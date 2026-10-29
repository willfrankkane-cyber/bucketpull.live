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

## Images

### Tony Hinchcliffe (thermometer handle, `img/tony.webp`)

- Source: [File:Tony_Hinchcliffe_on_The_Comedy_Store_podcast_(cropped).jpg](https://commons.wikimedia.org/wiki/File:Tony_Hinchcliffe_on_The_Comedy_Store_podcast_(cropped).jpg) on Wikimedia Commons
- Author: The Comedy Store
- License: [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)
- Changes: cropped to the head, background removed, white sticker outline added, resized to 144×204 and re-encoded as WebP. It is a real photograph and not an AI likeness.

### Comic photos (`img/comics/`)

Shown only beside regulars and golden ticket winners (never new bucket pulls). Cropped to a 96 px square face thumbnail. Sources, in order of preference: Wikimedia Commons (free licence), the comic's own X profile photo, the comic's own promo headshot (Ticketmaster artist page, as linked from killtonyhq.com) or YouTube channel avatar. Non-Commons images remain the property of their owners and are used as small identifying thumbnails; ask and they come down.

- **William Montgomery** (`img/comics/william-montgomery.webp`): ticketmaster · [https://killtonyhq.com/comedian/william-montgomery](https://killtonyhq.com/comedian/william-montgomery) · William Montgomery · artist promo headshot (Ticketmaster)
- **Hans Kim** (`img/comics/hans-kim.webp`): x · [https://x.com/DJHansKim](https://x.com/DJHansKim) · @DJHansKim · profile photo (X)
- **David Lucas** (`img/comics/david-lucas.webp`): x · [https://x.com/funnydavidlucas](https://x.com/funnydavidlucas) · @funnydavidlucas · profile photo (X)
- **Kam Patterson** (`img/comics/kam-patterson.webp`): commons · [https://commons.wikimedia.org/wiki/File:Kam_Patterson_2024_(2).png](https://commons.wikimedia.org/wiki/File:Kam_Patterson_2024_(2).png) · Roast Battle Chicago · [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)
- **Ari Matti** (`img/comics/ari-matti.webp`): x · [https://x.com/AriMattiComedy](https://x.com/AriMattiComedy) · @AriMattiComedy · profile photo (X)
- **Casey Rocket** (`img/comics/casey-rocket.webp`): ticketmaster · [https://killtonyhq.com/comedian/casey-rocket](https://killtonyhq.com/comedian/casey-rocket) · Casey Rocket · artist promo headshot (Ticketmaster)
- **Dedrick Flynn** (`img/comics/dedrick-flynn.webp`): ticketmaster · [https://killtonyhq.com/comedian/dedrick-flynn](https://killtonyhq.com/comedian/dedrick-flynn) · Dedrick Flynn · artist promo headshot (Ticketmaster)
- **Pat O'Neill** (`img/comics/pat-oneill.webp`): x · [https://x.com/patoneillcomedy](https://x.com/patoneillcomedy) · @patoneillcomedy · profile photo (X)
- **Heather McMahan** (`img/comics/heather-mcmahan.webp`): commons · [https://commons.wikimedia.org/wiki/File:Heather_McMahan_2019_01.png](https://commons.wikimedia.org/wiki/File:Heather_McMahan_2019_01.png) · Adam Rippon · [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)
- **Kimberly Congdon** (`img/comics/kimberly-congdon.webp`): youtube · [https://killtonyhq.com/comedian/kimberly-congdon](https://killtonyhq.com/comedian/kimberly-congdon) · Kimberly Congdon · YouTube channel avatar
- **Sara Weinshenk** (`img/comics/sara-weinshenk.webp`): x · [https://x.com/princessshenk](https://x.com/princessshenk) · @princessshenk · profile photo (X)
- **Vanessa Johnston** (`img/comics/vanessa-johnston.webp`): youtube · [https://killtonyhq.com/comedian/vanessa-johnston](https://killtonyhq.com/comedian/vanessa-johnston) · Vanessa Johnston · YouTube channel avatar
- **Martin Phillips** (`img/comics/martin-phillips.webp`): ticketmaster · [https://killtonyhq.com/comedian/martin-phillips](https://killtonyhq.com/comedian/martin-phillips) · Martin Phillips · artist promo headshot (Ticketmaster)
- **Pat Regan** (`img/comics/pat-regan.webp`): ticketmaster · [https://killtonyhq.com/comedian/pat-regan](https://killtonyhq.com/comedian/pat-regan) · Pat Regan · artist promo headshot (Ticketmaster)
- **Timmy No Brakes** (`img/comics/timmy-no-brakes.webp`): ticketmaster · [https://killtonyhq.com/comedian/timmy-no-brakes](https://killtonyhq.com/comedian/timmy-no-brakes) · Timmy No Brakes · artist promo headshot (Ticketmaster)
- **Ahren Belisle** (`img/comics/ahren-belisle.webp`): ticketmaster · [https://killtonyhq.com/comedian/ahren-belisle](https://killtonyhq.com/comedian/ahren-belisle) · Ahren Belisle · artist promo headshot (Ticketmaster)
- **Enrique Chicone** (`img/comics/enrique-chicone.webp`): youtube · [https://killtonyhq.com/comedian/enrique-chicone](https://killtonyhq.com/comedian/enrique-chicone) · Enrique Chicone · YouTube channel avatar
- **Tristan Bowling** (`img/comics/tristan-bowling.webp`): youtube · [https://killtonyhq.com/comedian/tristan-bowling](https://killtonyhq.com/comedian/tristan-bowling) · Tristan Bowling · YouTube channel avatar
- **Nicole Tran** (`img/comics/nicole-tran.webp`): youtube · [https://killtonyhq.com/comedian/nicole-tran](https://killtonyhq.com/comedian/nicole-tran) · Nicole Tran · YouTube channel avatar
- **Jack Shaw** (`img/comics/jack-shaw.webp`): x · [https://x.com/hijackshaw](https://x.com/hijackshaw) · @hijackshaw · profile photo (X)
- **Todd Royce** (`img/comics/todd-royce.webp`): x · [https://x.com/ToddRoyceXXL](https://x.com/ToddRoyceXXL) · @ToddRoyceXXL · profile photo (X)
- **Collin Sledge** (`img/comics/collin-sledge.webp`): youtube · [https://killtonyhq.com/comedian/collin-sledge](https://killtonyhq.com/comedian/collin-sledge) · Collin Sledge · YouTube channel avatar
- **Fiona Cauley** (`img/comics/fiona-cauley.webp`): x · [https://x.com/FionaCauley](https://x.com/FionaCauley) · @FionaCauley · profile photo (X)
- **Heath Cordes** (`img/comics/heath-cordes.webp`): youtube · [https://killtonyhq.com/comedian/heath-cordes](https://killtonyhq.com/comedian/heath-cordes) · Heath Cordes · YouTube channel avatar
- **Colt McNeely** (`img/comics/colt-mcneely.webp`): youtube · [https://killtonyhq.com/comedian/colt-mcneely](https://killtonyhq.com/comedian/colt-mcneely) · Colt McNeely · YouTube channel avatar
- **Ric Diez** (`img/comics/ric-diez.webp`): x · [https://x.com/sadmanric](https://x.com/sadmanric) · @sadmanric · profile photo (X)
- **Sir Winston Pickles** (`img/comics/sir-winston-pickles.webp`): commons · [https://commons.wikimedia.org/wiki/File:Sir_Winston_Pickles.jpg](https://commons.wikimedia.org/wiki/File:Sir_Winston_Pickles.jpg) · Sir Winston Pickles · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)
- **Aloe Mean** (`img/comics/aloe-mean.webp`): x · [https://x.com/AloeMean](https://x.com/AloeMean) · @AloeMean · profile photo (X)
- **Carlos Lopez** (`img/comics/carlos-lopez.webp`): youtube · [https://killtonyhq.com/comedian/carlos-lopez](https://killtonyhq.com/comedian/carlos-lopez) · Carlos Lopez · YouTube channel avatar
- **Charlie Mac** (`img/comics/charlie-mac.webp`): x · [https://x.com/funnycharliemac](https://x.com/funnycharliemac) · @funnycharliemac · profile photo (X)
- **Jeremiah Watkins** (`img/comics/jeremiah-watkins.webp`): x · [https://x.com/jeremiahstandup](https://x.com/jeremiahstandup) · @jeremiahstandup · profile photo (X)

Brent Reed has no photo on purpose (the earlier X avatar was a different Brent Reed); he shows initials.

### Panel photos (`img/panel/`)

Shown in Rate the Panel. All from Wikimedia Commons under the licences below.

- **Tony Hinchcliffe** (`img/panel/tony-hinchcliffe.webp`): Wikimedia Commons · [File:Tony Hinchcliffe on The Comedy Store podcast (cropped).jpg](https://commons.wikimedia.org/wiki/File:Tony_Hinchcliffe_on_The_Comedy_Store_podcast_(cropped).jpg) · The Comedy Store · [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) · cropped to a 96 px face thumbnail
- **Brian Redban** (`img/panel/brian-redban.webp`): Wikimedia Commons · [File:Brian Redban.png](https://commons.wikimedia.org/wiki/File:Brian_Redban.png) · The Joe Rogan Experience · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) · cropped to a 96 px face thumbnail
- **Jim Norton** (`img/panel/jim-norton.webp`): Wikimedia Commons · [File:Jim Norton photo by Josh Alder.jpg](https://commons.wikimedia.org/wiki/File:Jim_Norton_photo_by_Josh_Alder.jpg) · BoboMejor (Josh Alder) · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) · cropped to a 96 px face thumbnail
- **Anthony Cumia** (`img/panel/anthony-cumia.webp`): Wikimedia Commons · [File:Anthony Cumia in October 2021.png](https://commons.wikimedia.org/wiki/File:Anthony_Cumia_in_October_2021.png) · UnorthodoxyAC · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) · cropped to a 96 px face thumbnail
- **Shane Gillis** (`img/panel/shane-gillis.webp`): Wikimedia Commons · [File:Shane Gillis (cropped) (cropped).jpg](https://commons.wikimedia.org/wiki/File:Shane_Gillis_(cropped)_(cropped).jpg) · Quintin Soloviev · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) · cropped to a 96 px face thumbnail
- **Joe Rogan** (`img/panel/joe-rogan.webp`): Wikimedia Commons · [File:Joe Rogan.png](https://commons.wikimedia.org/wiki/File:Joe_Rogan.png) · Steven Crowder · [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) · cropped to a 96 px face thumbnail
- **Theo Von** (`img/panel/theo-von.webp`): Wikimedia Commons · [File:Theo Von Comedian (cropped).jpg](https://commons.wikimedia.org/wiki/File:Theo_Von_Comedian_(cropped).jpg) · Lisa Gansky · [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0/) · cropped to a 96 px face thumbnail
- **Adam Ray** (`img/panel/adam-ray.webp`): Wikimedia Commons · [File:Adam Ray in Japan, 2018 (cropped).jpg](https://commons.wikimedia.org/wiki/File:Adam_Ray_in_Japan,_2018_(cropped).jpg) · Pfc. Nicole Rogge (U.S. Marine Corps) · [Public domain](https://en.wikipedia.org/wiki/Public_domain) · cropped to a 96 px face thumbnail
- **Bert Kreischer** (`img/panel/bert-kreischer.webp`): Wikimedia Commons · [File:Bert kreischer (52703154941) (cropped).jpg](https://commons.wikimedia.org/wiki/File:Bert_kreischer_(52703154941)_(cropped).jpg) · Zach Catanzareti Photo · [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) · cropped to a 96 px face thumbnail
- **Ari Shaffir** (`img/panel/ari-shaffir.webp`): Wikimedia Commons · [File:Ari Shaffir 2016.jpg](https://commons.wikimedia.org/wiki/File:Ari_Shaffir_2016.jpg) · Lisa Gansky · [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0/) · cropped to a 96 px face thumbnail

Guests not in this map: the page looks up the guest's English Wikipedia article once (REST page summary), and uses its lead image only if the article is a regular page whose description mentions comedy, podcasting, radio, TV, acting or music. and only when that image is hosted on Wikimedia Commons (free licences only; locally hosted non-free files are skipped). The avatar's tooltip and link credit Wikipedia / Wikimedia Commons; otherwise the guest shows initials.

### Sandwich rating icon (`img/sandwich.png`, `img/sandwich-icon.webp`)

Provided by the site owner for Redban's panel rating icons (replaces the sandwich emoji). Background removed and trimmed for transparent use.

### Microphone rating icon (`img/mic.png`, `img/mic-icon.webp`)

Provided by the site owner for Tony's panel rating icons (replaces the microphone emoji). Black background removed and trimmed for transparent use.

### Wacky shirt rating icon (`img/shirt.png`, `img/shirt-icon.webp`)

Provided by the site owner for Pat O'Neill's panel (and regulars) rating icons. Psychedelic Hawaiian shirt; black studio background removed, trimmed and square-padded for transparent use.

### Gold grills rating icon (`img/grill.png`, `img/grill-icon.webp`)

Provided by the site owner for Dedrick Flynn's regulars (and panel, if he is on it) rating icons. Gold dental grills; white studio background removed, trimmed and square-padded (wide subject) for transparent use at icon size.

### Archive icon (`img/archive.png`, `img/archive-icon.webp`)

Provided by the site owner for the Episode Archive control. Current art is the KT Archives film reel (image-only button, no text label). White background and floor shadow removed; spoke gaps and sprocket holes made transparent; trimmed for use on dark UI. The previous wooden cabinet art is kept as `img/archive-cabinet.*` backups.

### App icon / favicon (`favicon.ico`, `apple-touch-icon.png`, `icons/icon-*.png`, `og.png`)

Provided by the site owner: black metal bucket stenciled BPL, filled with crumpled paper. White studio background removed; icon set centered on the site's near-black (`#050505`) for home-screen / PWA install, with a maskable 512 variant that keeps extra safe-zone padding.
