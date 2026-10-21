"""Cut the flown crafts out of assets/images/new and measure them.

Every landing in the mission is flown by hand (js/pilot.js), so every
craft is drawn bare -- the hull alone, no nozzle and no painted
exhaust -- and the four nozzles and their burns are built round it
(thrustersHTML in js/pages.js). The artwork for those hulls arrives on
a black ground, so each one is:

  keyed     the black that reaches the canvas edge is the ground and
            goes transparent, softly at the coast; the dark panel seams
            and the porthole ring INSIDE the hull are never touched,
            because only ground connected to the border is keyed
  framed    cropped to the hull and centred on a square canvas, with
            the hull's longer side at FRAME of it -- the same framing
            "square-craft.webp" was given, so all six crafts hang
            their nozzles with the same room round them
  measured  everything the page needs to know about it, off its own
            alpha channel:
              fill     per cent of the canvas the hull covers
              cx, cy   its centre of area
              hull     its painted extent, l t r b, per cent
              poly     its corners, per cent -- the convex hull of the
                       mask fitted to the shape's own corner count,
                       each side a line fitted to the middle of that
                       side, so a bevelled corner does not pull it in
              noz      where each nozzle is hung, t r b l: on the line
                       through the centre of area, at the coast, moved
                       in until the hull is wide enough there to hide
                       the bell's flange

Prints the table the CRAFT entries in js/pages.js are written from.

TWO OF THE SOURCE FILES ARE MISNAMED, the same two as last time:
"parallelogram-craft.png" is drawn as a trapezium (its rows widen
top to bottom) and "trapezium-craft.png" as a parallelogram (every
row the same width, sheared sideways). The output is named after
what each one IS, so nothing downstream has to cross them over.

The square is measured but not written: "square-craft.webp" was cut
from the same drawing before this tool existed, and the page's
figures for it are that file's. Its row here is the check that this
tool agrees with it. The triangle's craft is no longer cut: its round
was taken out of the mission on 2026-10-21 (its island stays, as a
decoy on the shape question).

    python3 tools/build_crafts.py
    python3 tools/build_manifest.py

Dev tooling only (Pillow, NumPy, SciPy): not needed at runtime.
"""
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from scipy.spatial import ConvexHull

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets", "images", "new")
OUT = os.path.join(ROOT, "assets", "images")

# source file -> (the shape it is drawn as, corners, output file or None)
CRAFTS = [
    ("square-craft.png", "square", 4, None),
    ("rectangle-craft.png", "rectangle", 4, "rectangle-craft.webp"),
    ("trapezium-craft.png", "parallelogram", 4, "parallelogram-craft.webp"),
    ("parallelogram-craft.png", "trapezium", 4, "trapezium-craft.webp"),
    ("rhombus-craft.png", "rhombus", 4, "rhombus-craft.webp"),
]

SIZE = 800           # px, the canvas written out
FRAME = 0.64         # the hull's longer side, as a share of the canvas

GROUND = 20          # max(r, g, b) at or under this, touching the border, is ground
SOFT = (4, 36)       # the coast's ramp: max(r, g, b) from transparent to solid
BAND = 3             # px either side of the ground the ramp is applied in

# the nozzle, as css/pilot.css draws it: 21% of the square's box wide,
# and that box is 1 / FRAME of the square's 64% hull -- so in units
# of a craft's own box it scales with the root of its hull's area
NOZZLE_W = 21.0      # per cent of the square's box
SQUARE_FILL = 37.943
FLANGE = 0.5         # share of the bell's width that must be over metal


def key(rgb):
    """Alpha off a black ground, and the colour unmixed from it."""
    hard = rgb.max(axis=2).astype(np.float32)
    ground, _n = ndi.label(hard <= GROUND)
    edge = np.unique(np.concatenate([
        ground[0], ground[-1], ground[:, 0], ground[:, -1]]))
    outside = np.isin(ground, edge[edge > 0])

    alpha = np.ones(hard.shape, np.float32)
    band = ndi.binary_dilation(outside, iterations=BAND)
    ramp = np.clip((hard - SOFT[0]) / (SOFT[1] - SOFT[0]), 0, 1)
    alpha[band] = ramp[band]
    alpha[outside & (ramp <= 0)] = 0

    # a pixel on the coast is the hull's colour mixed with black
    col = rgb.astype(np.float32)
    soft = band & (alpha > 0)
    col[soft] = np.clip(col[soft] / alpha[soft, None], 0, 255)
    return col, alpha


def frame(col, alpha):
    """Crop to the hull and centre it on a square canvas, hull's longer
    side at FRAME, scaled to SIZE."""
    ys, xs = np.nonzero(alpha > 0.5)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    side = max(x1 - x0, y1 - y0) / FRAME
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2

    rgba = np.dstack([col, alpha * 255]).round().clip(0, 255).astype(np.uint8)
    src = Image.fromarray(rgba, "RGBA")

    # premultiplied while it is resampled, so the ground's black never
    # bleeds into the coast
    left, top = cx - side / 2, cy - side / 2
    box = (left, top, left + side, top + side)
    pm = src.convert("RGBa").transform(
        (SIZE, SIZE), Image.EXTENT, box, Image.BICUBIC, fillcolor=(0, 0, 0, 0))
    return pm.convert("RGBA")


