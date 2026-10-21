-- Bucket Pull Live v3: no fan chat, Kill Tony regulars, HTTP-polled shared state for ~200 viewers on the free tier.
-- Run after schema.sql, autopilot.sql, autopilot_sync.sql. Idempotent.
--
-- * Fans no longer use Realtime at all. They call live_poll() every ~5 s (jittered, slower when the tab is hidden).
--   live_poll returns compact scores (cached server-side, recomputed at most every 2 s) and only re-sends the
--   episode "meta" (comics, panel, timeline, episode row) when live_ticks.meta_rev changed.
-- * Viewer count = clients seen by live_poll in the last 75 s (unlogged heartbeat table), no Presence.
-- * Votes go through vote() (one upsert per user per target); the per-vote live_ticks bump is gone.
-- * comics.kind = 'bucket' | 'regular'. Regulars are rated in the same comic_votes table (1-10; the regulars
--   card writes 5 stars as 2-10 like the panel).

------------------------------------------------------------------------------------------------
-- 1. fan chat removed
------------------------------------------------------------------------------------------------
do $$ begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages') then
    alter publication supabase_realtime drop table public.chat_messages;
  end if;
end $$;
drop function if exists public.host_delete_message(text, bigint);
drop function if exists private.host_delete_message(text, bigint);
drop function if exists public.host_mute(text, uuid, boolean, boolean);
drop function if exists private.host_mute(text, uuid, boolean, boolean);
drop table if exists public.chat_messages;
drop function if exists private.chat_guard();
drop table if exists private.chat_rate;
drop table if exists private.muted_users;
drop table if exists private.banned_words;

