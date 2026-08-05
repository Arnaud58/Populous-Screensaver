# Asset pipeline

How the sprites and sounds are recovered from the 1998 binary, and what has
been worked out about the sprite sheet.

Everything under `assets/` is derived. The original `.scr` is the only source,
and every step below can be replayed from it.

## 1. Preserve the original

Kept separate so every derived resource can be rebuilt:

```bash
mkdir -p original
cp "../Populous Screen Saver.scr" original/
sha256sum "original/Populous Screen Saver.scr"
```

Known SHA-256:

```text
a25f7f7d219018fcf1888891738a706dff5f39f72de103a21dde3945f7097e0b
```

## 2. Extract the Windows resources

```bash
mkdir -p extracted
7z x "original/Populous Screen Saver.scr" -oextracted
```

The resources that matter:

- `IDB_POPSAVER.bmp` — colour sprite sheet, 640 × 1277 pixels;
- `IDB_POPSAVERMASK.bmp` — transparency mask;
- `IDB_PLINTH2.bmp` — Populous banner;
- `WAVE/*` — 28 PCM sound effects.

## 3. Build the transparent atlas

The black-and-white mask is inverted and used as the alpha channel:

```bash
mkdir -p assets/images

ffmpeg \
    -i extracted/.rsrc/BITMAP/IDB_POPSAVER.bmp \
    -i extracted/.rsrc/BITMAP/IDB_POPSAVERMASK.bmp \
    -filter_complex \
    "[1:v]format=gray,negate[alpha];[0:v][alpha]alphamerge,format=rgba" \
    -frames:v 1 \
    assets/images/sprites.png

ffmpeg \
    -i extracted/.rsrc/BITMAP/IDB_PLINTH2.bmp \
    -frames:v 1 \
    assets/images/plinth.png
```

## 4. Recover the sounds

The resources are already WAV files, but carry no extension:

```bash
mkdir -p assets/sounds

for source_file in extracted/.rsrc/WAVE/*; do
    sound_name="$(basename "$source_file")"
    sound_name="${sound_name#WAV_}"
    cp "$source_file" "assets/sounds/${sound_name,,}.wav"
done
```

A 16-bit 44.1 kHz PCM version is kept alongside for Qt Multimedia
compatibility:

```bash
mkdir -p assets/sounds-converted

for source_file in assets/sounds/*.wav; do
    sound_name="$(basename "$source_file")"
    ffmpeg -i "$source_file" \
        -ar 44100 \
        -ac 1 \
        -c:a pcm_s16le \
        "assets/sounds-converted/$sound_name"
done
```

## 5. Map the sprites

The sheet contains opaque horizontal guide lines. The detector finds those
guides, then the transparent column runs that separate candidate poses:

```bash
python3 tools/build-atlas.py
```

It writes `research/sprites-detected.json` and an annotated
`research/sprites-detected.png` for visual checking. Current result:

```text
39 usable guide lines
39 sprite bands
1179 candidate rectangles
```

Not every rectangle is a complete frame. Particles and multi-part effects can
produce several rectangles for one logical frame.

The binary also contains a native table of 1,180 cells with width, height and
position. It preserves the transparent padding that keeps a character from
jittering during an animation:

```bash
python3 tools/extract-native-sprites.py
```

`research/sprites-native.json` is the authoritative source of coordinates.
Visual detection remains useful for naming and grouping sequences.

## 6. Build the animation manifest

In progress. **1,101 of the 1,179 usable cells are grouped into 414
animations.** Reviewed sequences are described in
`research/animation-layout.json` and compiled with:

```bash
python3 tools/build-sprites.py
```

This writes `assets/data/sprites.json` (canonical), `research/sprites.json`
(same content, for review) and `core/js/Animations.js` (importable from QML).
It prints a coverage line and the cell ranges no stream has claimed, which is
how the catalogue's progress is measured.

A stream is `directional` by default — tribes × eight directions × frames,
which is the layout most of the sheet uses. Effects with no facing declare
`"kind": "sequence"` instead, and may drop tribes entirely, so a seven-frame
sparkle does not have to be written out as eight identical copies.

