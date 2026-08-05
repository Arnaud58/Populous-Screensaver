# Changelog

Versions are those recorded in the Plasma plugin metadata, which every target
reads from: the Windows build has its number written into the payload by
`tools/build-targets.py`.

## Unreleased

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

### The atlas catalogue

- **1,101 of the 1,179 usable cells are grouped, into 382 animations**, against
  160 and 40 before. Only the 78 particle cells at 819–896 are left.
  `core/js/Simulation.js` and every QML file are untouched: animations are
  looked up by id, so a larger manifest changes nothing for the engine.
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
