# Roadmap

Five phases, ordered so that each one unblocks the next rather than by how
visible the result is.

Current version: **0.9.0**. Phases 1, 2 and 3 are complete; phase 4 is under
way — see [4b](#4b--catalogue-the-atlas--nearly-done) for where it stands and
[4a](#4a--watch-the-original--not-started-and-it-blocks-the-rest) for what to
pick up next.

## Phase 1 — Separate assets from targets ✅

Done in 0.4.0. Assets live once under `assets/`, the engine under `core/`, host
shells under `targets/`, and payloads are assembled into `build/`. This is what
makes a second and third target possible without duplicating megabytes, and it
removed the unsynchronised `plugin/` copy.

## Phase 2 — Make the core deterministic and geometry-aware ✅

The blocking phase, and the reason it came before any new platform. Earlier
prototypes were driven by roughly 120 per-character QML timers against the wall
clock: not deterministic, not portable to C, and poor at scale.

- ✅ extract the rules out of `Character.qml` into `core/js/Simulation.js`,
  operating on a duck-typed state so they run headless under Node — this is
  what makes everything below verifiable without Qt;
- ✅ one seeded PRNG (mulberry32) shared by every implementation, replacing
  every `Math.random()` call;
- ✅ a single fixed-timestep loop stepping all characters, with elapsed time
  passed in rather than read inside;
- ✅ a world made of one rectangle per screen, replacing the implicit single
  width × height, so that a continuous multi-monitor world and a per-screen
  world are the same code path with a different rectangle count;
- ✅ spatial partitioning replacing the O(n²) avoidance scan, without losing
  seeded replay;
- ✅ golden traces in `tests/golden/`, generated from the JS core.

The Plasma target remained functional throughout, and gained a configuration
page in 0.8.0.

## Phase 3 — The standalone Qt application

A second host shell over the same `core/`. **Windows first**, because that is
the platform where the modern version has something the original could not do,
and because the Plasma target already covers KDE. Linux follows from the same
CMake project.

- ✅ **State and view split** (0.9.0). The simulation owns plain JavaScript
  character objects; `Character.qml` is a view the simulation never touches.
  Frame data moved into the simulation at the same time, because no single view
  can own it once there are several. `PopulousWorld.qml` kept its property
  surface, so the Plasma and preview hosts were untouched.
- ✅ **The multi-window shell** (0.9.0). One `QQmlEngine`, one window per
  `QScreen`, one shared simulation, and the world built from every screen's
  geometry. Verified on a 1920×1200 beside two 1920×1080: characters walk from
  one physical monitor to the next and trails cross the seams.
- ✅ **The `.scr` entry point** (0.9.0). `/s`, `/c`, `/p <hwnd>` and a `/w`
  development mode, all four verified, with quitting on input guarded against
  the movement burst Windows sends at launch.
- ✅ **Packaging** (0.9.0). A `deploy` target gathering a runnable directory, a
  `package` target zipping it, a version resource, and an installer that needs
  no elevation.

**Packaging is settled: install anywhere, write the registry.** Tested on
Windows 11 by pointing `HKCU\Control Panel\Desktop\SCRNSAVE.EXE` at a
deployed binary outside `System32` and opening the screen-saver dialog. Windows
ran it, listed it, and drew the thumbnail. **No `System32` stub and no static
Qt build are needed.**

One nuance: the dialog lists the *currently selected* screen saver plus those
in `System32`, and offers no way to browse. The installer therefore writes the
registry value itself — a user cannot pick the screen saver from the list until
something has selected it once.

The archive is about 40 MB, unpacked to roughly 100 MB across 1378 files.

### What is left in this phase

**Deployment weight is worth a decision.** Almost all of those files are
QtQuick.Controls, which serves nothing but the `/c` dialog: the dependency set
is 40 MB across 35 files without it. Rewriting that dialog in plain QtQuick
would cut the download by more than half.

**One sprite scale for the whole world**, taken from the primary screen.
Per-monitor DPI would mean per-character margins and speeds, which the state
does not model.

Publishing the archive as a GitHub release, and wiring that to CI, is the
remaining step. Nothing about the artefact itself is blocking.

## Phase 4 — The rest of the simulation

Grouping the atlas first, then implementing behaviour in dependency order.
Observed behaviour is reproduced first; disassembling the original's 129 KB of
code is a fallback for ambiguous rules, probabilities or timings.

[spec/simulation.md](../spec/simulation.md) is written **as** each rule is
implemented, while the reasoning is fresh.

### 4b — Catalogue the atlas 🔄 nearly done

**1,101 of the 1,179 usable cells are grouped, into 382 animations**, against
160 and 40 when the phase started. Nothing in `core/` or in any QML file
changed: the simulation looks animations up by id and does not care how many
exist. Tests stay at 54 and the golden traces still reproduce.

What was found is written up in
[asset-pipeline.md](asset-pipeline.md#what-the-atlas-turned-out-to-be) — the
generalised width signature, the entities it uncovered, the merged cell, and
why sounds turned out to be a poor witness. `tools/build-sprites.py` now prints
a coverage line and the unclaimed ranges, so progress is a number rather than
an impression.

**What is left: cells 819–896**, the 78 particle cells, five pixels tall. One
connected component there is not one frame, so they need handling of their own
— probably a stream kind that takes a whole band and leaves it unsegmented
until something needs it.

### 4a — Watch the original ⏳ not started, and it blocks the rest

Running `original/Populous Screen Saver.scr` full screen and writing down what
it does, into `research/original-behaviour.md`. It needs Windows, or Wine on
the KDE machine.

This is now the bottleneck, because the catalogue raised questions only the
original can answer:

- **does a shaman ever fight?** `shaman_punch` is an arms-out pose that reads
  as a blow, but enemy braves are remembered as walking straight past. These
  cells may go unused;
- **are the waving animations used at all?** `brave_wave` and
  `firewarrior_wave` are grouped so the cells are accounted for, on the
  suspicion that nothing plays them;
- **every frame duration outside the walk cycles is invented.** Idle, cast,
  punch, kick, soul and the two effects all carry a provisional number and a
  note saying so;
- what triggers a fight, how long one lasts, what happens to the loser, how
  Armageddon starts, and whether the run ends or loops.

Record which sounds accompany which events by ear. The 28 file names are
suggestive and were already misleading once: `punch1`–`punch8` and
`swords1`–`swords5` led to naming two brave animations a punch and a sword
swing, when they are a brave *taking* a blow and a brave *kicking*.

### 4c onwards — behaviours

Each becomes its own plan once 4a has said what the rules are.

**4c — behaviour states and events**, the foundation the rest needs.
`stepCharacter` is one monolithic walk rule today, and `animationId` in
`core/js/Simulation.js` hard-codes `"brave." + tribe + ".walk." +
directionId` — with 382 animations behind it, that is now the narrowest point
in the engine. The state gains `entity`, `action` and a `behaviour` with an
explicit transition table; `stepSimulation` returns typed events instead of
only footprints, which is what both the renderer and the future audio layer
consume; non-character entities (souls, effects) become a second list with
their own lifetimes.

Then **4d** combat and deaths, **4e** conversions and spells, **4f** gathering
and Armageddon. Every one changes the golden traces: regenerate them once per
step, deliberately, and read the JSON diff.

## Phase 5 — The xscreensaver hack

Last, deliberately. It is a C and OpenGL renderer sharing no code with the QML
targets, so it should be written against a frozen spec and an existing set of
golden traces rather than a moving one.

X11 only, and therefore not usable under Wayland. It exists for non-KDE and X11
setups, not as the Linux path — on KDE, the wallpaper plugin is.

## Acceptance checklist

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
