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
    return parser.parse_args()


def read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise SystemExit(f"Required file not found: {path}") from error
    except json.JSONDecodeError as error:
        raise SystemExit(f"Invalid JSON in {path}: {error}") from error


def collect_stream_frames(native: dict, stream: dict) -> list[dict]:
    native_frames = native["frames"]
    collected: list[dict] = []

    for source_range in stream["sourceRanges"]:
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


def compile_stream(native: dict, stream: dict) -> dict[str, dict]:
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
    atlas: Image.Image, manifest: dict, layout: dict, output: Path
) -> None:
    stream = next(
        (item for item in layout["streams"] if item["id"] == "brave_walk"), None
    )
    if stream is None:
        return

    tribes = stream["layout"]["tribes"]
    directions = [item["id"] for item in stream["layout"]["directions"]]
    animation_frames = stream["layout"]["framesPerAnimation"]
    cell_width = 72
    cell_height = 62
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
                animation_id = f"brave.{tribe}.walk.{direction}"
                frame = manifest["animations"][animation_id]["frames"][frame_index]
                sprite = sprite_from_frame(atlas, frame)
                cell_x = label_width + column * cell_width
                cell_y = header_height + row * cell_height
                target_x = cell_x + round(cell_width / 2 - frame["anchorX"])
                target_y = cell_y + 48 - round(frame["anchorY"])
                canvas.alpha_composite(sprite, (target_x, target_y))
                draw.rectangle(
                    (cell_x, cell_y, cell_x + cell_width - 1, cell_y + cell_height - 1),
                    outline=(55, 55, 55, 255),
                )
                draw.line(
                    (cell_x + 4, cell_y + 48, cell_x + cell_width - 4, cell_y + 48),
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


def create_direction_check(atlas: Image.Image, manifest: dict, output: Path) -> None:
    """Lay every direction out on a compass, next to the vector it moves along.

    Mirror symmetry in the atlas tells you which directions pair up, but not
    which of a pair faces which way. Only seeing the sprite beside its arrow
    settles that. Getting it backwards makes characters moonwalk, and it is
    invisible in a plain contact sheet, so this render is worth regenerating
    whenever the direction order is touched.
    """
    tribe = "blue"
    scale = 6
    cell_width, cell_height = 340, 300
    font = ImageFont.load_default()

    canvas = Image.new("RGBA", (cell_width * 3, cell_height * 3), (16, 16, 20, 255))
    draw = ImageDraw.Draw(canvas)

    for direction_id, (column, row) in COMPASS_GRID.items():
        animation = manifest["animations"].get(f"brave.{tribe}.walk.{direction_id}")
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
            f"{direction_id}   (dx={dx}, dy={dy})",
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
                    cell_x + 14 + position * 80 + (70 - sprite.width) // 2,
                    cell_y + 118,
                ),
            )

    output.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output)


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
    create_walk_preview(atlas, manifest, layout, args.preview)
    create_direction_check(atlas, manifest, args.direction_check)

    stats = manifest["statistics"]
    print(f"Animations: {stats['animations']}")
    print(f"Unique source frames: {stats['uniqueSourceFrames']}")
    print(f"Research manifest: {args.research_output.resolve()}")
    print(f"Assets manifest: {args.assets_output.resolve()}")
    print(f"QML manifest: {args.qml_output.resolve()}")
    print(f"Preview: {args.preview.resolve()}")
    print(f"Direction check: {args.direction_check.resolve()}")


if __name__ == "__main__":
    main()
