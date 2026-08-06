# Changelog

Versions are those recorded in the Plasma plugin metadata, which every target
reads from: the Windows build has its number written into the payload by
`tools/build-targets.py`.

## Unreleased

### Corners, war parties and unaligned-only spawning

- **No character is born into a tribe any more.** Ordinary spawns are always
  unaligned and conversion is the only way into a tribe, which is what the
  original does. This also closed the death-rate gap on its own: the port now
  loses 0.72 characters per second against 0.45 to 1.68 measured in the
  original, and the configured population is reached and held instead of
  stalling around 55.
- **Each tribe owns a corner.** Its shaman is placed there and returns to it
  when idle rather than drifting to the middle of the screen.
- Added **war parties**: an aligned character with nothing to fight musters at
  its tribe's corner, taking a fixed lattice slot from its own id, and on a
  per-tribe countdown the whole group leaves together for another tribe's
  corner. That is the behaviour behind the diagonal columns of characters seen
  marching across the original, previously recorded as unexplained.
- The conversion projectile went from 133 px/s to 800 px/s. The old value was a
  guess and read as a drifting bubble rather than a spell.

### Corrections from a complete original capture

- A second capture covers a whole cycle, including the return to ordinary
  simulation the first one missed. Added `tools/measure-capture.py` so its
  measurements are reproducible rather than eyeballed.
- **The world now fills in over time.** The original opens on the four shamans
  alone and adds ordinary characters one at a time; a world that spawned its
  whole population at once was wrong from the first frame. The same rate
  refills the world after a death, replacing the former instant top-up.
- **Conversion is a zone, not a touch.** The ring measured in the capture is
  180 to 230 px across, about three times a character's height, so the radius
  went from 20 px to 75 px. A ring of sparkles is drawn at exactly the radius
  the rule uses, with staggered start frames to reproduce the original's
  travelling-around-the-circle look.
- Separated the projectile's arrival distance from the zone radius; raising one
  had silently made conversions detonate 75 px short of their target.
- Recorded the Armageddon cycle end to end: gather into four corner diamond
  formations, converge on the centre, mass melee with the shamans casting from
  their corners, wipe, refill. Lightning is a 0.25 s, near-vertical bolt of two
  or three jagged paths spanning 784 px, and occurs only during Armageddon.
- Measured the original's death rate at 0.45 to 1.68 souls per second. The port
  currently kills about 2.3 per second at a third of that population, so the
  configured character count is a target the world does not reach. Documented
  under Population in the specification.

### Conversion, shamans and the fire attack

- Added unaligned characters as tribe 0. The atlas settles what one is: the
  neutral variant has only a walk and a stand block, so an unaligned character
  never fights, is never struck and never dies. It wanders until converted.
- Added shamans, one per tribe, on top of the configured population. A shaman
  seeks an unaligned brave, pauses, casts, and launches a conversion
  projectile, then waits out a cooldown. It is never a combat target and has no
  hit or death states, which the absence of those streams in the atlas
  confirms.
- Added conversion: the projectile converts every unaligned brave within its
  radius to the casting shaman's tribe, spawning a flash and a tribe-coloured
  burst. A share arrive as firewarriors, which is the only way that class
  enters the world.
- Added the firewarrior fire attack. A firewarrior pursues like a brave but
  stops at cast range instead of closing to melee, throws, launches a
  projectile with a trail, and recovers. The impact spawns an impact effect and
  a ring and damages hostile combatants in its radius, leaving shamans and
  unaligned characters untouched. Firewarriors reuse the brave hit cells, as
  the original does.
- Added a general effect entity covering the conversion projectile, flash,
  tribe burst, fire projectile, trail, impact and ring, matching the original's
  effect selectors.
- Added `cast-started`, `converted` and `effect-spawned` events, and a `sound`
  field on the events that correspond to an original resource family. Nothing
  plays them yet.
- Every distance, interval and probability in this group is provisional and
  listed as such in `spec/simulation.md`; only the three cast frames and the
  8-to-10-tick firewarrior recovery are recovered values.
- Golden snapshots now drop undefined fields, so an effect without a soul phase
  and a soul without an effect kind compare equal to their own serialisation.

### Behaviour and combat foundation

- Added explicit entity, action and behaviour states plus stable entity ids.
  Animation lookup now selects walk, kick, hit and rising-soul streams from
  state instead of hard-coding brave walking.
- `stepSimulation` now emits one deterministic typed-event stream for
  footprints, transitions, attacks, hits, spawns and removals. QML exposes the
  complete stream while keeping footprint rendering isolated.
- Implemented the first evidence-backed original state chain: acquire and
  pursue a hostile, kick, receive damage, spawn a rising soul at zero health,
  then remove it after its lifetime. Unrecovered distances and timings remain
  explicitly provisional.
- Golden traces moved to format 2 and include ids, behaviour state,
  non-character entities and typed events.
