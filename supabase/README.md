# Bucket Pull Live — live backend (Supabase)

Project: `bucketpull-live` (ref `zwdogpkjxhpsrocqdnel`, us-east-2, free tier).

* `schema.sql` — full idempotent schema (tables, RLS, triggers, aggregate RPCs,
  host RPCs, Realtime publication). Applied as migrations
  `bucketpull_live_schema`, `bucketpull_live_private_impl_wrappers`,
  `bucketpull_live_tick_cascade_fix`.
* `config.js` (site root) holds the public URL + publishable key. Empty values => demo mode.
* `?demo=1` forces demo mode in that browser, `?demo=0` clears it.
* Host mode: open `/?host=1`, enter the host secret.

## Required dashboard setting
Authentication -> Sign In / Providers -> **Allow anonymous sign-ins: ON** (enabled 2026-10-20).
Without it fans can watch live totals/chat but cannot vote, bet or chat.

## Rotating the host secret
Run in the SQL editor (never from the browser; anon/authenticated cannot call it):

    select private.set_host_secret('<new secret, 24+ chars>');

## Design notes
* Security-definer code lives in schema `private` (not exposed by the API);
  the public RPCs are thin SECURITY INVOKER wrappers.
* Private tables have RLS on with no policies on purpose (deny-all) — the
  advisor reports them as INFO `rls_enabled_no_policy`.
* Votes bump `live_ticks` (throttled to 5/s per episode); clients subscribe and
  refetch `live_state()` debounced ~300 ms plus audience-scaled jitter, with a
  15 s safety poll.
