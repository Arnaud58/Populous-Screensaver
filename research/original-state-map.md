# Original state and effect map

This map joins three independent views of the 1998 executable: character
update methods, sprite-cell selection methods and effect-factory call sites.
It is intended to guide the clean-room simulation; it is not recovered source
code.

“Confirmed” below means the numeric selector and described code path are
unambiguous. A descriptive particle name remains provisional when several
visually similar effects reuse the same sprite cells.

## Character action states

The action field is the 32-bit integer at character offset `0x3c`. The three
classes share several state numbers but not every state.

| State | Class | Behavioural role | Atlas cells selected | Status |
| ---: | --- | --- | --- | --- |
| 0 | all | active roaming/search logic | ordinary walk or idle/stand cells | role confirmed at high level |
| 1 | all | stationary wait/cooldown before returning to active logic | ordinary idle/stand cells | confirmed |
| 2 | brave, firewarrior | pursue a reserved hostile target | ordinary walk cells | confirmed |
| 3 | shaman | pursue an unaligned conversion target; also used while gathering for Armageddon | shaman walk cells | confirmed |
| 4 | shaman | stationary pre-cast pause | shaman idle, two frames per direction | confirmed |
| 5 | shaman | cast: conversion normally, fire or lightning during Armageddon combat | shaman punch/cast, three frames per direction | confirmed; “punch” is only the catalogue name |
| 6 | brave | close-range kick | `brave.*.kick`, cells 655–718 | confirmed |
| 7 | brave, firewarrior | receiving a hit/stagger | `brave.*.hit`, cells 623–654 | confirmed; firewarriors deliberately reuse brave cells |
| 8 | brave | idle scratch | `brave.*.scratch`, cells 495–622 | confirmed |
| 9 | brave, firewarrior | travel to an Armageddon formation slot | ordinary walk cells | confirmed |
| 10 | brave, firewarrior | first death/soul phase | `soul.*.rise`, cells 719–818 | confirmed |
| 11 | brave, firewarrior | final rising/removal phase | final cell of the corresponding soul stream | confirmed |
| 12 | firewarrior | close-range firewarrior punch | `firewarrior.*.punch`, source cells 1057–1148 | confirmed |
| 13 | brave, firewarrior | three-frame Armageddon wave/celebration | brave cells 1149–1160; firewarrior cells 1161–1172 | confirmed |
| 14 | firewarrior | short recovery after launching a fire projectile | ordinary stand/walk cells | confirmed |

The ordinary renderer chooses between motion and rest rather than assigning a
unique animation to every logical state. For braves this means walk blocks at
0–191 and stand cells interleaved at 32–199; for firewarriors, walk is
897–1048 and stand is 929–1056. Shaman blocks overlap by design: each tribe has
16 idle cells, then 32 walk cells, then 24 cast cells.

### Combat transitions confirmed in code

- A brave pursuing a nearby hostile switches to state 6 and forces the target
  into state 7. The attack uses a random `PUNCH1`–`PUNCH8` sound.
- A firewarrior can switch to state 12, request `FIRECAST`, launch effect type
  6 at its target, then enter state 14 for 8–10 ticks.
- A shaman in state 5 launches effect type 0 toward an unaligned character and
  requests `CONVERT_SPELL` or `CONVERT2` when the cast completes.
- During Armageddon state 2, a shaman also uses character state 5 to launch
  either the type 6 fire projectile or type 10 lightning at another shaman.
- Damage above five changes braves and firewarriors to state 10. After three
  soul frames they enter state 11, rise vertically and are removed.

## Effect selectors

`FUN_00401670` allocates effects in the 400-slot array. The selector is stored
at object offset `0x0c`; positions are at `0x18`/`0x1c`, velocities at
`0x28`/`0x2c`, removal at `0x30`, age at `0x10` and the selected sprite cell at
`0x48`.

| Type | Proposed role | Visual implementation | Evidence and confidence |
| ---: | --- | --- | --- |
| 0 | conversion projectile | sparkle cells 345–350 plus types 1 and 2 particles | confirmed: launched by shaman state 5; scans nearby unaligned characters and changes their tribe or replaces them with a firewarrior |
| 1 | conversion flash/after-effect | rotating moving sparkle 345–350; emits type 3 | confirmed call site after a brave/firewarrior changes tribe; descriptive name provisional |
| 2 | generic debris mote | four particle variants based at 825, 861, 870 and 879 | confirmed generic child of types 0, 9 and 11 and several character bursts |
| 3 | tribe-coloured burst mote | particle groups based at 819, 836, 842 and 848 | confirmed tribe parameter; used by conversion, death and Armageddon relocation |
| 4 | moving magic sparkle | slowly animated sparkle 345–350 | confirmed general Armageddon/relocation particle; exact visual name provisional |
| 5 | short particle | cells 820–824 | implementation confirmed, but no direct factory call exists in the analysed executable |
| 6 | fire projectile and impact | moving cell 854, type 7 trail, type 9 impact and ring 1173–1178 | confirmed: launched by firewarrior state 12; damages nearby hostile non-shamans |
| 7 | fire-projectile trail | cells 854–860 over seven ticks | confirmed child of type 6 |
| 8 | impact ember | cells 893–896 | confirmed child of type 9 |
| 9 | fire impact/emitter | fixed cell 834 for about 60 ticks; repeatedly emits type 8 | confirmed child of type 6; descriptive name provisional |
| 10 | lightning bolt | no atlas sprite; three jagged procedural GDI paths aimed at a character | confirmed: selected by shaman combat logic together with sound index 26, `LIGHTNING` |
| 11 | eliminated-shaman swirl fragment | moving sparkle 345–350, lasting about 100 ticks and emitting type 2 | confirmed Armageddon-only call site immediately after sound index 27, `SWIRL`; descriptive name provisional |

Effect type 10 is the outlier in both memory and rendering. It allocates
`0x390` bytes rather than `0x70`/`0x74`, stores three 15-point paths and draws
them with line primitives. This explains why no lightning sequence exists in
the sprite atlas.

## Consequences for the clean-room engine

The next implementation can introduce the logical state enum and choose an
animation from this table without reproducing the old GDI dirty-rectangle
machinery. The safest first slice is the closed combat chain:

1. target pursuit (state 2);
2. brave kick / firewarrior punch (states 6 and 12);
3. hit reaction and accumulated damage (state 7);
4. soul rise and removal (states 10 and 11).

Conversion should follow after that because it changes class as well as tribe.
Armageddon depends on the same states but additionally needs formation-slot
allocation and the global six-state controller.

## Still unresolved

- exact user-facing names for generic effect types 1–5, 9 and 11;
- whether selector 5 is genuinely dead code or only reached through an
  indirect/non-constant selector missed by the static call search;
- precise per-state probabilities and distance constants after converting the
  compiler's floating-point literals;
- whether the shaman cast cells should be called `cast` rather than `punch` in
  the public atlas catalogue.