- Recovered the original combat constants directly from the PE: 250 px target
  range, 14 px melee range, four-tick kick, three-tick recoil, immediate
  damage, 10 px/tick knockback and death on the sixth hit. Added a reproducible
  PE extractor.
- Corrected each 25-cell soul block to eight directions × three death poses
  plus one final departure pose. Souls now use the original 90 ms pose phase,
  accelerating rise and six-second maximum lifetime.
- Maintained the configured population after deaths, matching the original
  main loop, with deterministic replacement ids and `character-spawned`
  events.

### Original executable analysis

- Added a reproducible Ghidra headless exporter and the first static-analysis
  report for the 1998 PE32 executable. Ghidra recognised 293 internal and 118
  imported functions, and decompiled every internal function without error.
- Confirmed a 30 ms frame timer, the Microsoft C runtime PRNG, fixed capacities
  of 200 characters and 400 effects, a 1,180-cell native sprite table, a
  default population of 150 and a repeating Armageddon timer defaulting to 120
  seconds.
- Recorded the exact runtime order of all 28 sound resources and a preliminary
  map of the Armageddon state machine. Raw pseudo-C and the Ghidra project stay
  outside Git; only the exporter and evidence-backed findings are versioned.
- Identified the original's brave, shaman and firewarrior classes from their
  constructors, vtables, sprite-cell ranges and sound call sites, plus the
  twelve still-unnamed effect subclasses.
- Added a reproducible audio matcher. It recovered 145 high-confidence WAV
  starts from the AAC capture and anchored the first Armageddon's gathering,
  site-spell, attack and lightning events to reviewed video frames.
- Recovered 32 function boundaries referenced only through C++ vtables, taking
  the reproducible Ghidra export from 293 to 327 internal functions.
- Mapped character states to the walk, stand, scratch, kick, hit, cast, soul,
  firewarrior-punch and wave atlas streams. Identified the conversion, fire and
  procedural-lightning effect chains while retaining provisional names for
  generic particles.

### The atlas catalogue

- **Every one of the 1,179 usable cells is grouped, into 427 animations**,
  against 160 and 40 before. The manifest remains generated from the reviewed
  layout; the simulation now consumes the corrected directional soul ids.
- Closed the last run, the 78 particle cells at 819–896, from the effect
  selector table rather than by eye — every cell there is a mote of two to
  eight pixels. Cell size confirmed the boundaries independently: the
  cross-shaped burst motes run 4, 6, 6, 6, 6, 4 pixels wide in each of four
  tribe groups, and the debris motes run nine cells of constant width in each
  of four colour variants. Only the fire trail's cadence is evidence-backed,
  at seven cells over seven 30 ms ticks.
- Renamed `shaman_punch` to `shaman_cast`. Character state 5 selects those
  cells and launches the conversion projectile, so a name that had only been
  read off the pose is now settled by the disassembly.
- `tools/build-sprites.py` prints a coverage line and the unclaimed cell
  ranges, and renders `research/sheets/cells-*.png` — every cell in index
  order, labelled, claimed ones dimmed. That sheet is what makes a sequence
  identifiable in the first place.
- The review artefacts are now per stream rather than hard-coded to the braves:
  a GIF at the declared frame duration, and a `direction-check` page.
- New entities: the **firewarrior**, four tribes × 8 directions × 4 frames; the
  four **shamans**, 16 idle + 32 walk + 24 punch each; **standing** sets for
  brave and firewarrior; the brave's **scratch**, **hit** and **kick**; the
  **soul** rising on death; a firewarrior **punch**; waving animations; and two
  effects with no facing.
- Streams may declare `"kind": "sequence"` for animations with no direction, and
  may cut a cell that holds two poses with `{"splitSprite": N, "at": [x]}`.

### What the atlas turned out to be

- **The width signature generalises**: within an eight-direction block, the
  widths of direction *i* equal those of direction *8−i* **read backwards**,
  because mirrored directions are drawn at the opposite phase. It scores
  exactly on the brave blocks, which makes it a detector rather than a guess,
  and it found the firewarrior, the standing sets and the shamans' 16/32/24
  split.
- **Tribe colour finds what the signature cannot.** Classifying each cell by
  the colour that separates it from the other three exposed the block
  boundaries of the brave actions and of the soul sequences, where the widths
  say nothing.
- **One cell holds two poses.** The firewarrior punch blocks read as 23 cells,
  which divides by neither 8 nor 4; the second cell of each is 43 pixels wide
  where the row is otherwise 21 to 33. Neither the native table nor the visual
  detector can separate them — the two figures touch, leaving no transparent
  column. Cut at the valley of the opaque-pixel profile, each block becomes
  8 × 3 and the signature scores exactly.
