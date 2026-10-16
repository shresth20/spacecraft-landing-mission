"""Cut the flight joystick out of assets/images/new/contoller.png.

The drawing holds the two pieces side by side -- the ring the stick
sits in on the left, the knob with its four arrows on the right --
on a checkerboard that is PAINTED IN (the file has no alpha). Both
pieces are round, so each is cut along its own coast:

  traced    along every degree round the piece's centre, the farthest
            pixel that is still saturated paint -- the checkerboard is
            grey and white, so saturation alone tells the two apart --
            smoothed, and drawn in a pixel and a half so none of the
            checkerboard blended into the rim comes with it
  masked    an anti-aliased mask along that trace (4x supersampled,
            1.2px feather), so the rim reads round at any size
  framed    centred on a square canvas and saved as webp

Writes "Joystick base.webp" and "Joystick knob.webp" into
assets/images, the two pieces js/pages.js builds the stick from.
Run tools/build_manifest.py after it.

Needs Pillow, NumPy and SciPy.
"""

import os

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets", "images", "new", "contoller.png")
OUT = os.path.join(ROOT, "assets", "images")

# (name, centre x, centre y, rough radius, output px) -- read off the
# drawing: the centres are the middle of each piece's painted box
PIECES = [
    ("Joystick base", 412.0, 369.5, 361, 640),
    ("Joystick knob", 1140.0, 397.0, 278, 480),
]

SOLID = 0.55     # saturation above which a pixel is paint
INSET = 1.5      # px the cut is drawn in from the traced coast
FEATHER = 1.2    # px of soft edge
PAD = 4          # px of clear canvas round the piece


def trace(solid, cx, cy, rguess):
    h, w = solid.shape
    rs = []
    for a in np.arange(0, 360, 1.0):
        t = np.radians(a)
        r = np.arange(rguess * .8, rguess * 1.1, .25)
        x = np.round(cx + r * np.cos(t)).astype(int)
        y = np.round(cy + r * np.sin(t)).astype(int)
        ok = (x >= 0) & (x < w) & (y >= 0) & (y < h)
        hit = np.zeros_like(r, bool)
        hit[ok] = solid[y[ok], x[ok]]
        rs.append(r[hit].max() if hit.any() else rguess)
    rs = ndimage.median_filter(np.array(rs), 9, mode="wrap")
    return ndimage.uniform_filter1d(rs, 7, mode="wrap") - INSET


def cut(img, solid, name, cx, cy, rguess, size):
    h, w = solid.shape
    rs = trace(solid, cx, cy, rguess)

    R = rs.max() + INSET + PAD
    L, T = int(np.floor(cx - R)), int(np.floor(cy - R))
    S = int(np.ceil(2 * R)) + 1
    crop = np.zeros((S, S, 3), np.float32)
    sx0, sy0 = max(0, L), max(0, T)
    sx1, sy1 = min(w, L + S), min(h, T + S)
    crop[sy0 - T:sy1 - T, sx0 - L:sx1 - L] = img[sy0:sy1, sx0:sx1]

    ss = 4
    yy, xx = np.mgrid[0:S * ss, 0:S * ss].astype(np.float32)
    px = (xx + .5) / ss + L - .5 - cx
    py = (yy + .5) / ss + T - .5 - cy
    ang = np.degrees(np.arctan2(py, px)) % 360
    i0 = np.floor(ang).astype(int) % 360
    f = ang - np.floor(ang)
    edge = rs[i0] * (1 - f) + rs[(i0 + 1) % 360] * f
    m = np.clip((edge - np.hypot(px, py)) / FEATHER + .5, 0, 1)
    m = m.reshape(S, ss, S, ss).mean((1, 3))

    rgba = np.dstack([crop, m * 255]).clip(0, 255).astype(np.uint8)
    out = Image.fromarray(rgba).resize((size, size), Image.LANCZOS)
    path = os.path.join(OUT, name + ".webp")
    out.save(path, "WEBP", quality=90, method=6)
    print("%-14s r %.1f-%.1f px  ->  %s" % (name, rs.min(), rs.max(),
                                           os.path.relpath(path, ROOT)))


def main():
    img = np.asarray(Image.open(SRC).convert("RGB")).astype(np.float32)
    mx, mn = img.max(2), img.min(2)
    solid = (mx - mn) / np.maximum(mx, 1) > SOLID
    for name, cx, cy, r, size in PIECES:
        cut(img, solid, name, cx, cy, r, size)


if __name__ == "__main__":
    main()
