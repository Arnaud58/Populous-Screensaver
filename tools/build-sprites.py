#!/usr/bin/env python3
"""Build the reviewed animation manifest from the native sprite-cell table."""

from __future__ import annotations

import argparse
import json
import math
from copy import deepcopy
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def parse_args() -> argparse.Namespace:
    project = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(
        description="Build the curated Populous animation manifest."
    )
    parser.add_argument(
        "--native",
        type=Path,
        default=project / "research/sprites-native.json",
    )
    parser.add_argument(
        "--layout",
        type=Path,
        default=project / "research/animation-layout.json",
    )
    parser.add_argument(
        "--atlas",
        type=Path,
        default=project / "assets/images/sprites.png",
    )
    parser.add_argument(
        "--research-output",
        type=Path,
        default=project / "research/sprites.json",
    )
    parser.add_argument(
        "--assets-output",
        type=Path,
        default=project / "assets/data/sprites.json",
        help="Canonical manifest consumed by every target",
    )
    parser.add_argument(
        "--qml-output",
        type=Path,
        default=project / "core/js/Animations.js",
        help="Generated JavaScript manifest importable without local-file XHR",
    )
    parser.add_argument(
        "--preview",
        type=Path,
        default=project / "research/walk-cycles.gif",
    )
    parser.add_argument(
        "--direction-check",
        type=Path,
        default=project / "research/direction-check.png",
        help="Compass sheet pairing each animation with its movement vector",
    )
    parser.add_argument(
        "--sheets",
        type=Path,
        default=project / "research/sheets",
        help="Directory receiving the labelled contact sheets of every cell",
    )
    return parser.parse_args()


def read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise SystemExit(f"Required file not found: {path}") from error
    except json.JSONDecodeError as error:
        raise SystemExit(f"Invalid JSON in {path}: {error}") from error


def split_native_frame(frame: dict, cuts: list[int]) -> list[dict]:
    """Cut one native cell into several, at local x offsets.

    Some cells hold two poses. Neither source can separate them: the native
    table lists one 43-pixel cell where the row is otherwise 21 to 33, and the
    visual detector merges them too, because the two figures touch and leave no
    transparent column to cut on. So the offsets are declared by hand, read off
    the column-by-column opaque pixel count, whose valley marks the join.
    """
    source = frame["source"]
    edges = [0] + sorted(cuts) + [source["width"]]
    parts: list[dict] = []

    for index in range(len(edges) - 1):
        width = edges[index + 1] - edges[index]
        if width <= 0:
            raise SystemExit(f"Empty part cutting {frame['id']} at {cuts}")
        parts.append(
            {
                "index": frame["index"],
                # The part keeps the cell it came from ahead of the '#', so
                # coverage still counts the cell exactly once.
                "id": f"{frame['id']}#{index}",
                "source": {
                    "x": source["x"] + edges[index],
                    "y": source["y"],
                    "width": width,
                    "height": source["height"],
                },
                "anchor": {
                    "x": width / 2,
                    "y": source["height"],
                    "mode": "bottom-center-split",
                },
                "inAtlasBounds": frame["inAtlasBounds"],
            }
        )

    return parts


def collect_stream_frames(native: dict, stream: dict) -> list[dict]:
    native_frames = native["frames"]
    collected: list[dict] = []

    for source_range in stream["sourceRanges"]:
        if "splitSprite" in source_range:
            frame = native_frames[source_range["splitSprite"]]
            if not frame["inAtlasBounds"]:
                raise SystemExit(
                    f"Stream {stream['id']} splits an out-of-bounds sprite: "
                    f"{frame['id']}"
                )
            collected.extend(
                deepcopy(split_native_frame(frame, source_range["at"]))
            )
            continue

        first = source_range["firstSprite"]
        count = source_range["frameCount"]
        selected = native_frames[first : first + count]
        if len(selected) != count:
            raise SystemExit(
                f"Stream {stream['id']} requests {count} frames at row "
                f"native index {first}, but only {len(selected)} are available"
            )
        invalid = [frame["id"] for frame in selected if not frame["inAtlasBounds"]]
        if invalid:
            raise SystemExit(
                f"Stream {stream['id']} includes out-of-bounds sprites: "
                + ", ".join(invalid)
            )
        collected.extend(deepcopy(selected))

    return collected


