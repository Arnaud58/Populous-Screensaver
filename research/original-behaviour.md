# Original-behaviour captures

Observation log for `../captures/original-2026-08-05-201327.mkv`. Timestamps
below are relative to the capture, not to the original process creation time.
The video is evidence for appearance and sequence; static call sites in
[reverse-engineering.md](reverse-engineering.md) remain the authority for code
paths and numeric state.

## Method

Frames were reviewed around automatically matched WAV starts. Reproduce the
audio index with:

```bash
python3 tools/match-capture-audio.py \
    ../captures/original-2026-08-05-201327.mkv \
    --output ../ghidra-work/capture-audio.json
```

The default score threshold is 0.85. A score near 1 means that the original WAV
is present at that time despite the capture's AAC encoding. It does not by
itself identify which on-screen character played it, especially when many
characters overlap.

## Observed sequence

| Time | Observation | Corroborating audio |
| ---: | --- | --- |
| 0–13 s | ordinary wandering on the plinth; tribes and unaligned characters coexist | no high-confidence resource before 13.371 s |
| 13.371–27.744 s | repeated conversion activity during ordinary simulation | `CONVERT2`, `CONVERT` and `CONVERT_SPELL` recur |
| 31.696–121.733 s | ordinary movement, conversion and local combat continue | many exact `PUNCH*`, `SWORDS*` and attack matches |
| about 120 s | Armageddon begins: characters stop ordinary wandering and converge toward four corner formations | matches the configured 120-second timer; this boundary is visual, not a matched WAV start |
| 124–127 s | four dense tribe formations become clearly visible; cyan effects travel along their approach paths | — |
| 127.493 s | cyan flashes/effects are active beside the formations | `SITESPELL`, score 0.999919 |
| 129.061 s | the four formations are compact and the transition into the confrontation is under way | `ATTACK99`, score 0.998398 |
| 132.715 s | a narrow orange/white bolt crosses the centre between formations | `LIGHTNING`, score 0.993125 |
| 140 s | formations remain in the corners while individual projectiles continue | the long `WARLOOP` is present only as a low-confidence mixed candidate |
| 160 s | Wine's “program is not responding” dialog covers the screen after capture interruption | exclude from behavioural evidence |

The capture therefore confirms that the first Armageddon phase is a gathering
phase, not immediate combat, and that the sequence is still active at 140 s.
It does not contain a clean, unobstructed return to ordinary wandering, so the
visual duration of the complete cycle remains unmeasured.

## Audio coverage

The automatic index finds 145 high-confidence starts among the 28 resources.
All punch and sword samples occur during the capture, as do `ATTACK1C`,
`ATTACK3A`, `ATTACK3B`, `ATTACK99`, all three conversion resources,
`SITESPELL` and `LIGHTNING`.

No match over 0.85 was found for `ATTACK1A`, `ATTACK1B`, `ATTACK3C`,
`FIRECAST`, `SWIRL` or `WARLOOP`. This means “not cleanly detected in this
capture”, not “unused by the executable”: static call sites prove that at least
`FIRECAST`, `WARLOOP` and `SWIRL` can be requested. Long or overlapping sounds
are particularly poorly suited to a whole-sample correlation.

# Second capture: a complete cycle

`ScreenSaver-01.mp4`, 263 s at 1920x1152, 30 fps, running on Windows rather
than under Wine. It contains **one whole cycle**: an empty world, its filling,
ordinary play, Armageddon, the wipe, and the world filling again. That is the
return the first capture missed.

Measurements below are reproducible with:

```bash
python3 tools/measure-capture.py CAPTURE.mp4 --census
python3 tools/measure-capture.py CAPTURE.mp4 --souls 60 120
python3 tools/measure-capture.py CAPTURE.mp4 --effects 116 175
```

The counts are blob proxies, not engine objects. A crowd merges into one blob,
so populations are under-reported once characters bunch up. Shapes of curves
survive that; absolute values do not.

## The world starts empty and fills in

| Time | Characters on screen |
| ---: | --- |
| 1–6 s | **3 to 4** — the four shamans and nobody else |
| 7–20 s | climbing: 4, 5, 8, 11, 15, 21, 24 |
| 40–60 s | 64 to 66 |
| 80–120 s | settled around 47 to 53 |

This is the single most consequential correction to the earlier reading. The
first capture's note that "tribes and unaligned characters coexist" from 0 s
was made from a recording that had already been running; a world does **not**
spawn its population at once. Ordinary characters arrive roughly one every
third of a second until the configured population is reached, which for the
original's default of 150 takes about fifty seconds.