create or replace function private.host_reset_episode(p_secret text, p_episode uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  perform private.require_host(p_secret);
  delete from public.comic_votes where episode_id = p_episode;
  delete from public.kill_bomb   where episode_id = p_episode;
  delete from public.panel_votes where episode_id = p_episode;
  delete from public.bets        where episode_id = p_episode;
  update public.episodes set betting_open = true, golden_ticket_at = null, golden_ticket_name = null,
         starts_at = greatest(starts_at, now() - interval '1 minute') where id = p_episode;
  update private.poll_cache set scores_at = '-infinity' where episode_id = p_episode;
end $$;

------------------------------------------------------------------------------------------------
-- 2. regulars
------------------------------------------------------------------------------------------------
alter table public.comics add column if not exists kind text not null default 'bucket';
do $$ begin
  alter table public.comics add constraint comics_kind_chk check (kind in ('bucket','regular'));
exception when duplicate_object then null; end $$;

create or replace function private.renumber(p_episode uuid)
returns void language sql volatile security definer set search_path = '' as $$
  with r as (select id, row_number() over (partition by kind order by ord, created_at) n from public.comics where episode_id = p_episode)
  update public.comics x set ord = r.n from r where x.id = r.id and x.ord <> r.n;
$$;

drop function if exists public.auto_comic(text, uuid, text, text, real, real, uuid);
drop function if exists private.auto_comic(text, uuid, text, text, real, real, uuid);
create or replace function private.auto_comic(p_secret text, p_episode uuid, p_name text, p_heard text, p_offset real,
  p_conf real, p_comic uuid default null, p_kind text default 'bucket')
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare ep public.episodes; cid uuid := p_comic; n int; created boolean := false; nm text := private.title_case(p_name);
        k text := case when p_kind = 'regular' then 'regular' else 'bucket' end;
begin
  perform private.require_host(p_secret);
  select * into ep from public.episodes where id = p_episode for update;
  if ep.id is null or ep.status = 'ended' then return jsonb_build_object('ok', false, 'why', 'no live episode'); end if;
  if not ep.auto_enabled then return jsonb_build_object('ok', false, 'why', 'auto off'); end if;
  if cid is null and exists (select 1 from private.auto_blocklist b where b.episode_id = p_episode
                              and b.name in (lower(nm), lower(coalesce(p_heard, nm)))) then
    return jsonb_build_object('ok', false, 'why', 'blocked by host');
  end if;
  if cid is not null and not exists (select 1 from public.comics where id = cid and episode_id = p_episode) then
    return jsonb_build_object('ok', false, 'why', 'unknown comic');
  end if;
  if cid is not null and ep.current_comic_id = cid then return jsonb_build_object('ok', true, 'comic', cid, 'why', 'already on stage'); end if;
  if cid is null then
    select coalesce(max(ord), 0) + 1 into n from public.comics where episode_id = p_episode and kind = k;
    insert into public.comics(episode_id, name, ord, source, confidence, heard_as, start_offset, kind)
    values (p_episode, nm, n, 'auto', p_conf, left(p_heard, 120), p_offset, k) returning id into cid;
    created := true;
  end if;
  update public.episodes set current_comic_id = cid, current_comic_at = now() where id = p_episode;
  perform private.add_event(p_episode, 'comic', p_offset, cid,
    jsonb_build_object('prev', ep.current_comic_id, 'created', created, 'heard', p_heard, 'kind', k), 'auto', p_conf);
  return jsonb_build_object('ok', true, 'comic', cid, 'created', created, 'kind', k);
end $$;
create or replace function public.auto_comic(p_secret text, p_episode uuid, p_name text, p_heard text, p_offset real,
  p_conf real, p_comic uuid default null, p_kind text default 'bucket')
returns jsonb language sql volatile security invoker set search_path = '' as $$
  select private.auto_comic(p_secret, p_episode, p_name, p_heard, p_offset, p_conf, p_comic, p_kind) $$;

drop function if exists public.host_add_comic(text, uuid, text, boolean);
drop function if exists private.host_add_comic(text, uuid, text, boolean);
create or replace function private.host_add_comic(p_secret text, p_episode uuid, p_name text, p_make_current boolean default true,
  p_kind text default 'bucket')
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare cid uuid; n int; prev uuid; k text := case when p_kind = 'regular' then 'regular' else 'bucket' end;
begin
  perform private.require_host(p_secret);
  if char_length(btrim(coalesce(p_name, ''))) = 0 then raise exception 'name required'; end if;
  select coalesce(max(ord), 0) + 1 into n from public.comics where episode_id = p_episode and kind = k;
  insert into public.comics(episode_id, name, ord, source, locked, kind) values (p_episode, left(btrim(p_name), 60), n, 'host', true, k) returning id into cid;
  if p_make_current then
    select current_comic_id into prev from public.episodes where id = p_episode;
    update public.episodes set current_comic_id = cid, current_comic_at = now() where id = p_episode;
    perform private.add_event(p_episode, 'comic', null, cid, jsonb_build_object('prev', prev, 'created', true, 'kind', k), 'host', null);
  end if;
  return cid;
end $$;
create or replace function public.host_add_comic(p_secret text, p_episode uuid, p_name text, p_make_current boolean default true,
  p_kind text default 'bucket')
returns uuid language sql volatile security invoker set search_path = '' as $$
  select private.host_add_comic(p_secret, p_episode, p_name, p_make_current, p_kind) $$;

-- convert bucket pull <-> regular (locks the row so the autopilot won't touch it again)
create or replace function private.host_set_comic_kind(p_secret text, p_comic uuid, p_kind text)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare c public.comics;
begin
  perform private.require_host(p_secret);
  if p_kind not in ('bucket','regular') then raise exception 'kind must be bucket or regular'; end if;
  select * into c from public.comics where id = p_comic;
  if c.id is null or c.kind = p_kind then return; end if;
  update public.comics set kind = p_kind, locked = true,
         ord = (select coalesce(max(ord), 0) + 1 from public.comics where episode_id = c.episode_id and kind = p_kind)
   where id = p_comic;
  perform private.renumber(c.episode_id);
end $$;
create or replace function public.host_set_comic_kind(p_secret text, p_comic uuid, p_kind text)
returns void language sql volatile security invoker set search_path = '' as $$ select private.host_set_comic_kind(p_secret, p_comic, p_kind) $$;

-- deletes renumber per kind
create or replace function private.host_delete_comic(p_secret text, p_comic uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare c public.comics;
begin
  perform private.require_host(p_secret);
  select * into c from public.comics where id = p_comic;
  if c.id is null then return; end if;
  insert into private.auto_blocklist(episode_id, name) values (c.episode_id, lower(coalesce(c.heard_as, c.name))) on conflict do nothing;
  insert into private.auto_blocklist(episode_id, name) values (c.episode_id, lower(c.name)) on conflict do nothing;
  delete from public.comics where id = p_comic;
  perform private.renumber(c.episode_id);
end $$;

-- autopilot heartbeat: comics now carry kind
create or replace function private.auto_heartbeat(p_secret text, p_episode uuid, p_state text, p_offset real,
  p_text text default null, p_conf real default null, p_event text default null, p_info jsonb default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare ep public.episodes;
begin
  perform private.require_host(p_secret);
  update public.autopilot_status set episode_id = p_episode, heartbeat_at = now(), state = left(p_state, 80),
         stream_offset = p_offset, last_text = coalesce(left(p_text, 400), last_text),
         last_confidence = coalesce(p_conf, last_confidence), last_event = coalesce(left(p_event, 200), last_event),
         info = coalesce(p_info, info)
   where id = 1;
  if p_episode is null then return null; end if;
  select * into ep from public.episodes where id = p_episode;
  return jsonb_build_object(
    'status', ep.status, 'auto_enabled', ep.auto_enabled, 'auto_gt', ep.auto_gt, 'auto_betting', ep.auto_betting,
    'betting_open', ep.betting_open, 'golden_ticket_at', ep.golden_ticket_at, 'current_comic_id', ep.current_comic_id,
    'sync_adjust', ep.sync_adjust, 'starts_at', ep.starts_at, 'youtube_url', ep.youtube_url,
    'comics', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'heard_as', c.heard_as, 'ord', c.ord,
                          'locked', c.locked, 'source', c.source, 'kind', c.kind) order by c.kind, c.ord) from public.comics c where c.episode_id = p_episode), '[]'::jsonb),
    'blocked', coalesce((select jsonb_agg(b.name) from private.auto_blocklist b where b.episode_id = p_episode), '[]'::jsonb));
