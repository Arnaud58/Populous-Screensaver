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

This creates `research/sprites.json`, copies the same manifest to
`package/contents/data/sprites.json`, generates the QML-importable
`package/contents/ui/Animations.js`, and renders `research/walk-cycles.gif`.

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

Row 27 contains the native 5-pixel-high particle strip. Its cells include
several colour families and shrinking shapes consistent with trail effects,
but their exact mapping to tribes, directions and effect types is not yet
confirmed. The QML prototype therefore uses a procedural pixel footprint and
keeps these native cells untouched until that mapping is verified.
