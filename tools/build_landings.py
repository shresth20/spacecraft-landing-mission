"""Cut and measure the two pictures each shape's close-up landing plays.

Dev dependencies: Pillow, NumPy, SciPy (as build_crafts.py).
Run python3 tools/build_landings.py, then python3 tools/build_manifest.py.

Every shape's cut-scene (js/square-landing.js and js/square-crash.js,
written for the square and played for every shape) is two pictures seen
from the angle: the CRAFT and the LAND it is set down on. The sources
are in assets/images/new, each on whatever ground its drawing came
with -- a checkerboard, black, or a real alpha channel -- and each is
keyed, cropped to what is drawn and saved as webp under
assets/images/landing/<shape>-{craft,land}.webp. Nothing is painted,
resized out of proportion or turned.

What is worked out is where each slab's FOUR CORNERS are in its own
picture: the corners of its top face and of its base, not the image's
rectangle. The player lays the island in by the homography that takes
its top face's four corners onto the craft's underside's four, so the
touchdown is corner-exact whatever the view.

── the slab, measured ────────────────────────────────────────────────
A flat slab with upright walls has a six-cornered silhouette whatever
angle it is drawn from: at its far left and far right an upright wall
edge, each joining a top-face corner to the base corner under it, and
between them one or two more corners over the top and one or two along
the bottom. The convex hull of the silhouette is cut down to those six,
each side refitted as a line through the middle of the outline along it
(so a rounded or bevelled corner does not pull it in), and the corners
are where neighbouring lines meet. The wall's height is the two upright
edges'. Then:

  top face   the two upright edges' tops, every corner over the top,
             and, for every corner along the bottom, the hidden top
             corner the wall's height above it
  base       the mirror of that

The four top corners are named l, b, r, f -- the leftmost first and
then clockwise -- which on a diamond view (the square, the rhombus) is
left, back, right, front, as js/square-landing.js has always read them,
and on a view from the front is front-left, back-left, back-right,
front-right. The player works out which walls face the camera from the
corners themselves (see viewOf in js/square-landing.js), so nothing
here says which kind of view a picture is.

── the sources ───────────────────────────────────────────────────────
Listed in ART below. A shape whose source is missing keeps the entry
and the webps it already has (the square's sources went with
assets/new4, and its two webps were cut by the tool this one replaces),
and is reported. A shape with no entry at all -- the parallelogram
craft, until it is drawn -- is left out of js/landing-assets.js, and
the page then lands that shape from overhead.

Writes assets/images/landing/ and js/landing-assets.js.
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
OUT = ROOT / 'assets/images/landing'
JS = ROOT / 'js/landing-assets.js'

# shape -> piece -> (source file, how it is keyed, which object on a sheet)
#   'alpha'    a real alpha channel: used as it is
#   'checker'  a grey drawing over a grey-and-white checkerboard
#   'colour'   a colourful one over the same
#   'black'    drawn on black
# `which` picks one object off a sheet holding several: 'top'/'bottom'.
ART = {
    'square': {
        'craft': ('square-craft-angle.png', 'alpha', None),
        'land': ('square-land-angle.png', 'alpha', None),
    },
    'rectangle': {
        'craft': ('Rectangle in angle view.png', 'alpha', None),
        'land': ('rectangle-land.png', 'colour', None),
    },
    'trapezium': {
        'craft': ('Trapeze in angle view.png', 'alpha', None),
        'land': ('trapizium-land.png', 'colour', None),
    },
    'rhombus': {
        'craft': ('Rhombus in angle view.png', 'checker', None),
        'land': ('Perlelogram and rhombus in angle view, land.png', 'black', 'top'),
    },
    'parallelogram': {
        'craft': ('parallelogram-craft-angle.png', 'alpha', None),
        'land': ('Perlelogram and rhombus in angle view, land.png', 'black', 'bottom'),
    },
}

PAD = 4            # px kept round the drawing when it is cropped
LONGEST = 1200     # px: the longer side of a written webp, at most
SIDE_MID = (.2, .8)   # the share of each silhouette side its line is fitted to
UPRIGHT = .03      # a side is an upright wall if both ends are within this
                   # share of the width of the silhouette's left or right edge


# ---------------------------------------------------------------- keying

def chroma(rgb):
    return rgb.max(axis=2) - rgb.min(axis=2)


def border_connected(mask):
    """The part of `mask` joined to the picture's edge."""
    labels, _n = ndi.label(mask)
    edge = np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
    return np.isin(labels, edge[edge > 0])


