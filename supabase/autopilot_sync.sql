-- Bucket Pull Live: podcast-first autopilot sync controls. Run after schema.sql and autopilot.sql.
alter table public.episodes add column if not exists sync_adjust real not null default 0;

-- host nudges the autopilot's timeline: shifts every auto event/comic (already released or not) by p_delta seconds
create or replace function private.host_sync_adjust(p_secret text, p_episode uuid, p_delta real)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare d real := greatest(-300, least(300, coalesce(p_delta, 0))); v real;
begin
  perform private.require_host(p_secret);
  update public.episodes set sync_adjust = sync_adjust + d where id = p_episode returning sync_adjust into v;
  if v is null then return jsonb_build_object('ok', false, 'why', 'no episode'); end if;
  update public.episode_events set offset_s = greatest(0, offset_s + d) where episode_id = p_episode and source = 'auto';
  update public.comics set start_offset = greatest(0, start_offset + d) where episode_id = p_episode and source = 'auto' and start_offset is not null;
  return jsonb_build_object('ok', true, 'sync_adjust', v);
end $$;

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
                          'locked', c.locked, 'source', c.source) order by c.ord) from public.comics c where c.episode_id = p_episode), '[]'::jsonb),
    'blocked', coalesce((select jsonb_agg(b.name) from private.auto_blocklist b where b.episode_id = p_episode), '[]'::jsonb));
end $$;

create or replace function public.host_sync_adjust(p_secret text, p_episode uuid, p_delta real)
returns jsonb language sql volatile security invoker set search_path = '' as $$ select private.host_sync_adjust(p_secret, p_episode, p_delta) $$;

revoke all on function private.host_sync_adjust(text, uuid, real) from public;
revoke all on function public.host_sync_adjust(text, uuid, real) from public;
grant execute on function public.host_sync_adjust(text, uuid, real), private.host_sync_adjust(text, uuid, real) to anon, authenticated;
