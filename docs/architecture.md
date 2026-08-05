# Architecture

How the repository is laid out, how the engine is separated from the hosts that
run it, and what keeps the future C port from silently drifting.

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
│   ├── qml/           #   PopulousSimulation, PopulousView, PopulousWorld,
│   │                  #   Character, Footprint
│   └── js/            #   Simulation.js, Animations.js (generated)
├── spec/              # normative simulation rules
├── targets/           # per-target host shells only
│   ├── plasma/        #   metadata, host QML and configuration page
│   ├── preview/       #   main.qml, a plain window for development
│   └── qt-app/        #   CMake, C++ entry point, one window per screen
├── tests/             # headless tests and golden traces
└── build/             # assembled payloads — generated, not versioned
```

The rule that shapes this layout: **nothing shared is stored twice.** The atlas
and the 56 sound files exist once, under `assets/`. Targets contain only what
is genuinely specific to their host — for Plasma, that is its metadata, host
QML and configuration page. Everything else is copied in at build time by
`tools/build-targets.py`.

Earlier versions kept a fully assembled `package/` *and* a byte-for-byte
duplicate in `plugin/`: 3.6 MB of assets stored twice with nothing keeping them
in sync. Both are gone.

`spec/` is deliberately not under `docs/`. It is a contract rather than an
explanation — the C port has to reproduce it exactly — and it is referenced
from code comments in `core/`.

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

The left column is described in [asset-pipeline.md](asset-pipeline.md).

## The engine

`core/` holds everything that is not host-specific.

- **`core/js/Simulation.js`** — the rules: directions, tribes, tuning values,
  world geometry, spawning, stepping, edge behaviour, avoidance, wandering and
  footprint decisions. A `.pragma library` module with no QML dependency, no
  clock access and no callbacks.
- **`core/js/Animations.js`** — the generated animation manifest. It exists
  because Qt forbids `XMLHttpRequest` from reading local files by default, so
  the manifest is emitted as a JavaScript module as well as JSON.
- **`core/qml/PopulousSimulation.qml`** — owns the simulation and paces it.
  Non-visual, so several views can watch the same one.
- **`core/qml/PopulousView.qml`** — renders one viewport: black background,
  trail layer and the characters visible in it. `viewportX` and `viewportY` are
  its top-left corner in world coordinates, which is how one world spans
  several windows.
- **`core/qml/Character.qml`** — one character on screen. It holds no state, no
  rule and no timer: the view copies four values into it each tick and
  everything visual is a binding derived from them. It renders a region of the
  atlas with `sourceClipRect`, avoiding hundreds of small PNG files.
- **`core/qml/Footprint.qml`** — a fading footprint pair, tinted per tribe.
- **`core/qml/PopulousWorld.qml`** — one simulation and one view wired together.
  This is what a host with a single window wants; drop it into anything that
  gives it a size.

The simulation and the view are separable for one reason: **QML items cannot be
shared between windows.** A host with three monitors creates one
`PopulousSimulation` and three `PopulousView`s over it. Until 0.9.0 the
`Character` items *were* the simulation state, which made that impossible.

### Duck-typed state

Every rule operates on a character state carrying `tribe`, `directionId`,
`worldX`, `worldY`, `speed`, countdowns and so on. A QML `Item` exposing those
as properties qualifies, and so does a plain JavaScript object.

That is what lets the same code drive the Plasma wallpaper and run headless
under Node:

```bash
node --test "tests/**/*.test.mjs"
```

The full field list is in [spec/simulation.md](../spec/simulation.md).

### Three constraints

They exist for the C port, and they are why the simulation is testable at all:

- **no clock access** — the caller passes elapsed time in, and the state holds
  remaining durations rather than timestamps;
- **no callbacks** — callers learn what happened from return values, so
  `stepCharacter` reports `{ directionChanged, footprint }` and
  `stepSimulation` returns the footprints to render;
- **no ambient randomness** — every draw comes from an explicit seeded source.

## Host shells

A host owns exactly three things: the world geometry, the clock, and one loop
calling `stepSimulation`. Everything else is the engine.

The Plasma host is consequently tiny — it instantiates the shared engine and
binds its four settings:

```qml
WallpaperItem {
    PopulousWorld {
        anchors.fill: parent
        characterCount: root.configuration.CharacterCount
        spriteScaleOverride: root.configuration.SpriteScale
        footprintsEnabled: root.configuration.FootprintsEnabled
        randomSeed: root.configuration.RandomSeed
    }
}
```

The preview replaces `WallpaperItem` with a `Window`.

The standalone screen saver is the one host that does not use `PopulousWorld`:
it holds a single `PopulousSimulation` and creates one `Window` per
`Qt.application.screens` entry, each with a `PopulousView` offset by that
monitor's position in the virtual desktop. World coordinates are the virtual
desktop, so characters line up across the seams.

Its C++ entry point does only two things: decide which mode Windows asked for
(`/s`, `/c`, `/p <hwnd>`) and, for the thumbnail, reparent the preview window
into the handle the settings dialog supplies.

## The world

The world is a **list of rectangles**, one per screen it spans, not a single
width × height. A single-screen host passes a list of one, so there is no
separate single-screen mode; it is the degenerate case of the general one.

Two consequences matter:

- **Dead zones.** Screens of different heights leave parts of the bounding box
  belonging to no monitor. Validity is membership of the union, never of the
  bounding box, so characters cannot walk into the gap and vanish.
- **Seams stay open.** Edge margins are *probed* rather than applied per
  rectangle. A probe crossing an internal seam lands in the neighbouring screen
  and is still inside the union, so the character walks through. Insetting each
  rectangle instead would raise an invisible wall down every seam.

Both are specified in [spec/simulation.md](../spec/simulation.md).

## Determinism and the C port

Three of the four targets share the QML engine verbatim. The xscreensaver hack
cannot: it is a C binary drawing into an X11 window handed to it on the command
line. That target is the one deliberate duplication in the project.

Two measures keep it from turning into silent divergence:

1. **A shared seeded PRNG.** mulberry32, chosen because every operation is an
   explicit unsigned 32-bit one and JavaScript's `Math.imul` is the same
   truncating 32-bit multiply as C's `uint32_t` multiply. Identical algorithm,
   identical draw order, identical output for a given seed.
2. **Golden traces.** Both implementations run from the same seed, dump the
   state of every character over N fixed steps, and the traces are diffed. A
   behavioural difference becomes a failing comparison instead of something
   noticed months later on screen.

`tests/golden/` holds traces for a single-screen and a three-screen world.

### What tests cannot check

Whether the frames behind a direction id *face* the right way is a claim about
pixels, not code. The direction order was once reversed, and every test still
passed while six of the eight directions moonwalked.

`research/direction-check.png` draws each compiled animation beside the vector
it travels along. It is the only thing that catches this, and it should be
re-read whenever the direction order or a source range changes.