def corners(mask, k):
    """The hull's k corners, in px: the convex hull of the mask, cut down
    to k vertices, and each side then refitted as a line through the
    middle of the hull points along it, so the corners land where the
    sides MEET rather than on a bevel."""
    ys, xs = np.nonzero(mask)
    pts = np.column_stack([xs, ys]).astype(np.float64)
    hull = pts[ConvexHull(pts).vertices]

    idx = list(range(len(hull)))

    def tri(a, b, c):
        return abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2

    while len(idx) > k:
        n = len(idx)
        cost = [tri(hull[idx[i - 1]], hull[idx[i]], hull[idx[(i + 1) % n]]) for i in range(n)]
        idx.pop(int(np.argmin(cost)))

    lines = []
    for i in range(k):
        a, b = idx[i], idx[(i + 1) % k]
        run = []
        j = a
        while True:
            run.append(hull[j])
            if j == b:
                break
            j = (j + 1) % len(hull)
        run = np.array(run)
        # the side's middle: densify the run and keep its central 60%
        seg = []
        for p, q in zip(run[:-1], run[1:]):
            n = max(2, int(np.hypot(*(q - p))))
            seg.extend(p + (q - p) * t for t in np.linspace(0, 1, n, endpoint=False))
        seg.append(run[-1])
        seg = np.array(seg)
        lo, hi = int(len(seg) * 0.2), int(len(seg) * 0.8)
        mid = seg[lo:max(hi, lo + 2)]
        c = mid.mean(axis=0)
        _u, _s, vt = np.linalg.svd(mid - c)
        lines.append((c, vt[0]))

    out = []
    for i in range(k):
        (p, d), (q, e) = lines[i - 1], lines[i]
        m = np.array([d, -e]).T
        t = np.linalg.solve(m, q - p)
        out.append(p + d * t[0])
    return np.array(out)


def poly_area(poly):
    x, y = poly[:, 0], poly[:, 1]
    return abs(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1))) / 2


def nozzles(mask, cx, cy, flange):
    """Where each nozzle meets the hull, in px: on the row (l, r) or the
    column (t, b) through the centre of area, at the coast -- moved in
    until the metal across the bell's flange reaches it everywhere, so
    the flange is bolted ON and not left hanging beside a point."""
    H, W = mask.shape
    half = flange / 2
    rows = np.arange(max(0, int(cy - half)), min(H, int(cy + half) + 1))
    cols = np.arange(max(0, int(cx - half)), min(W, int(cx + half) + 1))

    def first(v):
        nz = np.nonzero(v)[0]
        return (nz.min(), nz.max()) if len(nz) else None

    l = max(first(mask[r])[0] for r in rows if first(mask[r]))
    r_ = min(first(mask[r])[1] for r in rows if first(mask[r]))
    t = max(first(mask[:, c])[0] for c in cols if first(mask[:, c]))
    b = min(first(mask[:, c])[1] for c in cols if first(mask[:, c]))
    return {"t": (cx, t), "r": (r_ + 1, cy), "b": (cx, b + 1), "l": (l, cy)}


def measure(img):
    a = np.asarray(img).astype(np.float32)[..., 3] / 255
    H, W = a.shape
    yy, xx = np.mgrid[0:H, 0:W]
    tot = a.sum()
    cx = (a * (xx + 0.5)).sum() / tot
    cy = (a * (yy + 0.5)).sum() / tot
    solid = a > 0.5
    ys, xs = np.nonzero(solid)
    return {
        "a": a, "solid": solid,
        "fill": tot / (W * H) * 100,
        "cx": cx, "cy": cy,
        "hull": (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1),
    }


def pct(v):
    return round(float(v) / SIZE * 100, 1)


def main():
    for src, shape, k, out in CRAFTS:
        rgb = np.asarray(Image.open(os.path.join(SRC, src)).convert("RGB"))
        col, alpha = key(rgb)
        img = frame(col, alpha)
        m = measure(img)

        nz_w = NOZZLE_W * np.sqrt(m["fill"] / SQUARE_FILL)
        poly = corners(m["solid"], k)
        noz = nozzles(m["solid"], m["cx"], m["cy"], nz_w / 100 * SIZE * FLANGE)

        if out:
            img.save(os.path.join(OUT, out), "WEBP", quality=90, method=6)
            size = os.path.getsize(os.path.join(OUT, out))
        else:
            size = 0

        area_err = poly_area(poly) / m["solid"].sum() - 1
        print(f"{shape:14s} {out or '(not written)'}  {size:,} bytes")
        print(f"  fill {m['fill']:.3f}  cx {m['cx'] / SIZE:.4f}  cy {m['cy'] / SIZE:.4f}"
              f"  nozzle {nz_w:.1f}%")
        print("  hull [" + ", ".join(str(pct(v)) for v in m["hull"]) + "]")
        print("  poly [" + ", ".join(f"[{pct(x)}, {pct(y)}]" for x, y in poly) + "]"
              f"   (area {area_err:+.1%} on the mask)")
        print("  noz  {" + ", ".join(f"{s}: [{pct(x)}, {pct(y)}]" for s, (x, y) in noz.items()) + "}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
