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

In progress. 160 walk frames are identified and grouped into 40 animations:
five tribe variants, eight directions, four poses per cycle.

Reviewed sequences are described in `research/animation-layout.json` and
compiled with:

```bash
python3 tools/build-sprites.py
```

This writes `assets/data/sprites.json` (canonical), `research/sprites.json`
(same content, for review), `core/js/Animations.js` (importable from QML), and
two review artefacts: `research/walk-cycles.gif` and
`research/direction-check.png`.

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
atlas rows 16 to 19: standing poses with a raised arm and no leg cycle at all.

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

### The rest of the sheet

`research/sprite-groups.json` holds the first visual classification: shamans,
gold and green figures, falls and rolls, fires, particles, combatants, probable
Armageddon sequences and a circular spell effect. None of these are grouped
into named animations yet.

For each sequence still to be reviewed, the checks are: where it starts and
ends, frame order, direction, tribe or character type, approximate duration,
ground anchor, and any associated sound. The default anchor is the bottom
centre of the rectangle and must be corrected for sequences that jitter.

Row 27 holds native particle cells that may be the original's footprints, but
their mapping to tribes and directions is unconfirmed, so the engine draws
footprints procedurally and leaves those cells untouched.
