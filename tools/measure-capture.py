#!/usr/bin/env python3
"""Measure a capture of the original screen saver.

Reads a recording and reports the three things the clean-room simulation has
no other way to learn: how the population grows, how often characters die, and
how large each visual effect is.

The screen saver draws bright sprites on black, so simple colour and size
filters separate what matters:

- **characters** are compact, skin-toned and only moderately saturated;
- **effects** are strongly saturated — cyan for conversion, orange for fire;
- **souls** are the one tall, narrow, bright-yellow thing on screen.

Everything is a proxy rather than a count of engine objects. Crowds merge into
one blob, so populations are under-reported once characters bunch up; the
shape of the curve survives that, the absolute value does not.

Usage:

    python3 tools/measure-capture.py CAPTURE.mp4 --census
    python3 tools/measure-capture.py CAPTURE.mp4 --souls 60 120
    python3 tools/measure-capture.py CAPTURE.mp4 --effects 20 120 --json out.json

Needs OpenCV (`pip install opencv-python`).
"""
import argparse
import json
import sys

try:
    import cv2
    import numpy as np
except ImportError:  # pragma: no cover - depends on the machine, not the code
    sys.exit("This tool needs OpenCV: pip install opencv-python")


EFFECT_HUES = {
    # Conversion sparkles and the Armageddon site spell.
    "cyan": (85, 115),
    # Fire projectiles, impacts and embers.
    "orange": (8, 25),
}


def open_capture(path):
    capture = cv2.VideoCapture(path)
    if not capture.isOpened():
        sys.exit("Cannot open %s" % path)
    return capture, capture.get(cv2.CAP_PROP_FPS)


def largest_blob(mask, dilate=21):
    """Bounding box of the biggest connected region, dilated so that a cloud of
    separate particles reads as one effect rather than fifty."""
    grown = cv2.dilate(mask.astype(np.uint8) * 255,
                       np.ones((dilate, dilate), np.uint8))
    count, _, stats, centroids = cv2.connectedComponentsWithStats(grown)
    if count <= 1:
        return None
    best = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    x, y, width, height, area = stats[best]
    return dict(cx=int(centroids[best][0]), cy=int(centroids[best][1]),
                w=int(width), h=int(height), area=int(area))


def count_characters(image):
    """Number of character-sized skin-toned blobs, and their total area.

    The area is the more honest of the two once a crowd forms: merged
    characters stop adding to the count but keep adding to the area.
    """
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    hue, saturation, value = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]
    body = (value > 120) & (saturation > 25) & (saturation < 190) & (hue < 30)
    body = cv2.morphologyEx(body.astype(np.uint8) * 255, cv2.MORPH_CLOSE,
                            np.ones((7, 7), np.uint8))
    count, _, stats, _ = cv2.connectedComponentsWithStats(body)
    kept = [stats[i, cv2.CC_STAT_AREA] for i in range(1, count)
            if stats[i, cv2.CC_STAT_AREA] >= 25]
    return len(kept), int(sum(kept))


def find_souls(image):
    """Centres of rising souls: tall, narrow, bright yellow flames."""
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    hue, saturation, value = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]
    flame = (hue >= 18) & (hue < 34) & (saturation > 150) & (value > 200)
    flame = cv2.morphologyEx(flame.astype(np.uint8) * 255, cv2.MORPH_CLOSE,
                             np.ones((5, 5), np.uint8))
    count, _, stats, centroids = cv2.connectedComponentsWithStats(flame)
    found = []
    for i in range(1, count):
        _, _, width, height, area = stats[i]
        if area >= 60 and height >= 18 and height > 1.5 * width:
            found.append((int(centroids[i][0]), int(centroids[i][1])))
    return found


def census(path, step_seconds):
    capture, fps = open_capture(path)
    step = max(1, int(round(fps * step_seconds)))
    rows = []
    index = 0
    while True:
        ok, image = capture.read()
        if not ok:
            break
        if index % step == 0:
            blobs, area = count_characters(image)
            rows.append({"t": round(index / fps, 2), "blobs": blobs,
                         "area": area})
        index += 1
    capture.release()
    return rows


def souls(path, start, end):
    """Distinct rising souls between two times.

    A soul is followed frame to frame so that one death counts once: a new
    track is only opened when no existing one is nearby and recent.
    """
    capture, fps = open_capture(path)
    capture.set(cv2.CAP_PROP_POS_FRAMES, int(start * fps))
    tracks = []
    events = 0
    index = int(start * fps)
    while index < int(end * fps):
        ok, image = capture.read()
        if not ok:
            break
        for x, y in find_souls(image):
            match = next((track for track in tracks
                          if abs(track[0] - x) < 40 and abs(track[1] - y) < 90
                          and index - track[2] <= 4), None)
            if match:
                match[0], match[1], match[2] = x, y, index
            else:
                tracks.append([x, y, index])
                events += 1
        tracks = [track for track in tracks if index - track[2] <= 6]
        index += 1
    capture.release()
    return events, end - start


def effects(path, start, end):
    capture, fps = open_capture(path)
    capture.set(cv2.CAP_PROP_POS_FRAMES, int(start * fps))
    rows = []
    index = int(start * fps)
    while index < int(end * fps):
        ok, image = capture.read()
        if not ok:
            break
        hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
        hue, saturation, value = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]
        strong = (saturation > 110) & (value > 120)
        row = {"t": round(index / fps, 3)}
        for name, (low, high) in EFFECT_HUES.items():
            mask = strong & (hue >= low) & (hue < high)
            row[name] = int(mask.sum())
            box = largest_blob(mask)
            if box and box["area"] > 300:
                row[name + "_box"] = box
        # Lightning is the only near-white structure with a large extent.
        white = (saturation < 50) & (value > 225)
        row["white"] = int(white.sum())
        box = largest_blob(white)
        if box and box["area"] > 300:
            row["white_box"] = box
        rows.append(row)
        index += 1
    capture.release()
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("capture")
    parser.add_argument("--census", action="store_true",
                        help="population curve over the whole recording")
    parser.add_argument("--census-step", type=float, default=1.0,
                        help="seconds between census samples (default 1)")
    parser.add_argument("--souls", nargs=2, type=float, metavar=("START", "END"),
                        help="count rising souls between two times")
    parser.add_argument("--effects", nargs=2, type=float,
                        metavar=("START", "END"),
                        help="per-frame effect sizes between two times")
    parser.add_argument("--json", help="write the result as JSON instead of text")
    args = parser.parse_args()

    result = {}
    if args.census:
        result["census"] = census(args.capture, args.census_step)
    if args.souls:
        count, seconds = souls(args.capture, *args.souls)
        result["souls"] = {"count": count, "seconds": seconds,
                           "perSecond": round(count / seconds, 3)}
    if args.effects:
        result["effects"] = effects(args.capture, *args.effects)
    if not result:
        parser.error("choose at least one of --census, --souls, --effects")

    if args.json:
        with open(args.json, "w") as handle:
            json.dump(result, handle)
        print("wrote %s" % args.json)
        return

    if "census" in result:
        print("   t  blobs  bodyarea")
        for row in result["census"]:
            print("%6.1f %6d %9d" % (row["t"], row["blobs"], row["area"]))
    if "souls" in result:
        soul = result["souls"]
        print("%d souls over %.0f s, %.2f per second"
              % (soul["count"], soul["seconds"], soul["perSecond"]))
    if "effects" in result:
        print("     t     cyan  orange   white")
        for row in result["effects"]:
            print("%7.2f %7d %7d %7d"
                  % (row["t"], row["cyan"], row["orange"], row["white"]))


if __name__ == "__main__":
    main()
