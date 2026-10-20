-- Bucket Pull Live: shared realtime backend (Supabase / Postgres 15+)
-- Run once on a fresh project (SQL editor or as a migration). It is safe to re-run:
-- objects are created idempotently, and functions and policies are replaced.
--
-- Model
--   * Fans sign in anonymously (Supabase anonymous auth), so auth.uid() is a stable per-browser id.
--   * Fans write only their own rows (votes, kill/bomb, panel votes, bet, chat). RLS enforces this.
--   * Individual votes are private. Everyone reads shared numbers through SECURITY DEFINER RPCs
--     that return aggregates only (live_state, comic_scores, kill_bomb_split, panel_scores, bet_odds).
--   * Host actions go through SECURITY DEFINER RPCs (host_*). Each one checks a host secret whose
--     SHA-256 hash lives in private.host_config. That table is not readable by anon/authenticated.
--   * Clients subscribe (postgres_changes) to episodes, comics, panelists, chat_messages and to
--     live_ticks: a tiny per-episode counter that vote triggers bump (throttled). On a tick, clients
--     re-fetch live_state() once (debounced client-side), so thousands of viewers never stream raw votes.
--   * Viewer count = Supabase Realtime presence (no table).

create schema if not exists private;
revoke all on schema private from public;

------------------------------------------------------------------------------------------------
-- Tables
------------------------------------------------------------------------------------------------
create table if not exists public.episodes (
  id                 uuid primary key default gen_random_uuid(),
  title              text not null default 'Premiere Night' check (char_length(title) between 1 and 120),
  youtube_url        text check (youtube_url is null or char_length(youtube_url) <= 300),
  status             text not null default 'live' check (status in ('scheduled','live','ended')),
  starts_at          timestamptz not null default now(),
  betting_open       boolean not null default true,
  current_comic_id   uuid,
  golden_ticket_at   timestamptz,
  golden_ticket_name text check (golden_ticket_name is null or char_length(golden_ticket_name) <= 60),
  created_at         timestamptz not null default now()
);

create table if not exists public.comics (
  id         uuid primary key default gen_random_uuid(),
  episode_id uuid not null references public.episodes(id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 1 and 60),
  ord        int  not null default 1,
  created_at timestamptz not null default now(),
  unique (id, episode_id)
);
create index if not exists comics_episode_idx on public.comics(episode_id, ord);

alter table public.episodes add column if not exists current_comic_at timestamptz;

do $$ begin
  alter table public.episodes add constraint episodes_current_comic_fk
    foreign key (current_comic_id) references public.comics(id) on delete set null;
exception when duplicate_object then null; end $$;
create index if not exists episodes_current_comic_idx on public.episodes(current_comic_id);

create table if not exists public.panelists (
  id         uuid primary key default gen_random_uuid(),
  episode_id uuid not null references public.episodes(id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 1 and 40),
  role       text not null default 'Guest' check (char_length(role) <= 40),
  ord        int  not null default 1,
  unique (id, episode_id)
);
create index if not exists panelists_episode_idx on public.panelists(episode_id, ord);

create table if not exists public.comic_votes (
  episode_id uuid not null,
  comic_id   uuid not null,
  voter_id   uuid not null default auth.uid(),
  score      smallint not null check (score between 1 and 10),
  updated_at timestamptz not null default now(),
  primary key (comic_id, voter_id),
  foreign key (comic_id, episode_id) references public.comics(id, episode_id) on delete cascade
);
create index if not exists comic_votes_episode_idx on public.comic_votes(episode_id);
create index if not exists comic_votes_comic_ep_idx on public.comic_votes(comic_id, episode_id);
create index if not exists comic_votes_voter_idx on public.comic_votes(voter_id);

create table if not exists public.kill_bomb (
  episode_id uuid not null,
  comic_id   uuid not null,
  voter_id   uuid not null default auth.uid(),
  verdict    text not null check (verdict in ('kill','bomb')),
  updated_at timestamptz not null default now(),
  primary key (comic_id, voter_id),
  foreign key (comic_id, episode_id) references public.comics(id, episode_id) on delete cascade
);
create index if not exists kill_bomb_episode_idx on public.kill_bomb(episode_id);
create index if not exists kill_bomb_comic_ep_idx on public.kill_bomb(comic_id, episode_id);
create index if not exists kill_bomb_voter_idx on public.kill_bomb(voter_id);

