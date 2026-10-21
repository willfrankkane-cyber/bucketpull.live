-- Bucket Pull Live: autopilot (auto-detected comics / golden ticket / betting from the premiere audio)
-- Applied after schema.sql. Idempotent.
--
-- * episode_events: timeline of comic changes, golden ticket, betting and end-of-show, each with its
--   offset (seconds since the premiere started). Fans' browsers apply an event when their own YouTube
--   player reaches that offset; host events (offset null) apply immediately.
-- * The autopilot (a job on the box) uses the host secret and calls auto_* RPCs. Every auto_* RPC re-checks
--   the episode's auto switches server-side, so a host override always wins even in a race.
-- * Host actions pause auto for that item: editing a comic locks it, firing/cancelling the golden ticket turns
--   auto golden ticket off, opening/closing betting turns auto betting off. Auto ON/OFF is a global switch.

alter table public.episodes
  add column if not exists auto_enabled boolean not null default true,
  add column if not exists auto_gt      boolean not null default true,
  add column if not exists auto_betting boolean not null default true,
  add column if not exists video_id     text check (video_id is null or video_id ~ '^[A-Za-z0-9_-]{6,20}$'),
  add column if not exists ended_at     timestamptz;

alter table public.comics
  add column if not exists source     text not null default 'host' check (source in ('host','auto')),
  add column if not exists confidence real,
  add column if not exists heard_as   text check (heard_as is null or char_length(heard_as) <= 120),
  add column if not exists locked     boolean not null default false,
  add column if not exists start_offset real;

