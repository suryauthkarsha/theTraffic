#!/usr/bin/env python3
"""
theTraffic. · Bengaluru — the app icon and the favicon set, drawn from one mark.

The mark is the product's signal route: one sodium-orange road crossing a true-black canvas from the
bottom-left to the top-right, with three junctions on it — each a flat orange disc with a hairline
black casing, exactly as a signal is drawn on the Signal Map (.rork/DESIGN.md: flat colours, no glow,
no gradient, nothing green). Every size is drawn on its own, with the road, the discs and the casing
tuned to the pixel grid, so the mark still reads as a road with three junctions at 16 px in a browser
tab or a search result and keeps its proportions at 1024 px; from 64 px up the road weaves gently
through the junctions and each junction has a faint cross-street, so the discs read as junctions
rather than beads. Written to web/public/:

  favicon.ico             16 · 32 · 48 — three frames, each drawn at its size (never one downsampled)
  favicon-16x16.png · favicon-32x32.png · favicon-48x48.png · favicon.png (32)
  apple-touch-icon.png    180
  icon-192.png · icon-512.png · icon.png (1024)

Search engines want a square icon, 48 px or a multiple of it, reachable by their crawlers; browsers
pick the size they need from the <link rel="icon"> set in web/index.html; the manifest lists 192 ·
512 · 1024. web/src/test/icons.test.ts checks that every declared file exists at its declared size;
scripts/tests/test_build_icons.py checks the drawing.

Usage
  python3 scripts/build_icons.py             # writes every file into web/public/
  python3 scripts/build_icons.py --out DIR   # somewhere else
Needs Pillow (requirements-dev.txt).
"""
from __future__ import annotations

import argparse
import math
import os

from PIL import Image, ImageDraw

BLACK = (0, 0, 0)
ORANGE = (0xFF, 0x8A, 0x2B)  # the one accent
ARTERIAL = (0x33, 0x30, 0x2B)  # the map tint's arterial road

PUBLIC = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web", "public"))

PNGS: dict[str, int] = {
    "favicon-16x16.png": 16,
    "favicon-32x32.png": 32,
    "favicon-48x48.png": 48,
    "favicon.png": 32,
    "apple-touch-icon.png": 180,
    "icon-192.png": 192,
    "icon-512.png": 512,
    "icon.png": 1024,
}
ICO_NAME = "favicon.ico"
ICO_SIZES: tuple[int, ...] = (16, 32, 48)

ALONG = (math.sqrt(0.5), -math.sqrt(0.5))  # the road's direction: bottom-left → top-right (y down)
ACROSS = (math.sqrt(0.5), math.sqrt(0.5))  # across it


def metrics(size: int) -> dict[str, float]:
    """Proportions in pixels (and unit fractions) for a canvas of `size` px.

    Up to 48 px the road and the discs carry a constant so that at 16 px the road is still two pixels
    wide and a junction still a disc rather than a dot, and the junctions spread further apart so
    their casings never touch; the weave and the cross-streets are dropped, they would be mud. From
    64 px up the proportions are fixed: a thinner road under larger junctions.
    """
    if size <= 16:
        # Proofed on the pixel grid (2026-09-13): a 2 px road, 2.1 px discs, and the junctions pushed
        # toward the corners so the road still shows between their casings.
        return {"spread": 0.32, "stroke": 2.0, "radius": 2.1, "casing": 1.0, "amplitude": 0.0, "cross": 0.0}
    if size <= 48:
        return {
            "spread": 0.28 if size <= 32 else 0.26,
            "stroke": 0.07 * size + 1.0,
            "radius": 0.10 * size + 0.6,
            "casing": max(1.0, 0.025 * size),
            "amplitude": 0.0,
            "cross": 0.0,
        }
    return {
        "spread": 0.28,
        "stroke": 0.055 * size,
        "radius": 0.085 * size,
        "casing": 0.02 * size,
        "amplitude": 0.04,
        "cross": 0.17,
    }


def to_xy(u: float, v: float) -> tuple[float, float]:
    """Unit coordinates (x right, y down) of a point `u` along the road's axis and `v` across it."""
    return (0.5 + u * ALONG[0] + v * ACROSS[0], 0.5 + u * ALONG[1] + v * ACROSS[1])


def wavelength(spread: float) -> float:
    """One full weave: the road crosses its axis at the centre junction and at both outer ones."""
    return 2.0 * spread * math.sqrt(2.0)