create table if not exists public.panel_votes (
  episode_id   uuid not null,
  panelist_id  uuid not null,
  voter_id     uuid not null default auth.uid(),
  score        smallint not null check (score between 1 and 10),
  updated_at   timestamptz not null default now(),
  primary key (panelist_id, voter_id),
  foreign key (panelist_id, episode_id) references public.panelists(id, episode_id) on delete cascade
);
create index if not exists panel_votes_episode_idx on public.panel_votes(episode_id);
create index if not exists panel_votes_panelist_ep_idx on public.panel_votes(panelist_id, episode_id);
create index if not exists panel_votes_voter_idx on public.panel_votes(voter_id);

create table if not exists public.bets (
  episode_id uuid not null references public.episodes(id) on delete cascade,
  voter_id   uuid not null default auth.uid(),
  pick       text not null check (pick in ('yes','no')),
  confidence text check (confidence is null or confidence in ('vibes','sure','lock')),
  updated_at timestamptz not null default now(),
  primary key (episode_id, voter_id)
);
create index if not exists bets_voter_idx on public.bets(voter_id);

create table if not exists public.chat_messages (
  id         bigint generated always as identity primary key,
  episode_id uuid not null references public.episodes(id) on delete cascade,
  voter_id   uuid not null default auth.uid(),
  nickname   text not null check (char_length(nickname) between 1 and 24),
  body       text not null check (char_length(body) <= 200),
  deleted    boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists chat_episode_idx on public.chat_messages(episode_id, id desc);
create index if not exists chat_voter_idx on public.chat_messages(voter_id);

-- one row per episode; bumped (throttled) by vote/bet triggers so clients know to refetch aggregates
create table if not exists public.live_ticks (
  episode_id uuid primary key references public.episodes(id) on delete cascade,
  rev        bigint not null default 0,
  updated_at timestamptz not null default now()
);

-- private: host secret hash, mutes, chat rate limit, word filter
create table if not exists private.host_config (
  id          int primary key default 1 check (id = 1),
  secret_hash text not null
);
create table if not exists private.muted_users (
  voter_id   uuid primary key,
  created_at timestamptz not null default now()
);
create table if not exists private.chat_rate (
  voter_id uuid primary key,
  last_at  timestamptz not null
);
create table if not exists private.banned_words (word text primary key);
-- private.* tables: RLS on with NO policies on purpose (deny everything to API roles; only SECURITY DEFINER code reads them).
insert into private.banned_words(word) values
  ('fuck'),('fucking'),('shit'),('bitch'),('cunt'),('asshole'),('dick'),('pussy'),('bastard'),('slut'),('whore'),
  ('faggot'),('fag'),('nigger'),('nigga'),('retard'),('retarded'),('kike'),('spic'),('chink'),('tranny')
on conflict do nothing;

------------------------------------------------------------------------------------------------
-- Grants (RLS below does the row-level work)
------------------------------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
grant select on public.episodes, public.comics, public.panelists, public.chat_messages, public.live_ticks to anon, authenticated;
grant select, insert, update, delete on public.comic_votes, public.kill_bomb, public.panel_votes, public.bets to authenticated;
grant insert (episode_id, nickname, body) on public.chat_messages to authenticated;
revoke all on all tables in schema private from anon, authenticated, public;

alter table public.episodes      enable row level security;
alter table public.comics        enable row level security;
alter table public.panelists     enable row level security;
alter table public.comic_votes   enable row level security;
alter table public.kill_bomb     enable row level security;
alter table public.panel_votes   enable row level security;
alter table public.bets          enable row level security;
alter table public.chat_messages enable row level security;
alter table public.live_ticks    enable row level security;
alter table private.host_config  enable row level security;
alter table private.muted_users  enable row level security;
alter table private.chat_rate    enable row level security;
alter table private.banned_words enable row level security;

------------------------------------------------------------------------------------------------
-- Helpers (private schema, not exposed through the API)
------------------------------------------------------------------------------------------------
create or replace function private.episode_is_live(p_episode uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.episodes e where e.id = p_episode and e.status = 'live');
$$;

create or replace function private.betting_is_open(p_episode uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.episodes e
                 where e.id = p_episode and e.status <> 'ended' and e.betting_open
                   and e.golden_ticket_at is null
                   and now() < e.starts_at + interval '15 minutes');
$$;

create or replace function private.is_host(p_secret text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare h text;
begin
  select secret_hash into h from private.host_config where id = 1;
  return h is not null and p_secret is not null and char_length(p_secret) >= 16
     and h = encode(sha256(convert_to(p_secret, 'UTF8')), 'hex');
end $$;

create or replace function private.require_host(p_secret text)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_host(p_secret) then
    perform pg_sleep(0.4);               -- slow down guessing
    raise exception 'not authorized' using errcode = '42501';
  end if;
end $$;

grant usage on schema private to anon, authenticated;   -- needed for RLS helper calls; tables stay revoked
revoke execute on all functions in schema private from public;
grant execute on function private.episode_is_live(uuid), private.betting_is_open(uuid) to anon, authenticated;

------------------------------------------------------------------------------------------------
-- RLS policies
------------------------------------------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array['episodes','comics','panelists','chat_messages','live_ticks'] loop
    execute format('drop policy if exists "read all" on public.%I', t);
    execute format('create policy "read all" on public.%I for select to anon, authenticated using (true)', t);
  end loop;
end $$;

-- votes: own rows only, and only while the episode is live
do $$ declare t text; begin
  foreach t in array array['comic_votes','kill_bomb','panel_votes'] loop
    execute format('drop policy if exists "own select" on public.%I', t);
    execute format('drop policy if exists "own insert" on public.%I', t);
    execute format('drop policy if exists "own update" on public.%I', t);
    execute format('drop policy if exists "own delete" on public.%I', t);
    execute format('create policy "own select" on public.%I for select to authenticated using (voter_id = (select auth.uid()))', t);
    execute format('create policy "own insert" on public.%I for insert to authenticated with check (voter_id = (select auth.uid()) and private.episode_is_live(episode_id))', t);
    execute format('create policy "own update" on public.%I for update to authenticated using (voter_id = (select auth.uid())) with check (voter_id = (select auth.uid()) and private.episode_is_live(episode_id))', t);
    execute format('create policy "own delete" on public.%I for delete to authenticated using (voter_id = (select auth.uid()) and private.episode_is_live(episode_id))', t);
  end loop;
end $$;

-- bets: own rows only, and only while betting is open
drop policy if exists "own select" on public.bets;
drop policy if exists "own insert" on public.bets;
drop policy if exists "own update" on public.bets;
drop policy if exists "own delete" on public.bets;
create policy "own select" on public.bets for select to authenticated using (voter_id = (select auth.uid()));
create policy "own insert" on public.bets for insert to authenticated with check (voter_id = (select auth.uid()) and private.betting_is_open(episode_id));
create policy "own update" on public.bets for update to authenticated using (voter_id = (select auth.uid())) with check (voter_id = (select auth.uid()) and private.betting_is_open(episode_id));
create policy "own delete" on public.bets for delete to authenticated using (voter_id = (select auth.uid()) and private.betting_is_open(episode_id));

-- chat: anyone signed in (incl. anonymous) may post as themselves into a live episode
drop policy if exists "own insert" on public.chat_messages;
create policy "own insert" on public.chat_messages for insert to authenticated
  with check (voter_id = (select auth.uid()) and private.episode_is_live(episode_id));

------------------------------------------------------------------------------------------------
-- Triggers
------------------------------------------------------------------------------------------------
-- force ownership + timestamps on vote rows (a client can't vote as someone else or backdate)
create or replace function private.vote_stamp()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.voter_id := auth.uid();
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    if new.episode_id is distinct from old.episode_id then raise exception 'cannot move a vote'; end if;
  end if;
  return new;
end $$;

-- bump live_ticks at most ~5x/s per episode; clients also poll slowly as a safety net
create or replace function private.bump_tick()
returns trigger language plpgsql security definer set search_path = '' as $$
declare ep uuid;
begin
  ep := coalesce(case when tg_op = 'DELETE' then old.episode_id else new.episode_id end, old.episode_id);
  -- episode itself being deleted (cascade): nothing to notify
  if not exists (select 1 from public.episodes e where e.id = ep) then return null; end if;
  insert into public.live_ticks as t (episode_id, rev, updated_at) values (ep, 1, now())
  on conflict (episode_id) do update set rev = t.rev + 1, updated_at = now()
    where t.updated_at < now() - interval '200 milliseconds';
  return null;
end $$;

do $$ declare t text; begin
  foreach t in array array['comic_votes','kill_bomb','panel_votes','bets'] loop
    execute format('drop trigger if exists stamp on public.%I', t);
    execute format('create trigger stamp before insert or update on public.%I for each row execute function private.vote_stamp()', t);
    execute format('drop trigger if exists tick on public.%I', t);
    execute format('create trigger tick after insert or update or delete on public.%I for each row execute function private.bump_tick()', t);
  end loop;
end $$;

-- chat: identity, mute, slow mode (1 message / 3 s / user), length, word filter
create or replace function private.chat_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); last timestamptz; w text;
begin
  if uid is null then raise exception 'sign in to chat' using errcode = '42501'; end if;
  new.voter_id := uid;
  new.created_at := now();
  new.deleted := false;
  new.nickname := btrim(regexp_replace(new.nickname, '[[:cntrl:]]', '', 'g'));
  new.body := btrim(regexp_replace(new.body, '[[:cntrl:]]', ' ', 'g'));
  if char_length(new.body) = 0 then raise exception 'empty message' using errcode = '22023'; end if;
  if char_length(new.body) > 200 then raise exception 'message too long (200 max)' using errcode = '22001'; end if;
  if char_length(new.nickname) = 0 or char_length(new.nickname) > 24 then raise exception 'bad nickname' using errcode = '22023'; end if;
  if exists (select 1 from private.muted_users m where m.voter_id = uid) then
    raise exception 'you are muted' using errcode = '42501';
  end if;
  select r.last_at into last from private.chat_rate r where r.voter_id = uid for update;
  if last is not null and now() - last < interval '3 seconds' then
    raise exception 'slow mode: 1 message every 3 seconds' using errcode = 'P0001', hint = 'slow_mode';
  end if;
  insert into private.chat_rate(voter_id, last_at) values (uid, now())
    on conflict (voter_id) do update set last_at = excluded.last_at;
  for w in select b.word from private.banned_words b loop
    new.body := regexp_replace(new.body, '\m' || w || '\M', repeat('*', char_length(w)), 'gi');
    new.nickname := regexp_replace(new.nickname, '\m' || w || '\M', repeat('*', char_length(w)), 'gi');
  end loop;
  return new;
end $$;
drop trigger if exists guard on public.chat_messages;
create trigger guard before insert on public.chat_messages for each row execute function private.chat_guard();

------------------------------------------------------------------------------------------------
-- Aggregate RPCs (readable by everyone; return totals only, never individual votes)
------------------------------------------------------------------------------------------------
create or replace function private.comic_scores(p_episode uuid)
returns table (comic_id uuid, name text, ord int, votes bigint, avg_score numeric, dist int[])
language sql stable security definer set search_path = '' as $$
  select c.id, c.name, c.ord, count(v.score),
         round(avg(v.score)::numeric, 2),
         array(select count(*) filter (where v2.score = s)::int
               from generate_series(1,10) s
               left join public.comic_votes v2 on v2.comic_id = c.id
               group by s order by s)
  from public.comics c
  left join public.comic_votes v on v.comic_id = c.id
  where c.episode_id = p_episode
  group by c.id, c.name, c.ord
  order by c.ord, c.created_at;
$$;

create or replace function private.kill_bomb_split(p_episode uuid)
returns table (comic_id uuid, kills bigint, bombs bigint)
language sql stable security definer set search_path = '' as $$
  select c.id, count(*) filter (where k.verdict = 'kill'), count(*) filter (where k.verdict = 'bomb')
  from public.comics c left join public.kill_bomb k on k.comic_id = c.id
  where c.episode_id = p_episode group by c.id;
$$;

create or replace function private.panel_scores(p_episode uuid)
returns table (panelist_id uuid, name text, role text, ord int, votes bigint, avg_score numeric)
language sql stable security definer set search_path = '' as $$
  select p.id, p.name, p.role, p.ord, count(v.score), round(avg(v.score)::numeric, 2)
  from public.panelists p left join public.panel_votes v on v.panelist_id = p.id
  where p.episode_id = p_episode group by p.id order by p.ord;
$$;

create or replace function private.bet_odds(p_episode uuid)
returns table (yes bigint, no bigint, yes_share numeric)
language sql stable security definer set search_path = '' as $$
  select count(*) filter (where pick = 'yes'), count(*) filter (where pick = 'no'),
         case when count(*) = 0 then null
              else round((count(*) filter (where pick = 'yes'))::numeric / count(*), 4) end
  from public.bets where episode_id = p_episode;
$$;

-- one call with everything a client renders (plus the caller's own votes)
create or replace function private.live_state(p_episode uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare ep public.episodes; me uuid := auth.uid(); res jsonb;
begin
  if p_episode is null then
    select * into ep from public.episodes where status <> 'ended' order by created_at desc limit 1;
  else
    select * into ep from public.episodes where id = p_episode;
  end if;
  if ep.id is null then return jsonb_build_object('episode', null); end if;
  select jsonb_build_object(
    'server_time', now(),
    'episode', to_jsonb(ep) || jsonb_build_object('betting_is_open', private.betting_is_open(ep.id)),
    'comics', coalesce((select jsonb_agg(jsonb_build_object('id', s.comic_id, 'name', s.name, 'ord', s.ord, 'votes', s.votes,
                         'avg', s.avg_score, 'dist', s.dist, 'kills', k.kills, 'bombs', k.bombs) order by s.ord)
                        from private.comic_scores(ep.id) s join private.kill_bomb_split(ep.id) k using (comic_id)), '[]'::jsonb),
    'panel', coalesce((select jsonb_agg(jsonb_build_object('id', p.panelist_id, 'name', p.name, 'role', p.role, 'votes', p.votes, 'avg', p.avg_score) order by p.ord)
                       from private.panel_scores(ep.id) p), '[]'::jsonb),
    'bet', (select to_jsonb(b) from private.bet_odds(ep.id) b),
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
-- Host RPCs (all require the host secret)
------------------------------------------------------------------------------------------------
create or replace function private.host_check(p_secret text)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
begin
  if private.is_host(p_secret) then return true; end if;
  perform pg_sleep(0.4);
  return false;
end $$;

create or replace function private.host_new_episode(p_secret text, p_title text default 'Premiere Night',
  p_starts_at timestamptz default null, p_youtube_url text default null, p_panel jsonb default null)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare eid uuid; p jsonb; i int := 0;
begin
  perform private.require_host(p_secret);
  update public.episodes set status = 'ended' where status <> 'ended';
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
    status      = coalesce(p_status, status)
  where id = p_episode;
end $$;

create or replace function private.host_add_comic(p_secret text, p_episode uuid, p_name text, p_make_current boolean default true)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare cid uuid; n int;
begin
  perform private.require_host(p_secret);
  select coalesce(max(ord), 0) + 1 into n from public.comics where episode_id = p_episode;
  insert into public.comics(episode_id, name, ord) values (p_episode, btrim(p_name), n) returning id into cid;
  if p_make_current then update public.episodes set current_comic_id = cid, current_comic_at = now() where id = p_episode; end if;
  return cid;
end $$;

create or replace function private.host_set_current_comic(p_secret text, p_episode uuid, p_comic uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  perform private.require_host(p_secret);
  if p_comic is not null and not exists (select 1 from public.comics where id = p_comic and episode_id = p_episode) then
    raise exception 'comic not in episode';
  end if;
  update public.episodes set current_comic_id = p_comic, current_comic_at = now() where id = p_episode;
end $$;

create or replace function private.host_add_panelist(p_secret text, p_episode uuid, p_name text, p_role text default 'Guest')
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare pid uuid; n int;
begin
  perform private.require_host(p_secret);
  select coalesce(max(ord), 0) + 1 into n from public.panelists where episode_id = p_episode;
  insert into public.panelists(episode_id, name, role, ord) values (p_episode, btrim(p_name), coalesce(nullif(btrim(p_role), ''), 'Guest'), n) returning id into pid;
  return pid;
end $$;

create or replace function private.host_remove_panelist(p_secret text, p_panelist uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  perform private.require_host(p_secret);
  delete from public.panelists where id = p_panelist;
end $$;

create or replace function private.host_golden_ticket(p_secret text, p_episode uuid, p_name text default null)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare nm text;
begin
  perform private.require_host(p_secret);
  select coalesce(nullif(btrim(p_name), ''), c.name) into nm
    from public.episodes e left join public.comics c on c.id = e.current_comic_id where e.id = p_episode;
  update public.episodes set golden_ticket_at = now(), golden_ticket_name = left(coalesce(nm, 'Tonight''s comic'), 60), betting_open = false
  where id = p_episode;
end $$;

create or replace function private.host_set_betting(p_secret text, p_episode uuid, p_open boolean)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  perform private.require_host(p_secret);
  update public.episodes set betting_open = p_open where id = p_episode;
end $$;

create or replace function private.host_delete_message(p_secret text, p_id bigint)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  perform private.require_host(p_secret);
  update public.chat_messages set deleted = true, body = '' where id = p_id;
end $$;

create or replace function private.host_mute(p_secret text, p_voter uuid, p_muted boolean default true, p_purge boolean default true)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  perform private.require_host(p_secret);
  if p_muted then
    insert into private.muted_users(voter_id) values (p_voter) on conflict do nothing;
    if p_purge then
      update public.chat_messages set deleted = true, body = ''
       where voter_id = p_voter and created_at > now() - interval '1 hour' and not deleted;
    end if;
  else
    delete from private.muted_users where voter_id = p_voter;
  end if;
end $$;

-- wipe this episode's fan data (votes, bets, chat) and reopen betting
create or replace function private.host_reset_episode(p_secret text, p_episode uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  perform private.require_host(p_secret);
  delete from public.comic_votes where episode_id = p_episode;
  delete from public.kill_bomb   where episode_id = p_episode;
  delete from public.panel_votes where episode_id = p_episode;
  delete from public.bets        where episode_id = p_episode;
  delete from public.chat_messages where episode_id = p_episode;
  update public.episodes set betting_open = true, golden_ticket_at = null, golden_ticket_name = null,
         starts_at = greatest(starts_at, now() - interval '1 minute') where id = p_episode;
end $$;

-- set/rotate the host secret: run as the project owner in the SQL editor (never exposed to API roles)
--   select private.set_host_secret('<long random string>');
create or replace function private.set_host_secret(p_secret text)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if char_length(p_secret) < 24 then raise exception 'use at least 24 characters'; end if;
  insert into private.host_config(id, secret_hash) values (1, encode(sha256(convert_to(p_secret, 'UTF8')), 'hex'))
  on conflict (id) do update set secret_hash = excluded.secret_hash;
end $$;
revoke execute on function private.set_host_secret(text) from public, anon, authenticated;

revoke execute on all functions in schema private from public, anon, authenticated;

------------------------------------------------------------------------------------------------
-- Public API: thin SECURITY INVOKER wrappers. The privileged code lives in the private schema
-- (not exposed by the Data API); anon/authenticated may execute exactly these entry points.
------------------------------------------------------------------------------------------------
create or replace function public.comic_scores(p_episode uuid)
returns table (comic_id uuid, name text, ord int, votes bigint, avg_score numeric, dist int[])
language sql stable security invoker set search_path = '' as $$ select * from private.comic_scores(p_episode) $$;
create or replace function public.kill_bomb_split(p_episode uuid)
returns table (comic_id uuid, kills bigint, bombs bigint)
language sql stable security invoker set search_path = '' as $$ select * from private.kill_bomb_split(p_episode) $$;
create or replace function public.panel_scores(p_episode uuid)
returns table (panelist_id uuid, name text, role text, ord int, votes bigint, avg_score numeric)
language sql stable security invoker set search_path = '' as $$ select * from private.panel_scores(p_episode) $$;
create or replace function public.bet_odds(p_episode uuid)
returns table (yes bigint, no bigint, yes_share numeric)
language sql stable security invoker set search_path = '' as $$ select * from private.bet_odds(p_episode) $$;
create or replace function public.live_state(p_episode uuid default null)
returns jsonb language sql stable security invoker set search_path = '' as $$ select private.live_state(p_episode) $$;
create or replace function public.host_check(p_secret text)
returns boolean language sql volatile security invoker set search_path = '' as $$ select private.host_check(p_secret) $$;
create or replace function public.host_new_episode(p_secret text, p_title text default 'Premiere Night',
  p_starts_at timestamptz default null, p_youtube_url text default null, p_panel jsonb default null)
returns uuid language sql volatile security invoker set search_path = '' as $$ select private.host_new_episode(p_secret, p_title, p_starts_at, p_youtube_url, p_panel) $$;
create or replace function public.host_update_episode(p_secret text, p_episode uuid, p_title text default null,
  p_youtube_url text default null, p_starts_at timestamptz default null, p_status text default null)
returns void language sql volatile security invoker set search_path = '' as $$ select private.host_update_episode(p_secret, p_episode, p_title, p_youtube_url, p_starts_at, p_status) $$;
create or replace function public.host_add_comic(p_secret text, p_episode uuid, p_name text, p_make_current boolean default true)
returns uuid language sql volatile security invoker set search_path = '' as $$ select private.host_add_comic(p_secret, p_episode, p_name, p_make_current) $$;
create or replace function public.host_set_current_comic(p_secret text, p_episode uuid, p_comic uuid)
returns void language sql volatile security invoker set search_path = '' as $$ select private.host_set_current_comic(p_secret, p_episode, p_comic) $$;
create or replace function public.host_add_panelist(p_secret text, p_episode uuid, p_name text, p_role text default 'Guest')
returns uuid language sql volatile security invoker set search_path = '' as $$ select private.host_add_panelist(p_secret, p_episode, p_name, p_role) $$;
create or replace function public.host_remove_panelist(p_secret text, p_panelist uuid)
returns void language sql volatile security invoker set search_path = '' as $$ select private.host_remove_panelist(p_secret, p_panelist) $$;
create or replace function public.host_golden_ticket(p_secret text, p_episode uuid, p_name text default null)
returns void language sql volatile security invoker set search_path = '' as $$ select private.host_golden_ticket(p_secret, p_episode, p_name) $$;
create or replace function public.host_set_betting(p_secret text, p_episode uuid, p_open boolean)
returns void language sql volatile security invoker set search_path = '' as $$ select private.host_set_betting(p_secret, p_episode, p_open) $$;
create or replace function public.host_delete_message(p_secret text, p_id bigint)
returns void language sql volatile security invoker set search_path = '' as $$ select private.host_delete_message(p_secret, p_id) $$;
create or replace function public.host_mute(p_secret text, p_voter uuid, p_muted boolean default true, p_purge boolean default true)
returns void language sql volatile security invoker set search_path = '' as $$ select private.host_mute(p_secret, p_voter, p_muted, p_purge) $$;
create or replace function public.host_reset_episode(p_secret text, p_episode uuid)
returns void language sql volatile security invoker set search_path = '' as $$ select private.host_reset_episode(p_secret, p_episode) $$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.live_state(uuid), public.comic_scores(uuid), public.kill_bomb_split(uuid), public.panel_scores(uuid), public.bet_odds(uuid),
  public.host_check(text), public.host_new_episode(text, text, timestamptz, text, jsonb),
  public.host_update_episode(text, uuid, text, text, timestamptz, text), public.host_add_comic(text, uuid, text, boolean),
  public.host_set_current_comic(text, uuid, uuid), public.host_add_panelist(text, uuid, text, text),
  public.host_remove_panelist(text, uuid), public.host_golden_ticket(text, uuid, text),
  public.host_set_betting(text, uuid, boolean), public.host_delete_message(text, bigint),
  public.host_mute(text, uuid, boolean, boolean), public.host_reset_episode(text, uuid)
to anon, authenticated;
-- the wrappers run as the caller, so the caller needs EXECUTE on the private implementation
grant execute on function
  private.live_state(uuid), private.comic_scores(uuid), private.kill_bomb_split(uuid), private.panel_scores(uuid), private.bet_odds(uuid),
  private.host_check(text), private.host_new_episode(text, text, timestamptz, text, jsonb),
  private.host_update_episode(text, uuid, text, text, timestamptz, text), private.host_add_comic(text, uuid, text, boolean),
  private.host_set_current_comic(text, uuid, uuid), private.host_add_panelist(text, uuid, text, text),
  private.host_remove_panelist(text, uuid), private.host_golden_ticket(text, uuid, text),
  private.host_set_betting(text, uuid, boolean), private.host_delete_message(text, bigint),
  private.host_mute(text, uuid, boolean, boolean), private.host_reset_episode(text, uuid),
  private.episode_is_live(uuid), private.betting_is_open(uuid)
to anon, authenticated;

------------------------------------------------------------------------------------------------
-- Realtime: broadcast row changes for the small, public tables
------------------------------------------------------------------------------------------------
do $$ declare t text; begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['episodes','comics','panelists','chat_messages','live_ticks'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
