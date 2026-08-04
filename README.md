# Populous Screen Saver

A port of Bullfrog's 1998 Windows screen saver for **Populous: The Beginning**
to modern systems.

The original `.scr` is preserved untouched as the source of truth. Its sprites
and sound effects are extracted from it; the simulation is rewritten from
scratch. Rendering is on a black background, like the version most people
remember from Windows XP.

The project builds **two versions from one engine**:

- a **faithful port**, reproducing the 1998 behaviour on one screen;
- a **modern version**, which the original could not do: a single continuous
  world spanning every monitor, high-DPI aware, with a seeded deterministic
  simulation.

## Deliverables

| Target | Host | Renderer | Multi-monitor | Status |
| ------ | ---- | -------- | ------------- | ------ |
| `plasma` | KDE Plasma 6 wallpaper plugin | QML | one world per screen | working |
| `qt-app` (Linux) | standalone executable | QML | continuous world | planned |
| `qt-app` (Windows) | `.scr` screen saver | QML | continuous world | planned |
| `xscreensaver` | X11 screen saver hack | C / OpenGL | one world per window | planned |

The Plasma wallpaper plugin is also what KDE's **lock screen** consumes, so it
covers the screen-saver use case on KDE without being a screen saver in the
X11 sense.

Three of the four targets share the QML engine verbatim. The xscreensaver hack
cannot: it is a C binary drawing into an X11 window handed to it on the command
line. That target is the one deliberate duplication in the project, and the
measures that keep it from silently diverging are described under
[Determinism](#determinism-and-the-c-port).

## Repository layout

```text
populous-screensaver/
├── original/          # the 1998 .scr, never modified
├── extracted/         # raw Windows resources unpacked from it
├── tools/             # Python pipeline: extract, analyse, build, assemble
├── research/          # atlas analysis and review artefacts
├── assets/            # canonical output of the pipeline, stored once
│   ├── images/        #   sprites.png, plinth.png
│   ├── data/          #   sprites.json — the animation manifest
│   ├── sounds/        #   28 original PCM effects
│   └── sounds-converted/
├── core/              # the engine, shared by every QML target
│   ├── qml/           #   Character.qml, Footprint.qml
│   └── js/            #   Simulation.js, Animations.js (generated)
├── spec/              # language-neutral simulation rules
├── targets/           # per-target host shells only
│   └── plasma/        #   metadata.json + contents/ui/main.qml
├── tests/             # standalone preview, golden traces
└── build/             # assembled payloads — generated, not versioned
```

The rule that shapes this layout: **nothing shared is stored twice.** The atlas
and the 56 sound files exist once, under `assets/`. Targets contain only what
is genuinely specific to their host — for Plasma, that is a `metadata.json` and
a single `main.qml`. Everything else is copied in at build time by
`tools/build-targets.py`.

Earlier versions kept a fully assembled `package/` *and* a byte-for-byte
duplicate in `plugin/`, which meant 3.6 MB of assets stored twice with nothing
keeping them in sync. Both are gone.

## How it fits together

```text
original/*.scr
    │  7z, ffmpeg
    ▼
extracted/            raw bitmaps, mask, 28 WAV resources
    │  tools/build-atlas.py, tools/extract-native-sprites.py
    ▼
research/             frame coordinates, groupings, reviewed layout
    │  tools/build-sprites.py
    ▼
assets/               atlas + manifest + sounds        ─┐
core/                 engine (QML + JS)                 ├─ tools/build-targets.py
targets/<name>/       host shell                       ─┘
    ▼
build/<target>/       installable payload
```

## Current status

Version 0.5.0.

**Done**

- [x] Original `.scr` preserved and identified
- [x] Windows resources extracted
- [x] Sprite sheet converted to RGBA using the transparency mask
- [x] Populous plinth banner converted
- [x] 28 WAV effects extracted and converted
- [x] Automatic frame detection over the atlas
- [x] Annotated atlas map for visual review
- [x] First visual classification of sprite families
- [x] 1,180 native cells recovered from the original binary
- [x] 40 walk cycles grouped: five tribe variants, eight directions
- [x] QML prototype on a black background
- [x] Walking, direction changes, collision avoidance
- [x] Temporary footprints tinted per tribe
- [x] Plasma plugin installs and runs locally
- [x] Assets separated from targets, payloads assembled on demand
- [x] Simulation rules extracted from QML, covered by headless Node tests
- [x] Seeded PRNG: a given seed replays exactly
- [x] Single fixed-timestep loop, replacing ~120 per-character timers

**Next**

- [ ] World-region and viewport geometry in the core
- [ ] Group the remaining atlas frames into named animations
- [ ] Combat, deaths, conversions, shamans, spells, gathering, Armageddon
- [ ] Sound playback
- [ ] Plasma configuration page
- [ ] Standalone Qt application, Linux then Windows `.scr`
- [ ] xscreensaver hack
- [ ] Lock-screen selection and testing

## Dependencies

On Ubuntu and derivatives:

```bash
sudo apt install \
    7zip \
    ffmpeg \
    python3-pil \
    qml6-module-qtquick \
    qml6-module-qtquick-controls \
    qml6-module-qtquick-layouts \
    qml6-module-qtmultimedia \
    qml6-module-qtqml-workerscript
```

The pipeline needs Python 3 with Pillow. The Plasma target needs no C++
compiler, no CMake and no Qt development libraries — it is QML and JavaScript
only. The Qt application and the xscreensaver hack will need a toolchain; that
is confined to those targets.

## Asset pipeline

### 1. Preserve the original

The original file is kept separate so every derived resource can be rebuilt:

```bash
mkdir -p original
cp "../Populous Screen Saver.scr" original/
sha256sum "original/Populous Screen Saver.scr"
```

Known SHA-256:

```text
a25f7f7d219018fcf1888891738a706dff5f39f72de103a21dde3945f7097e0b
```

### 2. Extract the Windows resources

```bash
mkdir -p extracted
7z x "original/Populous Screen Saver.scr" -oextracted
```

The resources that matter:

- `IDB_POPSAVER.bmp` — colour sprite sheet, 640 × 1277 pixels;
- `IDB_POPSAVERMASK.bmp` — transparency mask;
- `IDB_PLINTH2.bmp` — Populous banner;
- `WAVE/*` — 28 PCM sound effects.

### 3. Build the transparent atlas

The black-and-white mask is inverted and used as the alpha channel:

```bash
mkdir -p assets/images

ffmpeg \
    -i extracted/.rsrc/BITMAP/IDB_POPSAVER.bmp \
    -i extracted/.rsrc/BITMAP/IDB_POPSAVERMASK.bmp \
    -filter_complex \
    "[1:v]format=gray,negate[alpha];[0:v][alpha]alphamerge,format=rgba" \
    -frames:v 1 \
    assets/images/sprites.png

ffmpeg \
    -i extracted/.rsrc/BITMAP/IDB_PLINTH2.bmp \
    -frames:v 1 \
    assets/images/plinth.png
```

### 4. Recover the sounds

The resources are already WAV files, but carry no extension:

```bash
mkdir -p assets/sounds

for source_file in extracted/.rsrc/WAVE/*; do
    sound_name="$(basename "$source_file")"
    sound_name="${sound_name#WAV_}"
    cp "$source_file" "assets/sounds/${sound_name,,}.wav"
done
```

A 16-bit 44.1 kHz PCM version is kept alongside for Qt Multimedia
compatibility:

```bash
mkdir -p assets/sounds-converted

for source_file in assets/sounds/*.wav; do
    sound_name="$(basename "$source_file")"
    ffmpeg -i "$source_file" \
        -ar 44100 \
        -ac 1 \
        -c:a pcm_s16le \
        "assets/sounds-converted/$sound_name"
done
```

### 5. Map the sprites

The sheet contains opaque horizontal guide lines. The detector finds those
guides, then the transparent column runs that separate candidate poses:

```bash
python3 tools/build-atlas.py
```

It writes `research/sprites-detected.json` and an annotated
`research/sprites-detected.png` for visual checking. Current result:

```text
39 usable guide lines
39 sprite bands
1179 candidate rectangles
```

Not every rectangle is a complete frame. Particles and multi-part effects can
produce several rectangles for one logical frame.

The binary also contains a native table of 1,180 cells with width, height and
position. It preserves the transparent padding that keeps a character from
jittering during an animation:

```bash
python3 tools/extract-native-sprites.py
```

`research/sprites-native.json` is the authoritative source of coordinates.
Visual detection remains useful for naming and grouping sequences.

### 6. Build the animation manifest

In progress. 160 walk frames are identified and grouped into 40 animations:
five tribe variants, eight directions, four poses per cycle.

Atlas rows 0 to 5 hold five consecutive blocks of 40 native cells starting at
sprite 0. Each block is the same character in a different colour — only the
loincloth carries it, and the first block has none. Of the 40 cells in a block,
only the first 32 form the walk cycle; the last 8 are standing poses.

| Block | First sprite | Tribe |
| ----- | ------------ | ----- |
| 0 | 0 | neutral |
| 1 | 40 | blue |
| 2 | 80 | red |
| 3 | 120 | yellow |
| 4 | 160 | green |

The direction order was recovered from the cell-width signature, which is
mirror-symmetric in blocks of four: `south_west` mirrors `south_east`, `west`
mirrors `east`, `north_west` mirrors `north_east`, and `south` and `north` are
the two self-symmetric axes. East and west were then told apart by inspection —
direction index 2 leans and strides towards the left of the screen, index 6
towards the right. The correct order is:

```text
south, south_west, west, north_west, north, north_east, east, south_east
```

Versions before 0.4.0 read 128 frames starting at sprite 495. Those cells are
atlas rows 16 to 19: standing poses with a raised arm and no leg cycle at all.
They were also walked in the reverse direction order, which swapped east and
west. Both bugs are fixed.

`research/sprite-groups.json` holds the first visual classification of the rest
of the sheet: shamans, gold and green figures, falls and rolls, fires,
particles, combatants, probable Armageddon sequences and a circular spell
effect. None of these are grouped into named animations yet.

For each sequence still to be reviewed, the checks are: where it starts and
ends, frame order, direction, tribe or character type, approximate duration,
ground anchor, and any associated sound. The default anchor is the bottom
centre of the rectangle and must be corrected for sequences that jitter.

Reviewed sequences are described in `research/animation-layout.json` and
compiled with:

```bash
python3 tools/build-sprites.py
```

This writes `assets/data/sprites.json` (canonical), `research/sprites.json`
(same content, for review), `core/js/Animations.js` (importable from QML) and
`research/walk-cycles.gif` for visually checking cycles, directions and
anchors.

`Animations.js` exists because Qt forbids `XMLHttpRequest` from reading local
files by default, so the manifest is also emitted as a JavaScript module.

## The engine

`core/` holds everything that is not host-specific.

- `core/js/Simulation.js` — **the rules**: directions, tribes, tuning values,
  spawning, stepping, edge bouncing, avoidance, wandering and footprint
  decisions. A `.pragma library` module with no QML dependency, no clock access
  and no callbacks.
- `core/qml/Character.qml` — one character on screen. Owns the state, the
  manifest lookup and the sprite, and calls into `Simulation.js` for every
  rule. Renders a region of the atlas with `sourceClipRect`, avoiding hundreds
  of small PNG files.
- `core/qml/Footprint.qml` — a fading footprint pair, tinted per tribe.
- `core/js/Animations.js` — generated manifest.

The rules operate on a duck-typed character state, so the same code runs on a
QML `Item` and on a plain object. That is what makes the simulation testable
without Qt:

```bash
node --test "tests/**/*.test.mjs"
```

A host shell supplies a black background, a character count, a sprite scale and
the world geometry, then instantiates characters. `targets/plasma/contents/ui/main.qml`
is that shell for Plasma, in 81 lines. The Qt application will be a second one.

The rules the engine implements, and the ones still missing, are written down
in [spec/simulation.md](spec/simulation.md).

## Building and installing

Assemble every target payload:

```bash
python3 tools/build-targets.py --clean
```

Then install the Plasma wallpaper plugin:

```bash
kpackagetool6 --type Plasma/Wallpaper --install build/plasma/org.poptheme.populous
```

During development, after each change:

```bash
python3 tools/build-targets.py
kpackagetool6 --type Plasma/Wallpaper --upgrade build/plasma/org.poptheme.populous
```

Check and remove:

```bash
kpackagetool6 --type Plasma/Wallpaper --list
kpackagetool6 --type Plasma/Wallpaper --remove org.poptheme.populous
```

A standalone preview is available without touching the desktop, once the
payload is built and `qmlscene-qt6` is installed:

```bash
python3 tools/build-targets.py
qmlscene-qt6 --software --resize-to-root tests/Preview.qml
```

The prototype was validated at 1280 × 720 with Qt software rendering: 24
characters spread over the black surface, cycles animating, positions staying
inside the bounds.

### Enabling it on the lock screen

```text
System Settings
→ Security & Privacy
→ Screen Locking
→ Configure Appearance
→ Wallpaper type
→ Populous Screen Saver
```

Quick test: `Ctrl + Alt + L`.

## The plan

Five phases. Each one is ordered so that it unblocks the next, rather than by
how visible the result is.

### Phase 1 — Separate assets from targets ✅

Done in 0.4.0. Assets live once under `assets/`, the engine under `core/`, host
shells under `targets/`, and payloads are assembled into `build/`. This is what
makes a second and third target possible without duplicating megabytes, and it
removes the unsynchronised `plugin/` copy.

### Phase 2 — Make the core deterministic and geometry-aware

The blocking phase, and the reason it comes before any new platform.

The simulation is currently driven by **per-character QML timers** — animation,
init, movement, avoidance, wander, five timers times 24 characters, each ticking
against the wall clock through `Date.now()`. That is three problems at once: it
is not deterministic, so implementations cannot be compared; it does not port to
C; and it scales badly towards dozens of characters across three monitors.

The work:

- ✅ extract the rules out of `Character.qml` into `core/js/Simulation.js`,
  operating on a duck-typed state so they run headless under Node — this is
  what makes every step below verifiable without Qt;
- ✅ one seeded PRNG (mulberry32) shared by every implementation, replacing
  every `Math.random()` call;
- ✅ a single fixed-timestep loop stepping all characters, with elapsed time
  passed in rather than read inside;
- world region plus viewport list replacing the implicit single `width` ×
  `height`, so that a continuous multi-monitor world and a per-screen world are
  the same code path with a different viewport count;
- spatial partitioning to replace the O(n²) avoidance scan;
- golden traces in `tests/golden/`, generated from the JS core.

The Plasma target must keep working throughout.

### Phase 3 — The standalone Qt application

A second host shell over the same `core/`. Linux first, because iteration is
faster there, then the Windows `.scr`.

A `.scr` is an ordinary executable with a different extension, invoked with
`/s` to run, `/c` to configure and `/p <hwnd>` to preview in the Windows
settings dialog. Qt enumerates monitors through `QScreen`, so the continuous
world from phase 2 maps directly onto one window per monitor.

This is the target that gives the modern version its reason to exist.

### Phase 4 — The rest of the simulation

Grouping the remaining atlas frames, then implementing behaviour, in
dependency order: combat and deaths, conversions, shamans and spells, gathering
at the centre, Armageddon. Sound comes with it, wired to simulation events with
a cap on simultaneous effects.

`spec/simulation.md` is written **as** each rule is implemented, while the
reasoning is fresh, not reconstructed afterwards.

Observed behaviour is reproduced first. Disassembling the original's 129 KB of
code is a fallback, used only to settle ambiguous rules, probabilities or
timings.

### Phase 5 — The xscreensaver hack

Last, deliberately. It is a C and OpenGL renderer that shares no code with the
QML targets, so it should be written against a frozen spec and an existing set
of golden traces rather than against a moving one.

X11 only, and therefore not usable under Wayland. It exists for non-KDE and
X11 setups, not as the Linux path — on KDE, the wallpaper plugin is.

## Determinism and the C port

The xscreensaver target forces the simulation to exist in two languages. Two
measures keep that from turning into silent divergence:

1. **A shared seeded PRNG.** Identical algorithm, identical draw order,
   identical output for a given seed. Without this, nothing below is possible.
2. **Golden traces.** Both implementations run from the same seed, dump the
   state of every character over N fixed steps, and the traces are diffed. A
   behavioural difference becomes a failing comparison instead of something
   noticed months later on screen.

This also gives the optional test seed already planned for the configuration
page.

## Configuration

Planned settings, following the original:

- number of characters;
- delay before Armageddon;
- sound on or off, and volume;
- footprint intensity;
- sprite size;
- optional random seed, for testing;
- multi-monitor mode: continuous world or one world per screen.

The background always stays black.

## Validation

Before the port can be called finished:

- rendering with no borders or guide lines;
- characters stable on the ground, no jitter;
- performance with several dozen characters;
- high-DPI displays;
- multi-monitor layouts, including mixed resolutions and non-rectangular
  arrangements;
- an X11 session and a Wayland session;
- repeated lock and unlock;
- sound stopping correctly on unlock;
- no process or resource left behind after shutdown;
- Windows: `/s`, `/c` and `/p` behaving as the settings dialog expects.

## Resources and distribution

The images, sounds, names and trademarks of Populous and Bullfrog remain the
property of their rights holders. The extracted resources are for local use.
If the project is published, the port's code must be kept separate from the
original resources.