end $$;

------------------------------------------------------------------------------------------------
-- 3. polling instead of realtime
------------------------------------------------------------------------------------------------
-- votes no longer bump live_ticks (that row was a hot spot and a realtime fan-out source)
drop trigger if exists tick on public.comic_votes;
drop trigger if exists tick on public.kill_bomb;
drop trigger if exists tick on public.panel_votes;
drop trigger if exists tick on public.bets;

alter table public.live_ticks add column if not exists meta_rev bigint not null default 0;

-- anything a fan renders that is not a score: bump meta_rev so polls re-send the meta block
create or replace function private.bump_meta()
returns trigger language plpgsql security definer set search_path = '' as $$
declare ep uuid;
begin
  if tg_table_name = 'episodes' then
    ep := case when tg_op = 'DELETE' then old.id else new.id end;
    if tg_op = 'DELETE' then return null; end if;
    insert into public.live_ticks as t (episode_id, rev, meta_rev, updated_at) values (ep, 0, 1, now())
      on conflict (episode_id) do update set meta_rev = t.meta_rev + 1, updated_at = now();
  else
    ep := case when tg_op = 'DELETE' then old.episode_id else new.episode_id end;
    update public.live_ticks set meta_rev = meta_rev + 1, updated_at = now() where episode_id = ep;
  end if;
  return null;