The same ramp refills the world after Armageddon: 13 characters at 155 s,
climbing to 86 by 200 s. There is no instant replacement of the dead.

## Conversion is a zone

Conversion casts happen every second or two across the four shamans, and 65
distinct cyan events occur between 20 s and 120 s.

A cast reads as: a short vertical streak of coloured motes leaving the shaman,
then a **ring of star sparkles blooming around the target**, then the target's
own burst of green and white motes as it changes tribe.

| Property | Measured |
| --- | --- |
| ring extent | 180 to 230 px wide, 140 to 200 px tall |
| ring shape | an ellipse, roughly 3:2 — a circle on the ground in shallow perspective |
| total duration | about 0.8 s: 0.35 s to bloom, then fading |
| colour over life | white, then cyan, then blue, then magenta |
| sparkle appearance | staggered around the circle, which reads as travelling |

At sprite scale 1 a brave is about 26 px tall, so the ring is roughly three
times a character's height across. Modelling conversion as a projectile that
touches one target and converts it was wrong by an order of magnitude.

## The fire projectile stays small

The fire projectile is native cell 854, 7x5 px, and the capture agrees: it is
a point of light with a short trail, nothing like the conversion ring. The
ring sprite at its impact is 26x29 px. Nothing here needed changing.

## Death rate

| Window | Souls | Per second |
| --- | ---: | ---: |
| 60–120 s, first cycle while still filling | 27 | **0.45** |
| 190–250 s, second cycle at full population | 101 | **1.68** |

The rate rises with the population, as it must. This is the number to
calibrate ordinary combat against: it is what allows the original's population
to keep growing to its configured size instead of stalling at an equilibrium
between spawns and deaths.

## Armageddon, observed end to end

| Time | What happens |
| ---: | --- |
| ~120 s | the timer fires; ordinary wandering stops |
| 121–126 s | characters walk to formation slots; heavy cyan and white effects along the approaches |
| 124–127 s | **four dense diamond formations**, one per screen corner, one per tribe, each holding thirty to forty characters in a lattice |
| ~128 s | the four formations leave their corners and converge on the centre |
| 130–153 s | one mass melee at the centre; souls rise continuously; orange effect coverage climbs from 500 to 1400 px |
| throughout | **the four shamans stay in their corners** and cast into the battle |
| 145.4 s | a lightning bolt |
| 154–157 s | the world empties: cyan and orange collapse to nothing |
| 157 s onward | the ramp starts again, and ordinary conversions resume from about 163 s |

Visually this reads as **timer, gather, converge, annihilate, refill**. Static
analysis later showed that those are not five timer-driven states: state 1
places entries directly for 201 ticks, state 2 lasts until fewer than two
tribes remain, and the empty/refill sequence belongs to a conditional winner
branch. See [reverse-engineering.md](reverse-engineering.md#armageddon-state-machine).

### Lightning

Measured at 145.37–145.53 s, about **0.25 s**, and it does not move.

It is **two or three near-parallel jagged lines**, white with a blue tinge,
spanning 784 px vertically inside a 61 px-wide envelope — very close to
vertical. Segments deviate by a few pixels every 50 px or so, which matches the
disassembly's three 15-point paths almost exactly: 784 px over 15 points is
56 px per segment.

It occurs only during Armageddon, and it has no atlas sprite: it must be drawn,
not blitted.

## Ordinary groups in the capture

The diagonal columns are coordinated groups, not a video artefact. The first
capture-only interpretation was a shared signal sending a whole tribe from one
corner to another. Decompilation disproved that mechanism: ordinary brave
state 9 uses per-character reservation slots, a leader and at most 15
followers, with several PRNG gates. The exact high-level intent of each group
is less certain than the visible coordination.

The four shamans hold the four corners throughout, in ordinary play as well as
during Armageddon, which is what the disassembly's "corner entities" means.

**Tribe sizes swing widely, and that is correct.** A tribe can be reduced to
almost nothing and recover; how the four compare depends mostly on the run.
The port may be a shade less balanced overall than the original, but not
enough to be worth chasing, and no rule should be added to even it out.

## Still to explain

- Whether the ring converts everyone inside it or only marks the boundary of
  a smaller effect. The disassembly's "scans nearby unaligned characters" says
  the former; the capture cannot distinguish them.
- The complete ordinary state-9 leader/follower trigger sequence. The formation
  table itself is now exact: 200 slots per tribe, eight columns by 25 rows,
  rotated and translated by `FUN_004010c0`.
