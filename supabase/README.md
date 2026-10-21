# Bucket Pull Live — live backend (Supabase)

Project: `bucketpull-live` (ref `zwdogpkjxhpsrocqdnel`, us-east-2, free tier).

* `schema.sql` — full idempotent schema (tables, RLS, triggers, aggregate RPCs,
  host RPCs, Realtime publication). Applied as migrations
  `bucketpull_live_schema`, `bucketpull_live_private_impl_wrappers`,
  `bucketpull_live_tick_cascade_fix`.
* `autopilot.sql` — autopilot layer (episode_events timeline, autopilot_status
  heartbeat, auto_* RPCs, host overrides: rename/delete/undo/auto toggles,
  cancel golden ticket). Applied as migration `bucketpull_autopilot`.
* `autopilot_sync.sql` — podcast-source sync: `episodes.sync_adjust`, host
  `host_sync_adjust` (±seconds nudge of auto events/comics), heartbeat returns
  sync_adjust/starts_at/youtube_url. Applied as migration `bucketpull_autopilot_sync`.
* `v3_scale_regulars.sql` — round 3: fan chat dropped (tables + RPCs), `comics.kind`
  ('bucket' | 'regular', numbered per kind) with `host_set_comic_kind` and `p_kind` on
  `auto_comic` / `host_add_comic`, HTTP polling (`live_poll`, `my_state`, `vote`), heartbeat
  viewer count (`private.viewers`, unlogged), 2 s score cache (`private.poll_cache`), `meta_rev`
  triggers, Realtime publication trimmed to `autopilot_status`. Applied as migrations
  `bucketpull_v3_scale_regulars` + `bucketpull_v3_fix_new_episode`.
* `final_results.sql` — the room keeps showing the last episode's **final results** until the next
  one is created: `current_episode()` = newest live episode, else the newest episode (no 12 h limit);
  `live_scores` sends every comic's distribution once ended; `live_meta.prev` (previous ended episode);
  `episode_results(id)` (read-only final results of an ended episode, for "Last week"); 60 s score
  cache when ended + trigger that refreshes the cache at the moment an episode ends. Applied as
  migrations `bucketpull_final_results`, `bucketpull_final_results_cache`,
  `bucketpull_final_results_newest`, `bucketpull_final_results_newest2` (the file is the final state).
  **Order matters:** run `schema.sql`, then `autopilot.sql`, then `autopilot_sync.sql`, then
  `v3_scale_regulars.sql`, then `final_results.sql` (schema.sql alone would restore the pre-autopilot
  host functions and chat).
* `config.js` (site root) holds the public URL + publishable key. Empty values => demo mode.
* `?demo=1` forces demo mode in that browser, `?demo=0` clears it.
* Host mode: open `/?host=1`, enter the host secret.

## Required dashboard setting
Authentication -> Sign In / Providers -> **Allow anonymous sign-ins: ON** (enabled 2026-10-20).
Without it fans can watch live totals but cannot vote or bet. Fans only sign in (lazily) on their
first vote or bet; the free tier allows ~30 anonymous sign-ins per hour per IP, so a big watch party on
one network may see "try again" on the first vote (the session is then kept in localStorage).

## Rotating the host secret
Run in the SQL editor (never from the browser; anon/authenticated cannot call it):

    select private.set_host_secret('<new secret, 24+ chars>');

## Design notes
* Security-definer code lives in schema `private` (not exposed by the API);
  the public RPCs are thin SECURITY INVOKER wrappers.
* Private tables have RLS on with no policies on purpose (deny-all) — the
  advisor reports them as INFO `rls_enabled_no_policy`.
* **No Realtime for fans (v3).** Every fan polls `live_poll(known_ep, meta_rev, client_id)` every
  ~5 s (±25 % jitter, 15 s when nothing is live, 30 s when the tab is hidden, backoff on errors).
  It returns scores (cached server-side, recomputed at most every 2 s, so 200 polls/5 s cost ~3
  aggregations) plus the viewer count; the episode/comics/panel/events `meta` is only sent when
  `meta_rev` changed. Votes are `vote()` RPC upserts (one row per fan per target), debounced 350 ms.
  The host panel polls `autopilot_status` every 5 s. Free-tier limits (200 Realtime connections,
  100 msg/s, 20 presence/s) no longer apply to the audience.
