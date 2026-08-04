#!/usr/bin/env python3
"""Build the reviewed animation manifest from the native sprite-cell table."""

from __future__ import annotations

import argparse
import json
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

    stats = manifest["statistics"]
    print(f"Animations: {stats['animations']}")
    print(f"Unique source frames: {stats['uniqueSourceFrames']}")
    print(f"Research manifest: {args.research_output.resolve()}")
    print(f"Assets manifest: {args.assets_output.resolve()}")
    print(f"QML manifest: {args.qml_output.resolve()}")
    print(f"Preview: {args.preview.resolve()}")


if __name__ == "__main__":
    main()
