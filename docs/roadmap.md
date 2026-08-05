# Roadmap

Five phases, ordered so that each one unblocks the next rather than by how
visible the result is.

Current version: **0.8.1**. Phases 1 and 2 are complete.

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

Three steps:

1. **State and view split.** The simulation must own plain JavaScript character
   objects rather than QML items, because three windows cannot share the same
   `Item`. `Simulation.js` already works on plain objects — that is how the
   golden traces are generated under Node — so the change is confined to the
   QML side, and the traces should not move by a byte.

   Worth doing before phase 4: a character state has fourteen fields and one
   behaviour today. After combat and spells it will have many more.

2. **The multi-window shell.** One `QQmlEngine`, one window per `QScreen`, one
   shared simulation, and the world built from every screen's geometry. This is
   what finally exercises the continuous multi-monitor world on real monitors
   rather than in the preview's rehearsal mode.

3. **The `.scr` entry point.** A `.scr` is an ordinary executable with a
   different extension, invoked with `/s` to run, `/c` to configure and
   `/p <hwnd>` to preview in the Windows settings dialog. It must also quit on
   input.

   Packaging carries an open decision: Windows lists screen savers from
   `System32`, where thirty Qt DLLs cannot reasonably be dropped. Either a tiny
   stub `.scr` relays to the real application installed elsewhere, or Qt is
   linked statically. To be settled when the step is reached.

Binary releases, one per target, start here — probably wired to CI.

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
