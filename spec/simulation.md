# Simulation specification

This document is the language-neutral reference for the simulation.
`core/js/Simulation.js` is the working implementation; the C port under
`core/c/` (planned, for the xscreensaver target) must reproduce this document
exactly, and the two are compared through golden traces.

Anything not written here is not settled. Where the original screen saver's
behaviour is still unknown, that is stated rather than guessed.

## Shape of the implementation

Every rule operates on a **duck-typed character state**, listed in full under
[Character state](#character-state). A QML `Item` exposing those as properties
qualifies, and so does a plain object. That is what lets the same code drive the
Plasma wallpaper and run headless under Node:

```bash
node --test "tests/**/*.test.mjs"
```

Three constraints keep it that way, and all three exist for the C port:

- **no clock access** — the caller passes elapsed time in, and the state holds
  remaining durations rather than timestamps;
- **no callbacks** — callers learn what happened from return values, so
  `stepCharacter` reports `{ directionChanged, footprint }` and
  `stepSimulation` returns the footprints to render;
- **no ambient randomness** — every draw comes from an explicit seeded source.

Numeric rules live in the `tuning` object so that this document, the
implementation and the C port have a single place to agree with. Distances are
unscaled world pixels; the caller supplies the sprite scale on the state.

Rendering stays out. The simulation reads `frameWidth`, `frameHeight`,
`frameCount` and `frameDurationMs` from the state, but never writes them: the
renderer keeps them current from the manifest.

The host shell owns exactly three things — the world geometry, the clock, and
one loop calling `stepSimulation`.

## Status

Written against version 0.9.0. Sections marked **planned** are not implemented
in any target yet.

## Coordinate system and world geometry

- Origin is top-left, `x` grows right, `y` grows down.
- Units are world pixels before sprite scaling.
- A character's position is its **ground point**: the point where it touches
  the floor, not the top-left of its sprite. Sprite placement subtracts the
  frame anchor from the ground point.
- `y` doubles as the draw order: a character lower on screen draws in front.

**The world is a list of rectangles**, built with `createWorld`, one per screen
it spans. A single-screen host passes a list of one, so there is no separate
single-screen mode — it is the degenerate case of the general one.

| Shell | World |
| ----- | ----- |
| Plasma wallpaper | one rectangle, the current screen |
| Preview | one rectangle, or a faked layout in rehearsal mode |
| Qt application (planned) | one rectangle per monitor |
| xscreensaver (planned) | one rectangle, the window it is given |

### Dead zones

Screens of different heights leave parts of the bounding box belonging to no
monitor. On the development machine — a 1920×1200 beside two 1920×1080, all
top-aligned — that is a 3840×120 strip along the bottom. A character walking
in there would simply be invisible.

Validity is therefore membership of the **union**, never of the bounding box.
`worldContains` tests the union; `bounds` exists only for hosts that need an
overall size.

### Margins at seams

`worldAllows(world, x, y, margins)` decides whether a character may stand
somewhere. It **probes** the margins rather than insetting each rectangle:
it tests `(x ± marginX, y)` and `(x, y − marginTop)` and `(x, y + bottom)` for
membership of the union.

This is the whole trick of the continuous world. A probe crossing an internal
seam lands in the neighbouring screen and is still inside the union, so the
character walks through. A probe crossing an outer edge leaves the union, so
the character turns. Insetting each rectangle instead would raise an invisible
wall down every seam, and the world would not be continuous at all.

The lip above a dead zone is an outer edge and behaves as one.

### Recovering an illegal position

`clampIntoWorld` pulls a character back to the nearest legal spot, and
`stepCharacter` calls it whenever the current position fails `worldAllows`.

This is not defensive padding: a position can become illegal without anyone
doing anything wrong. The spawn inset (40 px) is smaller than the top margin
of a tall sprite at scale 2 (52 px); the sprite scale changes when a window
resizes; a screen is unplugged. Without the rescue such a character fails every
move, reverses on the spot, and is stuck for good.

## Determinism

Implemented. A given seed replays exactly.

**The random source** is mulberry32, seeded with one 32-bit word. It was chosen
for portability: every operation is an explicit unsigned 32-bit one, and
JavaScript's `Math.imul` is the same truncating 32-bit multiply as C's
`uint32_t` multiply, so the C port produces the same bit patterns.

```text
state = (state + 0x6d2b79f5) mod 2^32
t     = imul(state xor (state >> 15), 1 or state)
t     = (t + imul(t xor (t >> 7), 61 or t)) xor t
result = t xor (t >> 14)
```

`nextFloat` is `result / 2^32`, uniform in [0, 1). `nextInt(bound)` is
`floor(nextFloat * bound)`. `pick` indexes an array with `nextInt`.

There is no ambient randomness anywhere: no rule calls `Math.random()`. The
source is passed in explicitly, which is also what fixes the **draw order** —
adding a draw in one implementation and not the other shows up immediately as
a divergence.

**The timestep is fixed.** `stepSimulation` takes real elapsed seconds,
accumulates them, and runs whole slices of `tuning.stepSeconds` (1/60 s). The
leftover is carried to the next call, so the amount simulated does not depend
on how often or how regularly the host calls in — only on how much real time
passed, quantised to one step.

Time longer than `tuning.maxAccumulatedSeconds` (0.25 s) is **dropped, not
caught up**. A host that stalls for a second resumes where it left off rather
than teleporting every character, and the loop cannot spiral trying to catch
up. This is a deliberate difference from the pre-0.5.0 behaviour, which
clamped each character's movement individually against the wall clock.

Golden traces live in `tests/golden/`. They record the initial state and one
snapshot per simulated second over 600 fixed steps for both a 1280×720 screen
and the three-screen development layout. Character state and footprint events
are rounded to six decimal places so the future C implementation can compare
language-neutral values.

Regenerate them only after an intentional simulation-rule change, then review
the JSON diff:

```bash
node tools/generate-golden.mjs --write
node tools/generate-golden.mjs --check
```

## Tribes

Five colour variants exist in the atlas. Only the loincloth carries the colour;
variant 0 has none.

| Tribe | Atlas block | First native sprite | Trail colour |
| ----- | ----------- | ------------------- | ------------ |
| `neutral` | 0 | 0 | `#b9b0a2` |
| `blue` | 1 | 40 | `#45d7ff` |
| `red` | 2 | 80 | `#ff5545` |
| `yellow` | 3 | 120 | `#ffe35a` |
| `green` | 4 | 160 | `#62e85c` |

The simulation currently draws only from the four coloured tribes. Whether the
original used the neutral variant, and for what, is **unknown**.

## Directions

Eight directions, in the atlas's own order. The order matters: it is the order
the manifest is compiled in, and reversing it swaps east and west.

| Index | Id | dx | dy |
| ----- | -- | -- | -- |
| 0 | `south` | 0 | 1 |
| 1 | `south_east` | 1 | 1 |
| 2 | `east` | 1 | 0 |
| 3 | `north_east` | 1 | -1 |
| 4 | `north` | 0 | -1 |
| 5 | `north_west` | -1 | -1 |
| 6 | `west` | -1 | 0 |
| 7 | `south_west` | -1 | 1 |

Diagonal movement is normalised, so diagonal speed equals cardinal speed.

`Simulation.js` lists the same eight pairs in a different order, which is
harmless: `directionForVector` matches on the vector, and `tests/` asserts that
the two tables agree on every animation in the manifest.

What no test can check is whether the **frames** behind each id face the right
way. That is a claim about pixels. `research/direction-check.png` draws each
compiled animation beside the arrow it moves along; it is the only thing that
catches a character walking backwards, and it should be re-read whenever the
direction order or the source range changes.

## Character state

Written by the simulation:

| Field | Meaning |
| ----- | ------- |
| `tribe` | one of the tribe ids above |
| `directionId`, `directionX`, `directionY` | current heading |
| `worldX`, `worldY` | ground point |
| `speed` | drawn once at spawn, 30 to 48 world pixels per second, times the sprite scale |
| `frameIndex`, `animationElapsedMs` | walk cycle position |
| `distanceSinceFootprint` | distance walked since the last footprint |
| `collisionCooldownMs` | counts down after an avoidance turn |
| `wanderRemainingMs` | counts down to the next spontaneous turn |
| `initialized` | false until the world is large enough to place it |

Resolved by the simulation from the manifest:

| Field | Meaning |
| ----- | ------- |
| `animations` | the manifest's `animations` object, so a character can resolve its own frames |
| `frames` | frame array of the current animation, refreshed by `setDirection` |
| `frameCount`, `frameDurationMs` | derived from the same animation |

Supplied by the host:

| Field | Meaning |
| ----- | ------- |
| `spriteScale` | multiplier the host chose for the display |

Edge margins follow `frames[frameIndex]`, not a constant: a cycle changes width
from frame to frame — `south` runs 17, 19, 17, 19.

**The renderer owns nothing.** Until 0.9.0 the state carried `frameWidth` and
`frameHeight` written by `Character.qml` bindings, which made the character
item *be* the state. That ownership has no answer once several windows render
one world, so the simulation resolves animations itself and a view only reads.

The three countdowns replace what used to be per-character timers. That is what
makes the state portable: it holds no timer object and no timestamp, only
remaining durations that a fixed step decrements.

`createCharacter(animations, spriteScale)` builds one; `populate(simulation,
count, spriteScale)` replaces a whole population.

**Planned:** a behaviour state (walking, fighting, converting, casting,
dying, gathering) with explicit transitions. Today every character is
permanently walking.

## Rules

### Spawn

Position is uniform over the world region, inset by a small margin. Tribe and
direction are uniform. Speed is uniform in its range.

### Walking

Each step, the character advances along its normalised direction by
`speed * stepSeconds`. The walk animation advances on its own accumulator at
120 ms per frame, four frames per cycle, looping. Changing direction restarts
the cycle at frame 0.

The animation is **not** tied to distance travelled, so characters of different
speeds move their legs at the same rate. Whether the original tied the two
together is **unknown**.

### Edges

Margins are half the frame width horizontally, the full frame height at the
top, and 4 pixels at the bottom.

Each step tries the whole move, then each axis on its own:

1. if the full move is allowed, take it;
2. else if moving in X alone is allowed, take that and negate `directionY`;
3. else if moving in Y alone is allowed, take that and negate `directionX`;
4. else negate both and stay put.

Whichever axis is refused is the one that hit a wall, so that is the one to
reflect. Testing the axes separately is what lets a character slide along an
edge instead of sticking to it, and it needs no special case for the concave
corners a multi-screen world has.

A refused move means the character does not advance that step, so no clamping
arithmetic is needed against a non-convex region. At 1/60 s and roughly
40 px/s that is under a pixel, so it reads as stopping at the wall.

### Wandering

`wanderRemainingMs` counts down each step. When it reaches zero the character
picks a uniformly random new direction and the countdown is redrawn from 2 to 7
seconds. The original's timing is **unknown**; these values were chosen to look
plausible.

A redundant pick — landing on the direction already held — still counts as a
change and restarts the walk cycle, matching the pre-0.5.0 behaviour.

### Avoidance

The driver runs an avoidance pass every 100 ms of simulated time, over every
character in order. A character within 14 scaled pixels of another turns
directly away from the **first** such neighbour it finds, but only if it is
currently moving towards it (negative dot product between direction and
separation). After turning, `collisionCooldownMs` blocks further avoidance for
350 ms.

Since 0.5.0 the pass is driven centrally rather than by one timer per
character, so every character is evaluated on the same tick instead of on its
own phase. The turning rate is unchanged, being governed by the cooldown.

This is a placeholder for combat, not a reproduction of anything observed. The
driver has used a uniform spatial grid since 0.7.0. Ground points are assigned
to 42-pixel cells and a character queries only the cells touched by its scaled
collision radius. Candidates are restored to their order in the master
character array before applying the rule. This preserves the historical
"first neighbour wins" decision and seeded replay while avoiding an O(n²)
scan over distant characters.

### Footprints

A footprint pair is dropped every 12 scaled pixels of distance actually walked,
oriented along the direction of travel and tinted with the tribe colour. It
holds full opacity for 900 ms, then fades over 2600 ms and is destroyed.

Footprints are drawn procedurally as two rectangles. Atlas row 27 holds native
particle cells that may be the original's footprints, but their mapping to
tribes and directions is **unconfirmed**, so they are left untouched.

### Combat, conversion, spells, gathering, Armageddon

**Planned.** None of these are implemented or specified. The atlas rows that
probably hold their frames are catalogued in `research/sprite-groups.json`, but
none of the sequences have been grouped into named animations yet.

## Screen-saver invocation

The Windows target is an ordinary executable with a `.scr` extension. Windows
dispatches on the first argument, and is inconsistent about both the separator
and the case, so `-S`, `/s` and `/S` all mean the same thing, and the window
handle sometimes arrives as `/c:1234` rather than as a second argument.

| Argument | Behaviour |
| -------- | --------- |
| `/s` | run: one full-screen borderless window per monitor, cursor hidden, quits on input |
| `/c`, `/c:<hwnd>` | show the configuration dialog |
| `/p <hwnd>` | draw into the settings dialog's thumbnail |
| `/w` | run in ordinary windows — a development affordance, not a Windows convention |
| *(none)* | treated as `/c`, which is what a double-click should do |

**Quitting on input** needs two guards. Windows delivers a burst of mouse
movement right after launch — the pointer has not moved, the system is only
reporting where it is — so input is ignored for 1.2 s. And a mouse resting on a
noisy surface reports tiny movements indefinitely, so the pointer must travel
more than 12 pixels before it counts.

## Sound

**Planned.** 28 effects are extracted and converted. No target plays any of
them yet, and no event-to-sound mapping has been decided.