create table if not exists public.episode_events (
  id         bigint generated always as identity primary key,
  episode_id uuid not null references public.episodes(id) on delete cascade,
  kind       text not null check (kind in ('comic','golden_ticket','betting','end')),
  offset_s   real,                    -- seconds since premiere start; null = apply immediately
  comic_id   uuid references public.comics(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  source     text not null check (source in ('auto','host')),
  confidence real,
  cancelled  boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists episode_events_ep_idx on public.episode_events(episode_id, id);
create index if not exists episode_events_comic_idx on public.episode_events(comic_id);

-- one row: what the autopilot is doing right now (host dashboard reads it)
create table if not exists public.autopilot_status (
  id           int primary key default 1 check (id = 1),
  episode_id   uuid references public.episodes(id) on delete set null,
  heartbeat_at timestamptz,
  state        text check (state is null or char_length(state) <= 60),
  stream_offset real,
  last_text    text check (last_text is null or char_length(last_text) <= 400),
  last_confidence real,
  last_event   text check (last_event is null or char_length(last_event) <= 200),
  info         jsonb not null default '{}'::jsonb
);
create index if not exists autopilot_status_ep_idx on public.autopilot_status(episode_id);
insert into public.autopilot_status(id) values (1) on conflict do nothing;

create table if not exists private.auto_blocklist (
  episode_id uuid not null references public.episodes(id) on delete cascade,
  name       text not null,
  primary key (episode_id, name)
);
alter table private.auto_blocklist enable row level security;

alter table public.episode_events  enable row level security;
alter table public.autopilot_status enable row level security;
drop policy if exists events_read on public.episode_events;
create policy events_read on public.episode_events for select to anon, authenticated using (true);
drop policy if exists autopilot_read on public.autopilot_status;
create policy autopilot_read on public.autopilot_status for select to anon, authenticated using (true);
revoke all on public.episode_events, public.autopilot_status from anon, authenticated;
grant select on public.episode_events, public.autopilot_status to anon, authenticated;

------------------------------------------------------------------------------------------------
-- helpers
------------------------------------------------------------------------------------------------
create or replace function private.title_case(p text)
returns text language sql immutable set search_path = '' as $$
  -- keep mixed-case input as sent (the autopilot already title-cases O'Neill, McX...); otherwise initcap
  select left(btrim(regexp_replace(case when p ~ '[a-z]' and p ~ '[A-Z]' then btrim(p) else initcap(lower(btrim(p))) end, '\s+', ' ', 'g')), 60)
$$;

create or replace function private.add_event(p_episode uuid, p_kind text, p_offset real, p_comic uuid,
  p_data jsonb, p_source text, p_conf real)
returns bigint language plpgsql volatile security definer set search_path = '' as $$
declare eid bigint;
begin
  insert into public.episode_events(episode_id, kind, offset_s, comic_id, data, source, confidence)
  values (p_episode, p_kind, p_offset, p_comic, coalesce(p_data, '{}'::jsonb), p_source, p_conf) returning id into eid;
  return eid;
end $$;

------------------------------------------------------------------------------------------------
-- live_state: also show a just-ended episode (final board) for 12 h; add comic meta + timeline
------------------------------------------------------------------------------------------------
create or replace function private.live_state(p_episode uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare ep public.episodes; me uuid := auth.uid(); res jsonb;
begin
  if p_episode is null then
    select * into ep from public.episodes where status <> 'ended' order by created_at desc limit 1;
    if ep.id is null then
      select * into ep from public.episodes where status = 'ended' and ended_at > now() - interval '12 hours'
       order by ended_at desc limit 1;
    end if;
  else
    select * into ep from public.episodes where id = p_episode;
  end if;
  if ep.id is null then return jsonb_build_object('episode', null, 'server_time', now()); end if;
  select jsonb_build_object(
    'server_time', now(),
    'episode', to_jsonb(ep) || jsonb_build_object('betting_is_open', private.betting_is_open(ep.id)),
    'comics', coalesce((select jsonb_agg(jsonb_build_object('id', s.comic_id, 'name', s.name, 'ord', s.ord, 'votes', s.votes,
                         'avg', s.avg_score, 'dist', s.dist, 'kills', k.kills, 'bombs', k.bombs,
                         'source', c.source, 'confidence', c.confidence, 'heard_as', c.heard_as, 'locked', c.locked,
                         'start_offset', c.start_offset) order by s.ord)
                        from private.comic_scores(ep.id) s join private.kill_bomb_split(ep.id) k using (comic_id)
                        join public.comics c on c.id = s.comic_id), '[]'::jsonb),
    'panel', coalesce((select jsonb_agg(jsonb_build_object('id', p.panelist_id, 'name', p.name, 'role', p.role, 'votes', p.votes, 'avg', p.avg_score) order by p.ord)
                       from private.panel_scores(ep.id) p), '[]'::jsonb),
    'bet', (select to_jsonb(b) from private.bet_odds(ep.id) b),
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'offset', e.offset_s, 'comic_id', e.comic_id,
                         'source', e.source, 'confidence', e.confidence, 'cancelled', e.cancelled, 'data', e.data,
                         'at', e.created_at) order by e.id)
                        from public.episode_events e where e.episode_id = ep.id), '[]'::jsonb),
    'me', case when me is null then null else jsonb_build_object(
        'votes', coalesce((select jsonb_object_agg(v.comic_id, v.score) from public.comic_votes v where v.episode_id = ep.id and v.voter_id = me), '{}'::jsonb),
        'kb',    coalesce((select jsonb_object_agg(v.comic_id, v.verdict) from public.kill_bomb v where v.episode_id = ep.id and v.voter_id = me), '{}'::jsonb),
        'panel', coalesce((select jsonb_object_agg(v.panelist_id, v.score) from public.panel_votes v where v.episode_id = ep.id and v.voter_id = me), '{}'::jsonb),
        'bet',   (select jsonb_build_object('pick', b.pick, 'confidence', b.confidence) from public.bets b where b.episode_id = ep.id and b.voter_id = me),
        'muted', exists (select 1 from private.muted_users m where m.voter_id = me))
      end
  ) into res;
  return res;
end $$;

