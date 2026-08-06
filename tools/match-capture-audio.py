#!/usr/bin/env python3
"""Locate the original WAV resources in a screen-capture audio track.

The matcher resamples every resource to the capture rate and computes a
normalised cross-correlation.  Exact-looking matches survive AAC capture well;
similar attack samples and sounds mixed over one another still require review.
"""

from __future__ import annotations

import argparse
import json
import math
import subprocess
import tempfile
import warnings
from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.signal import fftconvolve, find_peaks, resample_poly


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("capture", type=Path, help="video or audio capture")
    parser.add_argument(
        "--sounds",
        type=Path,
        default=Path("assets/sounds"),
        help="directory containing the original WAV resources",
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=0.85,
        help="minimum normalised score recorded as a match (default: 0.85)",
    )
    parser.add_argument("--output", type=Path, help="write JSON here instead of stdout")
    return parser.parse_args()


def read_mono(path: Path) -> tuple[int, np.ndarray]:
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        rate, samples = wavfile.read(path)
    signal = samples.astype(np.float64)
    if signal.ndim == 2:
        signal = signal.mean(axis=1)
    signal -= signal.mean()
    return rate, signal


def resample(signal: np.ndarray, source_rate: int, target_rate: int) -> np.ndarray:
    if source_rate == target_rate:
        return signal
    divisor = math.gcd(source_rate, target_rate)
    return resample_poly(signal, target_rate // divisor, source_rate // divisor)


def match(capture: np.ndarray, resource: np.ndarray) -> np.ndarray:
    numerator = fftconvolve(capture, resource[::-1], mode="valid")
    local_energy = fftconvolve(capture * capture, np.ones(len(resource)), mode="valid")
    denominator = np.sqrt(np.maximum(local_energy, 1.0)) * np.linalg.norm(resource)
    return numerator / np.maximum(denominator, np.finfo(np.float64).eps)


def main() -> int:
    args = parse_args()
    capture_path = args.capture.resolve()
    sounds_path = args.sounds.resolve()
    resources = sorted(sounds_path.glob("*.wav"))
    if not resources:
        raise SystemExit(f"no WAV resources found under {sounds_path}")

    with tempfile.TemporaryDirectory(prefix="populous-audio-") as directory:
        decoded = Path(directory) / "capture.wav"
        subprocess.run(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(capture_path),
                "-map",
                "0:a:0",
                "-ac",
                "1",
                "-ar",
                "48000",
                "-c:a",
                "pcm_s16le",
                str(decoded),
            ],
            check=True,
        )
        capture_rate, capture = read_mono(decoded)

    results = []
    for resource_path in resources:
        resource_rate, resource = read_mono(resource_path)
        resource = resample(resource, resource_rate, capture_rate)
        scores = match(capture, resource)
        separation = max(round(capture_rate * 0.08), len(resource) // 4)
        peaks, properties = find_peaks(scores, height=args.threshold, distance=separation)
        matches = [
            {
                "seconds": round(int(index) / capture_rate, 6),
                "score": round(float(score), 6),
            }
            for index, score in zip(peaks, properties["peak_heights"], strict=True)
        ]
        best_index = int(np.argmax(scores))
        results.append(
            {
                "resource": resource_path.name,
                "durationSeconds": round(len(resource) / capture_rate, 6),
                "best": {
                    "seconds": round(best_index / capture_rate, 6),
                    "score": round(float(scores[best_index]), 6),
                },
                "matches": matches,
            }
        )

    report = {
        "capture": str(capture_path),
        "sampleRate": capture_rate,
        "captureDurationSeconds": round(len(capture) / capture_rate, 6),
        "threshold": args.threshold,
        "method": "normalised FFT cross-correlation; timestamps mark resource starts",
        "resources": results,
    }
    rendered = json.dumps(report, indent=2, ensure_ascii=False) + "\n"
    if args.output:
        args.output.write_text(rendered, encoding="utf-8", newline="\n")
    else:
        print(rendered, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
