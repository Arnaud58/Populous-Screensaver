# First original-behaviour capture

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

## Next capture

A useful second recording should run past the return to ordinary simulation
and avoid interrupting Wine until the video is stopped. It should also use a
smaller population or a controlled seed if possible, so individual actors can
be followed through conversion and combat rather than hidden inside groups.
