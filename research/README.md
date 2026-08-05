# Sprite atlas research

`sprites-detected.json` and `sprites-detected.png` are generated files. Rebuild
them from the RGBA atlas with:

```bash
python3 tools/build-atlas.py
```

The detector uses the opaque horizontal guide lines from the original atlas to
find packed rows. Fully transparent column runs then delimit candidate frames.

The output is deliberately conservative: rows and frames are numbered but not
yet assigned gameplay names. Use the annotated PNG to classify coherent
sequences, then record reviewed animations in the top-level `animations` object
of a separate curated manifest. Do not hand-edit the generated JSON because it
will be overwritten on the next run.

`sprite-groups.json` is the first visual classification pass. Its names and row
ranges are review aids, not final animation identifiers. Unlike the detected
manifest, this file is curated and is safe to edit as our understanding of the
original screen saver improves.

`animation-layout.json` describes reviewed continuous frame streams and their
semantic layout. Build the QML-ready manifest and its animated review preview
with:

```bash
python3 tools/build-sprites.py
```

This creates `research/sprites.json`, writes the canonical manifest to
`assets/data/sprites.json`, generates the QML-importable
`core/js/Animations.js`, and renders two review artefacts:
`research/walk-cycles.gif` for the cycles themselves, and
`research/direction-check.png`, which draws each compiled animation beside
the vector it travels along.

Read `direction-check.png` whenever the direction order or a source range
changes. Mirror symmetry in the atlas says which directions pair up but not
which member of a pair faces which way, and no code test can judge sprite
orientation. Getting it backwards makes six of the eight directions
moonwalk, which is invisible in a plain contact sheet.

`sprites-native.json` is recovered from the 1,180-record cell table initialized
by the original executable. Regenerate it with:

```bash
python3 tools/extract-native-sprites.py
```

Prefer the native rectangles when compiling animations: unlike opaque pixel
bounds, they retain the transparent padding chosen by the original author and
therefore keep the character anchor stable. The heuristic detection remains
useful for visual classification and cross-checking.

Rows 0 to 5 are the brave walk cycles: five consecutive blocks of 40 native
cells from sprite 0, one block per tribe colour, each block being 32 walk cells
(8 directions x 4 frames) followed by 8 standing cells. Only the loincloth
carries the tribe colour, and the first block has none, so a naive colour
classifier reports it as uncoloured rather than as a fifth variant.

Rows 16 to 19 look superficially similar but are standing poses with a raised
arm. They contain no leg cycle and must not be used for locomotion.

Known limitations:

- a frame made of visually disconnected parts may produce several candidates;
- touching adjacent frames may produce one candidate;
- the provisional bottom-center anchor may cause jitter in some sequences;
- packed sequences may continue from one atlas row to the next.

Row 27 contains the native 5-pixel-high particle strip. Static analysis now
ties parts of it to effect selectors 2, 3, 5, 7, 8 and 9; the ranges and call
chains are recorded in [original-state-map.md](original-state-map.md). The
cells overlap in ways that do not fit the current one-frame-per-component
pipeline, so they remain uncompiled. The QML prototype continues to use a
procedural pixel footprint until that representation is implemented.
