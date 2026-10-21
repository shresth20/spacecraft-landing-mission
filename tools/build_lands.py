"""Cut the shaped islands out of assets/images/new and measure them.

Dev dependencies: Pillow, NumPy, SciPy (as build_crafts.py).
Run python3 tools/build_lands.py, then python3 tools/build_manifest.py.

Every landing zone that is not the square is one of these tiles: the
shape seen from straight above as a slab of orange rock, drawn on white.
Each is keyed off the white, left on its own 1254 x 1254 canvas (every
land tile must be square: see LAND in js/pages.js) and saved as
assets/images/<shape>.webp -- the same picture on both of a round's
sites, and the islets'.

Then, off its own alpha channel, everything the page needs to know:

  fill      per cent of the canvas the rock covers
  cx, cy    its centre of area
  outline   its four corners, per cent of the canvas: the convex hull
            of the silhouette cut down to four, each side refitted as a
            line through the middle of that side (so a bevel does not
            pull the corner in). The verdict outline, the tap target
            and the lock-on are all drawn on this
  label     where a printed number sits to look centred: the middle
            of the outline

Prints the LAND entries for js/pages.js, and writes the tiles into
js/environment-assets.js as `lands`, so js/reef.js can stand each one
in the sea as it stands the square's platform: its waterline (the
silhouette, traced, for the spray) and its footprint (the painted box
in the tile's own px, laid onto the outline's box on the page).

The square's tile is built here too, from the platform it stands in
the sea as on its landing screen (environment/platform.webp): the
platform's top face laid onto the square's own outline on a 1254 x 1254
canvas, exactly as js/reef.js lays it at run time. So the square looks
like the other shapes' slabs on every shape question, and its LAND
entry -- the outline, the fill, the centre -- is not re-measured: the
approved landing screen is laid out from those figures and must not
move. The triangle is out of the mission altogether (2026-10-21): no
round, no decoy, no tile.
"""
import json
import re
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from scipy.spatial import ConvexHull

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'assets/images/new'
OUT = ROOT / 'assets/images'
ENV = ROOT / 'js/environment-assets.js'

TILES = {
    'rectangle': 'rectangle.png',
    'parallelogram': 'parallelogram.png',
    'trapezium': 'trapizem.png',
    'rhombus': 'rhombus.png',
}
CORNERS = 4
SIDE_MID = (.2, .8)


def key_white(rgb):
    """Alpha off a white ground: the rock is orange, the paper is not."""
    rgb = rgb.astype(np.float32)
    chroma = rgb.max(axis=2) - rgb.min(axis=2)
    labels, n = ndi.label(ndi.binary_opening(chroma >= 60, iterations=2))
    counts = np.bincount(labels.ravel())
    counts[0] = 0
    obj = ndi.binary_fill_holes(labels == counts.argmax())
    alpha = np.clip((ndi.gaussian_filter(obj.astype(np.float32), .8) - .25) / .5, 0, 1)
    col = rgb.copy()
    soft = (alpha > 0) & (alpha < 1)
    a = alpha[soft, None]
    col[soft] = np.clip((col[soft] - (1 - a) * 255) / a, 0, 255)
    return col, alpha


def corners(mask, k):
    """As tools/build_crafts.py: the convex hull cut down to k corners,
    each side refitted through its middle."""
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
        run, j = [], a
        while True:
            run.append(hull[j])
            if j == b:
                break
            j = (j + 1) % len(hull)
        seg = []
        for p, q in zip(run[:-1], run[1:]):
            n = max(2, int(np.hypot(*(q - p))))
            seg.extend(p + (q - p) * t for t in np.linspace(0, 1, n, endpoint=False))
        seg.append(run[-1])
        seg = np.array(seg)
        lo, hi = int(len(seg) * SIDE_MID[0]), int(len(seg) * SIDE_MID[1])
        mid = seg[lo:max(hi, lo + 2)]
        c = mid.mean(axis=0)
        _u, _s, vt = np.linalg.svd(mid - c)
        lines.append((c, vt[0]))

    out = []
    for i in range(k):
        (p, d), (q, e) = lines[i - 1], lines[i]
        t = np.linalg.solve(np.array([d, -e]).T, q - p)
        out.append(p + d * t[0])
    # clockwise from the top-most corner, as the LAND outlines are written
    out = np.array(out)
    centre = out.mean(axis=0)
    ang = np.arctan2(out[:, 1] - centre[1], out[:, 0] - centre[0])
    start = int(np.argmin(out[:, 1]))
    order = sorted(range(k), key=lambda i: (ang[i] - ang[start]) % (2 * np.pi))
    return out[order]


def simplify(points, tolerance=1.4):
    if len(points) < 3:
        return points
    a, b = np.array(points[0]), np.array(points[-1])
    line = b - a
    delta = np.array(points) - a
    dist = np.abs(line[0] * delta[:, 1] - line[1] * delta[:, 0]) / max(np.linalg.norm(line), .001)
    i = int(np.argmax(dist))
    if dist[i] <= tolerance:
        return [points[0], points[-1]]
    return simplify(points[:i + 1], tolerance)[:-1] + simplify(points[i:], tolerance)


