"""Extract the supplied new3 artwork; no generated/repainted runtime art.

Dev dependencies: Pillow, NumPy, SciPy (also used by build_reef.py).
Writes transparent, bounded textures and measured metadata used by reef.js.
Run python3 tools/build_environment.py, then python3 tools/build_manifest.py.
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'assets/new3/dynamic-water-guide/assets'
OUT = ROOT / 'assets/images/environment'
# How far under the water the submerged rocks are baked: contrast kept, share
# of the sea's blue mixed in, overall shade, and blur in px.
SUBMERGE = dict(contrast=.8, sea=.3, shade=.92, blur=.8)


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


def outline(im):
    # Trace pixel edges of the dominant connected solid silhouette. This keeps
    # the actual notches; neither a bounding ellipse nor a convex hull.
    thumb = im.copy()
    thumb.thumbnail((180, 180))
    mask = ndi.binary_fill_holes(np.array(thumb)[..., 3] > 110)
    labels, _ = ndi.label(mask)
    counts = np.bincount(labels.ravel()); counts[0] = 0
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


def unpaper(a):
    # A sheet painted on white with no alpha: the rocks are saturated blue,
    # the paper and its pale frame are grey, so colourfulness is the matte.
    # Solid interiors stay opaque (pale highlights included, paper caught
    # between rocks not), and the paper is un-mixed out of the soft edge so
    # no white fringe survives.
    rgb = a[..., :3]
    chroma = rgb.max(axis=2) - rgb.min(axis=2)
    alpha = np.clip((chroma - 14) / 46, 0, 1)
    alpha[ndi.binary_fill_holes(alpha > .5) & (rgb.min(axis=2) < 215)] = 1
    a[..., :3] = np.clip((rgb - (1 - alpha[..., None]) * 255) / np.maximum(alpha, .001)[..., None], 0, 255)
    a[..., 3] = alpha * 255


def export(name, source, crop, longest, footprint=None, submerged=False, group=False, flat=None):
    original = Image.open(source)
    im = original.convert('RGBA').crop(crop)
    a = np.array(im).astype(float)
    if name == 'platform':
        # Edge-connected white only, retaining pale rock highlights.
        white = (a[..., :3].min(axis=2) > 225)
        bg = ndi.binary_propagation(np.pad(np.ones((1, im.width), bool),
              ((0, im.height - 1), (0, 0))), mask=white)
        a[bg, 3] = 0
    else:
        if original.mode == 'RGB':
            unpaper(a)
        else:
            # Remove the near-transparent cyan/orange matte fringes from sheets.
            a[..., 3] = np.clip((a[..., 3] - 85) / 145, 0, 1) * 255
        # Exclude disconnected neighbouring sprites and cropped sheet scraps.
        # A group (a cluster, or a land fragment with its pebbles) keeps every
        # real piece in its crop, and drops only specks.
        labels, _ = ndi.label(ndi.binary_opening(a[..., 3] > 80))
        counts = np.bincount(labels.ravel()); counts[0] = 0
        keep = np.isin(labels, np.nonzero(counts >= 24)[0]) if group else labels == counts.argmax()
        a[..., 3] *= ndi.binary_dilation(keep, iterations=2)
    if submerged:
        # Seen through a metre of water: flatter contrast, pulled towards the
        # sea's own blue and a shade darker, so the page needs no filter.
        rgb, w = a[..., :3], a[..., 3:] / 255
        mean = (rgb * w).sum(axis=(0, 1), keepdims=True) / max(w.sum(), 1)
        rgb = mean + (rgb - mean) * SUBMERGE['contrast']
        mix = SUBMERGE['sea']
        a[..., :3] = (rgb * (1 - mix) + np.array([8, 92, 168]) * mix) * SUBMERGE['shade']
        a[..., 3] *= .94
    im = Image.fromarray(a.astype('uint8'))
    bounds = im.getbbox()
    im = im.crop(bounds)
    if footprint:
        x, y, w, h = footprint
        # Rectify the supplied near-overhead top plane ONCE, at export, so
        # its straight top surface is square with uniform runtime scaling.
        sy = w / h
        im = im.resize((im.width, round(im.height * sy)), Image.Resampling.LANCZOS)
        footprint = [x - crop[0] - bounds[0], (y - crop[1] - bounds[1]) * sy, w, w]
    scale = min(1, longest / max(im.size))
    im = im.convert('RGBa').resize((round(im.width * scale), round(im.height * scale)),
                                  Image.Resampling.LANCZOS)
    if submerged and SUBMERGE['blur']:
        from PIL import ImageFilter
        im = im.filter(ImageFilter.GaussianBlur(SUBMERGE['blur']))
    im = im.convert('RGBA')
    # Two pixels of real transparent padding keep resampling away from edges.
    padded = Image.new('RGBA', (im.width + 4, im.height + 4))
    padded.paste(im, (2, 2)); im = padded
    im.save(OUT / (name + '.webp'), quality=92, method=6)
    meta = dict(src='assets/images/environment/' + name + '.webp',
                source=str(source.relative_to(ROOT)), sourceSize=list(original.size),
                sourceCrop=list(crop), size=list(im.size), anchor=[im.width / 2, im.height / 2],
                waterline=outline(im))
    if flat:
        # The fragment's straight cut, which reef.js lays on the screen edge:
        # which side it is, and its x in sprite px.
        cols = np.nonzero((np.array(im)[..., 3] > 110).any(axis=0))[0]
        meta['flat'] = dict(side=flat, x=int(cols[0]) if flat == 'left' else int(cols[-1]) + 1)
    if footprint:
        meta['sourceFootprint'] = [140, 150, 974, 888]
        meta['footprint'] = [round(footprint[0] * scale + 2, 3), round(footprint[1] * scale + 2, 3),
                             round(footprint[2] * scale, 3), round(footprint[3] * scale, 3)]
        meta['cliffExtent'] = [0, meta['footprint'][1] + meta['footprint'][3], im.width, im.height]
    return meta


def runtime(data):
    """Only what js/reef.js, js/reef-water.js and js/square-landing.js read:
    every sprite's src and size, the waterline where land breaks the
    surface (platform and dry rocks), each edge fragment's flat side, and
    the platform's footprint. The provenance fields are build-time only."""
    def pick(meta, *keys):
        return {k: meta[k] for k in ('src', 'size') + keys if k in meta}
    return dict(platform=pick(data['platform'], 'waterline', 'footprint'),
                dry=[pick(m, 'waterline') for m in data['dry']],
                edge=[pick(m, 'flat') for m in data['edge']],
                deep=[pick(m) for m in data['deep']],
                ocean=pick(data['ocean']))