------------------------------------------------------------------------------------------------
-- host actions: record an event and pause auto for that item
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
  insert into public.live_ticks(episode_id) values (eid);
  for p in select * from jsonb_array_elements(coalesce(p_panel,
      '[{"name":"Tony","role":"Host"},{"name":"Redban","role":"Co-host"}]'::jsonb)) loop
    i := i + 1;
    insert into public.panelists(episode_id, name, role, ord) values (eid, p->>'name', coalesce(p->>'role', 'Guest'), i);
  end loop;
  return eid;
end $$;

create or replace function private.host_update_episode(p_secret text, p_episode uuid, p_title text default null,
  p_youtube_url text default null, p_starts_at timestamptz default null, p_status text default null)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  perform private.require_host(p_secret);
  update public.episodes set
    title       = coalesce(nullif(btrim(p_title), ''), title),
    youtube_url = case when p_youtube_url is null then youtube_url else nullif(btrim(p_youtube_url), '') end,
    starts_at   = coalesce(p_starts_at, starts_at),
    status      = coalesce(p_status, status),
    ended_at    = case when p_status = 'ended' then coalesce(ended_at, now()) when p_status = 'live' then null else ended_at end
  where id = p_episode;
end $$;

create or replace function private.host_add_comic(p_secret text, p_episode uuid, p_name text, p_make_current boolean default true)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare cid uuid; n int; prev uuid;
begin
  perform private.require_host(p_secret);
  select coalesce(max(ord), 0) + 1 into n from public.comics where episode_id = p_episode;
  insert into public.comics(episode_id, name, ord, source, locked) values (p_episode, btrim(p_name), n, 'host', true) returning id into cid;
  if p_make_current then
    select current_comic_id into prev from public.episodes where id = p_episode;
    update public.episodes set current_comic_id = cid, current_comic_at = now() where id = p_episode;
    perform private.add_event(p_episode, 'comic', null, cid, jsonb_build_object('prev', prev, 'created', true), 'host', null);
  end if;
  return cid;
end $$;