The soul block is the mixed case: each tribe contributes eight directions ×
three death poses, then one directionless departure pose. It is compiled as
the directional `soul_rise` stream plus the four-cell `soul_depart` sequence;
this split comes directly from the original renderer.

### Review artefacts

| Artefact | What it is for |
| -------- | -------------- |
| `research/sheets/cells-*.png` | every cell in index order, labelled, claimed ones dimmed — the discovery sheet |
| `research/<stream>.gif` | the stream played at its declared frame duration |
| `research/direction-check-<stream>.png` | every direction beside the vector it travels along |

The GIF is what separates a plausible grouping from a correct one: frames that
look like a cycle in a contact sheet often are not one.

## What the atlas turned out to be

### The walk blocks

Atlas rows 0 to 5 hold five consecutive blocks of 40 native cells starting at
sprite 0. Each block is the same character in a different colour — only the
loincloth carries it, and the first block has none, which is why a naive colour
classifier reported it as uncoloured rather than as a fifth variant.

Of the 40 cells in a block, only the first 32 form the walk cycle; the last 8
are standing poses.

| Block | First sprite | Tribe |
| ----- | ------------ | ----- |
| 0 | 0 | neutral |
| 1 | 40 | blue |
| 2 | 80 | red |
| 3 | 120 | yellow |
| 4 | 160 | green |

Versions before 0.4.0 read 128 frames starting at sprite 495. Those cells are
the brave's **scratch** idle — what it does when it has stood still too long —
which has a raised arm and no leg cycle at all.

### The direction order

Within a block, the order was recovered from the cell-width signature, which is
mirror-symmetric in blocks of four: index 1 mirrors index 7, index 2 mirrors
index 6, index 3 mirrors index 5, and indices 0 and 4 are the two
self-symmetric axes — south and north. The order is:

```text
south, south_east, east, north_east, north, north_west, west, south_west
```

**That signature pairs the directions but cannot say which member of a pair
faces which way.** Only seeing a sprite next to the vector it travels along
settles it, which is what `research/direction-check.png` is for. Getting it
backwards makes six of the eight directions moonwalk, it is invisible in a
plain contact sheet, and every code test still passes. It happened once, in
0.5.0.

Re-read that render whenever the direction order or a source range changes.

### The signature generalises

The mirror rule turns out to hold across the whole sheet, in a sharper form
than the braves alone showed: **within an eight-direction block, the widths of
direction _i_ equal the widths of direction _8−i_ read backwards** — the
mirrored animation runs in reverse frame order. On the brave blocks it scores
exactly, which is what makes it a detector rather than a guess. Scanning the
native table with it found:

- **cells 897–1056**, four blocks of 40 laid out exactly like the braves: the
  **firewarrior**, a horned-helmet unit holding a flame in each hand. The four
  blocks were matched to tribes by the colour that separates each from the
  other three — blue, red, yellow, green, the same order again. No neutral
  variant;
- **the eight cells trailing every 40-cell walk block** (32–39, 72–79, … and
  929–936, …) as a **standing** set, one frame per direction. Their widths run
  18, 14, 10, 14 twice over, which is the one-frame case of the same signature;
- **four 72-cell shaman groups** at 200, 272, 351 and 423, each split
  **16 idle, 32 walk, 24 cast**. All twelve blocks score exactly. The colours
  run blue, red, yellow, green once more, though the headdresses differ and
  the two halves differ in cell height, so whether these are four variants of
  one unit or two unit types is unresolved. Their arms-out pose reads as a
  punch rather than a spell, and whether a shaman fights at all in the screen
  saver is doubtful — enemy braves are remembered as walking straight past.

### The direction sense, mechanically

Getting east and west backwards makes six of the eight moonwalk, passes every
code test, and shipped once in 0.5.0. Comparing a new set's silhouettes against
the verified brave set narrows it down, but only so far: 7/8 between brave and
firewarrior, which share a build, and 3/8 between brave and shaman, whose
headdress is half the sprite. **A low score means nothing on its own.**

What it catches reliably is the failure that actually happens — a whole set
assigned to its own mirror, east matching west. `build-sprites.py` fails the
build on that and prints the score otherwise. It has been checked both ways: it
stays silent on the real layout and fires on a deliberately reversed one.

`research/direction-check-<stream>.png` remains the authority.