def animation_frame(candidate: dict) -> dict:
    source = candidate["source"]
    return {
        "sourceId": candidate["id"],
        "x": source["x"],
        "y": source["y"],
        "width": source["width"],
        "height": source["height"],
        "anchorX": candidate["anchor"]["x"],
        "anchorY": candidate["anchor"]["y"],
    }


def compile_sequence_stream(native: dict, stream: dict) -> dict[str, dict]:
    """Frames in order, with no direction and optionally no tribe.

    Fires, sparkles and spell effects have no facing at all, and a death has
    one sequence per tribe at most. Forcing them through the directional layout
    would mean inventing eight identical copies of each.
    """
    source_frames = collect_stream_frames(native, stream)
    layout = stream.get("layout", {})
    tribes = layout.get("tribes") or [None]
    per_animation = layout.get("framesPerAnimation") or len(source_frames) // len(tribes)
    expected = len(tribes) * per_animation

    if len(source_frames) != expected:
        raise SystemExit(
            f"Stream {stream['id']} has {len(source_frames)} source frames; "
            f"its layout requires {expected}"
        )

    animations: dict[str, dict] = {}
    for index, tribe in enumerate(tribes):
        frames = source_frames[index * per_animation : (index + 1) * per_animation]
        animation_id = ".".join(
            part for part in (stream["entity"], tribe, stream["action"]) if part
        )
        animations[animation_id] = {
            "entity": stream["entity"],
            "tribe": tribe,
            "action": stream["action"],
            "direction": None,
            "loop": stream["playback"]["loop"],
            "frameDurationMs": stream["playback"]["frameDurationMs"],
            "frames": [animation_frame(frame) for frame in frames],
            "sourceStream": stream["id"],
        }

    return animations


def compile_stream(native: dict, stream: dict) -> dict[str, dict]:
    if stream.get("kind", "directional") == "sequence":
        return compile_sequence_stream(native, stream)

    source_frames = collect_stream_frames(native, stream)
    layout = stream["layout"]
    tribes = layout["tribes"]
    directions = layout["directions"]
    frames_per_animation = layout["framesPerAnimation"]
    expected = len(tribes) * len(directions) * frames_per_animation

    if layout["order"] != ["tribe", "direction", "frame"]:
        raise SystemExit(
            f"Unsupported layout order in stream {stream['id']}: {layout['order']}"
        )
    if len(source_frames) != expected:
        raise SystemExit(
            f"Stream {stream['id']} has {len(source_frames)} source frames; "
            f"its layout requires {expected}"
        )

    animations: dict[str, dict] = {}
    cursor = 0
    for tribe in tribes:
        for direction in directions:
            frames = source_frames[cursor : cursor + frames_per_animation]
            cursor += frames_per_animation
            animation_id = (
                f"{stream['entity']}.{tribe}.{stream['action']}.{direction['id']}"
            )
            animations[animation_id] = {
                "entity": stream["entity"],
                "tribe": tribe,
                "action": stream["action"],
                "direction": {
                    "id": direction["id"],
                    "dx": direction["dx"],
                    "dy": direction["dy"],
                },
                "loop": stream["playback"]["loop"],
                "frameDurationMs": stream["playback"]["frameDurationMs"],
                "frames": [animation_frame(frame) for frame in frames],
                "sourceStream": stream["id"],
            }

    return animations


def compile_manifest(native: dict, layout: dict) -> dict:
    animations: dict[str, dict] = {}
    for stream in layout["streams"]:
        compiled = compile_stream(native, stream)
        duplicate_ids = animations.keys() & compiled.keys()
        if duplicate_ids:
            raise SystemExit(
                "Duplicate animation IDs: " + ", ".join(sorted(duplicate_ids))
            )
        animations.update(compiled)

    return {
        "formatVersion": 1,
        "atlas": {
            "source": "../images/sprites.png",
            "width": native["atlas"]["width"],
            "height": native["atlas"]["height"],
        },
        "coordinateSystem": {
            "origin": "top-left",
            "positiveX": "right",
            "positiveY": "down",
            "anchor": "relative-to-cropped-frame",
        },
        "statistics": {
            "animations": len(animations),
            "uniqueSourceFrames": len(
                {
                    frame["sourceId"]
                    for animation in animations.values()
                    for frame in animation["frames"]
                }
            ),
        },
        "animations": animations,
    }


