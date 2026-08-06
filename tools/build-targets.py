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
    ("targets/plasma/contents/config", "contents/config"),
    ("targets/plasma/contents/ui", "contents/ui"),
    ("core/qml", "contents/ui"),
    ("core/js", "contents/ui"),
    ("assets/images", "contents/images"),
    ("assets/data", "contents/data"),
    ("assets/sounds", "contents/sounds"),
    ("assets/sounds-converted", "contents/sounds-converted"),
]

# The windowed preview. Same engine, no Plasma and no compiler: it runs under
# the plain `qml` runtime on any platform Qt supports. Sounds are left out
# until a target actually plays them.
PREVIEW_LAYOUT = [
    ("targets/preview/main.qml", "ui/main.qml"),
    ("core/qml", "ui"),
    ("core/js", "ui"),
    ("assets/images", "images"),
    ("assets/data", "data"),
]

# The standalone application, which becomes the Windows .scr. Everything it
# renders is compiled into the executable through a generated resources.qrc, so
# the binary does not depend on files sitting next to it.
QT_APP_LAYOUT = [
    ("targets/qt-app/CMakeLists.txt", "CMakeLists.txt"),
    ("targets/qt-app/main.cpp", "main.cpp"),
    ("targets/qt-app/populous.rc.in", "populous.rc.in"),
    ("targets/qt-app/install-windows.ps1", "install-windows.ps1"),
    ("targets/qt-app/main.qml", "ui/main.qml"),
    ("targets/qt-app/ConfigDialog.qml", "ui/ConfigDialog.qml"),
    ("targets/qt-app/DismissArea.qml", "ui/DismissArea.qml"),
    ("core/qml", "ui"),
    ("core/js", "ui"),
    ("assets/images", "images"),
    ("assets/data", "data"),
]

TARGETS = {
    "plasma": {
        "payload": "plasma/org.poptheme.populous",
        "layout": PLASMA_LAYOUT,
        "version_from": "targets/plasma/metadata.json",
    },
    "preview": {
        "payload": "preview",
        "layout": PREVIEW_LAYOUT,
    },
    "qt-app": {
        "payload": "qt-app",
        "layout": QT_APP_LAYOUT,
        # Everything under these directories is embedded in the binary.
        "qrc": {"output": "resources.qrc", "directories": ["ui", "images", "data"]},
        # The Plasma metadata stays the single place a version number is
        # written; CMake reads it back from the generated file.
        "version_from": "targets/plasma/metadata.json",
        "version_cmake": "version.cmake",
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


def write_qrc(payload: Path, spec: dict) -> int:
    """Emit a Qt resource file listing everything under the given directories.

    Paths are relative to the payload root and keep their directory prefix, so
    `ui/main.qml` is reachable as `qrc:/ui/main.qml` and the relative lookups
    inside the QML — `../images/sprites.png` — resolve unchanged.
    """
    entries: list[str] = []
    for directory in spec["directories"]:
        root = payload / directory
        if not root.exists():
            continue
        for item in sorted(root.rglob("*")):
            if item.is_file():
                entries.append(item.relative_to(payload).as_posix())

    lines = ['<!DOCTYPE RCC><RCC version="1.0">', '  <qresource prefix="/">']
    lines.extend(f"    <file>{entry}</file>" for entry in entries)
    lines.extend(["  </qresource>", "</RCC>", ""])

    (payload / spec["output"]).write_text("\n".join(lines), encoding="utf-8", newline="\n")
    return len(entries)


def write_version_cmake(payload: Path, output: str, version: str) -> None:
    """Hand the version to CMake, which needs it before project() runs.

    A screen saver's displayed name comes from its version resource, so the
    number has to reach the compiler. Writing it here keeps metadata.json the
    only file where it is maintained by hand.
    """
    (payload / output).write_text(
        "# Generated by tools/build-targets.py. Do not edit.\n"
        f'set(POPULOUS_VERSION "{version}")\n',
        encoding="utf-8", newline="\n",
    )


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

    details = []
    if "qrc" in target:
        details.append(f"{write_qrc(payload, target['qrc'])} embedded")
    if "version_from" in target:
        version = read_version(target["version_from"])
        if "version_cmake" in target:
            write_version_cmake(payload, target["version_cmake"], version)
        details.append(f"version {version}")

    suffix = f" ({', '.join(details)})" if details else ""
    print(f"{name}: {total} files -> {payload}{suffix}")
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
