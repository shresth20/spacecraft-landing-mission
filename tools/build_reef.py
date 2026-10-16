"""Cut the reef's sprites out of the underwater rock sheet in assets/images/new2.

The flown landing's sea (css/reef.css, js/reef.js) has rocks under the
water, and they come off a generated sprite sheet whose alpha is not
clean enough to lay straight on the sea: every rock stands in a faint
blue haze of near-transparent pixels that reads as a glowing outline.
So each rock is cut out by its own connected region, the haze is
thresholded away, and the result is baked for where it goes:

  deep rocks    assets/images/reef/deep-NN.webp
                Submerged at build time -- softened, flattened in
                contrast and pulled towards the water's own blue -- so
                the page needs no filter to make them look it, only an
                opacity.

  the sea       assets/images/reef/sea.webp
                "Serene Azure Ocean Currents", re-encoded.

Prints the sprite table js/reef.js keeps (each sprite's size), which
is what lets the layout be worked out before a single image has
decoded. Run it again if a pick below changes, then run
tools/build_manifest.py so the loading bar knows the new files:

    python3 tools/build_reef.py
    python3 tools/build_manifest.py

Dev tooling only (Pillow, NumPy, SciPy): not needed at runtime.
"""
import os
import sys

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as ndi

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets", "images", "new2")
OUT = os.path.join(ROOT, "assets", "images", "reef")

UNDER = "Underwater Rock Asset Sheet.png"
SEA = "Serene Azure Ocean Currents (1).png"

# One point on each rock to keep, (x, y) on the sheet: the flatter
# rocks and the broad clusters -- the tall stacks in the sheet's top
# rows are drawn side-on and give the overhead camera away.
UNDER_PICKS = [
    (223, 201), (1245, 238), (1257, 502), (914, 498), (152, 690),
    (393, 683), (662, 681), (904, 690), (800, 821), (1127, 819),
    (591, 930), (918, 932), (1360, 931), (605, 1022),
]

UNDER_MAX = 320      # px, longest side; softened, so upscaling is free


def labels(alpha, thr):
    """Each rock and the pebbles touching it, as one labelled region."""
    solid = ndi.binary_opening(alpha > thr, iterations=1)
    lab, _n = ndi.label(ndi.binary_dilation(solid, iterations=5))
    return lab


def region_at(lab, x, y):
    k = lab[y, x]
    if k == 0:
        # the seed fell in a gap: take the nearest labelled pixel
        ys, xs = np.nonzero(lab)
        i = np.argmin((ys - y) ** 2 + (xs - x) ** 2)
        k = lab[ys[i], xs[i]]
    return lab == k


def cut(rgba, region, lo, hi, pad):
    ys, xs = np.nonzero(region)
    y0, y1 = max(ys.min() - pad, 0), min(ys.max() + pad + 1, rgba.shape[0])
    x0, x1 = max(xs.min() - pad, 0), min(xs.max() + pad + 1, rgba.shape[1])
    px = rgba[y0:y1, x0:x1].astype(np.float32)
    keep = region[y0:y1, x0:x1]
    a = np.clip((px[..., 3] - lo) / (hi - lo), 0, 1) * keep
    return px[..., :3], a


def to_image(rgb, a):
    out = np.dstack([np.clip(rgb, 0, 255), np.clip(a * 255, 0, 255)])
    return Image.fromarray(out.astype(np.uint8))


def fit(im, longest):
    w, h = im.size
    s = min(1.0, longest / max(w, h))
    size = (max(1, round(w * s)), max(1, round(h * s)))
    # premultiplied, so the edge does not darken on the way down
    return im.convert("RGBa").resize(size, Image.LANCZOS).convert("RGBA")


def deep_rock(rgb, a):
    water = np.array([4, 86, 142], np.float32)
    mean = rgb.mean(axis=(0, 1), keepdims=True)
    rgb = mean + (rgb - mean) * 0.8           # flatter
    rgb = (rgb * 0.58 + water * 0.42) * 0.86  # bluer, and a shade darker
    im = fit(to_image(rgb, a * 0.9), UNDER_MAX)
    # soft, as seen through a metre of water -- premultiplied again
    return im.convert("RGBa").filter(ImageFilter.GaussianBlur(1.4)).convert("RGBA")


def main():
    os.makedirs(OUT, exist_ok=True)
    sizes = []

    sheet = np.array(Image.open(os.path.join(SRC, UNDER)).convert("RGBA"))
    lab = labels(sheet[..., 3], 60)
    for i, (x, y) in enumerate(UNDER_PICKS, 1):
        rgb, a = cut(sheet, region_at(lab, x, y), 90, 230, 6)
        im = deep_rock(rgb, a)
        im.save(os.path.join(OUT, f"deep-{i:02d}.webp"), "WEBP",
                quality=84, alpha_quality=92, method=6)
        sizes.append(im.size)

    sea = Image.open(os.path.join(SRC, SEA)).convert("RGB")
    sea.save(os.path.join(OUT, "sea.webp"), "WEBP", quality=82, method=6)

    total = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT))
    print(f"{len(os.listdir(OUT))} files, {total:,} bytes -> assets/images/reef/")
    print("\n/* sprite table for js/reef.js: [width, height] in px */")
    print("DEEP: [" + ", ".join(f"[{w}, {h}]" for w, h in sizes) + "]")
    return 0


if __name__ == "__main__":
    sys.exit(main())
