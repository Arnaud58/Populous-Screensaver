# Changelog

Versions are those recorded in the Plasma plugin metadata, which is the only
target shipping so far.

## 0.8.1

- Fixed the configuration page failing to load from the screen-locker
  appearance module. Plasma injects `configDialog` and `wallpaperConfiguration`
  into the page from both the desktop wallpaper dialog and the lock-screen KCM,
  and the page has to declare them.
- Documented how to launch KDE's real lock-screen shell for testing without
  locking the session.

## 0.8.0

- Added a Plasma configuration page: number of characters, sprite size,
  footprints on or off, and an optional deterministic seed.
- Changing population, sprite size or seed restarts the world; turning
  footprints off clears the trail without interrupting movement.

## 0.7.0

- Added golden traces for a single-screen and a three-screen world, generated
  by `tools/generate-golden.mjs`. Both implementations of the simulation will
  be diffed against them.
- Replaced the O(n²) avoidance scan with a uniform spatial grid. Query results
  are sorted by index in the master character array, which preserves the
  "first neighbour wins" rule and therefore keeps seeded replay exact.

## 0.6.0

- The world became a **union of screen rectangles** instead of one width ×
  height. A single-screen host passes a list of one, so there is no separate
  single-screen mode.
- Margins are probed rather than applied per rectangle, which is what keeps the
  seam between two screens open instead of raising an invisible wall down it.
- Dead zones — the parts of the bounding box belonging to no monitor when
  screens differ in height — are excluded from the world.
- Added `clampIntoWorld`, which rescues a character standing somewhere illegal.
  Without it a character spawned inside its own top margin failed every move,
  reversed on the spot and stayed stuck for good.
- The preview gained a rehearsal mode faking a three-screen layout in one
  window.

## 0.5.1

- Fixed a reversed direction order that made six of the eight directions
  moonwalk. Only `south` and `north` were unaffected, being self-symmetric.
- The atlas cell-width signature pairs directions by mirror symmetry but cannot
  say which member of a pair faces which way; that had been settled by eye, and
  got it backwards.
- `tools/build-sprites.py` now renders `research/direction-check.png`, drawing
  every compiled animation beside the vector it travels along. No code test can
  judge sprite orientation, so this render is the check.

## 0.5.0

- Extracted the simulation rules out of `Character.qml` into
  `core/js/Simulation.js`, operating on a duck-typed state so they run headless
  under Node.
- Added a seeded PRNG (mulberry32), replacing every `Math.random()` call. A
  given seed now replays exactly.
- Replaced roughly 120 per-character QML timers with a single fixed-timestep
  loop. Per-character timers became countdowns in the state, so it holds no
  timer object and no timestamp.
- `Character.qml` became fully declarative, with no functions and no timers.
- Added `PopulousWorld.qml`, the assembled engine, and a windowed preview
  target that runs anywhere Qt does.

## 0.4.0

- Fixed the walk animation reading 128 frames from sprite 495 — atlas rows 16
  to 19, which are standing poses with a raised arm and no leg cycle at all.
  The walk cycles start at sprite 0.
- Worked out the real atlas layout: five blocks of 40 native cells, one per
  tribe colour, of which the first 32 are the walk cycle. The first block has
  no loincloth colour and is the neutral variant, which a naive colour
  classifier had missed.
- Split the repository: assets live once under `assets/`, the engine under
  `core/`, host shells under `targets/`, and payloads are assembled into
  `build/` by `tools/build-targets.py`.
- Removed `plugin/`, a byte-for-byte duplicate of `package/` that nothing kept
  in sync — 3.6 MB of assets stored twice.

## 0.3.0

- Added footprints: pixel pairs tinted per tribe, spaced by the distance
  actually walked, holding then fading out.

## 0.2.0

- Characters change direction spontaneously every 2 to 7 seconds.
- Characters turn away from a neighbour they are closing in on. A placeholder
  for combat rather than a reproduction of anything observed.

## 0.1.0

- First working QML prototype: characters from four tribes walking on a black
  background, in eight directions, bouncing off the screen edges.
- Extracted the 1998 resources: the sprite sheet as RGBA using its transparency
  mask, the Populous banner, and 28 WAV effects.
- Recovered the native table of 1,180 sprite cells from the original binary,
  which preserves the transparent padding that keeps characters from jittering.
