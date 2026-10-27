-- Round 4 (after #791): episode numbers + archive, voting stays open on past episodes ("replay"),
-- "How red is Tony?" thermometer votes, and fan requests to add a past episode by pasting its link.
-- Applied as migration `bucketpull_archive_replay`. Run after final_results.sql.

-- ---------- episode numbers ----------
alter table public.episodes add column if not exists ep_num int;
create unique index if not exists episodes_ep_num_key on public.episodes (ep_num) where ep_num is not null;

create or replace function private.episode_num_from_title() returns trigger
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  -- "#791 - JIM NORTON ..." / "KT #791" -> 791 (test rooms titled TEST... never get a number)
  if new.ep_num is null and new.title !~* '^\s*test' then
    n := (regexp_match(new.title, '^\s*(?:KT\s*|Kill Tony\s*)?#\s*(\d{1,5})\b', 'i'))[1]::int;
    if n is not null and not exists (select 1 from public.episodes x where x.ep_num = n and x.id <> new.id) then
      new.ep_num := n;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists ep_num on public.episodes;
create trigger ep_num before insert or update of title, ep_num on public.episodes
  for each row execute function private.episode_num_from_title();
update public.episodes set ep_num = 791 where id = 'f02a73cf-d63b-4489-8888-6ae89c523ef5' and ep_num is null;

-- ---------- "How red is Tony?" votes (0-100, one per fan per episode) ----------
create table if not exists public.red_votes (
  episode_id uuid not null references public.episodes(id) on delete cascade,
  voter_id uuid not null default auth.uid(),
  level smallint not null check (level between 0 and 100),
  updated_at timestamptz not null default now(),
  primary key (episode_id, voter_id));
alter table public.red_votes enable row level security;
drop trigger if exists stamp on public.red_votes;
create trigger stamp before insert or update on public.red_votes for each row execute function private.vote_stamp();
drop policy if exists red_own_select on public.red_votes;
create policy red_own_select on public.red_votes for select to authenticated using (voter_id = (select auth.uid()));
grant select on public.red_votes to authenticated;

-- votes are open on live AND ended (past) episodes; only a scheduled room is closed
create or replace function private.episode_is_votable(p_episode uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.episodes e where e.id = p_episode and e.status in ('live','ended'));
$$;

create or replace function private.vote(p_kind text, p_target uuid, p_score integer default null, p_verdict text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); ep uuid;
begin
  if uid is null then raise exception 'sign in to vote' using errcode = '42501'; end if;
  if p_kind in ('comic','kb') then
    select episode_id into ep from public.comics where id = p_target;
  elsif p_kind = 'panel' then
    select episode_id into ep from public.panelists where id = p_target;
  elsif p_kind = 'red' then
    select id into ep from public.episodes where id = p_target;
  else
    raise exception 'unknown vote kind' using errcode = '22023';
  end if;
  if ep is null or not private.episode_is_votable(ep) then raise exception 'voting is closed' using errcode = '42501'; end if;
  if p_kind = 'comic' then
    if p_score is null or p_score not between 1 and 10 then raise exception 'score must be 1-10' using errcode = '22023'; end if;
    insert into public.comic_votes(episode_id, comic_id, voter_id, score) values (ep, p_target, uid, p_score)
      on conflict (comic_id, voter_id) do update set score = excluded.score where public.comic_votes.score is distinct from excluded.score;
  elsif p_kind = 'kb' then
    if p_verdict not in ('kill','bomb') then raise exception 'verdict must be kill or bomb' using errcode = '22023'; end if;
    insert into public.kill_bomb(episode_id, comic_id, voter_id, verdict) values (ep, p_target, uid, p_verdict)
      on conflict (comic_id, voter_id) do update set verdict = excluded.verdict where public.kill_bomb.verdict is distinct from excluded.verdict;
  elsif p_kind = 'red' then
    if p_score is null or p_score not between 0 and 100 then raise exception 'level must be 0-100' using errcode = '22023'; end if;
    insert into public.red_votes(episode_id, voter_id, level) values (ep, uid, p_score)
      on conflict (episode_id, voter_id) do update set level = excluded.level where public.red_votes.level is distinct from excluded.level;
  else
    if p_score is null or p_score not between 1 and 10 then raise exception 'score must be 1-10' using errcode = '22023'; end if;
    insert into public.panel_votes(episode_id, panelist_id, voter_id, score) values (ep, p_target, uid, p_score)
      on conflict (panelist_id, voter_id) do update set score = excluded.score where public.panel_votes.score is distinct from excluded.score;
  end if;
end $$;

create or replace function private.my_state(p_episode uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when auth.uid() is null then null else jsonb_build_object(
    'votes', coalesce((select jsonb_object_agg(v.comic_id, v.score) from public.comic_votes v where v.episode_id = p_episode and v.voter_id = auth.uid()), '{}'::jsonb),
    'kb',    coalesce((select jsonb_object_agg(v.comic_id, v.verdict) from public.kill_bomb v where v.episode_id = p_episode and v.voter_id = auth.uid()), '{}'::jsonb),
    'panel', coalesce((select jsonb_object_agg(v.panelist_id, v.score) from public.panel_votes v where v.episode_id = p_episode and v.voter_id = auth.uid()), '{}'::jsonb),
    'bet',   (select jsonb_build_object('pick', b.pick, 'confidence', b.confidence) from public.bets b where b.episode_id = p_episode and b.voter_id = auth.uid()),
    'red',   (select r.level from public.red_votes r where r.episode_id = p_episode and r.voter_id = auth.uid()))
  end;
$$;

create or replace function private.live_scores(p_episode uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with ep as (select id, status, current_comic_id from public.episodes where id = p_episode),
       cv as (select comic_id, count(*) n, round(avg(score)::numeric, 2) a from public.comic_votes where episode_id = p_episode group by comic_id),
       kb as (select comic_id, count(*) filter (where verdict = 'kill') k, count(*) filter (where verdict = 'bomb') b
                from public.kill_bomb where episode_id = p_episode group by comic_id),
       recent as (select c.id from public.comics c where c.episode_id = p_episode
                   order by (c.id = (select current_comic_id from ep)) desc, c.created_at desc
                   limit case when (select status from ep) = 'ended' then 1000 else 3 end),
       pv as (select panelist_id, count(*) n, round(avg(score)::numeric, 2) a from public.panel_votes where episode_id = p_episode group by panelist_id)
  select jsonb_build_object(
    'c', coalesce((select jsonb_object_agg(c.id, jsonb_build_array(coalesce(cv.n, 0), cv.a, coalesce(kb.k, 0), coalesce(kb.b, 0)))
                   from public.comics c left join cv on cv.comic_id = c.id left join kb on kb.comic_id = c.id
                   where c.episode_id = p_episode), '{}'::jsonb),
    'd', coalesce((select jsonb_object_agg(r.id, (select jsonb_agg(coalesce(x.n, 0) order by s.s) from generate_series(1, 10) s(s)
                        left join (select score, count(*) n from public.comic_votes where comic_id = r.id group by score) x on x.score = s.s))
                   from recent r), '{}'::jsonb),
    'p', coalesce((select jsonb_object_agg(pv.panelist_id, jsonb_build_array(pv.n, pv.a)) from pv), '{}'::jsonb),
    'b', (select jsonb_build_array(count(*) filter (where pick = 'yes'), count(*) filter (where pick = 'no')) from public.bets where episode_id = p_episode),
    'r', (select jsonb_build_array(count(*), round(avg(level)::numeric, 1)) from public.red_votes where episode_id = p_episode));
$$;

-- newest by air date (archived past episodes created later never take over the room)
create or replace function private.current_episode() returns public.episodes
language plpgsql stable security definer set search_path = '' as $$
declare ep public.episodes;
begin
  select * into ep from public.episodes where status = 'live' order by starts_at desc, created_at desc limit 1;
  if ep.id is null then
    select * into ep from public.episodes order by starts_at desc, created_at desc limit 1;
  end if;
  return ep;
end $$;

create or replace function private.live_meta(p_episode uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
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
               from public.episode_events v where v.episode_id = e.id), '[]'::jsonb),
    'prev', (select jsonb_build_object('id', x.id, 'title', x.title, 'ended_at', x.ended_at, 'ep_num', x.ep_num) from public.episodes x
              where x.status = 'ended' and x.id <> e.id and x.starts_at < e.starts_at and (x.ep_num is not null or e.ep_num is null)
              order by x.starts_at desc limit 1))
  from public.episodes e where e.id = p_episode;
$$;

-- live_poll gains p_want: '791' (episode number) or an episode uuid; the room then shows that episode
drop function if exists public.live_poll(uuid, bigint, text);
drop function if exists private.live_poll(uuid, bigint, text);
create or replace function private.live_poll(p_known_ep uuid default null, p_meta bigint default -1, p_client text default null, p_want text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare ep public.episodes; lv public.episodes; c private.poll_cache; mrev bigint; nv int; res jsonb; ttl interval; want_st text := null;
begin
  if p_client is not null and char_length(p_client) between 8 and 64 then
    insert into private.viewers as v (client, seen_at) values (p_client, now())
      on conflict (client) do update set seen_at = now() where v.seen_at < now() - interval '20 seconds';
  end if;
  if p_want is not null and p_want <> '' then
    if p_want ~ '^\d{1,5}$' then
      select * into ep from public.episodes where ep_num = p_want::int;
    elsif p_want ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      select * into ep from public.episodes where id = p_want::uuid;
    end if;
    want_st := case when ep.id is null then 'missing' else 'ok' end;
  end if;
  if ep.id is null then ep := private.current_episode(); end if;
  if ep.id is null then
    select count(*) into nv from private.viewers where seen_at > now() - interval '75 seconds';
    return jsonb_build_object('t', now(), 'ep', null, 'v', nv, 'want', want_st);
  end if;
  ttl := case when ep.status = 'ended' then interval '15 seconds' else interval '2 seconds' end;
  select * into c from private.poll_cache where episode_id = ep.id;
  if c.episode_id is null or c.scores_at < now() - ttl then
    select count(*) into nv from private.viewers
      where seen_at > now() - case when ep.status = 'ended' then interval '150 seconds' else interval '75 seconds' end;
    insert into private.poll_cache as pc (episode_id, scores, viewers, scores_at)
      values (ep.id, private.live_scores(ep.id), nv, now())
      on conflict (episode_id) do update set scores = excluded.scores, viewers = excluded.viewers, scores_at = excluded.scores_at
      where pc.scores_at < now() - ttl;
    select * into c from private.poll_cache where episode_id = ep.id;
    if random() < 0.02 then delete from private.viewers where seen_at < now() - interval '10 minutes'; end if;
  end if;
  select meta_rev into mrev from public.live_ticks where episode_id = ep.id;
  mrev := coalesce(mrev, 0);
  res := jsonb_build_object('t', now(), 'ep', ep.id, 'mv', mrev, 'v', c.viewers, 's', c.scores);
  if want_st is not null then
    res := res || jsonb_build_object('want', want_st);
    -- a fan pinned to an older episode hears about a live one
    if ep.status <> 'live' then
      select * into lv from public.episodes where status = 'live' order by starts_at desc limit 1;
      if lv.id is not null then res := res || jsonb_build_object('live', jsonb_build_object('id', lv.id, 'ep_num', lv.ep_num, 'title', lv.title)); end if;
    end if;
  end if;
  if p_known_ep is distinct from ep.id or p_meta is distinct from mrev then
    if c.meta_rev is distinct from mrev or c.meta is null then
      c.meta := private.live_meta(ep.id);
      update private.poll_cache set meta = c.meta, meta_rev = mrev where episode_id = ep.id;
    end if;
    res := res || jsonb_build_object('meta', jsonb_set(c.meta, '{episode,betting_is_open}', to_jsonb(private.betting_is_open(ep.id))));
  end if;
  return res || jsonb_build_object('bo', private.betting_is_open(ep.id));
end $$;
create or replace function public.live_poll(p_known_ep uuid default null, p_meta bigint default -1, p_client text default null, p_want text default null)
returns jsonb language sql volatile security invoker set search_path = '' as $$ select private.live_poll(p_known_ep, p_meta, p_client, p_want) $$;

-- ---------- archive (browse by show number) ----------
create or replace function private.episode_archive() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'ep_num', e.ep_num, 'title', e.title, 'status', e.status, 'video_id', e.video_id, 'starts_at', e.starts_at,
      'gt', e.golden_ticket_name,
      'comics', (select count(*) from public.comics c where c.episode_id = e.id),
      'votes', (select count(*) from public.comic_votes v where v.episode_id = e.id),
      'top', (select jsonb_build_object('name', c.name, 'avg', round(avg(v.score)::numeric, 1)) from public.comics c join public.comic_votes v on v.comic_id = c.id
               where c.episode_id = e.id and c.kind = 'bucket' group by c.id, c.name, c.ord order by avg(v.score) desc, count(*) desc, c.ord limit 1),
      'red', (select jsonb_build_array(count(*), round(avg(level)::numeric, 1)) from public.red_votes r where r.episode_id = e.id))
    order by e.ep_num desc), '[]'::jsonb)
  from public.episodes e where e.ep_num is not null;
