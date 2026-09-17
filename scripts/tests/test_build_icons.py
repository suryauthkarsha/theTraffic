"""
Tests for scripts/build_icons.py — the app icon and favicon set, drawn from one mark.

Run:  python3 -m unittest discover -s scripts/tests -v

The mark is checked as pixels, the way a browser tab or a search result shows it: every size is
square and the size its file name says; at 16 / 32 / 48 px every pixel is black, orange or a straight
blend of the two (no glow, no other hue); the centre pixel of every size is a junction; the road is
still visible between the junctions at 16 px; the geometry is symmetric under a half turn; and the
.ico really carries its three frames, each identical to the PNG of that size.
"""
from __future__ import annotations

import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

try:
    from PIL import Image, ImageChops

    import build_icons as icons  # noqa: E402

    HAVE_PIL = True
except ImportError:  # pragma: no cover
    HAVE_PIL = False


def black_orange_blend(px: tuple[int, int, int], tol: int = 8) -> bool:
    """True when the pixel lies on the straight line from black to the accent orange."""
    r, g, b = px
    t = r / 255.0
    return abs(g - t * 0x8A) <= tol and abs(b - t * 0x2B) <= tol


def pixels(im: "Image.Image") -> list[tuple[int, int, int]]:
    """Every pixel of an RGB image as a tuple."""
    data = im.tobytes()
    return [(data[i], data[i + 1], data[i + 2]) for i in range(0, len(data), 3)]


@unittest.skipUnless(HAVE_PIL, "Pillow not installed (pip install -r requirements-dev.txt)")
class MarkTests(unittest.TestCase):
    def test_small_sizes_are_black_and_orange_only(self) -> None:
        for size in (16, 32, 48):
            im = icons.draw_mark(size)
            self.assertEqual(im.size, (size, size))
            self.assertEqual(im.mode, "RGB")
            px = pixels(im)
            off = [p for p in px if not black_orange_blend(p)]
            self.assertEqual(off, [], f"{size} px: pixels off the black–orange line")
            self.assertIn(icons.ORANGE, px, f"{size} px: no fully orange pixel")
            self.assertIn(icons.BLACK, px, f"{size} px: no fully black pixel")

    def test_centre_is_a_junction_and_the_off_diagonal_corners_are_canvas(self) -> None:
        for size in sorted(set(icons.PNGS.values())):
            im = icons.draw_mark(size)
            c = size // 2
            self.assertEqual(im.getpixel((c, c)), icons.ORANGE, f"{size} px centre")
            self.assertEqual(im.getpixel((0, 0)), icons.BLACK, f"{size} px top-left")
            self.assertEqual(im.getpixel((size - 1, size - 1)), icons.BLACK, f"{size} px bottom-right")

    def test_road_shows_between_the_junctions_at_16_px(self) -> None:
        im = icons.draw_mark(16)
        spread = icons.metrics(16)["spread"]
        (x0, y0), (x1, y1), _ = icons.nodes(spread)
        mid = (round((x0 + x1) / 2 * 16 - 0.5), round((y0 + y1) / 2 * 16 - 0.5))
        r, _, _ = im.getpixel(mid)
        self.assertGreater(r, 140, f"the road is swallowed by the casings at {mid}")

    def test_geometry_is_symmetric_under_a_half_turn(self) -> None:
        for size in (16, 192):
            m = icons.metrics(size)
            pts = icons.road(m["spread"], m["amplitude"])
            for (x, y), (x2, y2) in zip(pts, reversed(pts)):
                self.assertAlmostEqual(x + x2, 1.0, places=9)
                self.assertAlmostEqual(y + y2, 1.0, places=9)
            a, b, c = icons.nodes(m["spread"])
            self.assertEqual(b, (0.5, 0.5))
            self.assertAlmostEqual(a[0] + c[0], 1.0)
            self.assertAlmostEqual(a[1] + c[1], 1.0)

    def test_build_writes_every_file_at_its_size_and_the_ico_holds_its_frames(self) -> None:
        with tempfile.TemporaryDirectory() as out:
            written = {os.path.basename(p) for p in icons.build(out)}
            self.assertEqual(written, set(icons.PNGS) | {icons.ICO_NAME})
            for name, size in icons.PNGS.items():
                with Image.open(os.path.join(out, name)) as im:
                    self.assertEqual(im.size, (size, size), name)
                    self.assertEqual(im.mode, "RGB", name)
            with Image.open(os.path.join(out, icons.ICO_NAME)) as ico:
                self.assertEqual(sorted(ico.ico.sizes()), [(s, s) for s in sorted(icons.ICO_SIZES)])
                for s in icons.ICO_SIZES:
                    frame = ico.ico.getimage((s, s)).convert("RGB")
                    self.assertEqual(frame.size, (s, s))
                    self.assertIsNone(ImageChops.difference(frame, icons.draw_mark(s)).getbbox(), f"ico {s} px frame")


if __name__ == "__main__":
    unittest.main()
