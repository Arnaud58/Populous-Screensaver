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
  `stepSimulation` returns one ordered stream of typed events;
- **no ambient randomness** — every draw comes from an explicit seeded source.

Numeric rules live in the `tuning` object so that this document, the
implementation and the C port have a single place to agree with. Distances are
unscaled world pixels; the caller supplies the sprite scale on the state.

Rendering stays out. The simulation resolves the current animation from the
manifest and stores its frames on the state; views only read that state.

The host shell owns exactly three things — the world geometry, the clock, and
one loop calling `stepSimulation`.

## Status

Written after version 0.9.0. Sections marked **planned** are not implemented in
any target yet.

Two passes over the executable have since replaced most of what was originally
inferred from video. Where this document gives a number, it is now usually a
recovered one; where it is not, it says so. The rule of thumb: **anything
expressed in original 30 ms ticks or as a comparison against a 15-bit threshold
came out of the disassembly**, and anything in seconds or pixels-per-second
was probably chosen.

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

**The random source is the Microsoft C runtime's `rand`**, the one the 1998
executable was linked against. It replaced mulberry32 once the behaviour rules
started depending on exact comparison thresholds: those thresholds are only
meaningful against the distribution that produced them.

```text
state  = (state * 214013 + 2531011) mod 2^32
result = (state >> 16) and 0x7fff
```

`nextOriginal` returns that 15-bit result and is what every recovered rule
compares against. `nextFloat` is `result / 32768`, `nextInt(bound)` is
`floor(nextFloat * bound)`, and `pick` indexes an array with `nextInt`.

Seeded with 1, the first ten values are 41, 18467, 6334, 26500, 19169, 15724,
11478, 29358, 26962 and 24464 — the sequence every C runtime of that era
produces, and what `tests/simulation.test.mjs` pins.

**Only 15 bits per call.** `nextUint32` returns the same 15-bit value rather
than a full word, so a port must not assume 32 bits of entropy from it.

There is no ambient randomness anywhere: no rule calls `Math.random()`. The
source is passed in explicitly, which is also what fixes the **draw order** —
adding a draw in one implementation and not the other shows up immediately as
a divergence.

**The timestep is the original's tick.** `stepSimulation` takes real elapsed
seconds, accumulates them, and runs whole slices of `tuning.stepSeconds`, which
is **30 ms** — the interval of the executable's Windows timer. The leftover is
carried to the next call, so the amount simulated does not depend on how often
or how regularly the host calls in — only on how much real time passed,
quantised to one step.

The 30 ms slice matters beyond pacing: every recovered rule counts ticks, not
milliseconds, so a 60 Hz slice would consume the random sequence at twice the
rate and diverge from the first countdown.

Time longer than `tuning.maxAccumulatedSeconds` (0.25 s) is **dropped, not
caught up**. A host that stalls for a second resumes where it left off rather
than teleporting every character, and the loop cannot spiral trying to catch
up. This is a deliberate difference from the pre-0.5.0 behaviour, which
clamped each character's movement individually against the wall clock.

Golden traces live in `tests/golden/`. They record the initial state and one
snapshot per simulated second over 600 fixed steps for both a 1280×720 screen
and the three-screen development layout. Character, entity and typed-event data
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

`neutral` is tribe 0 in the original: an **unaligned** character, belonging to
no tribe. The atlas settles what one can do. The neutral variant has a walk
block and a stand block and nothing else — no kick, no hit, no scratch, no
soul — while the four coloured tribes carry all of them. An unaligned character
therefore never fights, is never struck and never dies. It wanders until a
shaman converts it, which is the only role its sprites permit.