### Mirrored directions are stored at the opposite phase

The signature works on **reversed** width tuples, and that is not an accident of
measurement: the artist drew each mirrored direction at the opposite point of
its cycle. Going west the weapon arc falls on frame 1; going east it falls on
frame 2.

For a four-frame walk this is invisible and correct — a left leg forward
mirrors a right leg forward. For a two-frame action it means the two halves of
the set cannot be read the same way, which is why the punch and swing sets are
recorded with their direction sense still open.

### Braves do more than walk

Cells 495–718 are the brave's other poses, four tribes each, with no neutral
variant. The tribe of every cell was recovered by classifying it against the
colour that separates each block from the other three, which is what exposed
the block boundaries the width signature alone could not find:

| Cells | Per tribe | Action |
| ----- | --------- | ------ |
| 495–622 | 32 = 8 × 4 | **scratch** — what a brave does when it has stood still too long |
| 623–654 | 8 = 8 × 1 | **hit** — taking a blow, not throwing one |
| 655–718 | 16 = 8 × 2 | **kick** — the wide pale arc is the leg, not a weapon |

The last two were read wrong at first, as a punch and a sword swing, on the
strength of the `punch1`–`punch8` and `swords1`–`swords5` effects. **Sounds are
a weak witness**: they say what noises the screen saver can make, not which
sprite makes them. Both were corrected by the author from watching the
original, who also confirmed the direction sense of all three.

These cells are 29 pixels tall against 26 for the walk, and the legs are
covered rather than bare. A raised arm explains the height; the legwear does
not, and leaves some doubt that this is the same unit as the walk set.

### Deaths, and the rest

- **719–818** is the **soul flying away** when a brave or a firewarrior dies —
  not the ground fires it looks like at a glance. Four blocks of 25 at 719,
  744, 769 and 794. The boundaries came from tribe colour, not from the width
  signature: the first cells of each block carry no colour at all, which is the
  soul before its colour appears.
- **1057–1148** is a **firewarrior punch**, four blocks aligned exactly with
  atlas bands 33 to 36 — not the Armageddon melee it was first taken for. See
  below: each block reads as 23 cells but is really 24.
- **1149–1172** is braves and firewarriors **waving**, three frames per tribe
  for each. Probably unused by the screen saver; grouped so the cells are
  accounted for.

### One cell can hold two poses

The firewarrior punch blocks read as 23 cells each, which divides by neither 8
nor 4. They are really 24: the second cell of every block is **43 pixels wide
where the row is otherwise 21 to 33**, and holds two figures.

**Neither source can separate them.** The native table lists one cell, and the
visual detector merges them too, because the two figures touch and leave no
transparent column to cut on. The offset was read off the column-by-column
opaque pixel count, whose valley falls at local x 21, 22, 23 with counts 2, 1,
2, so the cut goes at 22.

A stream declares that itself, keeping every other cell index stable:

```json
{ "splitSprite": 1058, "at": [22] }
```

Once cut, the block is eight directions × three frames and the reversed
cell-width signature scores exactly on all four tribes. **That is what confirms
the cut** — a hand-placed offset that makes an independent structural check
snap into place is worth more than the eye that placed it.

Sweeping the whole atlas for cells more than 1.6 × their band's median width
turns up only these four as extreme outliers. The milder ones sit in streams
whose signature already scores 0.92 or better, so they are genuinely wide
frames rather than merges.

### Still to identify

**819–896**: 78 particle cells, five pixels tall. One connected component there
is not one frame, so they need handling of their own.

For each, the checks are: where it starts and ends, frame order, direction,
tribe or character type, approximate duration, ground anchor, and any
associated sound. The default anchor is the bottom centre of the rectangle and
must be corrected for sequences that jitter.

Two effects are grouped and have no facing at all: a cyan sparkle at 344–350,
sitting between the two halves of the shaman set, and an expanding orange ring
at 1173–1178, the last cells of the atlas.

Row 27 holds native particle cells. Reverse engineering now maps several
overlapping ranges to the original's conversion debris, fire trail, impact
emitter and embers; see
[research/original-state-map.md](../research/original-state-map.md). There is
still no confirmed code path identifying them as footprints, so the engine
draws footprints procedurally and leaves those cells untouched.
