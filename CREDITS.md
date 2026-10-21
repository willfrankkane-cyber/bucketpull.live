# Credits

Bucket Pull Live is an unofficial, fan-made design mockup. It is not affiliated with or endorsed by Kill Tony or its creators. In demo mode all names and numbers on the page are fictional sample data.

## Sounds

Every built-in sound except **Synth airhorn** is a real recording from [Freesound](https://freesound.org/), and every one is released under **CC0 1.0 Universal (Public Domain Dedication)**. CC0 does not require attribution, but we credit the authors anyway. Each license was checked on the sound's own Freesound page on 2026-10-20. No CC-BY, CC-BY-NC or Sampling+ material is used.

The soundboard has 8 buttons (keys 1–8). Every button can be swapped to any sound below or to your own file.

| Sound (slot / id) | Title | Author | Freesound page | License | Length here |
|---|---|---|---|---|---|
| **Gunshots** (default 1, `gunshots`) | "9mm pistol shot" | michorvath | https://freesound.org/people/michorvath/sounds/427592/ | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 1.74 s |
| **Airhorn** (default 2, `airhorn`) | "DJ airhorn sound" | pfranzen | https://freesound.org/people/pfranzen/sounds/528807/ | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 1.99 s |
| **Triumphant horns** (default 3, `fanfare`) | "Success Fanfare Trumpets.mp3" | FunWithSound | https://freesound.org/people/FunWithSound/sounds/456966/ | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 3.52 s |
| **Vader breath** (default 4, `vader-breath`) | "Gas Mask breath" | Nuclearoid | https://freesound.org/people/Nuclearoid/sounds/435825/ | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 1.91 s |
| **Rimshot** (default 5, `rimshot`) | "Ba Dum Tss! (classic edition)" | DJczyszy | https://freesound.org/people/DJczyszy/sounds/431811/ | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2.40 s |
| **Crowd "ooooh"** (default 7, `crowd-ooh`) | "Crowd Oooh.wav" | deleted_user_2104797 | https://freesound.org/s/324890/ | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2.57 s |
| **Sad trombone** (default 6, `sad-trombone`) | "wah wah sad trombone.wav" | kirbydx | https://freesound.org/people/kirbydx/sounds/175409/ | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 4.10 s |
| **Record scratch** (default 8, `record-scratch`) | "Record Scratch #1" | musicvision31 | https://freesound.org/people/musicvision31/sounds/431774/ | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 1.07 s |
| **Applause** (library, `applause`) | "Applause 3.aif" | lchapman1980 | https://freesound.org/people/lchapman1980/sounds/439894/ | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 3.80 s |
| **Bell ding** (library, `bell-ding`) | "Service bell louder" | Squidems | https://freesound.org/people/Squidems/sounds/709925/ | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2.40 s |
| **Synth airhorn** (library, `synth-airhorn`) | original synth effect | Bucket Pull Live | (none) | made for this project | 3.19 s |

### How the files were made

freesound.org was not reachable from the build machine and we did not log in or use an API key. The audio came from public copies of the exact Freesound IDs that other open-source projects keep in their GitHub repositories. Those copies are Freesound HQ previews or the original uploads; some were already trimmed. Each copy was checked against the length, sample rate and description on its Freesound page.

Each file was converted to mono 44.1 kHz and its leading silence was trimmed. It was kept to about 4 s or less, given a fade at the end, and level-matched to the airhorn (about -14 dBFS RMS over the audible part, peaks limited to about -1 dBFS). Then it was encoded as 128 kbps mono MP3 and embedded as base64 in `sounds-data.js`.

| Sound | Notes and mirror |
|---|---|
| **Gunshots** | One shot, trimmed to its transient and layered three times (0 / 0.23 / 0.44 s, slightly different levels) into a quick 3-shot burst. Mirror: `Sounds/427592__michorvath__9mm-pistol-shot.wav` in github.com/Soupstraw/Pistolman (same 1.663 s length as the Freesound page). |
| **Airhorn** | Unchanged from the previous release. It is itself an edit of "Airhorn" by jacksonacademyashmore, https://freesound.org/people/jacksonacademyashmore/sounds/414208/ (CC0). Mirror: `soundboard-airhorn.wav` in github.com/pulkitxm/edith. |
| **Triumphant horns** | Cut at 3.6 s with a 0.9 s fade (the original is 4.44 s with a long decay). Mirror: byte-for-byte copy `static/sounds/fanfare.mp3` in github.com/patcireamo/ChungusHub. |
| **Vader breath** | A real person breathing inside a Soviet GP-5 gas mask; no film audio. One in-and-out cycle (source 5.55-6.50 s inhale, 7.30-8.20 s exhale), pitched down 0.85x and EQ'd toward a respirator sound. The inhale was raised 9 dB and the two halves joined with a 0.12 s gap. Mirror: the `hoo.wav` and `hee.wav` cuts in github.com/ledwards/swupod `scripts/assets/mask-breath/` (their SOURCE.md documents the cut and EQ). |
| **Rimshot** | Cut at 2.4 s with a 0.8 s fade. Mirror: `soundboard-rimshot.wav` in github.com/pulkitxm/edith. |
| **Crowd "ooooh"** | One "oooh" (about 6.4-9.0 s of the 16.2 s original). Mirror: `rush/media/crowd/oooh-2.mp3` in github.com/danielkuperhand-cell/legacy-league. |
| **Sad trombone** | All four "wah"s, with the last note faded over 0.7 s. Mirror: `sounds/freesound/175409.ogg` in github.com/daetrox/void-of-voices. |
| **Record scratch** | Mirror: `soundboard-scratch.wav` in github.com/pulkitxm/edith. |
| **Applause** | First 3.8 s with a 1.2 s fade. Mirror: `soundboard-applause.wav` in github.com/pulkitxm/edith. |
| **Bell ding** | One ding, cut at 2.4 s with a 1.0 s fade. Mirror: `sounds/freesound/709925.ogg` in github.com/daetrox/void-of-voices. |

## Fonts

Anton, Bungee, Permanent Marker and Space Grotesk come from Google Fonts. They are licensed under the SIL Open Font License 1.1 and embedded in `styles.css`.

## Emoji

Emoji are drawn by each visitor's own system emoji font.