def sprite_from_frame(atlas: Image.Image, frame: dict) -> Image.Image:
    return atlas.crop(
        (
            frame["x"],
            frame["y"],
            frame["x"] + frame["width"],
            frame["y"] + frame["height"],
        )
    )


def create_walk_preview(
    atlas: Image.Image, manifest: dict, stream: dict, output: Path
) -> None:
    """Animate a whole directional stream: every tribe against every direction.

    A grouping can be plausible in a contact sheet and wrong in motion, so this
    is the artefact that decides whether the frames really form a cycle.
    """
    entity = stream["entity"]
    action = stream["action"]
    tribes = stream["layout"]["tribes"]
    directions = [item["id"] for item in stream["layout"]["directions"]]
    animation_frames = stream["layout"]["framesPerAnimation"]

    # The cell has to fit the tallest sprite in the stream: a shaman or a fire
    # is half again the height of a brave, and a fixed box would clip it.
    stream_frames = [
        frame
        for animation in manifest["animations"].values()
        if animation["sourceStream"] == stream["id"]
        for frame in animation["frames"]
    ]
    if not stream_frames:
        return
    baseline = max(frame["height"] for frame in stream_frames) + 12
    cell_width = max(frame["width"] for frame in stream_frames) * 2 + 24
    cell_height = baseline + 14
    header_height = 20
    label_width = 54
    font = ImageFont.load_default()
    preview_frames: list[Image.Image] = []

    for frame_index in range(animation_frames):
        canvas = Image.new(
            "RGBA",
            (
                label_width + cell_width * len(directions),
                header_height + cell_height * len(tribes),
            ),
            (24, 24, 24, 255),
        )
        draw = ImageDraw.Draw(canvas)
        for column, direction in enumerate(directions):
            draw.text(
                (label_width + column * cell_width + 2, 4),
                direction.replace("_", "\n", 1),
                fill=(120, 220, 255, 255),
                font=font,
            )
        for row, tribe in enumerate(tribes):
            draw.text(
                (4, header_height + row * cell_height + 22),
                tribe,
                fill=(255, 230, 90, 255),
                font=font,
            )
            for column, direction in enumerate(directions):
                animation_id = f"{entity}.{tribe}.{action}.{direction}"
                frame = manifest["animations"][animation_id]["frames"][frame_index]
                sprite = sprite_from_frame(atlas, frame)
                cell_x = label_width + column * cell_width
                cell_y = header_height + row * cell_height
                target_x = cell_x + round(cell_width / 2 - frame["anchorX"])
                target_y = cell_y + baseline - round(frame["anchorY"])
                canvas.alpha_composite(sprite, (target_x, target_y))
                draw.rectangle(
                    (cell_x, cell_y, cell_x + cell_width - 1, cell_y + cell_height - 1),
                    outline=(55, 55, 55, 255),
                )
                draw.line(
                    (cell_x + 4, cell_y + baseline,
                     cell_x + cell_width - 4, cell_y + baseline),
                    fill=(65, 110, 65, 255),
                )
        preview_frames.append(
            canvas.resize(
                (canvas.width * 2, canvas.height * 2), Image.Resampling.NEAREST
            )
        )

    output.parent.mkdir(parents=True, exist_ok=True)
    preview_frames[0].save(
        output,
        save_all=True,
        append_images=preview_frames[1:],
        duration=stream["playback"]["frameDurationMs"],
        loop=0,
        disposal=2,
    )


