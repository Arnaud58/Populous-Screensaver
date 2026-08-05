# Reverse engineering the original screen saver

First static-analysis pass over `original/Populous Screen Saver.scr`. This is
evidence for the behavioural specification, not recovered source code. Names
beginning with `FUN_` are Ghidra placeholders and the proposed semantic names
below remain annotations until more call sites have been checked.

## Provenance

| Property | Value |
| --- | --- |
| SHA-256 | `a25f7f7d219018fcf1888891738a706dff5f39f72de103a21dde3945f7097e0b` |
| MD5 | `230051613bce63d7d8825be0e32f50f0` |
| PE timestamp | 15 October 1998, 16:30:55 |
| Format | PE32 Windows GUI, Intel i386 |
| Image base | `0x00400000` |
| Code section | 129,250 bytes at `0x00401000` |
| Resource section | 5,466,856 bytes at `0x00428000` |
| Compiler evidence | Microsoft Visual C++ Runtime; Ghidra identifies Visual Studio 1998 library functions |

The executable is not visibly packed: it has ordinary `.text`, `.rdata`,
`.data` and `.rsrc` sections, a conventional import table and directly
analysable code. There is no PDB information.

The first video capture is
`../captures/original-2026-08-05-201327.mkv`: 167.666 seconds, 2560 × 1440 at
30 FPS, with 48 kHz stereo audio. It contains the normal population and the
first Armageddon sequence. It has not yet been indexed event by event.

## Reproducing the analysis

The first pass used Ghidra 12.1.2 with Temurin JDK 21.0.12. The Ghidra project
and the generated pseudo-C deliberately live outside Git under
`../ghidra-work/`; the repository contains only this report and the exporter.

Import and analyse the binary:

```bash
ghidra-analyzeHeadless ../ghidra-work populous \
    -import "original/Populous Screen Saver.scr" \
    -overwrite -analysisTimeoutPerFile 900 -max-cpu 8
```

Export the analysis snapshot:

```bash
ghidra-analyzeHeadless ../ghidra-work populous \
    -process "Populous Screen Saver.scr" -noanalysis -readOnly \
    -scriptPath "$PWD/tools/ghidra" \
    -postScript ExportPopulousAnalysis.java "$PWD/../ghidra-work/exports"
```

`tools/ghidra/ExportPopulousAnalysis.java` writes a summary, function table,
imports with their callers, strings and a complete pseudo-C listing. Ghidra
found 293 internal functions and 118 imported functions; all 293 internal
functions decompiled without an error. That does not make every inferred type
or function boundary correct.

## Confirmed architecture

The original is a GDI screen saver, not a DirectX application. It imports only
`KERNEL32`, `USER32`, `GDI32`, `ADVAPI32` and `WINMM`. Rendering uses bitmap
masks, compatible device contexts, palettes and `BitBlt`; individual effects
also use `GetPixel` and `SetPixel`. Audio uses `sndPlaySoundA` with WAV data
loaded from the executable's resources.

The core object has fixed arrays for:

- **200 character pointers**;
- **400 projectile/effect pointers**;
- **1,180 native sprite cells** (`0x49c`), matching the table independently
  extracted by `tools/extract-native-sprites.py`.

`FUN_00405190` is a 45,962-byte generated-looking initializer dominated by
sprite coordinates and dimensions. It is the static atlas table, not the game
loop.

### Main loop

`FUN_004044c0` is the custom window procedure. On `WM_CREATE` it creates two
Windows timers:

| Timer | Interval | Purpose |
| --- | --- | --- |
| 1 | `0x1e` = **30 ms** | advance and render one frame |
| 2 | configured seconds × 1,000 | begin Armageddon |

`WM_TIMER` for timer 1 calls `FUN_00401cd0`, the frame update and renderer.
The original therefore aims at roughly 33.3 updates per second and advances by
ticks, not by measured elapsed time. Timer 2 calls `FUN_00401bd0`, then stops
until the Armageddon state machine returns to its normal state.

When the state returns to normal, timer 2 is armed again with the configured
delay. Armageddon therefore **repeats**; it does not end the screen saver.

### Random number generator

`FUN_00417dd0` sets a 32-bit state and `FUN_00417de0` advances it with the
Microsoft C runtime algorithm:

```text
state = state * 214013 + 2531011       (modulo 2^32)
result = (state >> 16) & 0x7fff
```

