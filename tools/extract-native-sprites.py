#!/usr/bin/env python3
"""Recover the original 1,180-cell sprite table from the Windows binary."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path

from PIL import Image


FUNCTION_START = 0x405190
FUNCTION_END = 0x40F162
TABLE_BASE = 0x6DB0
TABLE_COUNT_OFFSET = 0xCB70
EXPECTED_COUNT = 0x49C
RECORD_SIZE = 16

INSTRUCTION_RE = re.compile(
    r"^\s*[0-9a-f]+:\s+(?:[0-9a-f]{2}\s+)+\s*([a-z][a-z0-9]*)\s*(.*)$"
)
REGISTER_IMMEDIATE_RE = re.compile(
    r"^(eax|ebx|edx|esi|edi|ebp),0x([0-9a-f]+)$"
)
REGISTER_ZERO_RE = re.compile(r"^(eax|ebx|edx|esi|edi|ebp),\1$")
MEMORY_STORE_RE = re.compile(
    r"^DWORD PTR \[ecx\+0x([0-9a-f]+)\],"
    r"(eax|ebx|edx|esi|edi|ebp|0x[0-9a-f]+)$"
)


def parse_args() -> argparse.Namespace:
    project = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(
        description="Extract the native Populous sprite cells from the .scr file."
    )
    parser.add_argument(
        "--executable",
        type=Path,
        default=project / "original/Populous Screen Saver.scr",
    )
    parser.add_argument(
        "--atlas",
        type=Path,
        default=project / "assets/images/sprites.png",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=project / "research/sprites-native.json",
    )
    parser.add_argument("--objdump", default="objdump")
    return parser.parse_args()


def disassemble(executable: Path, objdump: str) -> str:
    command = [
        objdump,
        "-d",
        "-Mintel",
        f"--start-address=0x{FUNCTION_START:x}",
        f"--stop-address=0x{FUNCTION_END:x}",
        str(executable),
    ]
    try:
        result = subprocess.run(
            command, check=True, capture_output=True, text=True
        )
    except FileNotFoundError as error:
        raise SystemExit(f"objdump was not found: {objdump}") from error
    except subprocess.CalledProcessError as error:
        raise SystemExit(error.stderr.strip() or "objdump failed") from error
    return result.stdout


def recover_assignments(disassembly: str) -> dict[int, int]:
    registers: dict[str, int] = {}
    assignments: dict[int, int] = {}

    for line in disassembly.splitlines():
        instruction = INSTRUCTION_RE.match(line)
        if instruction is None:
            continue
        operation, operands = instruction.groups()

        if operation == "mov":
            register_value = REGISTER_IMMEDIATE_RE.match(operands)
            if register_value is not None:
                register, hexadecimal = register_value.groups()
                registers[register] = int(hexadecimal, 16)
                continue

            memory_store = MEMORY_STORE_RE.match(operands)
            if memory_store is None:
                continue
            offset_hexadecimal, value_operand = memory_store.groups()
            offset = int(offset_hexadecimal, 16)
            if value_operand.startswith("0x"):
                value = int(value_operand, 16)
            else:
                if value_operand not in registers:
                    raise SystemExit(
                        f"Register {value_operand} used before initialization: {line}"
                    )
                value = registers[value_operand]
            assignments[offset] = value
            continue

        if operation == "xor":
            zeroed_register = REGISTER_ZERO_RE.match(operands)
            if zeroed_register is not None:
                registers[zeroed_register.group(1)] = 0

    return assignments


def build_manifest(
    executable: Path,
    atlas_path: Path,
    atlas: Image.Image,
    assignments: dict[int, int],
) -> dict:
    count = assignments.get(TABLE_COUNT_OFFSET)
    if count != EXPECTED_COUNT:
        raise SystemExit(
            f"Unexpected sprite count: {count!r}; expected {EXPECTED_COUNT}"
        )

    frames = []
    valid_frames = 0
    for index in range(count):
        record_offset = TABLE_BASE + index * RECORD_SIZE
        offsets = [record_offset + relative for relative in (0, 4, 8, 12)]
        missing = [offset for offset in offsets if offset not in assignments]
        if missing:
            formatted = ", ".join(f"0x{offset:x}" for offset in missing)
            raise SystemExit(f"Missing table values for sprite {index}: {formatted}")

        width, height, x, y = (assignments[offset] for offset in offsets)
        in_bounds = (
            width > 0
            and height > 0
            and 0 <= x < atlas.width
            and 0 <= y < atlas.height
            and x + width <= atlas.width
            and y + height <= atlas.height
        )
        valid_frames += int(in_bounds)
        frames.append(
            {
                "index": index,
                "id": f"sprite_{index:04d}",
                "source": {
                    "x": x,
                    "y": y,
                    "width": width,
                    "height": height,
                },
                "anchor": {
                    "x": round(width / 2, 2),
                    "y": height,
                    "mode": "bottom-center-provisional",
                },
                "inAtlasBounds": in_bounds,
            }
        )

    return {
        "formatVersion": 1,
        "source": {
            "executable": executable.name,
            "tableInitializerAddress": f"0x{FUNCTION_START:08x}",
            "tableBaseObjectOffset": f"0x{TABLE_BASE:x}",
            "recordLayout": ["width", "height", "x", "y"],
        },
        "atlas": {
            "file": atlas_path.name,
            "width": atlas.width,
            "height": atlas.height,
        },
        "statistics": {
            "records": count,
            "inAtlasBounds": valid_frames,
            "outOfBounds": count - valid_frames,
        },
        "frames": frames,
        "animations": {},
    }


def main() -> None:
    args = parse_args()
    executable = args.executable.resolve()
    atlas_path = args.atlas.resolve()
    if not executable.is_file():
        raise SystemExit(f"Screen saver not found: {executable}")
    if not atlas_path.is_file():
        raise SystemExit(f"Sprite atlas not found: {atlas_path}")

    atlas = Image.open(atlas_path).convert("RGBA")
    assignments = recover_assignments(disassemble(executable, args.objdump))
    manifest = build_manifest(executable, atlas_path, atlas, assignments)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8", newline="\n",
    )

    statistics = manifest["statistics"]
    print(f"Native records: {statistics['records']}")
    print(f"In atlas bounds: {statistics['inAtlasBounds']}")
    print(f"Out of bounds: {statistics['outOfBounds']}")
    print(f"Manifest: {args.output.resolve()}")


if __name__ == "__main__":
    main()
