# Bucket Pull Live — autopilot

Runs the live room by itself on Kill Tony night. Everything is box-local
(America/El_Salvador, CST, UTC-6, no DST). Source of truth lives on the box at
`/workspace/bucketpull-autopilot`; a copy is kept in the site repo under `autopilot/`.

## Schedule (crontab, box)
| when (CST) | what |
|---|---|
| Mon 18:40 | `run.sh live` — **podcast first**: poll the Kill Tony podcast RSS (conditional GET, every ~40-50 s) for up to 3 h. When the new main episode appears (Tue 01:00 UTC = 19:00 CST now, 20:00 CST from Nov 2): create the episode (title, guests from the title in proper case, YouTube link from the channel RSS if found, betting open), download the MP3 (~5 s), transcribe it in order (4-6x real time), and release each event when the premiere reaches it. YouTube live audio is only the fallback (no podcast 15 min after the premiere went live, or the podcast path crashed). |
| daily 12:17 | `run.sh keepalive` — one `live_state` read so the free Supabase project never pauses. |
| Tue+Fri 10:23 | GitHub Actions `supabase-keepalive.yml` — same, independent of the box. |

`cron` is not supervised on this box (no systemd). After a box restart run `sudo cron`.

## Podcast -> video time
Measured on #789 and #790 by cross-correlating the podcast with the YouTube audio: the podcast is the same
program audio with a different head (#789: +6.95 s network pre-roll; #790: 11.5 s *shorter* than the video)
and **no** mid-roll insertions, i.e. one constant per episode (drift < 0.15 s over 2 h).
* **captions** (best): align the podcast transcript to YouTube auto-captions (unique word 4-grams, piecewise,
  so inserted ads would be absorbed). Error 0.03-0.1 s. Fetched with yt-dlp every 5 min if reachable.
* **intro anchor** (no YouTube needed): the video's intro says "...from the comedy MOTHERSHIP" at 38.4 s
  (38.9 / 37.8 s on #789/#790); find that word in the podcast. Error 0.5-0.7 s.
* Video 0:00 = YouTube `release_timestamp` + 120 s (premiere countdown; from the #789/#790 chat replays).
* Host can nudge everything with **Sync −5/−1/+1/+5 s** in the panel.

Events are kept in the autopilot's memory and only written to the DB when the premiere clock reaches them,
so nothing (comic names, golden ticket, bet results) exists server-side before its moment; fans' browsers
additionally hold each event until their own YouTube player reaches it.

## Pipeline
Podcast MP3 (or YouTube live audio via yt-dlp in fallback) → ffmpeg 16 kHz mono → faster-whisper `small.en`
(int8, 14 s windows every 7 s, centre-commit, prompted with the episode roster) →
detector → Supabase RPCs (`auto_*`, gated by the host secret read from
`/workspace/bucketpull-host-secret.txt`; never logged). Never run two whisper processes at once on this box
(parallel runs produced garbage transcripts).
* **Regulars vs bucket pulls (v3):** every intro is classified `bucket` or `regular` from the words in the
  50 s before it (recency-weighted, τ 18 s): bucket cues ("bucket pull", "out of the bucket", "new name",
  "sign-ups", "goes by the name of", "60 seconds"…) vs regular cues ("regular", "golden ticket winner",
  "legend of the show", "special treat/return", "every week", "brand new set", "final comedian",
  "present to you", "the return of"…), regular if R − B ≥ 0.25. Priors: +1.0 for the known-regulars
  list (`bp_autopilot/regulars.py`, fuzzy ≥ 0.92), +0.4 for roster names that look like regulars. The list is
  a hint only; unknown regulars are found from cues. Written with `auto_comic(p_kind)`; the host can flip
  it (⇄) in the panel. Validated offline on #789/#790 (see PROGRESS.md).
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
* Heartbeat every 15 s → `autopilot_status` (host panel: source Podcast / YouTube live / Manual, sync method, how far ahead).

## Commands
    /workspace/ktvenv/bin/python autopilot.py live [--feed URL]
    /workspace/ktvenv/bin/python autopilot.py podreplay 790 [--mp3 F] [--speed 6] [--no-youtube] [--captions F.json3]
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

## Fan-requested past episodes (archive_job.py)
`run.sh archive` runs from cron every 10 minutes. It takes pending `episode_requests` (a pasted Kill Tony YouTube
link or `#N`, #791 or later), finds the podcast item, transcribes it (~30 min), builds the lineup, maps podcast time
to video time and creates an ENDED, votable episode with comic timestamps. It skips Mon 15:00 - Tue 03:00 (box
time) and whenever the live run holds `autopilot.lock`, so it never competes with a premiere.