def main():
    OUT.mkdir(exist_ok=True, parents=True)
    data = dict(platform=export('platform', SOURCE / 'square-land.png', (0, 0, 1254, 1254),
                               768, [140, 150, 974, 888]), dry=[], edge=[], deep=[])
    dry = [(12, 379, 148, 486), (194, 379, 315, 486), (344, 379, 494, 486),
           (532, 389, 606, 463), (690, 400, 762, 473), (1010, 385, 1109, 476),
           (1165, 398, 1242, 474), (1296, 406, 1359, 470)]
    for i, crop in enumerate(dry):
        data['dry'].append(export(f'dry-{i + 1:02}', SOURCE / 'small and side dry rocks.png', crop, 144))
    # The big land fragments, each with its own pebbles, label excluded. Each
    # one's longest straight side is a cut, laid on the screen edge at run
    # time. The second fragment on the sheet (the diagonal strip) has no
    # straight side, so it is not used.
    for i, (crop, side) in enumerate([((0, 39, 400, 335), 'left'), ((850, 39, 1140, 335), 'right'),
                                      ((1170, 39, 1512, 335), 'right')]):
        data['edge'].append(export(f'edge-{i + 1:02}', SOURCE / 'small and side dry rocks.png', crop, 400,
                                   group=True, flat=side))
    # Under the water: the six clusters of "underwater rock layer 02" only.
    layer = SOURCE / 'underwater rock layer 02.png'
    for i, crop in enumerate([(8, 0, 207, 177), (250, 4, 464, 173), (509, 3, 743, 179),
                              (789, 14, 1001, 180), (1041, 5, 1253, 181), (1292, 2, 1484, 191)]):
        data['deep'].append(export(f'deep-{i + 1:02}', layer, crop, 240, submerged=True, group=True))
    sea = SOURCE / 'bg water.png'
    Image.open(sea).save(OUT / 'ocean.webp', quality=92, method=6)
    data['ocean'] = dict(src='assets/images/environment/ocean.webp', source=str(sea.relative_to(ROOT)), size=[1672, 941])
    # Drop textures a previous pick left behind.
    names = {Path(m['src']).name for k in ('dry', 'edge', 'deep') for m in data[k]}
    for old in OUT.glob('*-0*.webp'):
        if old.name not in names:
            old.unlink()
    (ROOT / 'js/environment-assets.js').write_text('// Generated by tools/build_environment.py\nwindow.GeoEnvironmentAssets = ' + json.dumps(runtime(data), separators=(',', ':')) + ';\n')
    print('Exported platform, %d dry rocks, %d edge fragments, %d submerged rocks and ocean.'
          % (len(data['dry']), len(data['edge']), len(data['deep'])))


if __name__ == '__main__':
    main()