def create_sequence_preview(
    atlas: Image.Image, manifest: dict, stream: dict, output: Path
) -> None:
    """Animate a non-directional sequence, one row per variant.

    Whether seven cells are one growing sparkle or two unrelated effects is not
    a question a contact sheet answers; playing them is.
    """
    animations = [
        animation
        for animation in manifest["animations"].values()
        if animation["sourceStream"] == stream["id"]
    ]
    if not animations:
        return

    every_frame = [frame for animation in animations for frame in animation["frames"]]
    scale = 4
    cell_width = max(frame["width"] for frame in every_frame) * scale + 20
    baseline = max(frame["height"] for frame in every_frame) * scale + 10
    cell_height = baseline + 12
    steps = max(len(animation["frames"]) for animation in animations)
    pages: list[Image.Image] = []

    for step in range(steps):
        canvas = Image.new(
            "RGBA", (cell_width, cell_height * len(animations)), (16, 16, 20, 255)
        )
        draw = ImageDraw.Draw(canvas)
        for row, animation in enumerate(animations):
            top = row * cell_height
            draw.line(
                (4, top + baseline, cell_width - 4, top + baseline),
                fill=(65, 110, 65, 255),
            )
            frame = animation["frames"][min(step, len(animation["frames"]) - 1)]
            sprite = sprite_from_frame(atlas, frame)
            sprite = sprite.resize(
                (sprite.width * scale, sprite.height * scale), Image.Resampling.NEAREST
            )
            canvas.alpha_composite(
                sprite,
                (
                    (cell_width - sprite.width) // 2,
                    top + baseline - sprite.height,
                ),
            )
        pages.append(canvas)

    output.parent.mkdir(parents=True, exist_ok=True)
    pages[0].save(
        output,
        save_all=True,
        append_images=pages[1:],
        duration=stream["playback"]["frameDurationMs"],
        loop=0,
        disposal=2,
    )


COMPASS_GRID = {
    "north_west": (0, 0),
    "north": (1, 0),
    "north_east": (2, 0),
    "west": (0, 1),
    "east": (2, 1),
    "south_west": (0, 2),
    "south": (1, 2),
    "south_east": (2, 2),
}


def create_direction_check(
    atlas: Image.Image,
    manifest: dict,
    output: Path,
    entity: str = "brave",
    action: str = "walk",
    tribe: str = "blue",
) -> None:
    """Lay every direction out on a compass, next to the vector it moves along.

    Mirror symmetry in the atlas tells you which directions pair up, but not
    which of a pair faces which way. Only seeing the sprite beside its arrow
    settles that. Getting it backwards makes characters moonwalk, and it is
    invisible in a plain contact sheet, so this render is worth regenerating
    whenever the direction order is touched.

    One page per directional stream: the trap is per animation set, not per
    project, and every new set can fall into it independently.
    """
    scale = 6
    # The cell follows the sprites rather than the other way round. A fixed box
    # tuned for braves clips a shaman's headdress and makes four frames of a
    # wide animation overlap, which is exactly the kind of muddle this render
    # exists to avoid.
    page_frames = [
        frame
        for direction_id in COMPASS_GRID
        for frame in manifest["animations"]
        .get(f"{entity}.{tribe}.{action}.{direction_id}", {})
        .get("frames", [])
    ]
    if not page_frames:
        return

    slot_width = max(frame["width"] for frame in page_frames) * scale + 10
    sprite_top = 118
    frames_per_animation = max(
        len(manifest["animations"][key]["frames"])
        for key in (
            f"{entity}.{tribe}.{action}.{direction_id}"
            for direction_id in COMPASS_GRID
        )
        if key in manifest["animations"]
    )
    cell_width = max(340, slot_width * frames_per_animation + 28)
    cell_height = sprite_top + max(frame["height"] for frame in page_frames) * scale + 16
    font = ImageFont.load_default()

    canvas = Image.new("RGBA", (cell_width * 3, cell_height * 3), (16, 16, 20, 255))
    draw = ImageDraw.Draw(canvas)

    for direction_id, (column, row) in COMPASS_GRID.items():
        animation = manifest["animations"].get(
            f"{entity}.{tribe}.{action}.{direction_id}"
        )
        if animation is None:
            continue

        dx = animation["direction"]["dx"]
        dy = animation["direction"]["dy"]
        cell_x, cell_y = column * cell_width, row * cell_height

        draw.rectangle(
            (cell_x, cell_y, cell_x + cell_width - 1, cell_y + cell_height - 1),
            outline=(70, 70, 80, 255),
        )
        draw.text(
            (cell_x + 8, cell_y + 6),
            f"{entity}.{tribe}.{action}   {direction_id}   (dx={dx}, dy={dy})",
            fill=(255, 220, 90, 255),
            font=font,
        )

        # Screen coordinates: positive dy points down.
        length = math.hypot(dx, dy)
        unit_x, unit_y = dx / length, dy / length
        centre_x, centre_y = cell_x + cell_width // 2, cell_y + 62
        arrow_length = 42
        tip_x = centre_x + unit_x * arrow_length
        tip_y = centre_y + unit_y * arrow_length
        draw.line(
            (
                centre_x - unit_x * arrow_length,
                centre_y - unit_y * arrow_length,
                tip_x,
                tip_y,
            ),
            fill=(90, 200, 255, 255),
            width=7,
        )
        for side in (1, -1):
            draw.line(
                (
                    tip_x,
                    tip_y,
                    tip_x - unit_x * 16 + unit_y * 10 * side,
                    tip_y - unit_y * 16 - unit_x * 10 * side,
                ),
                fill=(90, 200, 255, 255),
                width=6,
            )

        for position, frame in enumerate(animation["frames"]):
            sprite = sprite_from_frame(atlas, frame)
            sprite = sprite.resize(
                (sprite.width * scale, sprite.height * scale), Image.Resampling.NEAREST
            )
            canvas.alpha_composite(
                sprite,
                (
                    cell_x + 14 + position * slot_width
                    + (slot_width - 10 - sprite.width) // 2,
                    cell_y + sprite_top,
                ),
            )

    output.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output)