def waterline(im):
    """The silhouette traced, as tools/build_environment.py traces every
    dry rock's: pixel edges of the solid land at thumbnail size."""
    thumb = im.copy()
    thumb.thumbnail((180, 180))
    mask = ndi.binary_fill_holes(np.array(thumb)[..., 3] > 110)
    labels, _ = ndi.label(mask)
    counts = np.bincount(labels.ravel())
    counts[0] = 0
    mask = labels == counts.argmax()
    edges = {}
    h, w = mask.shape
    for y, x in zip(*np.nonzero(mask)):
        if y == 0 or not mask[y - 1, x]: edges[(x, y)] = (x + 1, y)
        if x == w - 1 or not mask[y, x + 1]: edges[(x + 1, y)] = (x + 1, y + 1)
        if y == h - 1 or not mask[y + 1, x]: edges[(x + 1, y + 1)] = (x, y + 1)
        if x == 0 or not mask[y, x - 1]: edges[(x, y + 1)] = (x, y)
    loops = []
    while edges:
        p = next(iter(edges)); loop = [p]
        while p in edges:
            p = edges.pop(p); loop.append(p)
        loops.append(loop)
    loop = max(loops, key=len)
    mid = len(loop) // 2
    points = simplify(loop[:mid + 1])[:-1] + simplify(loop[mid:])[:-1]
    return [[round(x * im.width / w, 2), round(y * im.height / h, 2)] for x, y in points]


def pct(v, size):
    return round(float(v) / size * 100, 1)


# the square's LAND entry, as js/pages.js has it: its outline's box and
# centre of area, per cent of the canvas. Kept here, not measured.
SQUARE = dict(ext=(11.3, 11.7, 88.8, 88.5), cx=50.04, cy=50.08)
CANVAS = 1254


def square_tile(env):
    """The platform's top face onto the square's outline, as reef.js
    places it: the footprint's side onto the outline's shorter side,
    centred on the centre of area."""
    meta = env['platform']
    f = meta['footprint']
    art = Image.open(ROOT / meta['src']).convert('RGBA')
    side = min(SQUARE['ext'][2] - SQUARE['ext'][0], SQUARE['ext'][3] - SQUARE['ext'][1]) / 100 * CANVAS
    scale = side / f[2]
    w, h = round(art.width * scale), round(art.height * scale)
    x = SQUARE['cx'] / 100 * CANVAS - side / 2 - f[0] * scale
    y = SQUARE['cy'] / 100 * CANVAS - side / 2 - f[1] * scale
    tile = Image.new('RGBA', (CANVAS, CANVAS))
    tile.alpha_composite(art.convert('RGBa').resize((w, h), Image.Resampling.LANCZOS).convert('RGBA'),
                         (round(x), round(y)))
    dst = OUT / 'square.webp'
    tile.save(dst, 'WEBP', quality=90, method=6)
    print('square.webp: the platform at (%.0f, %.0f) x %.3f on the %d canvas' % (x, y, scale, CANVAS))


def main():
    env = json.loads(re.search(r'=\s*(\{.*\})\s*;', ENV.read_text(), re.S).group(1))
    env['lands'] = {}
    print('/* LAND entries for js/pages.js, measured by tools/build_lands.py */')
    for shape, name in TILES.items():
        rgb = np.asarray(Image.open(SOURCE / name).convert('RGB'))
        col, alpha = key_white(rgb)
        H, W = alpha.shape
        assert W == H, '%s is not square' % name
        rgba = np.dstack([col, alpha * 255]).round().clip(0, 255).astype(np.uint8)
        img = Image.fromarray(rgba)
        dst = OUT / (shape + '.webp')
        img.save(dst, 'WEBP', quality=90, method=6)

        yy, xx = np.mgrid[0:H, 0:W]
        tot = alpha.sum()
        cx = (alpha * (xx + .5)).sum() / tot / W
        cy = (alpha * (yy + .5)).sum() / tot / H
        poly = corners(alpha > .5, CORNERS)
        pp = [(pct(x, W), pct(y, H)) for x, y in poly]
        label = poly.mean(axis=0)
        ys, xs = np.nonzero(alpha > .43)
        box = [int(xs.min()), int(ys.min()), int(xs.max() + 1 - xs.min()), int(ys.max() + 1 - ys.min())]

        print('    %s: {' % shape)
        print("      img: '%s.webp', fill: %.3f, cx: %.4f, cy: %.4f," % (shape, tot / (W * H) * 100, cx, cy))
        print("      outline: '%s'," % ('M' + 'L'.join('%g %g' % p for p in pp) + 'z'))
        print("      clip: 'polygon(%s)'," % ', '.join('%g%% %g%%' % p for p in pp))
        print('      label: [%.1f, %.1f],' % (pct(label[0], W), pct(label[1], H)))
        print('    },')

        env['lands'][shape] = dict(src=dst.relative_to(ROOT).as_posix(), size=[W, H],
                                   waterline=waterline(img), footprint=box)

    square_tile(env)
    ENV.write_text('// Generated by tools/build_environment.py and tools/build_lands.py\n'
                   'window.GeoEnvironmentAssets = ' + json.dumps(env, separators=(',', ':')) + ';\n')
    print('wrote', ENV.relative_to(ROOT), 'lands:', ', '.join(env['lands']))


if __name__ == '__main__':
    main()
