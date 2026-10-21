-- Bucket Pull Live: hold the last episode's final results until the next one goes live.
-- Run after v3_scale_regulars.sql. Applied as migration `bucketpull_final_results`.

-- 1. which episode the room shows: the newest live one; otherwise the newest episode (ended ones stay up with
--    no time limit, so final results are there all week until the next episode is created).
create or replace function private.current_episode()
returns public.episodes language plpgsql stable security definer set search_path = '' as $$
declare ep public.episodes;
begin
  select * into ep from public.episodes where status = 'live' order by created_at desc limit 1;
  if ep.id is null then
    -- nothing live: the newest episode, i.e. last week's final results, or a newer scheduled one once it's created
    select * into ep from public.episodes order by created_at desc limit 1;
  end if;
  return ep;
end $$;

-- 2. scores: distributions for every comic once the episode has ended (final view), 3 most recent while live
create or replace function private.live_scores(p_episode uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
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
    'b', (select jsonb_build_array(count(*) filter (where pick = 'yes'), count(*) filter (where pick = 'no')) from public.bets where episode_id = p_episode));
$$;

-- 3. meta: + 'prev' = the episode before this one that has ended (for the "Last week" link)
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
               from public.episode_events v where v.episode_id = e.id), '[]'::jsonb),
    'prev', (select jsonb_build_object('id', x.id, 'title', x.title, 'ended_at', x.ended_at) from public.episodes x
              where x.status = 'ended' and x.id <> e.id and x.created_at < e.created_at
              order by x.created_at desc limit 1))
  from public.episodes e where e.id = p_episode;
$$;

-- 4. poll: an ended episode's scores can't change (votes and bets are closed), so cache them for 60 s instead of 2 s
create or replace function private.live_poll(p_known_ep uuid default null, p_meta bigint default -1, p_client text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare ep public.episodes; c private.poll_cache; mrev bigint; nv int; res jsonb; ttl interval;
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
  ttl := case when ep.status = 'ended' then interval '60 seconds' else interval '2 seconds' end;
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
  if p_known_ep is distinct from ep.id or p_meta is distinct from mrev then
    if c.meta_rev is distinct from mrev or c.meta is null then
      c.meta := private.live_meta(ep.id);
      update private.poll_cache set meta = c.meta, meta_rev = mrev where episode_id = ep.id;
    end if;
    res := res || jsonb_build_object('meta', jsonb_set(c.meta, '{episode,betting_is_open}', to_jsonb(private.betting_is_open(ep.id))));
  end if;
  return res || jsonb_build_object('bo', private.betting_is_open(ep.id));
end $$;

-- 5. final results of any ended episode (the "Last week" view). Read-only, no secret needed.
create or replace function private.episode_results(p_episode uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when e.id is null or e.status <> 'ended' then null
         else jsonb_build_object('meta', private.live_meta(e.id), 's', private.live_scores(e.id)) end
  from public.episodes e where e.id = p_episode;
$$;
create or replace function public.episode_results(p_episode uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$ select private.episode_results(p_episode) $$;
revoke all on function private.episode_results(uuid) from public;
grant execute on function private.episode_results(uuid) to anon, authenticated;
grant execute on function public.episode_results(uuid) to anon, authenticated;

-- 6. when an episode ends, drop its cached scores so the final view (all distributions) is served right away
create or replace function private.on_episode_end()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'ended' and old.status is distinct from 'ended' then
    update private.poll_cache set scores_at = '-infinity' where episode_id = new.id;
  end if;
  return null;
end $$;
drop trigger if exists episode_end_cache on public.episodes;
create trigger episode_end_cache after update of status on public.episodes for each row execute function private.on_episode_end();
