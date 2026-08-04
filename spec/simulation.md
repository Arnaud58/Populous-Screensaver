# Simulation specification

This document is the language-neutral reference for the simulation.
`core/js/Simulation.js` is the working implementation; the C port under
`core/c/` (planned, for the xscreensaver target) must reproduce this document
exactly, and the two are compared through golden traces.

Anything not written here is not settled. Where the original screen saver's
behaviour is still unknown, that is stated rather than guessed.

## Shape of the implementation

Every rule operates on a **duck-typed character state**: an object carrying
`tribe`, `directionId`, `directionX`, `directionY`, `worldX`, `worldY`,
`speed`, `previousTick`, `distanceSinceFootprint` and `lastCollisionAt`.

A QML `Item` exposing those as properties qualifies, and so does a plain
object. That is what lets the same code drive the Plasma wallpaper and run
headless under Node:

```bash
node --test "tests/**/*.test.mjs"
```

Two constraints keep it that way, and both matter for the C port:

- **no clock access inside the rules** — the caller passes the current time in;
- **no callbacks** — callers learn what happened from return values, so
  `stepCharacter` reports `{ directionChanged, footprint }` rather than
  emitting a signal.

Numeric rules live in the `tuning` object so that this document, the
implementation and the C port have a single place to agree with. Distances are
unscaled world pixels; the caller applies the sprite scale.

Rendering stays out: frame-derived distances such as edge margins and footprint
spacing are computed by the host shell and passed in as `metrics`.

## Status

Written against version 0.4.0. Sections marked **planned** are not implemented
in any target yet.

## Coordinate system and world geometry

The simulation reasons about a **world region** and a list of **viewports**,
never about a single screen size. See `spec/world-geometry.md` — planned.

- Origin is top-left, `x` grows right, `y` grows down.
- Units are world pixels before sprite scaling.
- A character's position is its **ground point**: the point where it touches
  the floor, not the top-left of its sprite. Sprite placement subtracts the
  frame anchor from the ground point.
- `y` doubles as the draw order: a character lower on screen draws in front.

Current shells supply geometry as follows.

| Shell | World region | Viewports |
| ----- | ------------ | --------- |
| Plasma wallpaper | the current screen | one |
| Qt application (planned) | union of all screens | one per monitor |
| xscreensaver (planned) | the window it is given | one |

The single-viewport case is not a separate mode; it is the degenerate case of
the general one.

## Determinism

**Planned, not yet implemented.** Today the simulation calls `Math.random()`
and reads the wall clock through `Date.now()`, so no two runs match and no two
implementations can be compared.

The target design:

- one explicit seeded PRNG, shared by every implementation, with an identical
  algorithm and identical output for a given seed;
- a fixed timestep, with elapsed time passed into the step function rather than
  read from a clock inside it;
- every random draw consumed in a defined order, so that adding a draw in one
  implementation and not the other shows up immediately as a trace divergence.

Golden traces live in `tests/golden/`. Each is the state of every character
over N steps from a known seed, serialised deterministically.

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
the manifest is compiled in, and getting it wrong swaps east and west.

| Index | Id | dx | dy |
| ----- | -- | -- | -- |
| 0 | `south` | 0 | 1 |
| 1 | `south_west` | -1 | 1 |
| 2 | `west` | -1 | 0 |
| 3 | `north_west` | -1 | -1 |
| 4 | `north` | 0 | -1 |
| 5 | `north_east` | 1 | -1 |
| 6 | `east` | 1 | 0 |
| 7 | `south_east` | 1 | 1 |

Diagonal movement is normalised, so diagonal speed equals cardinal speed.

## Character state

Implemented today:

- tribe, direction, ground position;
- speed, drawn once at spawn from 30 to 48 world pixels per second, then
  multiplied by the sprite scale;
- current animation and frame index;
- distance walked since the last footprint.

**Planned:** a behaviour state (walking, fighting, converting, casting,
dying, gathering) with explicit transitions. Today every character is
permanently walking.

## Rules

### Spawn

Position is uniform over the world region, inset by a small margin. Tribe and
direction are uniform. Speed is uniform in its range.

### Walking

Each step, the character advances along its normalised direction by
`speed * elapsed`. The walk animation advances on its own timer at 120 ms per
frame, four frames per cycle, looping.

The animation is **not** currently tied to distance travelled, so characters of
different speeds move their legs at the same rate. Whether the original tied
the two together is **unknown**.

### Edges

On reaching a world edge the corresponding direction component is negated and
the position is clamped. Margins are half the frame width horizontally, the
full frame height at the top, and 4 pixels at the bottom.

This is the behaviour to replace once the world spans several screens: a
character reaching the shared edge between two viewports must cross it rather
than bounce.

### Wandering

Every 2 to 7 seconds, redrawn after each change, the character picks a uniformly
random new direction. The original's timing is **unknown**; these values were
chosen to look plausible.

### Avoidance

Every 100 ms, a character within 14 scaled pixels of another turns directly
away from it, but only if it is currently moving towards it (negative dot
product between direction and separation). After turning, a character ignores
avoidance for 350 ms.

This is a placeholder for combat, not a reproduction of anything observed. The
scan is currently O(n²) over all characters.

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

## Sound

**Planned.** 28 effects are extracted and converted. No target plays any of
them yet, and no event-to-sound mapping has been decided.
