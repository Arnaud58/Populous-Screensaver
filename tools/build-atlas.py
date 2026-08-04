#!/usr/bin/env python3
"""Detect candidate frames in the Populous screen saver sprite atlas.

The original atlas uses opaque horizontal guide lines to separate packed rows.
Within each row, fully transparent columns delimit most individual frames.  This
script records those candidates without guessing animation names too early and
creates an annotated image for the manual classification pass.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


@dataclass(frozen=True)
class Rectangle:
    x: int
    y: int
    width: int
    height: int

    @property
    def right(self) -> int:
        return self.x + self.width

    @property
    def bottom(self) -> int:
        return self.y + self.height

    def as_dict(self) -> dict[str, int]:
        return {
            "x": self.x,
            "y": self.y,
            "width": self.width,
            "height": self.height,
        }


def parse_args() -> argparse.Namespace:
    script_dir = Path(__file__).resolve().parent
    project_dir = script_dir.parent

    parser = argparse.ArgumentParser(
        description="Detect and annotate frames in the Populous sprite atlas."
    )
    parser.add_argument(
        "--atlas",
        type=Path,
        default=project_dir / "assets/images/sprites.png",
        help="RGBA sprite atlas generated from the original BMP and mask",
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=project_dir / "research/sprites-detected.json",
        help="JSON manifest to create",
    )
    parser.add_argument(
        "--preview",
        type=Path,
        default=project_dir / "research/sprites-detected.png",
        help="Annotated PNG to create",
    )
    parser.add_argument(
        "--alpha-threshold",
        type=int,
        default=8,
        help="Pixels with a greater alpha value are considered opaque",
    )
    parser.add_argument(
        "--guide-coverage",
        type=float,
        default=0.95,
        help="Minimum occupied fraction for a row to be an atlas guide",
    )
    parser.add_argument(
        "--preview-scale",
        type=int,
        default=2,
        help="Integer scale of the annotated preview",
    )
    return parser.parse_args()


def occupied_alpha(alpha: Image.Image, threshold: int) -> Image.Image:
    return alpha.point(lambda value: 255 if value > threshold else 0, mode="1")


def occupied_count(binary_alpha: Image.Image, box: tuple[int, int, int, int]) -> int:
    histogram = binary_alpha.crop(box).histogram()
    return histogram[255] if len(histogram) > 255 else 0


def contiguous_runs(values: list[int]) -> list[tuple[int, int]]:
    if not values:
        return []

    runs: list[tuple[int, int]] = []
    start = previous = values[0]
    for value in values[1:]:
        if value != previous + 1:
            runs.append((start, previous))
            start = value
        previous = value
    runs.append((start, previous))
    return runs


def find_guides(
    binary_alpha: Image.Image, guide_coverage: float
) -> list[tuple[int, int]]:
    width, height = binary_alpha.size
    required_pixels = int(width * guide_coverage)
    guide_rows = [
        y
        for y in range(height)
        if occupied_count(binary_alpha, (0, y, width, y + 1)) >= required_pixels
    ]
    return contiguous_runs(guide_rows)


def find_bands(
    binary_alpha: Image.Image, guide_runs: list[tuple[int, int]]
) -> list[Rectangle]:
    width, height = binary_alpha.size
    bands: list[Rectangle] = []
    previous_guide_end = -1

    for guide_start, guide_end in [*guide_runs, (height, height)]:
        area_start = previous_guide_end + 1
        area_end = guide_start
        previous_guide_end = guide_end
        if area_start >= area_end:
            continue

        content_box = binary_alpha.crop((0, area_start, width, area_end)).getbbox()
        if content_box is None:
            continue

        bands.append(
            Rectangle(
                x=0,
                y=area_start + content_box[1],
                width=width,
                height=content_box[3] - content_box[1],
            )
        )

    return bands


def find_frames(binary_alpha: Image.Image, band: Rectangle) -> list[Rectangle]:
    occupied_columns = [
        x
        for x in range(band.x, band.right)
        if occupied_count(
            binary_alpha,
            (x, band.y, x + 1, band.bottom),
        )
        > 0
    ]

    frames: list[Rectangle] = []
    for start_x, end_x in contiguous_runs(occupied_columns):
        content_box = binary_alpha.crop(
            (start_x, band.y, end_x + 1, band.bottom)
        ).getbbox()
        if content_box is None:
            continue
        frames.append(
            Rectangle(
                x=start_x,
                y=band.y + content_box[1],
                width=end_x - start_x + 1,
                height=content_box[3] - content_box[1],
            )
        )
    return frames


def frame_record(row_index: int, frame_index: int, frame: Rectangle) -> dict:
    return {
        "id": f"row_{row_index:02d}_frame_{frame_index:02d}",
        "source": frame.as_dict(),
        "anchor": {
            "x": round(frame.width / 2, 2),
            "y": frame.height,
            "mode": "bottom-center-provisional",
        },
        "classification": "unclassified",
    }


def create_manifest(
    atlas_path: Path,
    atlas: Image.Image,
    guide_runs: list[tuple[int, int]],
    bands: list[Rectangle],
    frames_by_band: list[list[Rectangle]],
    alpha_threshold: int,
    guide_coverage: float,
) -> dict:
    rows = []
    total_frames = 0
    for row_index, (band, frames) in enumerate(zip(bands, frames_by_band)):
        rows.append(
            {
                "id": f"row_{row_index:02d}",
                "bounds": band.as_dict(),
                "status": "needs-manual-classification",
                "frames": [
                    frame_record(row_index, frame_index, frame)
                    for frame_index, frame in enumerate(frames)
                ],
            }
        )
        total_frames += len(frames)

    return {
        "formatVersion": 1,
        "atlas": {
            "file": atlas_path.name,
            "width": atlas.width,
            "height": atlas.height,
            "pixelFormat": "RGBA",
        },
        "detection": {
            "method": "horizontal-guides-and-transparent-column-runs",
            "alphaThreshold": alpha_threshold,
            "guideCoverage": guide_coverage,
            "limitations": [
                "A multi-part frame can be detected as several candidates.",
                "Adjacent touching frames can be detected as one candidate.",
                "Animation names and frame order require manual classification.",
                "Bottom-center anchors are provisional and may need adjustment.",
            ],
        },
        "statistics": {
            "guideRuns": len(guide_runs),
            "rows": len(rows),
            "candidateFrames": total_frames,
        },
        "guides": [
            {"y": start, "height": end - start + 1}
            for start, end in guide_runs
        ],
        "rows": rows,
        "animations": {},
    }


def create_preview(
    atlas: Image.Image,
    bands: list[Rectangle],
    frames_by_band: list[list[Rectangle]],
    scale: int,
) -> Image.Image:
    preview = atlas.copy().convert("RGBA")
    background = Image.new("RGBA", atlas.size, (24, 24, 24, 255))
    background.alpha_composite(preview)
    draw = ImageDraw.Draw(background)
    font = ImageFont.load_default()

    for row_index, (band, frames) in enumerate(zip(bands, frames_by_band)):
        draw.rectangle(
            (band.x, band.y, band.right - 1, band.bottom - 1),
            outline=(0, 220, 255, 255),
            width=1,
        )
        draw.text(
            (2, band.y + 1),
            f"R{row_index:02d}",
            fill=(0, 220, 255, 255),
            font=font,
            stroke_width=1,
            stroke_fill=(0, 0, 0, 255),
        )
        for frame_index, frame in enumerate(frames):
            draw.rectangle(
                (frame.x, frame.y, frame.right - 1, frame.bottom - 1),
                outline=(255, 75, 75, 255),
                width=1,
            )
            draw.text(
                (frame.x, max(band.y, frame.y - 8)),
                str(frame_index),
                fill=(255, 235, 80, 255),
                font=font,
                stroke_width=1,
                stroke_fill=(0, 0, 0, 255),
            )

    if scale == 1:
        return background
    return background.resize(
        (background.width * scale, background.height * scale),
        Image.Resampling.NEAREST,
    )


def main() -> None:
    args = parse_args()
    atlas_path = args.atlas.resolve()
    if not atlas_path.is_file():
        raise SystemExit(f"Sprite atlas not found: {atlas_path}")
    if not 0 <= args.alpha_threshold <= 254:
        raise SystemExit("--alpha-threshold must be between 0 and 254")
    if not 0 < args.guide_coverage <= 1:
        raise SystemExit("--guide-coverage must be greater than 0 and at most 1")
    if args.preview_scale < 1:
        raise SystemExit("--preview-scale must be at least 1")

    atlas = Image.open(atlas_path).convert("RGBA")
    binary_alpha = occupied_alpha(atlas.getchannel("A"), args.alpha_threshold)
    guide_runs = find_guides(binary_alpha, args.guide_coverage)
    bands = find_bands(binary_alpha, guide_runs)
    frames_by_band = [find_frames(binary_alpha, band) for band in bands]

    manifest = create_manifest(
        atlas_path,
        atlas,
        guide_runs,
        bands,
        frames_by_band,
        args.alpha_threshold,
        args.guide_coverage,
    )
    preview = create_preview(atlas, bands, frames_by_band, args.preview_scale)

    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    args.preview.parent.mkdir(parents=True, exist_ok=True)
    args.manifest.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    preview.save(args.preview)

    stats = manifest["statistics"]
    print(f"Atlas: {atlas.width}x{atlas.height}")
    print(f"Guide runs: {stats['guideRuns']}")
    print(f"Detected rows: {stats['rows']}")
    print(f"Candidate frames: {stats['candidateFrames']}")
    print(f"Manifest: {args.manifest.resolve()}")
    print(f"Preview: {args.preview.resolve()}")


if __name__ == "__main__":
    main()