def nodes(spread: float) -> list[tuple[float, float]]:
    """The three junctions on the diagonal, `spread` from the centre in x and in y."""
    d = spread * math.sqrt(2.0)
    return [to_xy(-d, 0.0), to_xy(0.0, 0.0), to_xy(d, 0.0)]


def road(spread: float, amplitude: float, steps: int = 96) -> list[tuple[float, float]]:
    """The road as a polyline: a gentle sine weave along the diagonal, through all three junctions.

    It runs past the corners (the corner sits 0.707 from the centre) so it leaves the frame; with
    `amplitude` 0 it is the straight diagonal.
    """
    length = wavelength(spread)
    half = 0.80
    pts: list[tuple[float, float]] = []
    for i in range(steps + 1):
        u = -half + 2.0 * half * i / steps
        pts.append(to_xy(u, amplitude * math.sin(2.0 * math.pi * u / length)))
    return pts


def cross_streets(spread: float, amplitude: float, reach: float) -> list[tuple[tuple[float, float], tuple[float, float]]]:
    """One faint street through each junction, square to the road where it crosses."""
    length = wavelength(spread)
    d = spread * math.sqrt(2.0)
    streets = []
    for u in (-d, 0.0, d):
        slope = amplitude * (2.0 * math.pi / length) * math.cos(2.0 * math.pi * u / length)
        norm = math.hypot(slope, 1.0)
        du, dv = -slope / norm, 1.0 / norm
        streets.append((to_xy(u - reach * du, -reach * dv), to_xy(u + reach * du, reach * dv)))
    return streets


def draw_mark(size: int) -> Image.Image:
    """One icon, `size` × `size` px.

    Drawn oversampled with hard edges, then reduced by area averaging, so every pixel is black,
    orange or a straight blend of the two — no ringing, no halo, no glow.
    """
    m = metrics(size)
    k = max(1, min(8, 4096 // size))
    n = size * k
    img = Image.new("RGB", (n, n), BLACK)
    draw = ImageDraw.Draw(img)
    scale = lambda pts: [(x * n, y * n) for x, y in pts]  # noqa: E731
    if m["cross"] > 0:
        for a, b in cross_streets(m["spread"], m["amplitude"], m["cross"]):
            draw.line(scale([a, b]), fill=ARTERIAL, width=max(1, round(0.5 * m["stroke"] * k)))
    draw.line(scale(road(m["spread"], m["amplitude"])), fill=ORANGE, width=max(1, round(m["stroke"] * k)), joint="curve")
    for x, y in nodes(m["spread"]):
        cx, cy = x * n, y * n
        for colour, r in ((BLACK, m["radius"] + m["casing"]), (ORANGE, m["radius"])):
            rr = r * k
            draw.ellipse((cx - rr, cy - rr, cx + rr, cy + rr), fill=colour)
    return img.resize((size, size), Image.Resampling.BOX) if k > 1 else img


def build(out: str = PUBLIC) -> list[str]:
    """Draw and write every file; returns the paths written."""
    os.makedirs(out, exist_ok=True)
    written: list[str] = []
    for name, size in PNGS.items():
        path = os.path.join(out, name)
        draw_mark(size).save(path, format="PNG", optimize=True)
        written.append(path)
    # Pillow keeps only the frames no larger than the first image, so the largest frame leads.
    frames = [draw_mark(s) for s in sorted(ICO_SIZES, reverse=True)]
    path = os.path.join(out, ICO_NAME)
    frames[0].save(
        path,
        format="ICO",
        sizes=[(s, s) for s in ICO_SIZES],
        append_images=frames[1:],
        bitmap_format="bmp",
    )
    written.append(path)
    return written


def main() -> None:
    parser = argparse.ArgumentParser(description="Draw the theTraffic. icon and favicon set.")
    parser.add_argument("--out", default=PUBLIC, help="directory to write into (default: web/public)")
    args = parser.parse_args()
    for path in build(args.out):
        with Image.open(path) as im:
            frames = sorted(im.ico.sizes()) if path.endswith(".ico") else [im.size]
        sizes = " · ".join(f"{w}x{h}" for w, h in frames)
        print(f"{os.path.relpath(path)}  {sizes}  {os.path.getsize(path):,} B")


if __name__ == "__main__":
    main()