end $$;
do $$ declare t text; begin
  foreach t in array array['comics','panelists','episode_events'] loop
    execute format('drop trigger if exists meta on public.%I', t);
    execute format('create trigger meta after insert or update or delete on public.%I for each row execute function private.bump_meta()', t);
  end loop;
end $$;
drop trigger if exists meta on public.episodes;
create trigger meta after insert or update on public.episodes for each row execute function private.bump_meta();

-- heartbeat table for the viewer count (unlogged: no WAL, losing it on a crash is harmless)
create unlogged table if not exists private.viewers (
  client  text primary key check (char_length(client) between 8 and 64),
  seen_at timestamptz not null default now()
);
create index if not exists viewers_seen_idx on private.viewers(seen_at);
alter table private.viewers enable row level security;

create table if not exists private.poll_cache (
  episode_id uuid primary key references public.episodes(id) on delete cascade,
  scores     jsonb,
  viewers    int not null default 0,
  scores_at  timestamptz not null default '-infinity',
  meta_rev   bigint,
  meta       jsonb
);
alter table private.poll_cache enable row level security;

create or replace function private.current_episode()
returns public.episodes language plpgsql stable security definer set search_path = '' as $$
declare ep public.episodes;
begin
  select * into ep from public.episodes where status <> 'ended' order by created_at desc limit 1;
  if ep.id is null then
    select * into ep from public.episodes where status = 'ended' and ended_at > now() - interval '12 hours'
     order by ended_at desc limit 1;
  end if;
  return ep;
end $$;

-- everything except scores (changes rarely)
create or replace function private.live_meta(p_episode uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'episode', to_jsonb(e) - 'auto_enabled' - 'auto_gt' - 'auto_betting' || jsonb_build_object(
        'betting_is_open', private.betting_is_open(e.id), 'auto_enabled', e.auto_enabled, 'auto_gt', e.auto_gt, 'auto_betting', e.auto_betting),
    'comics', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'ord', c.ord, 'kind', c.kind,
                 'source', c.source, 'confidence', c.confidence, 'heard_as', c.heard_as, 'locked', c.locked,
                 'start_offset', c.start_offset) order by c.kind, c.ord, c.created_at)
               from public.comics c where c.episode_id = e.id), '[]'::jsonb),
    'panel', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'role', p.role) order by p.ord)
               from public.panelists p where p.episode_id = e.id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'kind', v.kind, 'offset', v.offset_s, 'comic_id', v.comic_id,
                 'source', v.source, 'confidence', v.confidence, 'cancelled', v.cancelled, 'data', v.data, 'at', v.created_at) order by v.id)
               from public.episode_events v where v.episode_id = e.id), '[]'::jsonb))
  from public.episodes e where e.id = p_episode;
$$;