create or replace function private.host_set_current_comic(p_secret text, p_episode uuid, p_comic uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare prev uuid;
begin
  perform private.require_host(p_secret);
  if p_comic is not null and not exists (select 1 from public.comics where id = p_comic and episode_id = p_episode) then
    raise exception 'comic not in episode';
  end if;
  select current_comic_id into prev from public.episodes where id = p_episode;
  update public.episodes set current_comic_id = p_comic, current_comic_at = now() where id = p_episode;
  update public.comics set locked = true where id = p_comic;
  perform private.add_event(p_episode, 'comic', null, p_comic, jsonb_build_object('prev', prev), 'host', null);
end $$;

create or replace function private.host_rename_comic(p_secret text, p_comic uuid, p_name text)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  perform private.require_host(p_secret);
  if char_length(btrim(coalesce(p_name, ''))) = 0 then raise exception 'name required'; end if;
  update public.comics set name = left(btrim(p_name), 60), locked = true where id = p_comic;
end $$;

-- delete a false comic: votes go with it; autopilot won't re-add the same name this episode
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
  -- keep numbering tidy
  with r as (select id, row_number() over (order by ord, created_at) n from public.comics where episode_id = c.episode_id)
  update public.comics x set ord = r.n from r where x.id = r.id and x.ord <> r.n;
end $$;

create or replace function private.host_golden_ticket(p_secret text, p_episode uuid, p_name text default null)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare nm text;
begin
  perform private.require_host(p_secret);
  select coalesce(nullif(btrim(p_name), ''), c.name) into nm
    from public.episodes e left join public.comics c on c.id = e.current_comic_id where e.id = p_episode;
  update public.episodes set golden_ticket_at = now(), golden_ticket_name = left(coalesce(nm, 'Tonight''s comic'), 60),
         betting_open = false, auto_gt = false
  where id = p_episode;
  perform private.add_event(p_episode, 'golden_ticket', null, null, jsonb_build_object('name', nm), 'host', null);
end $$;

create or replace function private.host_cancel_golden_ticket(p_secret text, p_episode uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  perform private.require_host(p_secret);
  update public.episodes set golden_ticket_at = null, golden_ticket_name = null, auto_gt = false where id = p_episode;
  update public.episode_events set cancelled = true where episode_id = p_episode and kind = 'golden_ticket' and not cancelled;
end $$;

create or replace function private.host_set_betting(p_secret text, p_episode uuid, p_open boolean)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  perform private.require_host(p_secret);
  update public.episodes set betting_open = p_open, auto_betting = false,
         -- reopening after the 15-minute auto-close: push the cutoff out 15 minutes from now
         starts_at = case when p_open and now() >= starts_at + interval '15 minutes' then now() else starts_at end
   where id = p_episode;
  perform private.add_event(p_episode, 'betting', null, null, jsonb_build_object('open', p_open), 'host', null);
end $$;

create or replace function private.host_set_auto(p_secret text, p_episode uuid, p_enabled boolean default null,
  p_gt boolean default null, p_betting boolean default null)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  perform private.require_host(p_secret);
  update public.episodes set auto_enabled = coalesce(p_enabled, auto_enabled), auto_gt = coalesce(p_gt, auto_gt),
         auto_betting = coalesce(p_betting, auto_betting) where id = p_episode;
end $$;

-- undo the most recent auto action that is still in effect; returns a description
create or replace function private.host_undo_auto(p_secret text, p_episode uuid)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare e public.episode_events; c public.comics; msg text;
begin
  perform private.require_host(p_secret);
  select * into e from public.episode_events where episode_id = p_episode and source = 'auto' and not cancelled
   order by id desc limit 1;
  if e.id is null then return 'nothing to undo'; end if;
  update public.episode_events set cancelled = true where id = e.id;
  if e.kind = 'comic' then
    select * into c from public.comics where id = e.comic_id;
    update public.episodes set current_comic_id = (e.data->>'prev')::uuid, current_comic_at = now()
     where id = p_episode and (current_comic_id = e.comic_id or current_comic_id is null);
    if (e.data->>'created')::boolean and c.id is not null and not c.locked then
      insert into private.auto_blocklist(episode_id, name) values (p_episode, lower(coalesce(c.heard_as, c.name))) on conflict do nothing;
      delete from public.comics where id = c.id;
      msg := 'removed auto comic ' || c.name;
    else
      msg := 'unstaged ' || coalesce(c.name, 'comic');
    end if;
  elsif e.kind = 'golden_ticket' then
    update public.episodes set golden_ticket_at = null, golden_ticket_name = null, auto_gt = false where id = p_episode;
    msg := 'cancelled auto golden ticket';
  elsif e.kind = 'betting' then
    update public.episodes set betting_open = not coalesce((e.data->>'open')::boolean, false), auto_betting = false,
           starts_at = case when not coalesce((e.data->>'open')::boolean, false) and now() >= starts_at + interval '15 minutes' then now() else starts_at end
     where id = p_episode;
    msg := case when coalesce((e.data->>'open')::boolean, false) then 'closed betting again' else 'reopened betting' end;
  elsif e.kind = 'end' then
    update public.episodes set status = 'live', ended_at = null where id = p_episode;
    msg := 'reopened the episode';
  end if;
  return msg;
end $$;

------------------------------------------------------------------------------------------------
-- autopilot RPCs (host secret; each re-checks the switches so host overrides win)
------------------------------------------------------------------------------------------------
create or replace function private.auto_heartbeat(p_secret text, p_episode uuid, p_state text, p_offset real,
  p_text text default null, p_conf real default null, p_event text default null, p_info jsonb default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare ep public.episodes;
begin
  perform private.require_host(p_secret);
  update public.autopilot_status set episode_id = p_episode, heartbeat_at = now(), state = left(p_state, 60),
         stream_offset = p_offset, last_text = coalesce(left(p_text, 400), last_text),
         last_confidence = coalesce(p_conf, last_confidence), last_event = coalesce(left(p_event, 200), last_event),
         info = coalesce(p_info, info)
   where id = 1;
  if p_episode is null then return null; end if;
  select * into ep from public.episodes where id = p_episode;
  return jsonb_build_object(
    'status', ep.status, 'auto_enabled', ep.auto_enabled, 'auto_gt', ep.auto_gt, 'auto_betting', ep.auto_betting,
    'betting_open', ep.betting_open, 'golden_ticket_at', ep.golden_ticket_at, 'current_comic_id', ep.current_comic_id,
    'comics', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'heard_as', c.heard_as, 'ord', c.ord,
                          'locked', c.locked, 'source', c.source) order by c.ord) from public.comics c where c.episode_id = p_episode), '[]'::jsonb),
    'blocked', coalesce((select jsonb_agg(b.name) from private.auto_blocklist b where b.episode_id = p_episode), '[]'::jsonb));
