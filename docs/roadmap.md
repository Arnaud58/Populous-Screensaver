# Roadmap

Five phases, ordered so that each one unblocks the next rather than by how
visible the result is.

Current version: **0.9.0**. Phases 1, 2 and 3 are complete; phase 4 is under
way: 4b, 4c, 4d and 4e are implemented, and
[4a](#4a--observe-and-analyse-the-original--in-progress) is what to pick up
next — the provisional spell constants and the Armageddon return both wait on
the same controlled recording.

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

### 4b — Catalogue the atlas ✅

**Every one of the 1,179 usable cells is grouped, into 427 animations**,
against 160 and 40 when the phase started. The simulation still looks
animations up by id, and the golden traces guard each change.

The last run, the 78 particle cells at 819–896, was closed by the disassembly
rather than by the eye: every cell there is a mote of two to eight pixels, so
the effect selector table supplied the structure and cell size confirmed the
boundaries. `shaman_punch` became `shaman_cast` at the same time — character
state 5 selects those cells and launches the conversion projectile, which
settles a name that had only ever been read off the pose.

What was found is written up in
[asset-pipeline.md](asset-pipeline.md#what-the-atlas-turned-out-to-be) — the
generalised width signature, the entities it uncovered, the merged cell, and
why sounds turned out to be a poor witness. `tools/build-sprites.py` now prints
a coverage line and the unclaimed ranges, so progress is a number rather than
an impression.

Two small groups are grouped without being explained: a cyan burst at 888–892
and a single yellow pixel at 835, which no effect selector accounts for. They
are claimed so the coverage is honest, not because their role is known.

### 4a — Observe and analyse the original 🔄 in progress

The first 167-second capture has been recorded and indexed under Wine. A Ghidra
12.1.2 headless pass decompiled all 293 recognised internal functions and
established the original timer, PRNG, configuration defaults and high-level
Armageddon state machine. A second pass identified the brave, shaman and
firewarrior classes, all twelve numeric effect classes, and correlated 145
sound starts with the capture. The evidence and reproducible procedures live
in [research/reverse-engineering.md](../research/reverse-engineering.md) and
[research/original-behaviour.md](../research/original-behaviour.md).

The third pass mapped every character state to the atlas and established the
roles of the conversion projectile, fire projectile, lightning, their child
particles and the Armageddon swirl. See
[research/original-state-map.md](../research/original-state-map.md). Generic
particle names remain provisional. The remaining observational task is an
uninterrupted Armageddon through its return to ordinary simulation; ordinary
combat can now move into an implementation plan for 4c.

The static pass answered several former atlas questions: shamans do select
fire and lightning attacks, the “punch” cells are their conversion cast, the
wave cells are played in Armageddon state 13, and death uses the soul stream.
The remaining evidence work is narrower:

- most QML frame durations outside the walk cycles remain provisional; brave
  kick, hit and soul timing now come from original tick counters, while the
  remaining actions still need the same treatment and video checks;
- combat distances, countdowns, damage threshold and soul acceleration are
  converted and implemented; only the original pursuit-entry cadence still
  needs disentangling from cooldowns, reservations and global mode;
- the 819–896 particle band now has a build-pipeline representation, but only
  one of its frame cadences is evidence-backed;
- the first recording ends before Armageddon visibly returns to ordinary
  simulation, although the looping code path is statically confirmed.

Sound/resource call sites and 145 capture timestamps now replace identification
by ear. The old warning remains useful: a sound name identifies an effect, not
necessarily the sprite that caused it.

### 4c and 4d — behaviours and combat

**4c is complete.** State carries `entity`, `action` and `behaviour`, animation
selection is no longer hard-coded to brave walking, and `stepSimulation`
returns typed events. Non-character entities have their own list and lifetime.

The first closed **4d** chain is also implemented: hostile acquisition,
pursuit, brave kick, hit reaction, accumulated damage, rising soul and removal.
The QML targets enable it; explicit non-combat simulations remain available to
keep focused fixtures small. Golden traces moved to format 2 and now record the
new state and event contract.

The distance/timing literals and soul layout are now recovered and implemented.
Before 4d is called exact, reproduce the original pursuit-entry cadence and
validate the result against capture.

### 4e — conversions, shamans and the fire attack

**Implemented.** The world now has all three character classes and both
ordinary spells.

The atlas answered the question the disassembly left open. The neutral variant
carries a walk block and a stand block and nothing else — no kick, no hit, no
scratch, no soul — while the four coloured tribes carry all of them. That is
not a gap in the catalogue: it is the rule. An unaligned character never
fights, is never struck and never dies; it wanders until a shaman converts it.
The shaman streams say the same thing about shamans, which have `idle`, `walk`
and `cast` and no hit or soul at all.

On that footing: shamans seek, pause, cast and cool down; the conversion
projectile converts every unaligned brave in its radius and turns a share of
them into firewarriors, which is the only way that class enters the world;
firewarriors stop at cast range instead of closing to melee, throw fire with a
trail, and damage hostile combatants at the impact. A general effect entity
covers all seven visual kinds.

A second pass over a full capture then corrected four things: ordinary
characters are always born unaligned, each tribe's shaman holds a corner of the
screen, the conversion projectile is fast, and aligned characters gather at
their corner and leave in war parties for another tribe's. That last one
explains the diagonal columns the capture shows and the earlier model could not
produce.

Only two numbers here are recovered — the three cast frames per direction and
the 8-to-10-tick recovery. The rest are chosen and tabulated as provisional in
[spec/simulation.md](../spec/simulation.md#provisional-values). A controlled
recording with a small population is what replaces them, and it is the same
recording 4a still needs.

### 4f — gathering and Armageddon

**The whole cycle is now observed**, in a 263-second capture covering an empty
world, its filling, ordinary play, Armageddon and the return to ordinary
simulation. Written up in
[research/original-behaviour.md](../research/original-behaviour.md).

The sequence is: the timer fires at 120 s; characters walk to slots in **four
diamond formations, one per screen corner, one per tribe**, thirty to forty
each; the formations then leave their corners and converge on the centre for a
single mass melee, while **the four shamans stay in their corners** and cast
into it; the world empties; and the population ramps back up. The screen saver
loops that indefinitely.

**Lightning has no atlas sprite** and must be drawn: two or three near-parallel
jagged paths, white with a blue tinge, 784 px long inside a 61 px envelope,
lasting 0.25 s and not moving. Segment length matches the disassembly's
15-point paths. It occurs only during Armageddon.

It also carries a setting: an **Armageddon interval, 60 to 500 s, defaulting
to the original's 120**. It ships in the same change as the behaviour, and it
must extend the bound-agreement test in `tests/plasma-config.test.mjs` — see
[Configuration](../spec/simulation.md#configuration).

Ordinary combat now sits inside the original's measured band — 0.72 deaths per
second against 0.45 to 1.68 — because unaligned characters neither fight nor
die and they are the majority of the world. The muster lattice is the piece to
build on: Armageddon formations are the same idea with real slot allocation and
a global controller driving it.

Regenerate and review the golden JSON once per intentional rule change.

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