-- compact scores: c = {comic: [votes, avg, kills, bombs]}, d = {comic: dist[10]} for the 3 most recently staged,
-- p = {panelist: [votes, avg]}, b = [yes, no]
create or replace function private.live_scores(p_episode uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  with cv as (select comic_id, count(*) n, round(avg(score)::numeric, 2) a from public.comic_votes where episode_id = p_episode group by comic_id),
       kb as (select comic_id, count(*) filter (where verdict = 'kill') k, count(*) filter (where verdict = 'bomb') b
                from public.kill_bomb where episode_id = p_episode group by comic_id),
       recent as (select c.id from public.comics c where c.episode_id = p_episode
                   order by (c.id = (select current_comic_id from public.episodes where id = p_episode)) desc, c.created_at desc limit 3),
       pv as (select panelist_id, count(*) n, round(avg(score)::numeric, 2) a from public.panel_votes where episode_id = p_episode group by panelist_id)
  select jsonb_build_object(
    'c', coalesce((select jsonb_object_agg(c.id, jsonb_build_array(coalesce(cv.n, 0), cv.a, coalesce(kb.k, 0), coalesce(kb.b, 0)))
                   from public.comics c left join cv on cv.comic_id = c.id left join kb on kb.comic_id = c.id
                   where c.episode_id = p_episode), '{}'::jsonb),
    'd', coalesce((select jsonb_object_agg(r.id, (select jsonb_agg(coalesce(x.n, 0) order by s.s) from generate_series(1, 10) s(s)
                        left join (select score, count(*) n from public.comic_votes where comic_id = r.id group by score) x on x.score = s.s))
                   from recent r), '{}'::jsonb),
    'p', coalesce((select jsonb_object_agg(pv.panelist_id, jsonb_build_array(pv.n, pv.a)) from pv), '{}'::jsonb),
    'b', (select jsonb_build_array(count(*) filter (where pick = 'yes'), count(*) filter (where pick = 'no')) from public.bets where episode_id = p_episode));
$$;

create or replace function private.live_poll(p_known_ep uuid default null, p_meta bigint default -1, p_client text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare ep public.episodes; c private.poll_cache; mrev bigint; nv int; res jsonb;
begin
  if p_client is not null and char_length(p_client) between 8 and 64 then
    insert into private.viewers as v (client, seen_at) values (p_client, now())
      on conflict (client) do update set seen_at = now() where v.seen_at < now() - interval '20 seconds';
  end if;
  ep := private.current_episode();
  if ep.id is null then
    select count(*) into nv from private.viewers where seen_at > now() - interval '75 seconds';
    return jsonb_build_object('t', now(), 'ep', null, 'v', nv);
  end if;
  select * into c from private.poll_cache where episode_id = ep.id;
  if c.episode_id is null or c.scores_at < now() - interval '2 seconds' then
    select count(*) into nv from private.viewers where seen_at > now() - interval '75 seconds';
    insert into private.poll_cache as pc (episode_id, scores, viewers, scores_at)
      values (ep.id, private.live_scores(ep.id), nv, now())
      on conflict (episode_id) do update set scores = excluded.scores, viewers = excluded.viewers, scores_at = excluded.scores_at
      where pc.scores_at < now() - interval '2 seconds';
    select * into c from private.poll_cache where episode_id = ep.id;
    if random() < 0.02 then delete from private.viewers where seen_at < now() - interval '10 minutes'; end if;
  end if;
  select meta_rev into mrev from public.live_ticks where episode_id = ep.id;
  mrev := coalesce(mrev, 0);
  res := jsonb_build_object('t', now(), 'ep', ep.id, 'mv', mrev, 'v', c.viewers, 's', c.scores);
  if p_known_ep is distinct from ep.id or p_meta is distinct from mrev then
    if c.meta_rev is distinct from mrev or c.meta is null then
      c.meta := private.live_meta(ep.id);
      update private.poll_cache set meta = c.meta, meta_rev = mrev where episode_id = ep.id;
    end if;
    -- betting_is_open depends on the clock (15-min auto close); refresh that one field
    res := res || jsonb_build_object('meta', jsonb_set(c.meta, '{episode,betting_is_open}', to_jsonb(private.betting_is_open(ep.id))));
  end if;
  return res || jsonb_build_object('bo', private.betting_is_open(ep.id));
end $$;

-- the caller's own votes (fetched once per episode; the page keeps them locally afterwards)
create or replace function private.my_state(p_episode uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when auth.uid() is null then null else jsonb_build_object(
    'votes', coalesce((select jsonb_object_agg(v.comic_id, v.score) from public.comic_votes v where v.episode_id = p_episode and v.voter_id = auth.uid()), '{}'::jsonb),
    'kb',    coalesce((select jsonb_object_agg(v.comic_id, v.verdict) from public.kill_bomb v where v.episode_id = p_episode and v.voter_id = auth.uid()), '{}'::jsonb),
    'panel', coalesce((select jsonb_object_agg(v.panelist_id, v.score) from public.panel_votes v where v.episode_id = p_episode and v.voter_id = auth.uid()), '{}'::jsonb),
    'bet',   (select jsonb_build_object('pick', b.pick, 'confidence', b.confidence) from public.bets b where b.episode_id = p_episode and b.voter_id = auth.uid()))
  end;
$$;

-- one write per vote: p_kind 'comic' (p_score 1-10), 'kb' (p_verdict kill|bomb), 'panel' (p_score 1-10)
create or replace function private.vote(p_kind text, p_target uuid, p_score int default null, p_verdict text default null)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); ep uuid;
begin
  if uid is null then raise exception 'sign in to vote' using errcode = '42501'; end if;
  if p_kind in ('comic','kb') then
    select episode_id into ep from public.comics where id = p_target;
  elsif p_kind = 'panel' then
    select episode_id into ep from public.panelists where id = p_target;
  else
    raise exception 'unknown vote kind' using errcode = '22023';
  end if;
  if ep is null or not private.episode_is_live(ep) then raise exception 'voting is closed' using errcode = '42501'; end if;
  if p_kind = 'comic' then
    if p_score is null or p_score not between 1 and 10 then raise exception 'score must be 1-10' using errcode = '22023'; end if;
    insert into public.comic_votes(episode_id, comic_id, voter_id, score) values (ep, p_target, uid, p_score)
      on conflict (comic_id, voter_id) do update set score = excluded.score where public.comic_votes.score is distinct from excluded.score;
  elsif p_kind = 'kb' then
    if p_verdict not in ('kill','bomb') then raise exception 'verdict must be kill or bomb' using errcode = '22023'; end if;
    insert into public.kill_bomb(episode_id, comic_id, voter_id, verdict) values (ep, p_target, uid, p_verdict)
      on conflict (comic_id, voter_id) do update set verdict = excluded.verdict where public.kill_bomb.verdict is distinct from excluded.verdict;
  else
    if p_score is null or p_score not between 1 and 10 then raise exception 'score must be 1-10' using errcode = '22023'; end if;
    insert into public.panel_votes(episode_id, panelist_id, voter_id, score) values (ep, p_target, uid, p_score)
      on conflict (panelist_id, voter_id) do update set score = excluded.score where public.panel_votes.score is distinct from excluded.score;
  end if;
end $$;

create or replace function public.live_poll(p_known_ep uuid default null, p_meta bigint default -1, p_client text default null)
returns jsonb language sql volatile security invoker set search_path = '' as $$ select private.live_poll(p_known_ep, p_meta, p_client) $$;
create or replace function public.my_state(p_episode uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$ select private.my_state(p_episode) $$;
create or replace function public.vote(p_kind text, p_target uuid, p_score int default null, p_verdict text default null)
returns void language sql volatile security invoker set search_path = '' as $$ select private.vote(p_kind, p_target, p_score, p_verdict) $$;

-- live_state (old clients / tools): same as before plus kind, without chat mute
create or replace function private.live_state(p_episode uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare ep public.episodes; me uuid := auth.uid(); res jsonb;
begin
  if p_episode is null then ep := private.current_episode();
  else select * into ep from public.episodes where id = p_episode; end if;
  if ep.id is null then return jsonb_build_object('episode', null, 'server_time', now()); end if;
  select jsonb_build_object(
    'server_time', now(),
    'episode', to_jsonb(ep) || jsonb_build_object('betting_is_open', private.betting_is_open(ep.id)),
    'comics', coalesce((select jsonb_agg(jsonb_build_object('id', s.comic_id, 'name', s.name, 'ord', s.ord, 'votes', s.votes,
                         'avg', s.avg_score, 'dist', s.dist, 'kills', k.kills, 'bombs', k.bombs, 'kind', c.kind,
                         'source', c.source, 'confidence', c.confidence, 'heard_as', c.heard_as, 'locked', c.locked,
                         'start_offset', c.start_offset) order by c.kind, s.ord)
                        from private.comic_scores(ep.id) s join private.kill_bomb_split(ep.id) k using (comic_id)
                        join public.comics c on c.id = s.comic_id), '[]'::jsonb),
    'panel', coalesce((select jsonb_agg(jsonb_build_object('id', p.panelist_id, 'name', p.name, 'role', p.role, 'votes', p.votes, 'avg', p.avg_score) order by p.ord)
                       from private.panel_scores(ep.id) p), '[]'::jsonb),
    'bet', (select to_jsonb(b) from private.bet_odds(ep.id) b),
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'offset', e.offset_s, 'comic_id', e.comic_id,
                         'source', e.source, 'confidence', e.confidence, 'cancelled', e.cancelled, 'data', e.data,
                         'at', e.created_at) order by e.id)
                        from public.episode_events e where e.episode_id = ep.id), '[]'::jsonb),
    'me', private.my_state(ep.id)
  ) into res;
  return res;