**Ordinary characters are always born unaligned.** No member of a tribe ever
appears spontaneously; conversion is the only way into one, which is what makes
the shamans the engine of the simulation rather than decoration. The spawn draw
is still made, from a one-entry list, so every class costs the same sequence of
values.

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
| `id` | stable numeric identity within one simulation |
| `entity` | renderable class: `brave`, `shaman` or `firewarrior` |
| `action` | animation action: `walk`, `stand`, `idle`, `kick`, `punch`, `cast`, `scratch`, `wave` or `hit` |
| `behaviour` | state-machine state: `wander`, `pursue`, `attack`, `hit`, `seek`, `cast`, `recover` or Armageddon `muster` |
| `castSpell` | which spell the current cast will launch: `conversion`, `fire` or `lightning` |
| `tribe` | one of the tribe ids above |
| `directionId`, `directionX`, `directionY` | the eight-way sprite direction |
| `headingX`, `headingY` | the continuous heading a slow turn rotates; the sprite direction is derived from it |
| `legacyState` | the original's numeric roaming state: 0 roam, 1 wait, 2 pursue, 8 scratch, 9 formation, 13 celebration |
| `legacySubstate` | the original's secondary selector within a state; 9 marks a war-party member, 4 a character holding its formation slot |
| `legacyTimerTicks` | the original's per-character countdown, in 30 ms ticks |
| `legacyMod11`, `legacyMod2` | free-running counters modulo 11 and 2; several rules only fire on the tick where one is zero, which is what staggers a crowd instead of having it act in unison |
| `legacyTurnTicks`, `legacyTurnRadians` | remaining ticks of a slow turn and its per-tick rotation |
| `formationSlot` | index reserved in the tribe's 200-slot table, or −1 |
| `celebrationPathIndex`, `celebrationFinished` | position along the celebration waypoint path |
| `enteringWorld`, `entryTargetX`, `entryTargetY`, `entryDirectionX`, `entryDirectionY` | a character walking in from beyond the screen edge, and where it is headed |
| `worldX`, `worldY` | ground point |
| `speed` | base motion, exactly 2 px per original 30 ms tick (66.667 px/s), times sprite scale |
| `frameIndex`, `animationElapsedMs` | walk cycle position |
| `footprintElapsedMs`, `footprintSide` | 60 ms cadence and alternating side of the persistent pixel mark |
| `collisionCooldownMs` | counts down after an avoidance turn |
| `wanderRemainingMs` | counts down to the next spontaneous turn |
| `health` | remaining hits; starts at 6 |
| `targetId` | stable id of the current opponent, or 0 |
| `actionRemainingMs` | remaining time in a kick or hit reaction |
| `attackImpactDone` | prevents a kick from dealing damage twice |
| `castCooldownMs` | counts down before the next spell |
| `castLaunched` | prevents one cast from launching two projectiles |
| `tribePinned` | true for a shaman, whose tribe survives initialisation |
| `enteringWorld` | true while an allocated ordinary character is still outside the visible world |
| `entryTargetX`, `entryTargetY` | seeded interior spawn point toward which an entering character walks |
| `entryDirectionX`, `entryDirectionY` | seeded ordinary heading restored once entry is complete |
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

