# Roadmap

Five phases, ordered so that each one unblocks the next rather than by how
visible the result is.

Current version: **0.9.0**. Phases 1, 2 and 3 are complete.

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

Grouping the remaining atlas frames, then implementing behaviour in dependency
order: combat and deaths, conversions, shamans and spells, gathering at the
centre, Armageddon. Sound comes with it, wired to simulation events with a cap
on simultaneous effects.

Observed behaviour is reproduced first. Disassembling the original's 129 KB of
code is a fallback, used only to settle ambiguous rules, probabilities or
timings.

[spec/simulation.md](../spec/simulation.md) is written **as** each rule is
implemented, while the reasoning is fresh.

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