- **Sounds are a weak witness.** `punch1`–`punch8` and `swords1`–`swords5` led
  to naming two brave sets a punch and a sword swing. They are a brave *taking*
  a blow and a brave *kicking*; the pale arc is a leg, not a weapon. Both were
  corrected from watching the original.
- The cells versions before 0.4.0 mistook for a walk cycle are the brave's
  **scratch** idle — what it does when it has stood still too long.

### Guarding the direction order

- `build-sprites.py` matches each new directional set's silhouettes against the
  verified brave set. The score alone means little: 7/8 between brave and
  firewarrior, 3/8 between brave and shaman, whose headdress is half the
  sprite.
- What it fails the build on is the failure that actually happens — a set
  assigned to its own mirror, east matching west. Checked both ways: silent on
  the real layout, fatal on a deliberately reversed one.

## 0.9.0

### The standalone Qt application

- New `qt-app` target: a Qt 6 application opening **one window per monitor over
  a single shared world**. This is the first time the continuous multi-monitor
  world runs on real monitors rather than in the preview's rehearsal mode.
- Windows builds it as `populous.scr`. `/s` runs it, `/c` opens the settings
  dialog, `/w` runs in ordinary windows for development, and `/p <hwnd>` draws
  into the settings dialog's thumbnail.
- Quitting on input ignores the burst of mouse movement Windows sends at launch
  and requires the pointer to travel more than 12 pixels, so the screen saver
  does not dismiss itself the moment it starts.
- Assets and QML are compiled into the executable through a generated
  `resources.qrc`, so the binary does not depend on files beside it.

### The engine split in three

- `PopulousSimulation.qml` owns the simulation and the loop, `PopulousView.qml`
  renders one viewport of it, and `PopulousWorld.qml` is now a wrapper holding
  one of each. Its property surface is unchanged, so the Plasma and preview
  hosts were untouched by the split.
- `Character.qml` holds no state at all: the view copies four values into it
  each tick. QML items cannot be shared between windows, so the simulation had
  to stop using them as its state.

### Frame data moved into the simulation

- A character state carries `animations` and caches the resolved `frames` of
  its current animation, so nothing outside the simulation owns its dimensions.
  Edge margins follow the displayed frame, which changes within a cycle.
- **Golden traces were regenerated once, deliberately.** They previously used a
  fabricated 20×26 frame and so never matched what a host actually rendered;
  they now use the real manifest.

- `/p` reparents through raw Win32 `SetParent` after Qt has realised the
  window. Qt's own `QWindow::fromWinId` plus `setParent` reports success
  without reparenting anything, and calling `show()` afterwards undoes the
  Win32 version, so the order matters: realise, then take over.

- Verified end to end against the real Windows screen-saver dialog, which
  listed it, ran it and drew its thumbnail from a path outside `System32`.
  That settles the packaging question: install anywhere and write
  `HKCU\Control Panel\Desktop\SCRNSAVE.EXE`, with no stub and no static build.

### Packaging

- A `deploy` target gathers a runnable directory — the screen saver, Qt's DLLs
  and QML modules, and the installer — and a `package` target zips it into
  `populous-screensaver-<version>-windows-x64.zip`, about 40 MB.
- `windeployqt` is told `--qmldir build/qt-app/ui`, since the QML lives in the
  compiled `.qrc` and cannot be scanned from disk. Without it the binary ships
  no QML module and exits 1 on loading `main.qml`.
- `install-windows.ps1` copies the directory under `%LOCALAPPDATA%\Programs`
  and selects the screen saver, with no elevation. It remembers what was
  selected before and `-Uninstall` restores it — necessary because Windows
  offers no way to browse for a screen saver.
- The installer refuses a directory holding the screen saver without Qt beside
  it, such as the CMake build directory. Installing from one used to fail late
  and obscurely: "no Qt platform plugin could be initialized", raised only once
  the broken copy was already the selected screen saver.
- The executable is now named `Populous Screen Saver.scr`. **The settings
  dialog labels an entry by file name**, not by the version resource: a
  `FileDescription` of "Populous Screen Saver" still displayed as `populous`
  until the file itself was renamed.
- Added a version resource all the same, for Explorer's Properties tab. Its
  number comes from the Plasma plugin metadata, which stays the only file where
  a version is maintained by hand.
- Fixed the `/p` thumbnail rendering an almost always empty world: it used a
  fixed 640×480 world seen through a window of roughly 150×110, so the
  characters were somewhere else. The preview world is now the thumbnail.

### Known gaps

- One sprite scale for the whole world, taken from the primary screen.
  Per-monitor DPI would need per-character margins and speeds.
- The unpacked deployment is 1378 files, nearly all of them QtQuick.Controls,
  used by nothing but the `/c` dialog. Without it the dependency set is 35
  files and 40 MB unpacked.
- The Visual C++ 2015-2022 redistributable has to be present: the archive drops
  the 25 MB `vc_redist.x64.exe` windeployqt would otherwise include, since
  nothing runs it.

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