end $$;

-- realtime: only the host dashboard's autopilot_status stays published
do $$ declare t text; begin
  foreach t in array array['comics','episode_events','episodes','live_ticks','panelists','comic_votes','kill_bomb','panel_votes','bets'] loop
    if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime drop table public.%I', t);
    end if;
  end loop;
end $$;

-- grants
revoke execute on all functions in schema private from public;
revoke execute on function public.live_poll(uuid, bigint, text), public.my_state(uuid), public.vote(text, uuid, int, text),
  public.auto_comic(text, uuid, text, text, real, real, uuid, text), public.host_add_comic(text, uuid, text, boolean, text),
  public.host_set_comic_kind(text, uuid, text) from public;
grant execute on function public.live_poll(uuid, bigint, text), public.my_state(uuid), public.vote(text, uuid, int, text),
  public.auto_comic(text, uuid, text, text, real, real, uuid, text), public.host_add_comic(text, uuid, text, boolean, text),
  public.host_set_comic_kind(text, uuid, text) to anon, authenticated;
grant execute on function private.live_poll(uuid, bigint, text), private.my_state(uuid), private.vote(text, uuid, int, text),
  private.auto_comic(text, uuid, text, text, real, real, uuid, text), private.host_add_comic(text, uuid, text, boolean, text),
  private.host_set_comic_kind(text, uuid, text), private.renumber(uuid), private.current_episode(), private.live_meta(uuid),
  private.live_scores(uuid), private.live_state(uuid), private.host_reset_episode(text, uuid), private.host_delete_comic(text, uuid),
  private.auto_heartbeat(text, uuid, text, real, text, real, text, jsonb)