def largest(mask, which=None):
    """The biggest solid piece of `mask` (holes filled), or the top/bottom
    one of the two biggest when `which` picks one off a sheet."""
    labels, n = ndi.label(mask)
    if not n:
        raise ValueError('nothing drawn')
    counts = np.bincount(labels.ravel())
    counts[0] = 0
    order = np.argsort(counts)[::-1]
    if which:
        pair = order[:2]
        ys = [np.nonzero(labels == i)[0].mean() for i in pair]
        pick = pair[int(np.argmin(ys))] if which == 'top' else pair[int(np.argmax(ys))]
    else:
        pick = order[0]
    return ndi.binary_fill_holes(labels == pick)


def unmix(rgb, alpha, ground):
    """A pixel on the coast is the drawing's colour mixed with the ground
    under it: take the ground back out."""
    col = rgb.astype(np.float32)
    soft = (alpha > 0) & (alpha < 1)
    a = alpha[soft, None]
    col[soft] = np.clip((col[soft] - (1 - a) * ground[soft]) / a, 0, 255)
    return col


def key_alpha(rgba, which):
    a = rgba[..., 3].astype(np.float32) / 255
    keep = largest(a > .5, which)
    keep = ndi.binary_dilation(keep, iterations=3)
    a = np.where(keep, a, 0)
    return rgba[..., :3].astype(np.float32), a


def key_ground(rgb, is_ground, which):
    """A drawing over a ground `is_ground` tells apart by colour: the
    ground is what is joined to the edge, the drawing the biggest piece
    of the rest, feathered one pixel at its coast and the local ground
    colour taken out of that coast."""
    ground = border_connected(is_ground)
    # opened a little first, so a speck of ground caught at the coast
    # does not hang off the silhouette
    obj = largest(ndi.binary_opening(~ground, iterations=3), which)
    alpha = ndi.gaussian_filter(obj.astype(np.float32), .8)
    alpha = np.clip((alpha - .25) / .5, 0, 1)
    # the ground's colour under the coast: the nearby ground, averaged
    g = ground.astype(np.float32)
    local = np.stack([ndi.gaussian_filter(rgb[..., c] * g, 6) / np.maximum(ndi.gaussian_filter(g, 6), 1e-3)
                      for c in range(3)], axis=2)
    return unmix(rgb, alpha, local), alpha


def key_checker(rgb, which):
    rgb = rgb.astype(np.float32)
    # the squares' colour fringes run to a chroma of 30-odd next to the
    # drawing; nothing drawn on them is that grey
    grey = (chroma(rgb) < 40) & (rgb.max(axis=2) > 150)
    return key_ground(rgb, grey, which)


def key_colour(rgb, which):
    """A colourful drawing (the orange lands) over a grey checkerboard:
    everything that is not plainly colourful is the ground, fringes and
    all, so no square of it is ever caught at the coast."""
    rgb = rgb.astype(np.float32)
    return key_ground(rgb, chroma(rgb) < 60, which)


def key_black(rgb, which):
    rgb = rgb.astype(np.float32)
    return key_ground(rgb, rgb.max(axis=2) <= 20, which)


def keyed(path, how, which):
    img = Image.open(path)
    if how == 'alpha':
        return key_alpha(np.array(img.convert('RGBA')), which)
    rgb = np.array(img.convert('RGB'))
    return {'checker': key_checker, 'colour': key_colour, 'black': key_black}[how](rgb, which)


# ---------------------------------------------------------------- the slab

def hexagon(mask):
    """The six corners of the slab's silhouette, in cyclic order."""
    ys, xs = np.nonzero(mask)
    pts = np.column_stack([xs, ys]).astype(np.float64)
    hull = pts[ConvexHull(pts).vertices]
    idx = list(range(len(hull)))

    def tri(a, b, c):
        return abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2

    while len(idx) > 6:
        n = len(idx)
        cost = [tri(hull[idx[i - 1]], hull[idx[i]], hull[idx[(i + 1) % n]]) for i in range(n)]
        idx.pop(int(np.argmin(cost)))

    lines = []
    for i in range(6):
        a, b = idx[i], idx[(i + 1) % 6]
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
    for i in range(6):
        (p, d), (q, e) = lines[i - 1], lines[i]
        t = np.linalg.solve(np.array([d, -e]).T, q - p)
        out.append(p + d * t[0])
    return np.array(out)


