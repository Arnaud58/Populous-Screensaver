#!/usr/bin/env python3
"""Build the reviewed animation manifest from detected atlas frames."""

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
        "--detected",
        type=Path,
        default=project / "research/sprites-detected.json",
    )
    parser.add_argument(
        "--layout",
        type=Path,
        default=project / "research/animation-layout.json",
    )
    parser.add_argument(
        "--atlas",
        type=Path,
        default=project / "package/contents/images/sprites.png",
    )
    parser.add_argument(
        "--research-output",
        type=Path,
        default=project / "research/sprites.json",
    )
    parser.add_argument(
        "--package-output",
        type=Path,
        default=project / "package/contents/data/sprites.json",
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


def collect_stream_frames(detected: dict, stream: dict) -> list[dict]:
    rows = detected["rows"]
    collected: list[dict] = []

    for segment in stream["sourceSegments"]:
        row_index = segment["row"]
        first = segment["firstFrame"]
        count = segment["frameCount"]
        if row_index < 0 or row_index >= len(rows):
            raise SystemExit(f"Invalid row {row_index} in stream {stream['id']}")
        row_frames = rows[row_index]["frames"]
        selected = row_frames[first : first + count]
        if len(selected) != count:
            raise SystemExit(
                f"Stream {stream['id']} requests {count} frames at row "
                f"{row_index}:{first}, but only {len(selected)} are available"
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


def compile_stream(detected: dict, stream: dict) -> dict[str, dict]:
    source_frames = collect_stream_frames(detected, stream)
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


def compile_manifest(detected: dict, layout: dict) -> dict:
    animations: dict[str, dict] = {}
    for stream in layout["streams"]:
        compiled = compile_stream(detected, stream)
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
            "width": detected["atlas"]["width"],
            "height": detected["atlas"]["height"],
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
    detected = read_json(args.detected)
    layout = read_json(args.layout)
    manifest = compile_manifest(detected, layout)

    serialized = json.dumps(manifest, indent=2, ensure_ascii=False) + "\n"
    for output in (args.research_output, args.package_output):
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(serialized, encoding="utf-8")

    atlas = Image.open(args.atlas).convert("RGBA")
    if atlas.size != (manifest["atlas"]["width"], manifest["atlas"]["height"]):
        raise SystemExit(
            f"Atlas dimensions {atlas.size} do not match the detected manifest"
        )
    create_walk_preview(atlas, manifest, layout, args.preview)

    stats = manifest["statistics"]
    print(f"Animations: {stats['animations']}")
    print(f"Unique source frames: {stats['uniqueSourceFrames']}")
    print(f"Research manifest: {args.research_output.resolve()}")
    print(f"Package manifest: {args.package_output.resolve()}")
    print(f"Preview: {args.preview.resolve()}")


if __name__ == "__main__":
    main()