SILHOUETTE_SIZE = (24, 32)

# Each direction against its reflection across the vertical axis. A stream
# assigned to its own mirror is the reversal that made six of eight moonwalk.
MIRRORED_DIRECTION = {
    "south": "south",
    "south_east": "south_west",
    "east": "west",
    "north_east": "north_west",
    "north": "north",
    "north_west": "north_east",
    "west": "east",
    "south_west": "south_east",
}


def silhouettes(atlas: Image.Image, manifest: dict, entity: str, action: str,
                tribe: str) -> dict[str, list[list[int]]]:
    """Alpha masks of one directional set, normalised to a common size."""
    masks: dict[str, list[list[int]]] = {}
    for direction_id in COMPASS_GRID:
        animation = manifest["animations"].get(
            f"{entity}.{tribe}.{action}.{direction_id}"
        )
        if animation is None:
            continue
        masks[direction_id] = [
            list(
                sprite_from_frame(atlas, frame)
                .split()[3]
                .resize(SILHOUETTE_SIZE, Image.Resampling.BILINEAR)
                .getdata()
            )
            for frame in animation["frames"]
        ]
    return masks


def check_direction_sense(
    atlas: Image.Image, manifest: dict, layout: dict, reference: str = "brave_walk"
) -> list[str]:
    """Check a new directional set against one whose sense is already verified.

    The atlas's mirror symmetry pairs directions but cannot say which member of
    a pair faces which way, and getting it backwards makes six of the eight
    moonwalk while every code test still passes. Eyes settled it for the braves,
    at the second attempt.

    Matching silhouettes against the verified set narrows that down, but only
    so far: it scores 7/8 between brave and firewarrior, which have the same
    build, and 3/8 between brave and shaman, whose headdress is half the
    sprite. A low score therefore means nothing on its own.

    What the comparison does catch reliably is the failure that actually
    happens: a whole set assigned to its own mirror, where east matches west
    and north_east matches north_west. That is reported as a reversal and
    fails the build; anything else is printed and left to the eye, since
    research/direction-check-*.png remains the authority.
    """
    streams = {stream["id"]: stream for stream in layout["streams"]}
    if reference not in streams:
        return []

    reference_stream = streams[reference]
    reference_masks = silhouettes(
        atlas,
        manifest,
        reference_stream["entity"],
        reference_stream["action"],
        reference_stream["layout"]["tribes"][0],
    )

    def distance(left: list[list[int]], right: list[list[int]]) -> float:
        pairs = min(len(left), len(right))
        total = sum(
            abs(a - b)
            for index in range(pairs)
            for a, b in zip(left[index], right[index])
        )
        return total / (pairs * SILHOUETTE_SIZE[0] * SILHOUETTE_SIZE[1])

    report: list[str] = []
    for stream_id, stream in streams.items():
        if stream_id == reference or stream.get("kind", "directional") != "directional":
            continue

        # Only compare like with like. An idle pose and a walk cycle have
        # different silhouettes for reasons that have nothing to do with
        # facing, so measuring one against the other says nothing. A pose is
        # checked against its own entity's walk instead, and only a walk
        # against the reference walk is strict enough to fail on.
        same_action = stream["action"] == reference_stream["action"]
        if same_action:
            against, against_masks = reference, reference_masks
        else:
            sibling = next(
                (
                    other
                    for other in streams.values()
                    if other["entity"] == stream["entity"]
                    and other["action"] == reference_stream["action"]
                ),
                None,
            )
            if sibling is None:
                continue
            against = sibling["id"]
            against_masks = silhouettes(
                atlas,
                manifest,
                sibling["entity"],
                sibling["action"],
                sibling["layout"]["tribes"][0],
            )

        candidate = silhouettes(
            atlas,
            manifest,
            stream["entity"],
            stream["action"],
            stream["layout"]["tribes"][0],
        )
        if not candidate or not against_masks:
            continue

        agreed = 0
        mirrored = 0
        for direction_id, mask in against_masks.items():
            best = min(candidate, key=lambda other: distance(mask, candidate[other]))
            if best == direction_id:
                agreed += 1
            elif best == MIRRORED_DIRECTION[direction_id]:
                mirrored += 1

        total = len(against_masks)
        report.append(
            f"{stream_id}: {agreed}/{total} match {against}, {mirrored}/{total} mirrored"
        )
        if mirrored > agreed and mirrored * 2 >= total:
            raise SystemExit(
                f"Stream {stream_id} matches {against} mirrored rather than "
                "straight: its direction order is reversed, which makes six of "
                "the eight moonwalk. Check "
                f"research/direction-check-{stream_id}.png."
            )

    return report


