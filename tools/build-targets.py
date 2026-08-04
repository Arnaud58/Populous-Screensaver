#!/usr/bin/env python3
"""Assemble a distributable payload for each target from assets/ and core/.

Targets are never stored assembled in the repository. Every shared file lives
exactly once, under assets/ or core/, and is copied into build/ on demand. This
is what keeps the multi-megabyte atlas and sound set from being duplicated per
target.
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

PROJECT = Path(__file__).resolve().parent.parent

# Each entry maps a source directory or file to its destination inside the
# assembled target. Sources are relative to the project root, destinations to
# the target payload root.
PLASMA_LAYOUT = [
    ("targets/plasma/metadata.json", "metadata.json"),
    ("targets/plasma/contents/ui", "contents/ui"),
    ("core/qml", "contents/ui"),
    ("core/js", "contents/ui"),
    ("assets/images", "contents/images"),
    ("assets/data", "contents/data"),
    ("assets/sounds", "contents/sounds"),
    ("assets/sounds-converted", "contents/sounds-converted"),
]

TARGETS = {
    "plasma": {
        "payload": "plasma/org.poptheme.populous",
        "layout": PLASMA_LAYOUT,
        "version_from": "targets/plasma/metadata.json",
    },
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "targets",
        nargs="*",
        default=sorted(TARGETS),
        help="Targets to assemble (default: all known targets)",
    )
    parser.add_argument(
        "--build-dir",
        type=Path,
        default=PROJECT / "build",
        help="Directory receiving the assembled payloads",
    )
    parser.add_argument(
        "--clean",
        action="store_true",
        help="Remove the target payload before assembling it",
    )
    return parser.parse_args()


def copy_entry(source: Path, destination: Path) -> int:
    if not source.exists():
        raise SystemExit(f"Missing source: {source}")

    if source.is_file():
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        return 1

    copied = 0
    for item in sorted(source.rglob("*")):
        if item.is_dir():
            continue
        target_path = destination / item.relative_to(source)
        target_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(item, target_path)
        copied += 1
    return copied


def read_version(relative: str) -> str:
    metadata = json.loads((PROJECT / relative).read_text(encoding="utf-8"))
    return metadata.get("KPlugin", {}).get("Version", "unknown")


def assemble(name: str, build_dir: Path, clean: bool) -> Path:
    target = TARGETS[name]
    payload = build_dir / target["payload"]

    if clean and payload.exists():
        shutil.rmtree(payload)

    total = 0
    for source_relative, destination_relative in target["layout"]:
        total += copy_entry(PROJECT / source_relative, payload / destination_relative)

    version = read_version(target["version_from"])
    print(f"{name}: {total} files -> {payload} (version {version})")
    return payload


def main() -> None:
    args = parse_args()
    unknown = [name for name in args.targets if name not in TARGETS]
    if unknown:
        raise SystemExit(
            "Unknown target(s): "
            + ", ".join(unknown)
            + ". Known targets: "
            + ", ".join(sorted(TARGETS))
        )

    for name in args.targets:
        assemble(name, args.build_dir, args.clean)


if __name__ == "__main__":
    main()
