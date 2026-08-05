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
first Armageddon sequence. Its audio and first Armageddon are now indexed in
[original-behaviour.md](original-behaviour.md).

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

### Character object family

`FUN_004014f0` is the character factory. Every character allocation is exactly
`0x90` (144) bytes and its numeric selector chooses one of three constructors.
The sprite-cell constants used by each animation method independently identify
all three classes:

| Selector | Constructor | Vtable | Confirmed class | Independent evidence |
| ---: | --- | --- | --- | --- |
| 0 | `0x00410520` | `0x00421260` | brave | ordinary tribe blocks begin at cells 0, 40, 80 and 120 |
| 1 | `0x004145e0` | `0x00421388` | shaman | tribe blocks begin at 200, 272, 351 and 423; requests `LIGHTNING`, `FIRECAST` and conversion sounds |
| 2 | `0x00412300` | `0x004212d8` | firewarrior | ordinary cells begin in the 897–1056 firewarrior range; also requests `FIRECAST` |

All three call the common constructor at `0x00413df0` and common initializer at
`0x00413e10`. Their first five fields of interest are now structurally known:

| Offset | Meaning |
| ---: | --- |
| `0x10`, `0x14` | floating-point position |
| `0x18`, `0x1c` | floating-point velocity |
| `0x34` | removal flag checked by the main loop |
| `0x38` | tribe, 0 for unaligned and 1–4 for the four colours |
| `0x3c` | numeric action state |
| `0x60` | frame/counter used by the animation methods |
| `0x64` | selected native sprite-cell index |

Each character vtable has five entries. The main loop calls offset `+4` once
per update, uses the rectangle-returning methods at `+8` and `+0xc` around its
dirty-region/render sequence, and uses `+0x10` for a tribe-changing operation.
The latter is overridden by braves and firewarriors, where it plays conversion
sound index 8 and emits an effect; shamans use the common implementation at
`0x004145d0`, which only writes the tribe. Exact semantic names for the two
rectangle methods are deliberately left open until their GDI side effects are
fully separated.

### Projectile/effect object family

`FUN_00401670` is the second factory. These objects are `0x70` (112) bytes,
occupy the fixed 400-slot array and share the base vtable at `0x00421510`.
Twelve concrete selectors, 0 through 11, have distinct constructors and
vtables:

| Selector | Constructor | Vtable | Selector | Constructor | Vtable |
| ---: | --- | --- | ---: | --- | --- |
| 0 | `0x00415680` | `0x00421410` | 6 | `0x00415f80` | `0x00421490` |
| 1 | `0x00416490` | `0x004214d0` | 7 | `0x00415ea0` | `0x00421480` |
| 2 | `0x00417160` | `0x00421550` | 8 | `0x00416eb0` | `0x00421520` |
| 3 | `0x00415a20` | `0x00421440` | 9 | `0x00416fc0` | `0x00421530` |
| 4 | `0x00416650` | `0x004214e8` | 10 | `0x00416770` | `0x004214f8` |
| 5 | `0x00416380` | `0x004214c0` | 11 | `0x00415bf0` | `0x00421458` |

The base update and rectangle/render methods start at `0x00416b40`,
`0x00416bb0`, `0x00416c00` and `0x00416e10`. The class split and selector
values are confirmed; effect names are not. Naming them from appearance alone
would repeat the mistake previously made with the punch and sword WAV names.

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

### Matching the capture audio

`tools/match-capture-audio.py` decodes the capture to mono 48 kHz PCM, resamples
each original WAV and runs normalised FFT cross-correlation. It records a
sound's best candidate and every peak over a configurable threshold:

```bash
python3 tools/match-capture-audio.py \
    ../captures/original-2026-08-05-201327.mkv \
    --output ../ghidra-work/capture-audio.json
```

It requires `ffmpeg`, NumPy and SciPy. The decoded audio lasts 166.379 seconds;
the final part of the video has no audio. With the default threshold of 0.85,
145 occurrences survive. Most short effects score between 0.95 and 1.00 even
after AAC compression. This establishes exact start times for those resources,
not the visible actor that caused them.

The strongest Armageddon landmarks are `SITESPELL` at 127.493458 s (score
0.999919), `ATTACK99` at 129.060750 s (0.998398) and `LIGHTNING` at
132.714792 s (0.993125). `WARLOOP` has only an ambiguous best score of 0.329408
at 130.997500 s because the long loop is mixed with other effects. `SWIRL` is
not detected (best score 0.123082). `FIRECAST` peaks at 80.890750 s with a
probable but sub-threshold score of 0.765474.

Attack variants share waveform material: for example `ATTACK1A` correlates at
0.595 with occurrences that `ATTACK3A` matches at 0.998. The matcher therefore
keeps scores and does not silently turn the nearest resource name into a fact.

## Function map

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
| `0x00410520` | construct a brave |
| `0x00412300` | construct a firewarrior |
| `0x004145e0` | construct a shaman |
| `0x00415680`–`0x00417160` | construct the twelve concrete effect types |
| `0x00417dd0` | seed the PRNG |
| `0x00417de0` | generate a 15-bit random value |

## What is not established yet

- semantic names for the twelve effect selectors and all virtual methods;
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
