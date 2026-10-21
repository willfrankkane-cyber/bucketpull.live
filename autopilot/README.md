# Bucket Pull Live — autopilot

Runs the live room by itself on Kill Tony night. Everything is box-local
(America/El_Salvador, CST, UTC-6, no DST). Source of truth lives on the box at
`/workspace/bucketpull-autopilot`; a copy is kept in the site repo under `autopilot/`.

## Schedule (crontab, box)
| when (CST) | what |
|---|---|
| Mon 18:40 | `run.sh live` — find the premiere on @KillTony (re-check every ~3 min for up to 3 h), create the episode (title, panel = Tony + Redban + guests from the title, YouTube link, betting open), wait for it to go live, listen, end the episode when the stream ends. Hard stop = premiere start + 3h15 (and `timeout 5h`). |
| daily 12:17 | `run.sh keepalive` — one `live_state` read so the free Supabase project never pauses. |
| Tue+Fri 10:23 | GitHub Actions `supabase-keepalive.yml` — same, independent of the box. |

Kill Tony premieres 8 PM Central = 19:00 CST now, 20:00 CST once the US leaves DST (Nov 1).
The 18:40 start covers both.

`cron` is not supervised on this box (no systemd). After a box restart run `sudo cron`.

## Pipeline
yt-dlp (`--js-runtimes node`) → ffmpeg 16 kHz mono → faster-whisper `small.en`
(int8, 14 s windows every 7 s, centre-commit, prompted with the episode roster) →
detector → Supabase RPCs (`auto_*`, gated by the host secret read from
`/workspace/bucketpull-host-secret.txt`; never logged).

* **Comic intros:** "next bucket pull…", "goes by the name of", "60 seconds uninterrupted",
  "make some noise for…", "this is…", "give it up for…" with boosts (bucket mentioned,
  name repeated, "…everybody", comedy context, roster match). Publish ≥ 0.75.
  Names published as heard, Title Case; fuzzy-matched (≥0.84) to the roster and to
  comics already on the board so one comic isn't added twice.
* **Betting auto-close:** opener's set end ("to the bucket we go", "there goes…", or
  the 2nd comic's intro).
* **Golden ticket:** award phrase ("newest golden ticket winner", "you just won a golden
  ticket", …) about the comic on stage (on 30 s – 20 min) AND ≥ 6 s continuous / ≥ 8 s total
  of crowd ≥ 5 dB over the 120 s rolling median within −5…+20 s.
* Every action is an `episode_events` row with its offset from the premiere start, so
  fans' browsers apply it when *their* YouTube player reaches that point.
* Heartbeat every 15 s → `autopilot_status` (host panel).

## Commands
    /workspace/ktvenv/bin/python autopilot.py live
    /workspace/ktvenv/bin/python autopilot.py replay WAV --title "TEST …" [--speed 0] [--roster …] [--guests …]
    /workspace/ktvenv/bin/python autopilot.py keepalive
Logs: `logs/YYYY-MM-DD-live.log`, `logs/cron-live.log`, `logs/replay-*.json`.

## Host overrides (bucketpull.live/?host=1)
* **AUTO ON/OFF** — master switch; 🎟️ and BETS toggles switch just the golden ticket / betting automation.
* **↶ Undo** — reverts the most recent auto action (comic, golden ticket, betting, end).
* Comics list: ▶ put on stage, ✎ rename, 🗑 delete (autopilot won't re-add that name).
* Golden ticket / ✕ Cancel golden ticket; Open/Close betting.
* Any host action on an item locks it from the autopilot (renamed/staged comic,
  manual golden ticket → auto 🎟️ off, manual betting → auto BETS off).

## When YouTube blocks the box
YouTube sometimes answers this box's IP with "Sign in to confirm you're not a bot" (it did on
2026-10-20 after a day of research downloads). The listener then rotates yt-dlp clients
(default, no-js, web_safari, tv, mweb) on every reconnect, falls back to the channel listing
for live/upcoming status, and shows **"YouTube bot check: audio blocked"** in the host panel.
Run the room by hand when that happens (all host controls keep working).
Optional fix: put a Netscape-format `cookies.txt` (export from a throwaway YouTube login) in
this folder; it is used automatically if present.