def create_cell_sheets(
    atlas: Image.Image,
    native: dict,
    claimed: set[int],
    output_dir: Path,
    scale: int = 2,
    columns: int = 10,
    rows: int = 10,
) -> list[Path]:
    """Render every native cell in index order, labelled, a page at a time.

    This is the discovery artefact, not a review one: grouping a sequence means
    first seeing which cells sit next to which. Claimed cells are dimmed, so
    what is left to identify reads at a glance.
    """
    frames = [frame for frame in native["frames"] if frame["inAtlasBounds"]]
    cell_width = max(frame["source"]["width"] for frame in frames) * scale + 6
    cell_height = max(frame["source"]["height"] for frame in frames) * scale + 16
    font = ImageFont.load_default()

    output_dir.mkdir(parents=True, exist_ok=True)
    for stale in output_dir.glob("cells-*.png"):
        stale.unlink()

    per_page = columns * rows
    written: list[Path] = []

    for page_start in range(0, len(frames), per_page):
        page = frames[page_start : page_start + per_page]
        canvas = Image.new(
            "RGBA", (cell_width * columns, cell_height * rows), (16, 16, 20, 255)
        )
        draw = ImageDraw.Draw(canvas)

        for position, frame in enumerate(page):
            column = position % columns
            row = position // columns
            box_x = column * cell_width
            box_y = row * cell_height
            is_claimed = frame["index"] in claimed

            draw.rectangle(
                (box_x, box_y, box_x + cell_width - 1, box_y + cell_height - 1),
                fill=(28, 34, 28, 255) if is_claimed else None,
                outline=(60, 60, 70, 255),
            )
            draw.text(
                (box_x + 3, box_y + 2),
                str(frame["index"]),
                fill=(110, 130, 110, 255) if is_claimed else (255, 220, 90, 255),
                font=font,
            )

            sprite = sprite_from_frame(atlas, frame["source"])
            sprite = sprite.resize(
                (sprite.width * scale, sprite.height * scale), Image.Resampling.NEAREST
            )
            canvas.alpha_composite(
                sprite,
                (
                    box_x + (cell_width - sprite.width) // 2,
                    box_y + cell_height - 3 - sprite.height,
                ),
            )

        output = output_dir / f"cells-{page[0]['index']:04d}.png"
        canvas.save(output)
        written.append(output)

    return written


