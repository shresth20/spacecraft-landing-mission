"""Cut the big dry rocks -- the reef's decoration -- out of assets/images/new.

Dev dependencies: Pillow, NumPy, SciPy (as build_crafts.py).
Run python3 tools/build_rocks.py, then python3 tools/build_manifest.py.

Three drawings, supplied 2026-10-21 to replace the straight-cut land
fragments that used to lie along the screen edges:

  dry rock 2.png     one big island of orange rock with its pebbles
  dry rock 3.png     another
  dry-rock01.png     a sheet of eight smaller clusters

The two big ones are each trimmed to what is drawn; the sheet is split
into its clusters (every rock on it that is near another is one
cluster). Each is saved as assets/images/environment/big-NN.webp with
its silhouette traced for the spray and the shore, and written into
js/environment-assets.js as `big`, `large` marking the two island-sized
ones. js/reef.js lays the large ones along the frame's edges and strews
a few of the clusters over the open water (THE BIG ROCKS there).

The small dry rocks that stand round each landing zone (dry-01..08) are
not touched: they are a separate sheet, and the user asked for them
kept as they are.
"""
import json
import re
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'assets/images/new'
OUT = ROOT / 'assets/images/environment'
ENV = ROOT / 'js/environment-assets.js'

LARGE = ['dry rock 2.png', 'dry rock 3.png']
SHEET = 'dry-rock01.png'
LARGE_PX = 640        # the longer side of a big island, written out
CLUSTER_PX = 240      # and of a cluster
JOIN = 8              # px: rocks nearer than twice this are one cluster
SPECK = 400           # px squared: anything smaller on the sheet is dropped
PAD = 2


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
    dry rock's: pixel edges of the solid land at thumbnail size. A
    cluster's is its biggest rock's, as the small rocks' always were."""
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


def export(name, rgba, longest, large):
    """Trim, scale and save one rock, and measure it."""
    alpha = rgba[..., 3]
    ys, xs = np.nonzero(alpha > 8)
    box = (max(0, xs.min() - PAD), max(0, ys.min() - PAD),
           min(rgba.shape[1], xs.max() + 1 + PAD), min(rgba.shape[0], ys.max() + 1 + PAD))
    im = Image.fromarray(rgba).crop(box)
    scale = min(1, longest / max(im.size))
    if scale < 1:
        im = im.convert('RGBa').resize((round(im.width * scale), round(im.height * scale)),
                                       Image.Resampling.LANCZOS).convert('RGBA')
    padded = Image.new('RGBA', (im.width + 4, im.height + 4))
    padded.paste(im, (2, 2))
    im = padded
    dst = OUT / (name + '.webp')
    im.save(dst, 'WEBP', quality=92, method=6)
    return dict(src=dst.relative_to(ROOT).as_posix(), size=[im.width, im.height],
                waterline=waterline(im), large=large)


def main():
    env = json.loads(re.search(r'=\s*(\{.*\})\s*;', ENV.read_text(), re.S).group(1))
    big = []
    n = 0
    for name in LARGE:
        n += 1
        rgba = np.array(Image.open(SOURCE / name).convert('RGBA'))
        big.append(export('big-%02d' % n, rgba, LARGE_PX, True))
        print('big-%02d  %s  %s' % (n, name, big[-1]['size']))

    rgba = np.array(Image.open(SOURCE / SHEET).convert('RGBA'))
    solid = rgba[..., 3] > 110
    labels, count = ndi.label(ndi.binary_dilation(solid, iterations=JOIN))
    order = sorted(range(1, count + 1), key=lambda i: (np.nonzero(labels == i)[0].min() // 300,
                                                       np.nonzero(labels == i)[1].min()))
    for i in order:
        part = labels == i
        if part.sum() < SPECK:
            continue
        n += 1
        piece = rgba.copy()
        piece[..., 3] = np.where(part, piece[..., 3], 0)
        big.append(export('big-%02d' % n, piece, CLUSTER_PX, False))
        print('big-%02d  %s cluster %d  %s' % (n, SHEET, i, big[-1]['size']))

    # the straight-cut fragments these replace
    for old in ('edge',):
        for meta in env.get(old, []):
            path = ROOT / meta['src']
            if path.exists():
                path.unlink()
        env.pop(old, None)
    for stale in OUT.glob('big-*.webp'):
        if not any(stale.name == Path(m['src']).name for m in big):
            stale.unlink()
    env['big'] = big
    ENV.write_text('// Generated by tools/build_environment.py, tools/build_lands.py and tools/build_rocks.py\n'
                   'window.GeoEnvironmentAssets = ' + json.dumps(env, separators=(',', ':')) + ';\n')
    print('wrote', ENV.relative_to(ROOT), 'big:', len(big))


if __name__ == '__main__':
    main()