to anon, authenticated;

------------------------------------------------------------------------------------------------
-- fix: the episodes bump_meta trigger already creates the live_ticks row for a new episode
------------------------------------------------------------------------------------------------
create or replace function private.host_new_episode(p_secret text, p_title text default 'Premiere Night',
  p_starts_at timestamptz default null, p_youtube_url text default null, p_panel jsonb default null)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare eid uuid; p jsonb; i int := 0;
begin
  perform private.require_host(p_secret);
  update public.episodes set status = 'ended', ended_at = coalesce(ended_at, now()) where status <> 'ended';
  insert into public.episodes(title, starts_at, youtube_url, status)
    values (coalesce(nullif(btrim(p_title), ''), 'Premiere Night'), coalesce(p_starts_at, now()), nullif(btrim(p_youtube_url), ''), 'live')
    returning id into eid;
  insert into public.live_ticks(episode_id) values (eid) on conflict (episode_id) do nothing;
  for p in select * from jsonb_array_elements(coalesce(p_panel,
      '[{"name":"Tony","role":"Host"},{"name":"Redban","role":"Co-host"}]'::jsonb)) loop
    i := i + 1;
    insert into public.panelists(episode_id, name, role, ord) values (eid, p->>'name', coalesce(p->>'role', 'Guest'), i);
  end loop;
  return eid;
end $$;