There are 115 recognised call sites. At window creation the state is seeded
from a value derived from local date and time. This explains why the original
is not replayable, while also giving the faithful port an exact optional PRNG.

## Original configuration defaults

`FUN_00404d60` reads the original settings from:

```text
HKEY_LOCAL_MACHINE\SOFTWARE\Bullfrog Productions Ltd\Populous Screensaver
```

Missing values are created with these defaults:

| Registry value | Default | Interpretation |
| --- | ---: | --- |
| `Number of People` | **150** | active population, from a 200-slot capacity |
| `Armageddon time` | **120** | seconds before each Armageddon |
| `Darken amount` | **20** | background darkening parameter |
| `Footprint amount` | **100** | footprint parameter |
| `Sound Effects` | **1** | enabled |
| `Blacken Screen` | **0** | disabled |
| `Show Plinth` | **1** | enabled |

`FUN_00405050` writes the same values. For a client area narrower than 321
pixels, the window procedure forces a reduced preview configuration including
10 people and disables several visual options.

The current port's default of 24 characters is therefore a modern performance
choice, not the original default. A future explicit “faithful” preset should
use 150, subject to performance validation.

## Armageddon state machine

These transitions are structurally confirmed, while their semantic labels
remain provisional:

1. Timer 2 changes state 0 (normal) to state 1 and assigns every unaligned
   character to one of four tribes.
2. State 1 lasts just over 200 frame ticks — about six seconds at 30 ms — and
   processes characters in sequence.
3. State 2 operates on the four tribe counts, emits projectiles and removes or
   relocates characters as tribes are eliminated.
4. States 3 and 4 run a shorter resolution sequence.
5. State 5 restores normal state, recreates missing corner entities and lets
   the window procedure re-arm the configured Armageddon timer.

The state machine explicitly loops over 200 character slots and maintains four
tribe counters. Exact state names, winner selection and the meaning of every
projectile type still need correlation with the video.

## Audio table

`FUN_004039e0` loads all 28 WAV resources into a contiguous table. Their exact
runtime indices are:

| Indices | Resources |
| --- | --- |
| 0–2 | `ATTACK1A`, `ATTACK1B`, `ATTACK1C` |
| 3–5 | `ATTACK3A`, `ATTACK3B`, `ATTACK3C` |
| 6 | `ATTACK99` |
| 7–9 | `CONVERT_SPELL`, `CONVERT`, `CONVERT2` |
| 10 | `FIRECAST` |
| 11–18 | `PUNCH1` through `PUNCH8` |
| 19–23 | `SWORDS1` through `SWORDS5` |
| 24–27 | `WARLOOP`, `SITESPELL`, `LIGHTNING`, `SWIRL` |

`FUN_00403d80` is the playback gate. It plays resource data directly from
memory, asynchronously and without the Windows default sound; some calls also
request that an already playing sound not be interrupted. It tracks a value
per sound that appears to be a priority, but that field needs more analysis.

The Armageddon update directly requests indices 6, 24, 27, 25 and a random
choice among 3–5 at identifiable transitions. This is stronger evidence than
the resource names alone, but each call still needs to be aligned with the
capture before assigning an event name in the new engine.

## Function map for the next pass

| Address | Current interpretation |
| --- | --- |
| `0x00401bd0` | start Armageddon |
| `0x00401cd0` | frame update, Armageddon progression and rendering |
| `0x004039e0` | load the 28 WAV resources |
| `0x00403d80` | arbitrate and play a sound |
| `0x004044c0` | screen-saver window procedure |
| `0x00404d60` | load settings and create defaults |
| `0x00405050` | save settings |
| `0x00405190` | initialise the 1,180-cell sprite table |
| `0x00417dd0` | seed the PRNG |
| `0x00417de0` | generate a 15-bit random value |

## What is not established yet

- class layouts and virtual methods for every character/entity type;
- which atlas stream corresponds to every numeric action state;
- ordinary combat triggers and damage rules;
- whether shamans use their punch/cast-looking animations outside Armageddon;
- the 78 particle cells at 819–896;
- exact meaning and range of the darkening and footprint settings;
- timings inside actions that are not directly driven by the two Windows
  timers.

The next analysis pass should label the character constructors and virtual
tables, then align state changes and sound calls against timestamped events in
the capture. Only confirmed rules should move into `spec/simulation.md`.
