"""Cut the square landing's cinematic out of the supplied new4 artwork.

Dev dependencies: Pillow, NumPy, SciPy (as build_environment.py).
Run python3 tools/build_cinematic.py, then python3 tools/build_manifest.py.

Writes assets/images/cinematic/ and js/cinematic-assets.js, which
js/cinematic.js plays. Nothing is painted here: every pixel is the
supplied art, cut, cleaned, moved or re-projected.

  sea        bg.png, the angle-view water
  land-*     "square land from angle view", re-projected into each sheet's
             own camera (a homography of its top face onto the craft's
             footprint), so the craft and the land are drawn from one
             viewpoint and the exact fit is exact. Sized by the side ratio
             of its area to the craft's: 24, 36 or 54 against 36.
  atlas-*    one sprite sheet per landing, its frames cut and cleaned
  shadow-*   the craft's footprint, blurred: its shadow on land and water

Every frame keeps its own anchors, in frame px:
  foot   the centre of the craft's footprint (level frames)
  dome   the centre of the cyan dome
  pool   the centre of the water a splash frame is drawn in
and, on a level frame, its own hull from the foot (for drawing the craft
without its jets or its dust) and how far its jets reach below the base.
Everything about the scene (the land, its top face, its base, the
shadow) is given in the same px of the sheet's reference frame, from the
footprint's centre, so the runtime needs one scale per landing.

The sheets are matched to their landings by file name in SHEETS. A sheet
replaced with a redrawn one of the same layout needs only this run; one
laid out differently may need its frame count, and the frame numbers the
shots in js/cinematic.js play, changed to match.
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage as ndi
from scipy.spatial import ConvexHull

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'assets/new4'
OUT = ROOT / 'assets/images/cinematic'

# The land's top face and base in its own image, corner by corner: the
# extremes of the rounded blocks, which is also how the craft's footprint
# is measured. The front top corner is hidden inside the silhouette, read
# off the art; the back of the base is hidden behind the land.
LAND_TOP = dict(l=(219, 430), b=(763, 69), r=(1474, 308), f=(1112, 740))
LAND_BASE = dict(l=(225, 558), b=(763, 194), r=(1487, 431), f=(1112, 873))
LAND_RES = 3          # land image px per frame px

# The three landings. `side` is the island's side against the craft's
# (sqrt of 24/36, 1, sqrt of 54/36). `ref` is the level frame whose
# footprint the land is fitted to. `seeds` finds one body per frame:
# `main` the biggest opaque blobs, `metal` the grey hulls (for a sheet
# whose dust runs one frame into the next). `reach` is how far a pixel
# may lie from its frame's body and still belong to it; `feather` fades
# the cut between two frames that touch.
SHEETS = {
    'fit': dict(src='landing successfully.png', frames=12, seeds='main', reach=70,
                feather=0, row=300, side=1.0, ref=12, level=range(1, 13)),
    'tight': dict(src='craft distory in water.png', frames=18, seeds='main', reach=70,
                  feather=0, row=280, side=(24 / 36) ** .5, ref=1, level=(1, 2)),
    'loose': dict(src='distroy-on large land.png', frames=8, seeds='metal', reach=160,
                  feather=22, row=0, side=(54 / 36) ** .5, ref=1, level=range(1, 9)),
}

# Domes read off the art by hand, in frame px, where the detector cannot
# find one: the tipping craft's dome loses its dark collar to the light.
DOME = {'tight': {6: (175, 65)}}


def hsv(rgb):
    r, g, b = (rgb[..., i] / 255.0 for i in range(3))
    mx = np.maximum(np.maximum(r, g), b)
    d = mx - np.minimum(np.minimum(r, g), b)
    h = np.zeros_like(mx)
    m = d > 1e-6
    rr = m & (mx == r)
    gg = m & (mx == g) & ~rr
    bb = m & ~rr & ~gg
    h[rr] = ((g - b)[rr] / d[rr]) % 6
    h[gg] = ((b - r)[gg] / d[gg]) + 2
    h[bb] = ((r - g)[bb] / d[bb]) + 4
    return h * 60, np.where(mx > 0, d / np.maximum(mx, 1e-6), 0), mx


def seeds(a, n, mode):
    if mode == 'main':
        m = ndi.binary_opening(a[..., 3] > 160, iterations=2)
    else:
        h, s, v = hsv(a[..., :3])
        m = (a[..., 3] > 200) & (s < .22) & (v > .55)
        m = ndi.binary_closing(ndi.binary_opening(m, iterations=2), iterations=4)
    lab, _ = ndi.label(m)
    counts = np.bincount(lab.ravel())
    counts[0] = 0
    return lab, [k for k in np.argsort(-counts)[:n] if counts[k] > 0]


def cut(cfg):
    """Every frame of a sheet, in reading order, each pixel given to the
    nearest frame body. The sheets were cut out of their backgrounds badly:
    a haze of faint, saturated specks lies between the frames, and it is
    dropped by `reach` and by keeping only what touches the body (or is a
    small loose piece near it: debris, drops)."""
    a = np.array(Image.open(SOURCE / cfg['src']).convert('RGBA')).astype(np.float64)
    lab, keep = seeds(a, cfg['frames'], cfg['seeds'])
    objs = ndi.find_objects(lab)
    row = cfg['row']
    order = sorted(keep, key=lambda k: ((objs[k - 1][0].start // row) if row else 0, objs[k - 1][1].start))
    dists = np.stack([ndi.distance_transform_edt(lab != k) for k in order])
    near = dists.argmin(axis=0)
    ranked = np.sort(dists, axis=0)
    inside = ranked[1] - ranked[0]
    frames = []
    for idx, k in enumerate(order):
        alpha = a[..., 3] * ((near == idx) & (dists[idx] <= cfg['reach']))
        if cfg['feather']:
            alpha *= np.clip(inside / cfg['feather'], 0, 1)
        body = alpha > 40
        grown, _ = ndi.label(ndi.binary_dilation(body, iterations=3))
        own = np.unique(grown[(lab == k) & body])
        attached = np.isin(grown, own[own > 0])
        loose, n = ndi.label(body & ~attached)
        if n:
            ids = np.arange(1, n + 1)
            size = ndi.sum(np.ones_like(loose), loose, ids)
            far = ndi.mean(dists[idx], loose, ids)
            attached |= np.isin(loose, ids[(size < 900) & (far < cfg['reach'] * .6)])
        alpha *= ndi.binary_dilation(attached, iterations=2)
        ys, xs = np.nonzero(alpha > 6)
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        fr = a[y0:y1, x0:x1].copy()
        fr[..., 3] = alpha[y0:y1, x0:x1]
        frames.append(fr)
    return frames


def dome(fr, collared=.25):
    """The dome: a compact saturated blue blob ringed by the near-black
    collar it sits in. Water is the same blue, but it has no collar. A
    frame with no water in it may be asked again with `collared` 0, for a
    dome whose collar has caught the light as the craft tips."""
    h, s, v = hsv(fr[..., :3])
    solid = fr[..., 3] > 200
    collar = solid & (v < .28)
    lab, n = ndi.label(solid & (h > 185) & (h < 222) & (s > .55) & (v > .6))
    best = None
    for j in range(1, n + 1):
        m = lab == j
        area = m.sum()
        if area < 150:
            continue
        ring = ndi.binary_dilation(m, iterations=6) & ~ndi.binary_dilation(m, iterations=1)
        dark = (collar & ring).sum() / max(ring.sum(), 1)
        ys, xs = np.nonzero(m)
        fill = area / ((np.ptp(xs) + 1) * (np.ptp(ys) + 1))
        score = dark * 2 + fill + (area / 4000 if not collared else 0)
        if dark >= collared and fill > .5 and (best is None or score > best[0]):
            best = (score, xs.mean(), ys.mean())
    return None if best is None else [float(best[1]), float(best[2])]


def pool(fr):
    """Centre of the water a splash frame is drawn in."""
    h, s, v = hsv(fr[..., :3])
    water = (fr[..., 3] > 200) & (h > 180) & (h < 225) & (s > .35) & (v > .28)
    if water.sum() < 4000:
        return None
    ys, xs = np.nonzero(water)
    return [float(xs.mean()), float(ys.mean())]


def fire(fr):
    h, s, v = hsv(fr[..., :3])
    return (fr[..., 3] > 90) & (s > .45) & ((h < 55) | (h > 320)) & (v > .5)


def hull(fr, dusty=False):
    """The craft's outline as a hexagon, corners named the way the camera
    sees a box from above and in front: the top face's left, back and
    right corners, then the right, front and left corners of its base.
    `dusty`: the frame has dust or rock round the hull, so what is warm and
    coloured is left out: the hull's metal is a cool grey, its rim near
    black, and the dust, the burn and the rocks are all warm."""
    m = (fr[..., 3] > 180) & ~fire(fr)
    if dusty:
        h, s, v = hsv(fr[..., :3])
        warm = ((h < 70) | (h > 330)) & (s > .12)
        m = (m & ~warm) | ((fr[..., 3] > 180) & (v < .3))
    m = ndi.binary_opening(m, iterations=3)
    lab, _ = ndi.label(m)
    counts = np.bincount(lab.ravel())
    counts[0] = 0
    m = ndi.binary_fill_holes(lab == counts.argmax())
    ys, xs = np.nonzero(m)
    pts = np.c_[xs, ys].astype(float)
    poly = [tuple(p) for p in pts[ConvexHull(pts).vertices]]

    def area(a, b, c):
        return abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]))
    while len(poly) > 6:
        costs = [area(poly[i - 1], poly[i], poly[(i + 1) % len(poly)]) for i in range(len(poly))]
        del poly[int(np.argmin(costs))]
    poly = np.array(poly)
    # name them: the topmost is the back corner and the lowest the front of
    # the base; of the two left of the back corner the higher is the top
    # face's and the lower the base's, and the same right of the front
    back = poly[np.argmin(poly[:, 1])]
    front = poly[np.argmax(poly[:, 1])]
    left = sorted(poly[poly[:, 0] < back[0]], key=lambda p: p[1])
    right = sorted(poly[poly[:, 0] > front[0]], key=lambda p: p[1])
    lt, lb, rt, rb = left[0], left[-1], right[0], right[-1]
    wall = ((lb[1] - lt[1]) + (rb[1] - rt[1])) / 2
    return dict(lt=lt, b=back, rt=rt, rb=rb, f=front, lb=lb, wall=float(wall))


def homography(src, dst):
    rows = []
    for (x, y), (u, v) in zip(src, dst):
        rows.append([x, y, 1, 0, 0, 0, -u * x, -u * y, -u])
        rows.append([0, 0, 0, x, y, 1, -v * x, -v * y, -v])
    h = np.linalg.svd(np.array(rows, float))[2][-1].reshape(3, 3)
    return h / h[2, 2]


def apply(h, p):
    v = h @ np.array([p[0], p[1], 1.0])
    return v[:2] / v[2]


def noise(shape, blur, seed):
    n = ndi.gaussian_filter(np.random.default_rng(seed).random(shape), blur)
    return (n - n.mean()) / max(n.std(), 1e-6)


def shore(base, size, scale):
    """Foam where the land stands in the sea: a broken white collar hugging
    the base, flecks of it a little further out, and the paler shallow
    water round it all. Distances are in frame px. Drawn under the land,
    so only what shows round it is ever seen."""
    w, h = size
    yy, xx = np.mgrid[0:h, 0:w]
    inside = np.ones((h, w), bool)
    pts = [base[k] for k in ('l', 'b', 'r', 'f')]
    for i in range(4):
        (x0, y0), (x1, y1) = pts[i], pts[(i + 1) % 4]
        inside &= (x1 - x0) * (yy - y0) - (y1 - y0) * (xx - x0) >= 0
    out = ndi.distance_transform_edt(~inside) / scale
    fine = noise((h, w), 1.3 * scale, 7)
    broad = noise((h, w), 5 * scale, 11)
    band = 4.5 + 2.2 * broad                       # the collar's width along the shore
    collar = np.clip((band - out) / 1.6, 0, 1) * np.clip((fine + .9) / .8, 0, 1)
    flecks = np.clip((fine - 1.1) / .5, 0, 1) * np.clip(1 - np.abs(out - band - 5) / 4, 0, 1)
    foam = np.clip(collar + flecks, 0, 1) * ~inside
    shallow = np.exp(-out / 20) * .42 * ~inside
    rgba = np.zeros((h, w, 4))
    a = np.clip(foam + shallow * (1 - foam), 0, 1)
    col = foam[..., None] * np.array([255, 255, 255]) + \
        (shallow * (1 - foam))[..., None] * np.array([168, 240, 255])
    rgba[..., :3] = col / np.maximum(a, 1e-6)[..., None]
    rgba[..., 3] = a * 255
    return rgba


def export(name, arr):
    im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    im.save(OUT / (name + '.webp'), quality=90, method=6)
    return 'assets/images/cinematic/' + name + '.webp'


def pack(frames, width=2048, gap=4):
    order = sorted(range(len(frames)), key=lambda i: -frames[i].shape[0])
    rects = [None] * len(frames)
    x = y = shelf = 0
    for i in order:
        h, w = frames[i].shape[:2]
        if x + w > width:
            x, y, shelf = 0, y + shelf + gap, 0
        rects[i] = [x, y, w, h]
        x += w + gap
        shelf = max(shelf, h)
    atlas = np.zeros((y + shelf, width, 4))
    for i, (x, y, w, h) in enumerate(rects):
        atlas[y:y + h, x:x + w] = frames[i]
    used = max(r[0] + r[2] for r in rects)
    return atlas[:, :used], rects


def landing(key, cfg, land_src):
    frames = cut(cfg)
    ref = frames[cfg['ref'] - 1]
    g = hull(ref)
    d0 = dome(ref)
    wall = g['wall']
    foot_pts = dict(l=g['lb'], f=g['f'], r=g['rb'], b=(g['b'][0], g['b'][1] + wall))
    origin = np.mean([foot_pts[k] for k in 'lfrb'], axis=0)
    foot0 = origin - np.array(d0)            # from the dome to the foot, ref frame

    # the island the craft is put down on: the footprint, scaled by side
    side = cfg['side']
    top = {k: origin + (np.array(p) - origin) * side for k, p in foot_pts.items()}

    # the land, re-projected into this sheet's camera at LAND_RES
    R = LAND_RES
    H = homography([LAND_TOP[k] for k in 'lbrf'], [top[k] * R for k in 'lbrf'])
    corners = [apply(H, p) for p in [(0, 0), (land_src.width, 0), (0, land_src.height),
                                     (land_src.width, land_src.height)]]
    lo = np.floor(np.min(corners, axis=0)) - 40 * R
    hi = np.ceil(np.max(corners, axis=0)) + 40 * R
    T = np.array([[1, 0, -lo[0]], [0, 1, -lo[1]], [0, 0, 1]]) @ H
    Ti = np.linalg.inv(T)
    size = (int(hi[0] - lo[0]), int(hi[1] - lo[1]))
    land = land_src.transform(size, Image.PERSPECTIVE, tuple((Ti / Ti[2, 2]).ravel()[:8]),
                              Image.BICUBIC)
    base = {k: apply(T, p) for k, p in LAND_BASE.items()}
    sea = shore(base, size, R)
    la = np.array(land).astype(float)
    sa = la[..., 3:] / 255
    comp = sea.copy()
    comp[..., :3] = la[..., :3] * sa + sea[..., :3] * (sea[..., 3:] / 255) * (1 - sa)
    comp[..., 3] = la[..., 3] + sea[..., 3] * (1 - sa[..., 0])
    comp[..., :3] /= np.maximum(comp[..., 3:] / 255, 1e-6)
    ys, xs = np.nonzero(comp[..., 3] > 3)
    y0, x0 = ys.min(), xs.min()
    comp = comp[y0:ys.max() + 1, x0:xs.max() + 1]
    land_off = (np.array([x0, y0]) + lo) / R - origin   # its top-left, from the foot

    def rel(p):
        return [round(float(v), 2) for v in (np.array(p) - origin)]

    # the shadow: the footprint, solid, blurred
    pad = 40
    fp = np.array([foot_pts[k] for k in 'lbrf']) - origin
    span = fp.max(axis=0) - fp.min(axis=0)
    sw, sh = (span + 2 * pad).astype(int)
    shadow = Image.new('L', (int(sw), int(sh)), 0)
    ImageDraw.Draw(shadow).polygon([tuple(p - fp.min(axis=0) + pad) for p in fp], fill=150)
    shadow = shadow.filter(ImageFilter.GaussianBlur(span[0] * .045))
    sh_rgba = np.zeros((int(sh), int(sw), 4))
    sh_rgba[..., :3] = (4, 30, 52)
    sh_rgba[..., 3] = np.array(shadow)

    front = foot_pts['f'][1] - origin[1]     # the base's front corner, below the foot
    meta_frames = []
    for i, fr in enumerate(frames, start=1):
        f = dict()
        pl = pool(fr)
        dm = DOME.get(key, {}).get(i) or dome(fr) or (None if pl else dome(fr, 0))
        if dm:
            f['dome'] = [round(v, 1) for v in dm]
        if pl:
            f['pool'] = [round(v, 1) for v in pl]
        if dm and i in cfg['level']:
            foot = np.array(dm) + foot0
            f['foot'] = [round(float(v), 1) for v in foot]
            # this frame's own outline, from its own foot: the sheets are
            # not drawn from one camera, and a hull from another frame cuts
            # the craft or lets the dust in
            own = hull(fr, dusty=True)
            f['hull'] = [[round(float(own[k][0] - foot[0]), 1), round(float(own[k][1] - foot[1]), 1)]
                         for k in ('lt', 'b', 'rt', 'rb', 'f', 'lb')]
            ys, xs = np.nonzero(fire(fr))
            # how far the painted burn reaches below the base's front corner;
            # the hull's own lamps are above it, so they never count
            reach = float(ys.max() - foot[1] - front) if len(ys) else 0
            if reach > 4:
                f['burn'] = round(reach, 1)
        meta_frames.append(f)

    atlas, rects = pack(frames)
    for f, r in zip(meta_frames, rects):
        f['rect'] = r

    return dict(
        side=round(side, 4),
        atlas=export('atlas-' + key, atlas), atlasSize=[atlas.shape[1], atlas.shape[0]],
        frames=meta_frames,
        land=export('land-' + key, comp), landSize=[comp.shape[1], comp.shape[0]], landRes=R,
        landAt=[round(float(v), 2) for v in land_off],
        top={k: rel(p) for k, p in top.items()},
        base={k: rel(np.array(p) / R + lo / R) for k, p in base.items()},
        foot={k: rel(p) for k, p in foot_pts.items()},
        hull={k: rel(g[k]) for k in ('lt', 'b', 'rt', 'rb', 'f', 'lb')},
        wall=round(wall, 1),
        shadow=export('shadow-' + key, sh_rgba), shadowSize=[int(sw), int(sh)],
        shadowAt=[round(float(v), 2) for v in fp.min(axis=0) - pad],
        source=str((SOURCE / cfg['src']).relative_to(ROOT)),
    )


def main():
    OUT.mkdir(exist_ok=True, parents=True)
    land_src = Image.open(SOURCE / 'square land from angle view.png').convert('RGBA')
    data = {key: landing(key, cfg, land_src) for key, cfg in SHEETS.items()}
    sea = Image.open(SOURCE / 'bg.png').convert('RGB')
    sea.save(OUT / 'sea.webp', quality=86, method=6)
    data['sea'] = dict(src='assets/images/cinematic/sea.webp', size=list(sea.size),
                       source=str((SOURCE / 'bg.png').relative_to(ROOT)))
    (ROOT / 'js/cinematic-assets.js').write_text(
        '// Generated by tools/build_cinematic.py\nwindow.GeoCinemaAssets = ' +
        json.dumps(data, separators=(',', ':')) + ';\n')
    for key in SHEETS:
        d = data[key]
        print('%-6s %2d frames, atlas %s, land %s' % (key, len(d['frames']), d['atlasSize'], d['landSize']))


if __name__ == '__main__':
    main()