def claimed_indices(manifest: dict, native: dict) -> set[int]:
    """Native indices already grouped into an animation, by source id."""
    by_id = {frame["id"]: frame["index"] for frame in native["frames"]}
    return {
        by_id[frame["sourceId"].split("#")[0]]
        for animation in manifest["animations"].values()
        for frame in animation["frames"]
        if frame["sourceId"].split("#")[0] in by_id
    }


def unclaimed_ranges(claimed: set[int], native: dict) -> list[tuple[int, int]]:
    """Contiguous runs of usable cells no stream has taken."""
    ranges: list[tuple[int, int]] = []
    start = None
    for frame in native["frames"]:
        index = frame["index"]
        free = frame["inAtlasBounds"] and index not in claimed
        if free and start is None:
            start = index
        elif not free and start is not None:
            ranges.append((start, index - 1))
            start = None
    if start is not None:
        ranges.append((start, native["frames"][-1]["index"]))
    return ranges


def main() -> None:
    args = parse_args()
    native = read_json(args.native)
    layout = read_json(args.layout)
    manifest = compile_manifest(native, layout)

    serialized = json.dumps(manifest, indent=2, ensure_ascii=False) + "\n"
    for output in (args.research_output, args.assets_output):
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(serialized, encoding="utf-8")

    args.qml_output.parent.mkdir(parents=True, exist_ok=True)
    args.qml_output.write_text(
        ".pragma library\n\nvar manifest = "
        + json.dumps(manifest, indent=2, ensure_ascii=False)
        + "\n",
        encoding="utf-8",
    )

    atlas = Image.open(args.atlas).convert("RGBA")
    if atlas.size != (manifest["atlas"]["width"], manifest["atlas"]["height"]):
        raise SystemExit(
            f"Atlas dimensions {atlas.size} do not match the native manifest"
        )
    # One page of each review artefact per directional stream. Both traps they
    # guard against are per animation set: a grouping can be wrong in motion
    # only, and a direction order can be reversed in one stream and right in
    # the next.
    reviews: list[Path] = []
    for stream in layout["streams"]:
        if stream.get("kind", "directional") == "sequence":
            preview = args.preview.with_name(f"{stream['id']}.gif")
            create_sequence_preview(atlas, manifest, stream, preview)
            reviews.append(preview)
            continue

        if stream["id"] == "brave_walk":
            preview = args.preview
            check = args.direction_check
        else:
            preview = args.preview.with_name(f"{stream['id']}.gif")
            check = args.direction_check.with_name(
                f"direction-check-{stream['id']}.png"
            )
        create_walk_preview(atlas, manifest, stream, preview)
        create_direction_check(
            atlas,
            manifest,
            check,
            entity=stream["entity"],
            action=stream["action"],
            tribe=stream["layout"]["tribes"][0],
        )
        reviews.extend([preview, check])

    sense = check_direction_sense(atlas, manifest, layout)
    claimed = claimed_indices(manifest, native)
    usable = sum(1 for frame in native["frames"] if frame["inAtlasBounds"])
    sheets = create_cell_sheets(atlas, native, claimed, args.sheets)
    free = unclaimed_ranges(claimed, native)

    stats = manifest["statistics"]
    print(f"Animations: {stats['animations']}")
    print(f"Unique source frames: {stats['uniqueSourceFrames']}")
    print(f"Coverage: {len(claimed)}/{usable} usable cells claimed")
    for line in sense:
        print(f"Direction sense: {line}")
    if free:
        print(
            "Unclaimed: "
            + ", ".join(
                f"{start}" if start == end else f"{start}-{end}" for start, end in free
            )
        )
    print(f"Research manifest: {args.research_output.resolve()}")
    print(f"Assets manifest: {args.assets_output.resolve()}")
    print(f"QML manifest: {args.qml_output.resolve()}")
    for review in reviews:
        print(f"Review: {review.resolve()}")
    print(f"Cell sheets: {len(sheets)} pages in {args.sheets.resolve()}")


if __name__ == "__main__":
    main()