$$;
create or replace function public.episode_archive() returns jsonb
language sql stable security invoker set search_path = '' as $$ select private.episode_archive() $$;

-- ---------- fan requests: paste a past episode (#791 or later) ----------
create table if not exists public.episode_requests (
  id uuid primary key default gen_random_uuid(),
  video_id text check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  ep_num int check (ep_num between 1 and 99999),
  status text not null default 'pending' check (status in ('pending','processing','done','rejected')),
  reason text,
  episode_id uuid references public.episodes(id) on delete set null,
  client text,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (video_id is not null or ep_num is not null));
alter table public.episode_requests enable row level security;   -- no policies: only via the RPCs below
create index if not exists episode_requests_status on public.episode_requests (status, created_at);

create or replace function private.request_json(r public.episode_requests) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', r.id, 'status', r.status, 'reason', r.reason, 'video_id', r.video_id,
    'ep_num', coalesce((select e.ep_num from public.episodes e where e.id = r.episode_id), r.ep_num), 'episode_id', r.episode_id,
    'position', case when r.status in ('pending','processing') then
        (select count(*) from public.episode_requests x where x.status in ('pending','processing') and x.created_at <= r.created_at) end);
$$;

create or replace function private.request_episode(p_video text default null, p_num int default null, p_client text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e public.episodes; r public.episode_requests; v text := nullif(trim(coalesce(p_video, '')), '');
begin
  if v is not null and v !~ '^[A-Za-z0-9_-]{11}$' then return jsonb_build_object('status', 'invalid'); end if;
  if p_num is not null and p_num not between 1 and 99999 then return jsonb_build_object('status', 'invalid'); end if;
  if v is null and p_num is null then return jsonb_build_object('status', 'invalid'); end if;
  if p_num is not null and p_num < 791 then return jsonb_build_object('status', 'too_old', 'min', 791); end if;
  select * into e from public.episodes where ep_num is not null and ((v is not null and video_id = v) or (p_num is not null and ep_num = p_num))
    order by starts_at desc limit 1;
  if e.id is not null then return jsonb_build_object('status', 'ready', 'ep_num', e.ep_num, 'episode_id', e.id); end if;
  select * into r from public.episode_requests where ((v is not null and video_id = v) or (p_num is not null and ep_num = p_num))
    order by created_at desc limit 1;
  if r.id is not null and (r.status <> 'rejected' or r.updated_at > now() - interval '6 hours') then return private.request_json(r); end if;
  if (select count(*) from public.episode_requests where status in ('pending','processing')) >= 25 then
    return jsonb_build_object('status', 'busy'); end if;
  if p_client is not null and (select count(*) from public.episode_requests where client = p_client and created_at > now() - interval '1 hour') >= 5 then
    return jsonb_build_object('status', 'busy'); end if;
  insert into public.episode_requests(video_id, ep_num, client) values (v, p_num, left(p_client, 64)) returning * into r;
  return private.request_json(r);
end $$;
create or replace function public.request_episode(p_video text default null, p_num int default null, p_client text default null)
returns jsonb language sql volatile security invoker set search_path = '' as $$ select private.request_episode(p_video, p_num, p_client) $$;

create or replace function private.request_status(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select private.request_json(r) from public.episode_requests r where r.id = p_id;
$$;
create or replace function public.request_status(p_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$ select private.request_status(p_id) $$;

-- ---------- host (autopilot box) side ----------
create or replace function private.host_pending_requests(p_secret text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_host(p_secret);
  return coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at) from public.episode_requests r where r.status in ('pending','processing')), '[]'::jsonb);
end $$;

create or replace function private.host_update_request(p_secret text, p_id uuid, p_status text, p_reason text default null,
  p_episode uuid default null, p_num int default null, p_video text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_host(p_secret);
  update public.episode_requests set status = p_status, reason = left(p_reason, 200),
    episode_id = coalesce(p_episode, episode_id), ep_num = coalesce(p_num, ep_num),
    video_id = coalesce(case when p_video ~ '^[A-Za-z0-9_-]{11}$' then p_video end, video_id),
    attempts = attempts + case when p_status = 'processing' then 1 else 0 end, updated_at = now()
  where id = p_id;
  -- every other open request for the same episode resolves with it
  if p_status in ('done','rejected') and p_num is not null then
    update public.episode_requests set status = p_status, reason = left(p_reason, 200), episode_id = coalesce(p_episode, episode_id), updated_at = now()
     where id <> p_id and status in ('pending','processing') and (ep_num = p_num or (p_video is not null and video_id = p_video));
  end if;
end $$;

-- create a finished (ended) episode from the offline lineup; never touches the live room
create or replace function private.host_archive_episode(p_secret text, p_num int, p_title text, p_video text, p_starts_at timestamptz,
  p_panel jsonb default null, p_comics jsonb default '[]'::jsonb, p_gt jsonb default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare eid uuid; x jsonb; cid uuid; nb int := 0; nr int := 0; k text; i int := 0; gt_c uuid;
begin
  perform private.require_host(p_secret);
  if p_num is null or p_num < 791 then raise exception 'episode number must be 791 or later' using errcode = '22023'; end if;
  select id into eid from public.episodes where ep_num = p_num;
  if eid is not null then return eid; end if;
  insert into public.episodes(title, youtube_url, video_id, status, starts_at, betting_open, auto_enabled, auto_gt, auto_betting, ended_at, ep_num,
                              golden_ticket_name, golden_ticket_at)
  values (left(coalesce(nullif(p_title, ''), '#' || p_num), 120),
          case when p_video ~ '^[A-Za-z0-9_-]{11}$' then 'https://www.youtube.com/watch?v=' || p_video end,
          case when p_video ~ '^[A-Za-z0-9_-]{11}$' then p_video end,
          'ended', coalesce(p_starts_at, now()), false, false, false, false, coalesce(p_starts_at, now()) + interval '3 hours', p_num,
          left(nullif(p_gt->>'name', ''), 60), case when nullif(p_gt->>'name', '') is not null then coalesce(p_starts_at, now()) + make_interval(secs => coalesce((p_gt->>'offset')::float, 0)) end)
  returning id into eid;
  insert into public.live_ticks(episode_id) values (eid) on conflict do nothing;
  for x in select * from jsonb_array_elements(coalesce(p_panel, '[{"name":"Tony Hinchcliffe","role":"Host"},{"name":"Redban","role":"Co-host"}]'::jsonb)) loop
    i := i + 1;
    insert into public.panelists(episode_id, name, role, ord) values (eid, left(x->>'name', 40), left(coalesce(x->>'role', 'Guest'), 40), i);
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p_comics, '[]'::jsonb)) order by (value->>'offset')::float loop
    k := case when x->>'kind' = 'regular' then 'regular' else 'bucket' end;
    if k = 'regular' then nr := nr + 1; else nb := nb + 1; end if;
    insert into public.comics(episode_id, name, ord, source, confidence, heard_as, kind, start_offset)
    values (eid, left(x->>'name', 60), case when k = 'regular' then nr else nb end, 'auto', (x->>'conf')::real, left(x->>'heard', 120), k, (x->>'offset')::real)
    returning id into cid;
    perform private.add_event(eid, 'comic', (x->>'offset')::real, cid, jsonb_build_object('name', x->>'name', 'kind', k), 'auto', (x->>'conf')::real);
    if p_gt is not null and lower(x->>'name') = lower(p_gt->>'name') then gt_c := cid; end if;
  end loop;
  if nullif(p_gt->>'name', '') is not null then
    perform private.add_event(eid, 'golden_ticket', (p_gt->>'offset')::real, gt_c, jsonb_build_object('name', p_gt->>'name', 'comic', gt_c), 'auto', null);
  end if;
  return eid;
end $$;

-- public thin wrappers for the host RPCs
create or replace function public.host_pending_requests(p_secret text) returns jsonb
language sql volatile security invoker set search_path = '' as $$ select private.host_pending_requests(p_secret) $$;
create or replace function public.host_update_request(p_secret text, p_id uuid, p_status text, p_reason text default null,
  p_episode uuid default null, p_num int default null, p_video text default null)
returns void language sql volatile security invoker set search_path = '' as $$ select private.host_update_request(p_secret, p_id, p_status, p_reason, p_episode, p_num, p_video) $$;
create or replace function public.host_archive_episode(p_secret text, p_num int, p_title text, p_video text, p_starts_at timestamptz,
  p_panel jsonb default null, p_comics jsonb default '[]'::jsonb, p_gt jsonb default null)
returns uuid language sql volatile security invoker set search_path = '' as $$ select private.host_archive_episode(p_secret, p_num, p_title, p_video, p_starts_at, p_panel, p_comics, p_gt) $$;

-- ---------- grants ----------
do $$
declare f text;
begin
  foreach f in array array[
    'public.live_poll(uuid, bigint, text, text)', 'private.live_poll(uuid, bigint, text, text)',
    'public.episode_archive()', 'private.episode_archive()',
    'public.request_episode(text, int, text)', 'private.request_episode(text, int, text)',
    'public.request_status(uuid)', 'private.request_status(uuid)', 'private.request_json(public.episode_requests)',
    'public.host_pending_requests(text)', 'private.host_pending_requests(text)',
    'public.host_update_request(text, uuid, text, text, uuid, int, text)', 'private.host_update_request(text, uuid, text, text, uuid, int, text)',
    'public.host_archive_episode(text, int, text, text, timestamptz, jsonb, jsonb, jsonb)', 'private.host_archive_episode(text, int, text, text, timestamptz, jsonb, jsonb, jsonb)',
    'private.episode_is_votable(uuid)', 'private.vote(text, uuid, integer, text)', 'private.my_state(uuid)']
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
  execute 'revoke execute on function private.episode_num_from_title() from public, anon, authenticated';
end $$;