`createCharacter(animations, spriteScale, entity, tribe)` builds one.
`populate(simulation, count, spriteScale)` allocates **one shaman per tribe and
the complete ordinary population**. The shamans are additional rather than
taken out of the count: the configured number is how many ordinary characters
the user asked for. Ordinary characters begin outside the visible world; see
[Population](#population) for how they enter.

`simulation.entities` is a second list for short-lived non-character entities,
rendered by the same delegate as characters.

The rising **soul** has `entity = soul`, `action = rise`, its own position,
animation and `lifetimeRemainingMs`. It is deliberately not left in the
character population after death.

An **effect** has `entity = effect` and a `kind` from the original's effect
factory — `conversion`, `flash`, `burst`, `fire`, `fire_trail`, `fire_impact`
or `ring`. It carries a velocity, a lifetime, an optional `targetId` and an
`animationKey` naming its stream directly, because several effect streams are
directionless and only some are tribe-coloured. A lifetime of zero at creation
becomes the length of its own animation, which is what a one-shot decoration
wants. Effects created during a step are stepped from the next one, never
mid-iteration.

## Rules

### Spawn

Position is uniform over the world region, inset by a small margin. Tribe and
direction are uniform. Speed is uniform in its range.

A shaman's tribe is fixed for the run and is not drawn. The draw is still
**consumed**, so every character costs the same sequence of values whatever its
class; a C port that skips it for shamans diverges from the first shaman
onward.

### Population

The original allocates its complete population immediately. Each ordinary
character is first positioned inside the world, then shifted by half the
selected screen's width and height toward the corresponding outside corner.
That is why the capture opens on the four visible shamans and appears to fill
gradually: the other characters already exist, but are walking in from beyond
the screen. The same mechanism explains the apparent refill delay after
Armageddon.

Shamans are outside the count. They never die, and including them would
silently shrink the population the user asked for.

The configured count **is** reached and held, because the majority of the world
is unaligned and unaligned characters neither fight nor die. Measured over
three minutes at a target of 150, the port loses 0.72 characters per second,
inside the 0.45 to 1.68 measured in the original.

### Walking

Each step, the character advances along its normalised direction by
`speed * stepSeconds`. Ordinary speed is not drawn: brave state 0 stores
**exactly 2 px per 30 ms tick**, so every ordinary character moves at the same
66.667 px/s. The walk animation advances on its own accumulator at 120 ms per
frame, four frames per cycle, looping. Changing direction restarts the cycle at
frame 0.

The animation is **not** tied to distance travelled. Whether the original tied
the two together is **unknown**.

### Heading and turning

A character carries a continuous `headingX`/`headingY` vector alongside the
eight-way `directionId`. Roaming applies a slow rotation to the heading —
±0.1 radians per tick for 20 ticks — and the sprite direction is re-derived
from it. That is what produces the drifting arcs in the original rather than
the hard eight-way turns an eight-direction state alone would give.

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
66.667 px/s that is close to one pixel, so it reads as stopping at the wall.

### Wandering

`wanderRemainingMs` currently counts down each step. When it reaches zero the
character picks a uniformly random new direction and the countdown is redrawn
from 2 to 7 seconds. This remains a clean-room approximation. The original
moves at exactly 2 px per 30 ms tick, uses 0.1-radian turns lasting 20 ticks,
and can wait for 10–39 ticks, but its PRNG gates are interleaved with state-9
reservation logic. The port now uses the exact base speed while retaining its
deterministic high-level turn scheduler until that whole chain can be ported.

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

When combat is disabled, this remains a separation rule. The driver has used a
uniform spatial grid since 0.7.0. Ground points are assigned
to 42-pixel cells and a character queries only the cells touched by its scaled
collision radius. Candidates are restored to their order in the master
character array before applying the rule. This preserves the historical
"first neighbour wins" decision and seeded replay while avoiding an O(n²)
scan over distant characters.

### Footprints

A moving character emits one 2 × 2 pixel mark every other original tick
(60 ms). Its side sign alternates and its offset follows the arithmetic in
`FUN_00413f20`. Marks persist on a Canvas until the trail is explicitly
cleared, matching the original backing-surface behaviour without creating one
QML object per mark.

**The colour is sampled, not chosen.** The original reads the pixel already
under the character's own sprite and blends it into the surface with integer
arithmetic. The port reproduces that: each footprint event carries `sourceX`
and `sourceY`, the atlas coordinates of the pixel under the mark, and the view
samples the atlas through an off-screen copy before applying
`blendFootprintChannel`.

That function is the recovered blend, and it has three branches:

- a **state-13** character (the celebration) moves each channel one tenth of
  the way toward white in red and toward black in green and blue;
- with **no backing image**, the channel is divided by `1 + amount * 0.002`;
- otherwise the channel moves toward the background by `(amount + 1) / 400`.

All three truncate **toward zero**, not downward — the difference shows on
negative deltas, and getting it wrong drifts the trail colour over thousands of
marks.

Cadence, dimensions, persistence and now colour are all recovered. What remains
approximate is that the port samples the atlas rather than a live backing
surface, so a mark laid over another mark does not compound the way it would in
the original.

### Events

`stepSimulation` returns one array in deterministic emission order. Every item
has a `type`; actor-related items carry stable numeric ids. Current types are:

| Type | Meaning |
| ---- | ------- |
| `footprint` | renderer should add one trail mark |
| `behaviour-changed` | `from`/`to` state transition |
| `attack-started` | an attacker began its kick |
| `hit` | damage landed; includes remaining health |
| `soul-spawned` | dead character was replaced by a soul entity |
| `character-removed` | actor left the character population |
| `character-spawned` | replacement actor was created to maintain population |
| `cast-started` | a shaman or firewarrior began a spell; carries `spell` |
| `converted` | an unaligned character joined a tribe; carries its new `entity` |
| `effect-spawned` | a projectile or decoration entered the world; carries `kind` |
| `armageddon-started` | the countdown fired; carries how many were `conscripted` |
| `conscripted` | an unaligned character was drafted into a tribe |
| `armageddon-phase` | the cycle moved on; carries the new `phase` |
| `armageddon-ended` | ordinary play resumes and the interval is re-armed |
| `war-party-launched` | a leader set out; carries `tribe`, `targetTribe` and how many `followers` joined |
| `celebration-character-spawned` | a state-13 character entered for the winner's celebration |
| `entity-removed` | a short-lived entity expired |

`attack-started`, `cast-started` and `converted` carry a `sound` naming the
original resource family the event corresponds to. Nothing plays them yet; the
field exists so the audio layer is a mapping rather than a second reading of
the state machine.

The QML renderer filters `footprint`; the complete stream is also exposed as
`PopulousSimulation.eventsEmitted` for the future sound and effect layers.

### Combat and death

Implemented as the first closed chain recovered from original states 2, 6, 7,
10 and 11. Combat is enabled by default and by the QML hosts;
`{ combatEnabled: false }` keeps focused non-combat fixtures possible.

| Current behaviour | Condition | Next behaviour |
| ----------------- | --------- | -------------- |
| `wander` | nearest hostile within acquisition range | `pursue` |
| `pursue` | target enters attack range | `attack` |
| `attack` | impact point reached | target becomes `hit` |
| `attack` | kick ends and target lives | `pursue` |
| `hit` | reaction ends with health remaining | `pursue` attacker |
| `hit` | reaction ends at zero health | remove character, spawn `soul` |
| `rise` | lifetime ends | remove soul entity |

Target selection scans character order and retains the first nearest hostile,
so ties and replay are deterministic. A kick deals one point at its impact
point and cannot deal twice. A soul plays its directional death poses, changes
to its departure pose, accelerates upward, then expires.

The chain, animations and numeric values now come from the original brave
update. Acquisition is 250 px and melee range 14 px. Pursuit moves at 2 px per
30 ms original tick (66.667 px/s). A kick holds for four ticks (120 ms) and
applies its damage immediately; hit reaction lasts three ticks (90 ms), with
the target recoiling at 10 px per tick opposite its heading and the sixth hit
fatal.

Death first displays three direction-dependent poses, one original tick each.
The final departure pose then rises from 2 px/tick, accelerates by 1 px/tick
every two ticks up to 20 px/tick, and is removed at the top edge or after 200
ticks (6 s). The 60 Hz clean-room engine expresses those tick values as
milliseconds and speeds; transitions are quantised to its fixed step.

The original main loop immediately allocates a replacement after removal when
the live count is below the configured population. `populate` records that
target and the clean-room engine does the same. The replacement receives a new
stable id, is initialised immediately through the ordinary seeded spawn path,
and enters from beyond both axes. Each selected screen uses its own
half width and height, so the rule remains valid with non-rectangular
multi-monitor geometry.

What remains approximate is **when wandering decides to seek combat**. The
original interleaves several PRNG gates with cooldown, reservation and global
Armageddon state. Applying those comparisons on every modern 60 Hz step would
consume a different random sequence and be less faithful than leaving the
current deterministic acquisition cadence explicit.

### Classes

Three character classes share the state machine, and each is routed to its own
rules by `stepBehaviourCharacter`.

| Class | Ordinary role | Fights | Can die |
| ----- | ------------- | ------ | ------- |
| `brave` (unaligned) | wanders the whole world, waits to be converted | no | no |
| `brave` (aligned) | roams, forms up, joins war parties and fights | yes, at 14 px | yes |
| `firewarrior` | roams and fights at range | yes, at 500 px | yes |
| `shaman` | holds its corner and converts | no | no |

A firewarrior has no hit stream of its own. The original selects the **brave**
hit cells for it, and the atlas carries no alternative, so
`stateAnimationId` substitutes them.

Shamans are neither attacked nor damaged, which the atlas again settles: they
have `idle`, `walk` and `cast` and no hit or soul stream at all. The original's
fire impact also excludes them explicitly.

### The roaming state machine

Ordinary behaviour is the original's own numeric state machine rather than a
rewrite of it, because its transitions are gated on comparisons against exact
PRNG thresholds. Reproducing the shape but not the thresholds would consume the
random sequence differently and diverge immediately.

| State | Name | What it does |
| ----: | ---- | ------------ |
| 0 | roam | walks, occasionally starting a slow ±0.1 rad turn for 20 ticks; drops into `wait` on a threshold |
| 1 | wait | stands still; on a threshold picks its next state |
| 2 | pursue | closes on a target and fights |
| 8 | scratch | plays the idle scratch for 15 ticks |
| 9 | formation | reserves a slot in its tribe's table, walks to it, then holds it |
| 13 | celebration | walks the winner's waypoint path (see below) |

**The thresholds are the rule, not an implementation detail.** A `wait`
character leaves only when a 15-bit draw is at least 12000; the branch between
fighting directly and joining a formation is a second draw against 16385; the
choice to scratch instead needs a draw of at least 27001 **and** `legacyMod11`
at zero. Those constants are recovered and belong in the table of numbers a C
port must match exactly.

The modulo counters are what keep a crowd from acting in unison: a rule gated
on `legacyMod11 === 0` fires for any given character on one tick in eleven, and
characters are offset from each other because they were created at different
times.

Unaligned characters take a shorter path — they leave `wait` straight into
`roam` with a 20-to-49-tick lock — so they never fight and never form up.

### Recovered thresholds

Every value here is a comparison against a 15-bit `nextOriginal` draw, or a
tick count, taken from the executable. They are listed together because they
are the part of the specification a C port is most likely to get subtly wrong:
an off-by-one on a threshold does not crash anything, it just makes the world
behave differently after a few minutes.

| Constant | Value | Where it decides |
| -------- | ----: | ---------------- |
| `idleDecisionThreshold` | 12000 | a waiting character stays put below it; a roaming one starts waiting at or above it |
| `groupDecisionThreshold` | 27001 | at or above, and with `legacyMod11` zero, the character scratches instead of acting |
| `directCombatThreshold` | 16385 | below it a character fights directly, otherwise it joins a formation |
| `targetGateThreshold` | 16384 | each candidate target must pass a draw above this in ordinary play; Armageddon bypasses it |
| `groupLaunchThreshold` | 32700 | above it, a character holding its slot becomes a war-party leader |
| turn gate | 22000 | above it, with `legacyMod11` zero, a roaming character starts a slow turn |
| turn direction | 0x4001 | below it the turn is −0.1 rad, otherwise +0.1 |
| `firewarriorConversionChance` | 2767 / 32768 | a conversion produces a firewarrior rather than a brave |

| Tick count | Value | Meaning |
| ---------- | ----: | ------- |
| turn duration | 20 | ticks of slow rotation |
| `scratchTicks` | 15 | length of the idle scratch |
| `roamWaitMinTicks` + span | 10 + 0..29 | how long a character waits |
| `neutralRoamLockMinTicks` + span | 20 + 0..29 | an unaligned character's roam lock |
| `formationWaitTicks` | 100 | held in a formation slot before deciding again |
| `groupFollowerLimit` | 15 | maximum followers a war-party leader recruits |
| `armageddonGatherTicks` | 201 | length of the gather, one table entry placed per tick |
| `armageddonRestoreTicks` | 2 | ordinary restoration |
| `celebrationPathStartDelayTicks` | 7 | the world's modulo-51 counter value that starts state 13 |
| `groupTargetDistanceSquared` | 125000 | squared reach for a war-party target, about 354 px |

### Corners and war parties

Each tribe owns a **corner of the world**, as fractions of the bounding box:
blue top-left, red top-right, yellow bottom-right, green bottom-left. Two
things follow from it.

**A shaman belongs to its corner.** The original creates the four shamans at
`(50, 50)` and the three positions mirrored through the world width and height.
When it has nothing to convert it walks back and stands
instead of wandering off. The corner anchor is pulled into the world with
`clampIntoWorld`, because the bounding-box corner of a multi-screen world can
land in a dead zone belonging to no monitor.

**A war party is an individual decision, not a tribe-wide one.** There is no
shared per-tribe countdown; an earlier port invented one, and the executable
contains no such rule.

Instead, a character in state 9 that has reached its slot and waited out its
timer draws against 32700. On success — and only when its `legacyMod11` is
zero — it becomes a **leader**: it picks a target tribe, releases its slot and
sets off, and then recruits **at most fifteen** followers from the same tribe
who are themselves holding a formation slot. Each follower gets its own nearest
target, releases its own slot and leaves with the leader, marked by substate 9.

The target tribe is the largest one that is not its own; if its own tribe is
the largest, it picks the smallest other instead. Candidate targets must be
within a squared distance of 125000, about 354 px.

That is what produces the columns of characters marching diagonally across the
original: a leader and up to fifteen followers crossing the map together, each
walking to a slightly different opponent.

**Slots are reserved, not computed.** Each tribe has a 200-entry reservation
table; a character takes the lowest free index and releases it when it leaves.
Two characters therefore never hold the same slot, and a tribe whose table is
full sends the overflow back to roaming.

The original instead lets individual state-9 leaders reserve a table position,
select an opposing tribe through PRNG gates and reassign at most 15 eligible
followers. The 200-entry reservation tables and formation coordinates are
confirmed, but the full leader/follower transition chain is not yet cleanly
ported. Until it is, aligned characters roam and use the proven local combat
rules. This deliberately leaves one feature incomplete instead of presenting
an invented global timer as original behaviour.

### Conversion

Implemented, from original shaman states 3, 4 and 5 and effect type 0.

| Current behaviour | Condition | Next behaviour |
| ----------------- | --------- | -------------- |
| `wander` | an unaligned brave within acquisition range | `seek` |
| `seek` | target within the 100 px cast range | `cast` |
| `cast` | cast ends | launch projectile, `seek`, start cooldown |

The projectile flies along the heading it was launched with — it does not
home — and ends on reaching its target or when its lifetime runs out.

**Conversion is a zone.** On ending, a ring of sparkles blooms and every
unaligned brave inside it changes tribe, not only the one it was aimed at,
which is what the original's scan does. The ring is drawn at exactly the radius
the rule uses rather than at a decorative one, so what a viewer sees is what
the simulation did.

The radius is measured, not chosen: the ring in the capture is 180 to 230 px
across and about 3:2 elliptical — a circle on the ground seen in shallow
perspective, roughly three times a character's height. The sparkles are placed
at once but started at staggered animation frames, which reproduces the
original's travelling-around-the-circle look without carrying a delay per
sparkle in the state.

A converted character joins the casting shaman's tribe. A share of them arrive
as **firewarriors** instead of braves; that is the only way the class enters
the world. Each conversion spawns a flash and a tribe-coloured burst.

### The fire attack

Implemented, from original firewarrior states 12 and 14 and effect types 6, 7
and 9.

A firewarrior pursues like a brave but stops at cast range instead of closing
to melee. It throws, launches the projectile as the throw ends, then holds a
short recovery before returning to wandering. The projectile emits a trail
behind it, and on impact spawns an impact effect and a ring, and damages every
hostile combatant within its radius. Unaligned characters and shamans are
untouched.

### Provisional values

The unlimited shaman acquisition scan, the three cast frames per direction and
the 8-to-10-tick recovery after a fire throw are recovered. The remaining
distances, intervals and probabilities below are **chosen**, not measured, and
should be replaced as the corresponding static paths are reconstructed.

The shaman cast lasts the recovered 20 ticks (600 ms), independently of the
three-frame animation stream.

| Rule | Current value |
| ---- | ------------- |
| shaman acquisition / cast range | whole world / 100 px |
| cast / cooldown | 600 ms / 900 ms |
| conversion projectile | 333.333 px/s for 12 ticks, then six scans |
| conversion radius | 80 px |
| firewarrior share of conversions | 2767 / 32768 (about 8.44%) |
| fire cast range | 500 px |
| fire projectile speed / impact radius | 333.333 px/s / 15 px |
| fire damage | 2 points |
| firewarrior recovery | 8 to 10 ticks, no extra fixed cooldown |

### Gathering and Armageddon

Implemented for the ordinary state-1 → state-2 → state-5 path. The configured
countdown is re-armed after each cycle.

| Phase | Duration | What happens |
| ----- | -------- | ------------ |
| `normal` | the configured interval | ordinary play |
| `gather` | 201 original ticks (6.03 s) | every neutral gets a random tribe; at most one character-table entry is moved to a formation slot per tick |
| `battle` | conditional | continues until fewer than two tribes have a living non-shaman combatant |
| `celebration` | conditional | the rare winner branch, below |
| `celebration_restore` | 1 tick, then 10 | releases the celebration and hands back to `restore` |
| `restore` | 2 original ticks on the ordinary path | survivors return to ordinary states and the interval is re-armed |

There is no distinct convergence phase and no fixed 22-second battle in the
executable.

### The celebration

Global states 3 and 4 are a **conditional branch, not a phase every cycle goes
through**. It runs only when the battle leaves exactly one tribe standing *and*
the run's cycle counter — advanced once per Armageddon, modulo 11 — is 1. One
cycle in eleven, at most.

When it fires, everything but the four shamans is removed and half the
configured population is respawned in the winner's colours, in state 13,
entering from the left edge. They then walk an **84-point waypoint path**
copied literally from `FUN_00402e90`: a 500 × 100 drawing translated around the
screen centre, with one exit point 20 px from the right edge appended. Each
character advances to the next waypoint when it comes within a few pixels,
moving at 2 px per tick and slowing to 1 px near a waypoint.

The path is kept as a literal table rather than regenerated, which makes it
independently testable and avoids inventing a replacement for something that is
plainly a hand-drawn shape.

The phase holds until every celebrating character has finished its path, then
40 more ticks, and only then unwinds.

**A gate worth knowing about.** State 13 does not begin walking until the
world's own modulo-51 counter reaches 7, so the whole group starts together
rather than the moment each one spawns.

**The draft is random, not balanced.** Every still-neutral brave draws one of
the four tribes. The near-equal groups in the first capture do not override the
direct code evidence.

**Gathering is a truce.** Nobody acquires a target while the formations
assemble. Without that the field empties before the battle begins — measured:
82 of 150 characters died during the gather — while the capture's four
formations arrive intact.

**The shamans do not join in.** They hold their corners for the whole cycle and
throw at each other over the top of the melee, alternating the fire projectile
and lightning. That is the only place lightning is ever used.

Each tribe has the exact 200-slot table built by `FUN_004010c0`: eight columns
and 25 rows at 20 px spacing, rotated by `-0.75`, `+0.75`, `+2.3` or `-2.3`
radians around screen centre, then translated horizontally by one third of the
screen height. For a non-rectangular Plasma desktop, a point falling in a dead
zone is clamped into the nearest real screen.

### Lightning

The one effect with no sprite anywhere in the atlas. The original draws it with
line primitives, so the simulation carries a path and the renderer strokes it.

Measured at 145.4 s in the capture: **two or three near-parallel jagged paths**,
white with a blue tinge, spanning 784 px inside a 61 px envelope, held for a
quarter of a second and not moving. 784 px over the disassembly's 15 points is
56 px a segment, which is what the capture shows.

The jitter is applied **across** the bolt rather than along it, which keeps it
inside a narrow envelope however long it is, and both ends are pinned: a bolt
that missed its target at either end would read as a stray scratch rather than
a strike.

`PopulousView` collects lightning entities and strokes them onto a `Canvas`
above everything else, twice per path — a wide blue halo, then a thin white
core. It repaints only while a bolt exists, and once more to clear the last
one.

## Configuration

Every setting is declared in three places that must agree, and nothing checks
that for you:

1. the schema and its default — `targets/plasma/contents/config/main.xml` for
   Plasma, the `Settings` block of `ConfigDialog.qml` for Windows;
2. the control offered on the configuration page, with its bounds;
3. the **clamp in the host** that reads the value back.

A page that offers more than its host honours produces the worst kind of
defect: a setting the user saves, which is silently ignored. That happened once
already, with a spin box offering 1000 characters against a wallpaper clamping
to 100. `tests/plasma-config.test.mjs` now asserts the two bounds agree, and
**every new bounded setting must extend that test**.

| Setting | Type | Default | Range | Status |
| ------- | ---- | ------- | ----- | ------ |
| number of characters | integer | 200 | 10 to 1000 | implemented |
| sprite size | choice | automatic | automatic, 1x, 2x, 3x | implemented |
| footprints | boolean | on | — | implemented |
| random seed | integer | 0 (a different run each time) | 0 to 2147483647 | implemented |
| Armageddon interval | integer, seconds | 120 | 60 to 500 | implemented |
| **sound** | boolean | **off** | — | with [sound](#sound) |

The sound setting is deliberately **not** declared yet. A knob that moves
nothing is the defect described above, so it arrives in the same change as the
behaviour it controls.

The simulation clamps the Armageddon interval to the same range the pages
offer, so a host that asks for more than it advertises gets the ceiling rather
than a value quietly ignored.

**The Armageddon default of 120 s is the original's**, confirmed both by the
configuration block in the executable and by the capture, where the first
Armageddon begins almost exactly two minutes in. The range is wider than the
original offered.

**Sound defaults to off**, which the original did not. A 1998 screen saver
could reasonably make noise unannounced; software in 2026 should ask first.
The 28 effects are extracted either way, and the event stream already carries
the `sound` field that names them.

Changing the population, sprite size or seed starts a fresh world. Turning
footprints off clears the existing trail without interrupting movement.

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

`attack-started`, `cast-started` and `converted` already carry a `sound` field
naming the original resource family, so the audio layer is a mapping from the
event stream rather than a second reading of the state machine.

It arrives behind a **sound setting defaulting to off** — see
[Configuration](#configuration).