end $$;

-- stage a comic heard on the stream. p_comic = existing comic to re-stage (fuzzy-matched by the autopilot), or null to add.
create or replace function private.auto_comic(p_secret text, p_episode uuid, p_name text, p_heard text, p_offset real,
  p_conf real, p_comic uuid default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare ep public.episodes; cid uuid := p_comic; n int; created boolean := false; nm text := private.title_case(p_name);
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
    select coalesce(max(ord), 0) + 1 into n from public.comics where episode_id = p_episode;
    insert into public.comics(episode_id, name, ord, source, confidence, heard_as, start_offset)
    values (p_episode, nm, n, 'auto', p_conf, left(p_heard, 120), p_offset) returning id into cid;
    created := true;
  end if;
  update public.episodes set current_comic_id = cid, current_comic_at = now() where id = p_episode;
  perform private.add_event(p_episode, 'comic', p_offset, cid,
    jsonb_build_object('prev', ep.current_comic_id, 'created', created, 'heard', p_heard), 'auto', p_conf);
  return jsonb_build_object('ok', true, 'comic', cid, 'created', created);
end $$;

create or replace function private.auto_golden_ticket(p_secret text, p_episode uuid, p_offset real, p_conf real,
  p_name text default null, p_evidence jsonb default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare ep public.episodes; nm text;
begin
  perform private.require_host(p_secret);
  select * into ep from public.episodes where id = p_episode for update;
  if ep.id is null or ep.status = 'ended' then return jsonb_build_object('ok', false, 'why', 'no live episode'); end if;
  if not ep.auto_enabled or not ep.auto_gt then return jsonb_build_object('ok', false, 'why', 'auto golden ticket off'); end if;
  if ep.golden_ticket_at is not null then return jsonb_build_object('ok', false, 'why', 'already awarded'); end if;
  select coalesce(nullif(btrim(p_name), ''), c.name) into nm from public.comics c where c.id = ep.current_comic_id;
  nm := left(coalesce(nm, 'Tonight''s comic'), 60);
  update public.episodes set golden_ticket_at = now(), golden_ticket_name = nm, betting_open = false where id = p_episode;
  perform private.add_event(p_episode, 'golden_ticket', p_offset, null,
    jsonb_build_object('name', nm, 'comic', ep.current_comic_id) || coalesce(p_evidence, '{}'::jsonb), 'auto', p_conf);
  return jsonb_build_object('ok', true, 'name', nm);
end $$;

create or replace function private.auto_set_betting(p_secret text, p_episode uuid, p_open boolean, p_offset real,
  p_reason text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare ep public.episodes;
begin
  perform private.require_host(p_secret);
  select * into ep from public.episodes where id = p_episode for update;
  if ep.id is null or ep.status = 'ended' then return jsonb_build_object('ok', false, 'why', 'no live episode'); end if;
  if not ep.auto_enabled or not ep.auto_betting then return jsonb_build_object('ok', false, 'why', 'auto betting off'); end if;
  if ep.betting_open = p_open then return jsonb_build_object('ok', true, 'why', 'unchanged'); end if;
  update public.episodes set betting_open = p_open where id = p_episode;
  perform private.add_event(p_episode, 'betting', p_offset, null, jsonb_build_object('open', p_open, 'reason', p_reason), 'auto', null);
  return jsonb_build_object('ok', true);
end $$;

create or replace function private.auto_end_episode(p_secret text, p_episode uuid, p_offset real)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare ep public.episodes;
begin
  perform private.require_host(p_secret);
  select * into ep from public.episodes where id = p_episode for update;
  if ep.id is null or ep.status = 'ended' then return jsonb_build_object('ok', false, 'why', 'not live'); end if;
  if not ep.auto_enabled then return jsonb_build_object('ok', false, 'why', 'auto off'); end if;
  update public.episodes set status = 'ended', ended_at = now(), betting_open = false where id = p_episode;
  perform private.add_event(p_episode, 'end', p_offset, null, '{}'::jsonb, 'auto', null);
  return jsonb_build_object('ok', true);
end $$;

-- the premiere's actual start (seconds-accurate offsets) and video id
create or replace function private.auto_set_video(p_secret text, p_episode uuid, p_video_id text, p_starts_at timestamptz default null)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  perform private.require_host(p_secret);
  update public.episodes set video_id = p_video_id,
         youtube_url = coalesce(youtube_url, 'https://www.youtube.com/watch?v=' || p_video_id),
         starts_at = coalesce(p_starts_at, starts_at) where id = p_episode;
end $$;

revoke execute on all functions in schema private from public, anon, authenticated;

------------------------------------------------------------------------------------------------
-- public wrappers
------------------------------------------------------------------------------------------------
create or replace function public.host_rename_comic(p_secret text, p_comic uuid, p_name text)
returns void language sql volatile security invoker set search_path = '' as $$ select private.host_rename_comic(p_secret, p_comic, p_name) $$;
create or replace function public.host_delete_comic(p_secret text, p_comic uuid)
returns void language sql volatile security invoker set search_path = '' as $$ select private.host_delete_comic(p_secret, p_comic) $$;
create or replace function public.host_cancel_golden_ticket(p_secret text, p_episode uuid)
returns void language sql volatile security invoker set search_path = '' as $$ select private.host_cancel_golden_ticket(p_secret, p_episode) $$;
create or replace function public.host_set_auto(p_secret text, p_episode uuid, p_enabled boolean default null, p_gt boolean default null, p_betting boolean default null)
returns void language sql volatile security invoker set search_path = '' as $$ select private.host_set_auto(p_secret, p_episode, p_enabled, p_gt, p_betting) $$;
create or replace function public.host_undo_auto(p_secret text, p_episode uuid)
returns text language sql volatile security invoker set search_path = '' as $$ select private.host_undo_auto(p_secret, p_episode) $$;
create or replace function public.auto_heartbeat(p_secret text, p_episode uuid, p_state text, p_offset real,
  p_text text default null, p_conf real default null, p_event text default null, p_info jsonb default null)
returns jsonb language sql volatile security invoker set search_path = '' as $$ select private.auto_heartbeat(p_secret, p_episode, p_state, p_offset, p_text, p_conf, p_event, p_info) $$;
create or replace function public.auto_comic(p_secret text, p_episode uuid, p_name text, p_heard text, p_offset real, p_conf real, p_comic uuid default null)
returns jsonb language sql volatile security invoker set search_path = '' as $$ select private.auto_comic(p_secret, p_episode, p_name, p_heard, p_offset, p_conf, p_comic) $$;
create or replace function public.auto_golden_ticket(p_secret text, p_episode uuid, p_offset real, p_conf real, p_name text default null, p_evidence jsonb default null)
returns jsonb language sql volatile security invoker set search_path = '' as $$ select private.auto_golden_ticket(p_secret, p_episode, p_offset, p_conf, p_name, p_evidence) $$;
create or replace function public.auto_set_betting(p_secret text, p_episode uuid, p_open boolean, p_offset real, p_reason text default null)
returns jsonb language sql volatile security invoker set search_path = '' as $$ select private.auto_set_betting(p_secret, p_episode, p_open, p_offset, p_reason) $$;
create or replace function public.auto_end_episode(p_secret text, p_episode uuid, p_offset real)
returns jsonb language sql volatile security invoker set search_path = '' as $$ select private.auto_end_episode(p_secret, p_episode, p_offset) $$;
create or replace function public.auto_set_video(p_secret text, p_episode uuid, p_video_id text, p_starts_at timestamptz default null)
returns void language sql volatile security invoker set search_path = '' as $$ select private.auto_set_video(p_secret, p_episode, p_video_id, p_starts_at) $$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.live_state(uuid), public.comic_scores(uuid), public.kill_bomb_split(uuid), public.panel_scores(uuid), public.bet_odds(uuid),
  public.host_check(text), public.host_new_episode(text, text, timestamptz, text, jsonb),
  public.host_update_episode(text, uuid, text, text, timestamptz, text), public.host_add_comic(text, uuid, text, boolean),
  public.host_set_current_comic(text, uuid, uuid), public.host_add_panelist(text, uuid, text, text),
  public.host_remove_panelist(text, uuid), public.host_golden_ticket(text, uuid, text),
  public.host_set_betting(text, uuid, boolean), public.host_delete_message(text, bigint),
  public.host_mute(text, uuid, boolean, boolean), public.host_reset_episode(text, uuid),
  public.host_rename_comic(text, uuid, text), public.host_delete_comic(text, uuid), public.host_cancel_golden_ticket(text, uuid),
  public.host_set_auto(text, uuid, boolean, boolean, boolean), public.host_undo_auto(text, uuid),
  public.auto_heartbeat(text, uuid, text, real, text, real, text, jsonb), public.auto_comic(text, uuid, text, text, real, real, uuid),
  public.auto_golden_ticket(text, uuid, real, real, text, jsonb), public.auto_set_betting(text, uuid, boolean, real, text),
  public.auto_end_episode(text, uuid, real), public.auto_set_video(text, uuid, text, timestamptz)
to anon, authenticated;
grant execute on function
  private.live_state(uuid), private.comic_scores(uuid), private.kill_bomb_split(uuid), private.panel_scores(uuid), private.bet_odds(uuid),
  private.host_check(text), private.host_new_episode(text, text, timestamptz, text, jsonb),
  private.host_update_episode(text, uuid, text, text, timestamptz, text), private.host_add_comic(text, uuid, text, boolean),
  private.host_set_current_comic(text, uuid, uuid), private.host_add_panelist(text, uuid, text, text),
  private.host_remove_panelist(text, uuid), private.host_golden_ticket(text, uuid, text),
  private.host_set_betting(text, uuid, boolean), private.host_delete_message(text, bigint),
  private.host_mute(text, uuid, boolean, boolean), private.host_reset_episode(text, uuid),
  private.host_rename_comic(text, uuid, text), private.host_delete_comic(text, uuid), private.host_cancel_golden_ticket(text, uuid),
  private.host_set_auto(text, uuid, boolean, boolean, boolean), private.host_undo_auto(text, uuid),
  private.auto_heartbeat(text, uuid, text, real, text, real, text, jsonb), private.auto_comic(text, uuid, text, text, real, real, uuid),
  private.auto_golden_ticket(text, uuid, real, real, text, jsonb), private.auto_set_betting(text, uuid, boolean, real, text),
  private.auto_end_episode(text, uuid, real), private.auto_set_video(text, uuid, text, timestamptz),
  private.episode_is_live(uuid), private.betting_is_open(uuid), private.add_event(uuid, text, real, uuid, jsonb, text, real),
  private.title_case(text)
to anon, authenticated;

-- realtime: fans follow the timeline; only the host dashboard subscribes to autopilot_status
do $$ declare t text; begin
  foreach t in array array['episode_events','autopilot_status'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