def measure(alpha):
    m = largest(alpha > .5)
    c = hexagon(m)
    xs = c[:, 0]
    x0, x1 = xs.min(), xs.max()
    w = x1 - x0

    def upright(i, at):
        a, b = c[i], c[(i + 1) % 6]
        return abs(a[0] - at) < UPRIGHT * w and abs(b[0] - at) < UPRIGHT * w

    left = [i for i in range(6) if upright(i, x0)]
    right = [i for i in range(6) if upright(i, x1)]
    if len(left) != 1 or len(right) != 1:
        raise ValueError('no upright wall at each side: %r %r' % (left, right))

    def ends(i):
        a, b = c[i], c[(i + 1) % 6]
        return (a, b) if a[1] < b[1] else (b, a)

    l_top, l_bot = ends(left[0])
    r_top, r_bot = ends(right[0])
    wall = ((l_bot[1] - l_top[1]) + (r_bot[1] - r_top[1])) / 2

    used = {left[0], (left[0] + 1) % 6, right[0], (right[0] + 1) % 6}
    rest = [c[i] for i in range(6) if i not in used]
    top_line_y = (l_top[1] + r_top[1]) / 2
    over = [p for p in rest if p[1] < top_line_y]
    along = [p for p in rest if p[1] >= top_line_y]
    if len(over) + len(along) != 2:
        raise ValueError('silhouette is not a slab')

    tops = [(l_top, l_bot), (r_top, r_bot)]
    tops += [(p, p + [0, wall]) for p in over]
    tops += [(p - [0, wall], p) for p in along]

    # l first, then clockwise about the top face's middle
    centre = np.mean([t for t, _b in tops], axis=0)
    start = min(range(4), key=lambda i: tops[i][0][0])
    ang = [np.arctan2(tops[i][0][1] - centre[1], tops[i][0][0] - centre[0]) for i in range(4)]
    order = sorted(range(4), key=lambda i: (ang[i] - ang[start]) % (2 * np.pi))

    r = lambda p: [round(float(p[0]), 1), round(float(p[1]), 1)]
    keys = ['l', 'b', 'r', 'f']
    return {
        'top': {k: r(tops[i][0]) for k, i in zip(keys, order)},
        'base': {k: r(tops[i][1]) for k, i in zip(keys, order)},
        'wall': round(float(wall), 1),
    }


# ---------------------------------------------------------------- the files

def existing():
    """What js/landing-assets.js already holds (or the file this tool
    replaces), for shapes whose sources are no longer about."""
    for path in (JS, ROOT / 'js/square-landing-assets.js'):
        if not path.exists():
            continue
        m = re.search(r'=\s*(\{.*\})\s*;', path.read_text(), re.S)
        if not m:
            continue
        data = json.loads(m.group(1))
        if 'craft' in data and 'land' in data:
            data = {'square': data}
        return data
    return {}


def export(shape, piece, spec):
    name, how, which = spec
    src = SOURCE / name
    col, alpha = keyed(src, how, which)
    ys, xs = np.nonzero(alpha > .03)
    box = (max(0, xs.min() - PAD), max(0, ys.min() - PAD),
           min(alpha.shape[1], xs.max() + 1 + PAD), min(alpha.shape[0], ys.max() + 1 + PAD))
    rgba = np.dstack([col, alpha * 255]).round().clip(0, 255).astype(np.uint8)
    img = Image.fromarray(rgba).crop(box)
    scale = min(1, LONGEST / max(img.size))
    if scale < 1:
        img = img.convert('RGBa').resize((round(img.width * scale), round(img.height * scale)),
                                         Image.Resampling.LANCZOS).convert('RGBA')
    geo = measure(np.asarray(img)[..., 3].astype(np.float32) / 255)
    dst = OUT / ('%s-%s.webp' % (shape, piece))
    img.save(dst, 'WEBP', quality=90, method=6)
    return dict(src=dst.relative_to(ROOT).as_posix(), source=src.relative_to(ROOT).as_posix(),
                size=[img.width, img.height], **geo)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    kept = existing()
    data = {}
    for shape, pieces in ART.items():
        entry = {}
        for piece, spec in pieces.items():
            if (SOURCE / spec[0]).exists():
                entry[piece] = export(shape, piece, spec)
                print('%-14s %-6s %s  wall %s' % (shape, piece, entry[piece]['size'], entry[piece]['wall']))
                print('    top  %s' % entry[piece]['top'])
                print('    base %s' % entry[piece]['base'])
            elif kept.get(shape, {}).get(piece):
                old = kept[shape][piece]
                dst = OUT / ('%s-%s.webp' % (shape, piece))
                if dst.exists():
                    entry[piece] = dict(old, src=dst.relative_to(ROOT).as_posix())
                elif (ROOT / old['src']).exists():
                    entry[piece] = old
                else:
                    print('%-14s %-6s MISSING: supply assets/images/new/%s' % (shape, piece, spec[0]))
                    continue
                print('%-14s %-6s kept as measured (source %s is not about)' % (shape, piece, spec[0]))
            else:
                print('%-14s %-6s MISSING: supply assets/images/new/%s' % (shape, piece, spec[0]))
        if 'craft' in entry and 'land' in entry:
            data[shape] = entry
        else:
            print('%-14s left out: the page lands it from overhead' % shape)

    JS.write_text('// Generated by tools/build_landings.py\n'
                  'window.GeoLandingAssets = ' + json.dumps(data, separators=(',', ':')) + ';\n')
    print('wrote', JS.relative_to(ROOT), 'with', ', '.join(sorted(data)))


if __name__ == '__main__':
    main()
