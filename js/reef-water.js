/* The square landing's live water. A per-pixel pass, after the one in
   Fishing Frenzy (ice-age-fishing-2): the sea under the camera is drawn
   through moving water rather than shown as a still picture.

   One WebGL canvas sits exactly where the ocean plate (.s3-bg) is in the
   paint order, under the camera plate. Each frame it draws, bottom to top:

     layer 01  the ocean              sampled through the plate's current
                                      transform (cover, like the CSS)
     layer 02  rocks under the water  sampled at each .env-submerged
                                      element's current box, at its opacity

   all through the same slow refraction and a live rippling surface over
   it (five sizes of ripple, each rolling its own way, bending the
   painting under them and shading their own faces), then lights them
   with soft drifting bands of sunlight and a slow shimmer. No caustic
   net: its lines read as too busy here. Everything dry (platforms, small rocks,
   edge fragments, their shoreline rings, the craft) is DOM over the
   canvas, so it stays perfectly still.

   Round every piece of dry land it draws the shore, from the land's own
   silhouettes (a distance field over all the land in the camera plate:
   site B's, site A's islands, the islets and the rock strewn between
   them): shallows glowing turquoise against it, swell rolling in that
   only bends the water, and broken foam washing up and drawing back. No
   outline is drawn.

   When land comes up (`.pad.is-up`, `.islet.is-up`) the water answers it,
   in real time rather than on the slow sea clock: a boil of bubbles and a
   swell over it, then foam pushed off its waterline and three wave rings
   that follow its shape outward, bending the sea as they pass, with small
   bubbles rising round it, all at the size the camera shows that land.
   css/reef.css plays the land's half on the reef's own rock.

   Effects are in ocean-painting pixels (1672 wide, the reference stage's
   own width), so the water zooms and pans with the ocean plate. Without
   WebGL, or until the artwork has decoded, the canvas stays hidden and
   the plain ocean and DOM rocks show as before. */
(function (global) {
  'use strict';
  var doc = document, ART = global.GeoEnvironmentAssets;
  var MAX_ROCKS = 16, MAX_EVENTS = 32, MAX_LANDS = 128;
  var CONFIG = {
    // the strength of the whole pass; light levels are added brightness
    amplitude: 1, reducedAmplitude: .35, rays: .07, shimmer: .03,
    // how fast the water's clock runs against the reference's (1)
    speed: .4,
    // the surface itself, on real seconds: ripples of five sizes rolling
    // across the painting, each one bending what is under it (`refract`,
    // painting px per unit of slope) and lighting the faces turned to the
    // sun (`shade`). It only warps and lights the ocean image; nothing is
    // drawn over it.
    surfaceSpeed: 1, refract: 11, shade: .3,
    // a breach, in real seconds from the land starting up (css/reef.css
    // envRise): it breaks the surface at `breach`, and its water has
    // settled by `eventLife`. Small rocks move this share of the water,
    // and seen from further off than `rockZoom` (the camera's scale)
    // throw none of their own: from on high they are a few pixels across.
    breach: .45, eventLife: 4.2, rockStrength: .55, rockZoom: .6,
    // the breach follows the camera's scale down to this and no further:
    // any smaller, its rings close up into lines and its bubbles into dust
    breachZoom: .55,
    // the shore: how far out from land it reaches (camera plate px), when
    // a surfacing island's shore comes in (s after it starts up, and over)
    // and how long it takes to go once the island sinks again
    shoreReach: 64, shoreIn: .35, shoreFade: 1.3, sinkFade: 1.1,
    // the shore map's cells: at most this many, however big the sea
    maxCells: 1300000,
    // how strongly the shallows glow, the foam shows and the swell bends
    shoreGlow: .75, shoreFoam: 1, shoreSwell: 1.6,
    // backing pixels never exceed the painting's resolution (times this),
    // and drop to `slowQuality` if frames keep running long
    resolution: 1.15, slowQuality: .65, slowFrameMs: 24
  };

  var VERTEX = [
    'attribute vec2 aPos;',
    'void main() { gl_Position = vec4(aPos, 0.0, 1.0); }'
  ].join('\n');

  var FRAGMENT = [
    'precision highp float;',
    'uniform vec2 uRes;',
    'uniform float uTime;',
    'uniform float uAmp;',
    'uniform vec4 uOcean;',          // cover box of the painting, canvas px
    'uniform float uUnit;',          // canvas px per painting px
    'uniform sampler2D uSea;',
    'uniform sampler2D uAtlas;',
    'uniform vec4 uRock[' + MAX_ROCKS + '];',   // canvas px box (w 0: unused)
    'uniform vec4 uCell[' + MAX_ROCKS + '];',   // atlas uv box
    'uniform float uRockAlpha;',
    'uniform vec2 uLight;',          // rays, shimmer
    'uniform vec4 uEv[' + MAX_EVENTS + '];',    // breach: centre, half size, canvas px
    'uniform vec4 uEvT[' + MAX_EVENTS + '];',   // age s, strength (0: unused), corner px (< 0: a rhombus), seed
    'uniform float uEvents;',
    'uniform sampler2D uField;',     // distance to land, outward direction
    'uniform sampler2D uFieldId;',   // which land is nearest (its index / 255)
    'uniform sampler2D uLand;',      // each land's shore strength, in a row
    'uniform vec4 uSite;',           // the field's box, canvas px
    'uniform float uWorld;',         // canvas px per camera plate px
    'uniform float uClock;',         // real seconds (0: still)
    'uniform float uShore;',         // 0 until the field is built
    'uniform vec3 uShoreMix;',       // glow, foam, swell
    'uniform vec3 uSurf;',           // surface clock (s), refract, shade
    'uniform float uZoom;',          // the camera's scale (1: a site's frame)
    'const float BREACH = ' + CONFIG.breach.toFixed(3) + ';',
    'const float REACH = ' + CONFIG.shoreReach.toFixed(1) + ';',
    'const float LANDS = ' + MAX_LANDS.toFixed(1) + ';',

    'float hash(vec2 c) { return fract(sin(dot(c, vec2(127.1, 311.7))) * 43758.5453); }',
    'float noise(vec2 x) {',
    '  vec2 i = floor(x), f = fract(x);',
    '  f = f * f * (3.0 - 2.0 * f);',
    '  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),',
    '             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);',
    '}',
    // signed distance outside a rounded box, and the outward direction there
    'float box(vec2 p, vec2 h, float r, out vec2 n) {',
    '  vec2 a = abs(p) - h + r, o = max(a, 0.0);',
    '  vec2 sg = vec2(p.x < 0.0 ? -1.0 : 1.0, p.y < 0.0 ? -1.0 : 1.0);',
    '  n = sg * (o.x + o.y > 0.0 ? normalize(o + 0.0001) : (a.x > a.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0)));',
    '  return length(o) + min(max(a.x, a.y), 0.0) - r;',
    '}',
    // and outside a rhombus with half diagonals h (after Inigo Quilez)
    'float rhomb(vec2 p, vec2 h, out vec2 n) {',
    '  vec2 q = abs(p), sg = vec2(p.x < 0.0 ? -1.0 : 1.0, p.y < 0.0 ? -1.0 : 1.0);',
    '  float t = clamp(((h.x - 2.0 * q.x) * h.x - (h.y - 2.0 * q.y) * h.y) / dot(h, h), -1.0, 1.0);',
    '  vec2 o = q - 0.5 * h * vec2(1.0 - t, 1.0 + t);',
    '  float side = q.x * h.y + q.y * h.x - h.x * h.y;',
    '  n = sg * (side > 0.0 ? normalize(o + 0.0001) : normalize(vec2(h.y, h.x)));',
    '  return length(o) * (side > 0.0 ? 1.0 : -1.0);',
    '}',
    // a breach's land: a rounded box, or a rhombus where the corner is < 0
    'float shapeOf(vec2 p, vec2 h, float r, out vec2 n) {',
    '  return r < 0.0 ? rhomb(p, h, n) : box(p, h, r, n);',
    '}',

    // One grid of bubbles round a breach. A cell holds at most one, placed
    // by the distance of its own centre so none is cut off; each is born at
    // its own moment, swells, drifts off with the water and pops. They boil
    // over the land itself only until it is up.
    'float bubbles(vec2 s, float g, float a, float seed, vec2 ec, vec2 eh, float er, float k) {',
    '  vec2 cell = floor(s / g);',
    '  float h1 = hash(cell + seed), h2 = hash(cell + seed + 17.3), h3 = hash(cell + seed + 41.9);',
    '  vec2 c = (cell + 0.32 + 0.36 * vec2(h3, h2)) * g, n;',
    '  float dc = shapeOf(c - ec, eh, er, n), grow = min(a, 1.6);',
    '  float density = k * 0.5 * (1.0 - smoothstep(4.0 + 22.0 * grow, 14.0 + 36.0 * grow, dc));',
    '  if (dc < -3.0) density *= 1.0 - smoothstep(0.1, BREACH + 0.2, a);',
    '  if (h1 >= density) return 0.0;',
    '  float ph = (a - (h2 * h2 * 2.4 - 0.05)) / (0.3 + 0.45 * h3);',
    '  if (ph <= 0.0 || ph >= 1.0) return 0.0;',
    '  c += n * ph * g * 0.05;',
    '  float rad = g * (0.1 + 0.14 * h1 / max(density, 0.001)) * (0.65 + 0.35 * ph + 0.3 * smoothstep(0.86, 1.0, ph));',
    '  float dist = length(s - c);',
    '  float rim = smoothstep(rad * 0.55, rad * 0.82, dist) * (1.0 - smoothstep(rad * 0.86, rad, dist));',
    '  float body = 1.0 - smoothstep(rad * 0.5, rad, dist);',
    '  float spec = 1.0 - smoothstep(0.0, rad * 0.32, length(s - c + rad * vec2(0.34, 0.38)));',
    '  return (rim * 0.6 + body * 0.1 + spec * 0.7) * smoothstep(0.0, 0.18, ph) * (1.0 - smoothstep(0.82, 1.0, ph));',
    '}',

    // The shore round every piece of land, from its own silhouette: the
    // shallows glowing turquoise against it, swell rolling in that only
    // bends the water (no line is drawn), and broken foam that washes up
    // the land and draws back again.
    'void shore(vec2 p, inout vec2 disp, inout float glow, inout float foam) {',
    '  vec2 fuv = (p - uSite.xy) / uSite.zw;',
    '  if (fuv.x < 0.0 || fuv.y < 0.0 || fuv.x > 1.0 || fuv.y > 1.0) return;',
    '  vec4 f = texture2D(uField, fuv);',
    '  if (f.r > 0.99) return;',
    '  float id = floor(texture2D(uFieldId, fuv).r * 255.0 + 0.5);',
    '  float k = texture2D(uLand, vec2((id + 0.5) / LANDS, 0.5)).r;',
    '  if (k <= 0.0) return;',
    '  float d = f.r * REACH, t = uClock;',             // plate px from that land
    '  vec2 dir = f.gb * 2.0 - 1.0, w = (p - uSite.xy) / uWorld;',
    '  float swell = sin(d * 0.17 + t * 1.3 + id * 1.7) * exp(-d / 30.0) * smoothstep(0.0, 5.0, d);',
    '  disp += dir * swell * uShoreMix.z * k * uWorld / uUnit;',
    '  glow += k * (1.0 - smoothstep(REACH * 0.6, REACH, d)) *',
    '    (0.55 * exp(-d / 12.0) + 0.45 * exp(-d / 32.0)) * (0.88 + 0.12 * swell);',
    '  if (d < 22.0) {',
    '    float lap = 0.5 + 0.5 * sin(t * 1.1 + id * 2.3 + dot(w, vec2(0.013, 0.009)));',
    '    float reach = 2.5 + 6.5 * lap;',
    '    float fn = noise(w * 0.21 + vec2(t * 0.25, -t * 0.18)) * 0.65 + noise(w * 0.53 - vec2(t * 0.2, t * 0.3)) * 0.35;',
    '    float band = 1.0 - smoothstep(reach * 0.35, reach, d);',
    '    foam += uShoreMix.y * k * smoothstep(0.55, 0.8, fn * 0.8 + band * 0.25) * band;',
    '  }',
    '}',

    // The water's half of land coming up (css/reef.css has the land's): a
    // boil and a swell over it, then, as it breaks through, foam pushed off
    // its waterline and three wave rings that follow its shape outward,
    // bending the sea under them, with bubbles rising all round. Worked out
    // in painting px over the camera's scale, so from on high it is the same
    // event as close to, only as small as the land it comes off.
    'void breach(vec2 p, inout vec2 disp, inout float light, inout float foam, inout float bub) {',
    '  vec2 s = p / uZoom, moved = vec2(0.0);',
    '  for (int i = 0; i < ' + MAX_EVENTS + '; i++) {',
    '    vec4 e = uEv[i], et = uEvT[i];',
    '    if (et.y <= 0.0) continue;',
    '    float a = et.x, k = et.y, unit = uUnit * uZoom;',
    '    vec2 ec = (e.xy - uOcean.xy) / unit, eh = e.zw / unit, n;',
    '    float er = et.z / unit, size = min(eh.x, eh.y);',
    '    float d = shapeOf(s - ec, eh, er, n);',
    '    if (d > 30.0 + 150.0 * a) continue;',
    '    float pre = k * smoothstep(0.0, 0.18, a) * (1.0 - smoothstep(BREACH, BREACH + 0.45, a));',
    '    float over = 1.0 - smoothstep(-4.0, 26.0, d);',
    '    float churn = noise(s * 0.09 + vec2(a * 3.1, -a * 2.3) + et.w);',
    '    moved += (vec2(churn, noise(s * 0.09 - vec2(a * 2.7, a * 1.9) + et.w + 5.0)) - 0.5) * 7.0 * pre * over;',
    '    moved -= n * 5.0 * pre * exp(-max(d, 0.0) / 16.0);',
    '    light += pre * over * (0.06 + 0.1 * churn);',
    '    float outside = smoothstep(-3.0, 3.0, d);',
    '    for (int j = 0; j < 3; j++) {',
    '      float fj = float(j), tr = a - BREACH - 0.3 * fj;',
    '      if (tr <= 0.0) continue;',
    '      float front = 3.0 + (125.0 - 16.0 * fj) * tr, wl = 14.0 + 10.0 * tr, x = d - front;',
    '      float amp = k * (1.0 - 0.22 * fj) * exp(-tr * 0.8) * (size + 50.0) / (size + 50.0 + front);',
    '      float w = sin(x / wl * 6.2832) * exp(-x * x / (wl * wl * 0.8)) * amp * outside;',
    '      moved += n * w * 5.0;',
    '      light += max(w, 0.0) * 0.22 + min(w, 0.0) * 0.12;',
    '    }',
    '    float ta = a - BREACH;',
    '    if (d < 70.0 && ta > -0.1 && ta < 2.6) {',
    '      float spread = 6.0 + 30.0 * clamp(ta, 0.0, 2.6);',
    '      float zone = smoothstep(-4.0, 1.0, d) * (1.0 - smoothstep(spread * 0.4, spread, d));',
    '      float fade = k * smoothstep(-0.1, 0.12, ta) * (1.0 - smoothstep(0.5, 2.6, ta));',
    '      vec2 drift = vec2(0.7, -0.5) * ta;',
    '      float fn = noise(s * 0.12 + drift + et.w) * 0.6 + noise(s * 0.31 - drift * 1.6 + et.w) * 0.4;',
    '      foam += smoothstep(0.42 + 0.2 * smoothstep(0.0, 2.6, ta), 0.8, fn) * zone * fade;',
    '    }',
    '    if (d < 70.0 && a < 3.2) {',
    '      bub += bubbles(s, 6.0, a, et.w, ec, eh, er, k);',
    '      bub += bubbles(s, 11.0, a, et.w + 3.1, ec, eh, er, k * 0.6);',
    '    }',
    '  }',
    '  disp += moved * uZoom;',
    '}',

    // The moving surface: value noise with its exact slope (quintic, so the
    // slope has no creases), five sizes of it, each turned its own way and
    // rolling its own way, so no two line up into a pattern and the sum
    // keeps changing shape instead of sliding. The big ripples roll faster
    // than the small ones, as on real water. Returns the surface's slope in
    // painting px; its height goes to `h` (about 0 to 1).
    'float hashI(vec2 p) {',
    '  vec3 p3 = fract(vec3(p.xyx) * 0.1031);',
    '  p3 += dot(p3, p3.yzx + 33.33);',
    '  return fract((p3.x + p3.y) * p3.z);',
    '}',
    'vec3 noised(vec2 x) {',
    '  vec2 i = floor(x), f = fract(x);',
    '  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);',
    '  vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);',
    '  float a = hashI(i), b = hashI(i + vec2(1.0, 0.0)), c = hashI(i + vec2(0.0, 1.0)), d = hashI(i + vec2(1.0, 1.0));',
    '  float k = a - b - c + d;',
    '  return vec3(a + (b - a) * u.x + (c - a) * u.y + k * u.x * u.y, du * (vec2(b - a, c - a) + k * u.yx));',
    '}',
    'void ripple(vec2 s, float size, float turn, vec2 roll, float amp, inout float h, inout vec2 g) {',
    '  mat2 r = mat2(cos(turn), sin(turn), -sin(turn), cos(turn));',
    '  vec3 n = noised(r * (s / size) + roll);',
    '  h += amp * n.x;',
    '  g += amp * (n.yz * r) / size;',
    '}',
    'vec2 surface(vec2 s, float t, out float h) {',
    '  vec2 g = vec2(0.0); h = 0.0;',
    '  ripple(s, 92.0, 0.4, vec2(0.11, 0.05) * t, 0.30, h, g);',
    '  ripple(s, 61.0, 2.1, vec2(-0.09, 0.10) * t, 0.24, h, g);',
    '  ripple(s, 37.0, 3.7, vec2(0.15, -0.07) * t, 0.20, h, g);',
    '  ripple(s, 23.0, 5.2, vec2(-0.16, -0.14) * t, 0.15, h, g);',
    '  ripple(s, 14.0, 1.3, vec2(0.24, 0.12) * t, 0.11, h, g);',
    '  return g * 30.0;',
    '}',

    // refraction: the reference's under-surface terms at mid depth, plus two
    // slow swells crossing the view, since from above the whole sea is surface
    'vec2 displace(vec2 s, float t) {',
    '  vec2 d;',
    '  d.x = 4.1 * (0.6 * sin(s.y * 0.045 + t * 0.8) + 0.4 * sin(s.x * 0.012 + s.y * 0.03 - t * 0.55));',
    '  d.y = 2.2 * sin(s.x * 0.02 + s.y * 0.01 + t * 0.7);',
    '  vec2 a = normalize(vec2(0.86, 0.5)), b = normalize(vec2(-0.42, 0.91));',
    '  d += a * 2.4 * sin(dot(s, a) * 0.013 + t * 1.25);',
    '  d += b * 1.5 * sin(dot(s, b) * 0.029 - t * 0.9);',
    '  return d * uAmp;',
    '}',

    'void main() {',
    '  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);',
    '  vec2 s = (p - uOcean.xy) / uUnit;',
    '  float t = uTime;',
    '  vec2 disp = vec2(0.0);',
    '  float light = 0.0, foam = 0.0, bub = 0.0;',
    '  float glow = 0.0;',
    '  if (uShore > 0.5) shore(p, disp, glow, foam);',
    '  if (uEvents > 0.5) breach(s, disp, light, foam, bub);',
    '  float h;',
    '  vec2 g = surface(s, uSurf.x, h);',
    '  disp += g * uSurf.y * uAmp;',
    '  vec2 q = p + (displace(s, t) + disp) * uUnit;',
    '  vec3 color = texture2D(uSea, clamp((q - uOcean.xy) / uOcean.zw, 0.0, 1.0)).rgb;',
    '  for (int i = 0; i < ' + MAX_ROCKS + '; i++) {',
    '    vec4 r = uRock[i];',
    '    if (r.z <= 0.0) continue;',
    '    vec2 l = (q - r.xy) / r.zw;',
    '    if (l.x < 0.0 || l.y < 0.0 || l.x > 1.0 || l.y > 1.0) continue;',
    '    vec4 c = texture2D(uAtlas, uCell[i].xy + l * uCell[i].zw);',   // premultiplied
    '    color = color * (1.0 - c.a * uRockAlpha) + c.rgb * uRockAlpha;',
    '  }',
    '  float rays = pow(max(0.0, sin(s.x * 0.010 + s.y * 0.0040 - t * 0.22)), 12.0)',
    '    + 0.7 * pow(max(0.0, sin(s.x * 0.0063 - s.y * 0.0026 + t * 0.17 + 1.7)), 14.0);',
    '  rays *= uLight.x;',
    '  float shimmer = uLight.y * sin(s.x * 0.006 + t * 0.4 + s.y * 0.004);',
    // the surface's own light: faces tipped toward the sun (upper left)
    // brighter, the far sides of the ripples and the troughs darker. No
    // sun glints: off a slope like this they trace thin rings or smudges.
    '  shimmer += (dot(g, normalize(vec2(-0.6, -0.8))) + (h - 0.5) * 0.25) * uSurf.z;',
    '  color = color * (1.0 + shimmer * uAmp) + vec3(0.75, 0.93, 1.0) * (rays * uAmp + light);',
    '  color = mix(color, vec3(0.33, 0.88, 0.97), clamp(glow * uShoreMix.x, 0.0, 0.6));',
    '  color = mix(color, vec3(0.9, 0.98, 1.0), clamp(foam, 0.0, 0.85));',
    '  color = mix(color, vec3(0.86, 0.97, 1.0), clamp(bub, 0.0, 0.9));',
    '  gl_FragColor = vec4(color, 1.0);',
    '}'
  ].join('\n');

  var states = new Map();

  function reducedMotion() {
    return doc.body.classList.contains('is-reduced') ||
      (global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  function load(src) {
    var img = new Image(); img.src = src;
    return img.decode().then(function () { return img; });
  }

  // The underwater rock sprites, packed in one row with clear gutters so
  // linear filtering never bleeds a neighbour in.
  function atlasOf(images) {
    var pad = 4, w = pad, h = 0;
    images.forEach(function (img) { w += img.naturalWidth + pad; h = Math.max(h, img.naturalHeight); });
    var c = doc.createElement('canvas'); c.width = w; c.height = h + pad * 2;
    var cx = c.getContext('2d'), x = pad, cells = {};
    images.forEach(function (img, i) {
      cx.drawImage(img, x, pad);
      cells[ART.deep[i].src] = [x / c.width, pad / c.height, img.naturalWidth / c.width, img.naturalHeight / c.height];
      x += img.naturalWidth + pad;
    });
    return { canvas: c, cells: cells };
  }

  function program(gl) {
    function compile(type, src) {
      var sh = gl.createShader(type);
      gl.shaderSource(sh, src); gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
      return sh;
    }
    var prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    return prog;
  }
  function texture(gl, source, premultiply) {
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiply);
    [[gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
      [gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR]]
      .forEach(function (p) { gl.texParameteri(gl.TEXTURE_2D, p[0], p[1]); });
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    return tex;
  }

  function setup(s) {
    var gl = s.gl;
    s.prog = program(gl);
    gl.useProgram(s.prog);
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    var aPos = gl.getAttribLocation(s.prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    s.u = {};
    ['uRes', 'uTime', 'uAmp', 'uOcean', 'uUnit', 'uSea', 'uAtlas', 'uRock', 'uCell', 'uRockAlpha', 'uLight',
      'uEv', 'uEvT', 'uEvents', 'uField', 'uFieldId', 'uLand', 'uSite', 'uWorld', 'uClock', 'uShore', 'uShoreMix', 'uSurf', 'uZoom']
      .forEach(function (name) { s.u[name] = gl.getUniformLocation(s.prog, name); });
    gl.activeTexture(gl.TEXTURE0); s.seaTex = texture(gl, s.sea, false);
    gl.activeTexture(gl.TEXTURE1); s.atlasTex = texture(gl, s.atlas.canvas, true);
    s.fieldTex = dataTexture(gl, gl.LINEAR); s.idTex = dataTexture(gl, gl.NEAREST);
    s.landTex = dataTexture(gl, gl.NEAREST);
    s.landBytes = new Uint8Array(MAX_LANDS);
    upload(gl, s.landTex, gl.LUMINANCE, MAX_LANDS, 1, s.landBytes);
    gl.uniform1i(s.u.uSea, 0); gl.uniform1i(s.u.uAtlas, 1);
    gl.uniform1i(s.u.uField, 2); gl.uniform1i(s.u.uFieldId, 3); gl.uniform1i(s.u.uLand, 4);
    gl.uniform2f(s.u.uLight, CONFIG.rays, CONFIG.shimmer);
    s.rocks = new Float32Array(MAX_ROCKS * 4); s.cells = new Float32Array(MAX_ROCKS * 4);
    s.ev = new Float32Array(MAX_EVENTS * 4); s.evT = new Float32Array(MAX_EVENTS * 4);
    s.field = null; s.fieldDirty = true;
  }
  function dataTexture(gl, filter) {
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    [[gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
      [gl.TEXTURE_MIN_FILTER, filter], [gl.TEXTURE_MAG_FILTER, filter]]
      .forEach(function (p) { gl.texParameteri(gl.TEXTURE_2D, p[0], p[1]); });
    return tex;
  }
  function upload(gl, tex, format, w, h, data) {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, format, w, h, 0, format, gl.UNSIGNED_BYTE, data);
  }

  /* ---------------------------------------------------------- the shores
     A distance field over all the land in the camera plate, in its own
     (camera-free) pixels, built from the silhouettes of that land
     whenever it changes: per cell, how far the nearest land is, which way
     is away from it, and which land that is. Rebuilt on a strew, a resize
     or land being shown or hidden, never per frame. */
  // the reef's rock (platforms, small rocks, the big rocks), site A's
  // islands and the islets (js/pages.js), and the picture each one's
  // silhouette is read from
  var LAND = '.env-platform, .env-satellite, .env-big, .site--a .pad, .islet';
  function pictureOf(el) {
    return el.querySelector(el.classList.contains('pad') ? ':scope > .pad__img' :
      el.classList.contains('islet') ? ':scope > .islet__img' : '.env-image');
  }
  // an element's box in its host's layout, through no transform: land
  // mid-rise is drawn where it will stand
  function layout(el, host) {
    var x = 0, y = 0, n = el;
    while (n && n !== host) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
    return { x: x, y: y, w: el.offsetWidth, h: el.offsetHeight };
  }
  // Site B's first: it is where the landing is flown, so it is never the
  // land left over when there is more than the field can tell apart.
  function landsOf(s) {
    var out = [], all = Array.prototype.slice.call(s.site.querySelectorAll(LAND));
    s.cam.querySelectorAll(LAND).forEach(function (el) { if (!s.site.contains(el)) all.push(el); });
    all.forEach(function (el) {
      var img = pictureOf(el);
      if (out.length >= MAX_LANDS - 1 || !img || el.closest('[hidden]') || !img.offsetParent ||
          el.querySelector(':scope > .env-art.is-missing')) return;
      out.push({ el: el, img: img, edge: el.classList.contains('env-big'), flip: el.classList.contains('is-flip') });
    });
    return out;
  }
  // Exact squared distances along one line (Felzenszwalb & Huttenlocher),
  // with the cell each one is measured from.
  function edt(f, len, d, arg, v, z) {
    var k = 0, q, x;
    function cut() { return (f[q] + q * q - f[v[k]] - v[k] * v[k]) / (2 * q - 2 * v[k]); }
    v[0] = 0; z[0] = -1e20; z[1] = 1e20;
    for (q = 1; q < len; q++) {
      x = cut();
      while (x <= z[k]) { k--; x = cut(); }
      k++; v[k] = q; z[k] = x; z[k + 1] = 1e20;
    }
    for (k = 0, q = 0; q < len; q++) {
      while (z[k + 1] < q) k++;
      d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; arg[q] = v[k];
    }
  }
  // A picture's silhouette at about the most it is ever drawn at in the
  // field: scaling the full artwork down on every build was most of the
  // build's time.
  var silhouettes = new Map();
  function silhouette(img) {
    var key = img.currentSrc || img.src, m = silhouettes.get(key);
    if (m) return m;
    var k = Math.min(1, 256 / Math.max(img.naturalWidth, img.naturalHeight));
    m = doc.createElement('canvas');
    m.width = Math.max(1, Math.round(img.naturalWidth * k)); m.height = Math.max(1, Math.round(img.naturalHeight * k));
    m.getContext('2d').drawImage(img, 0, 0, m.width, m.height);
    silhouettes.set(key, m);
    return m;
  }
  function buildField(s) {
    var cam = s.cam, W = cam.clientWidth, H = cam.clientHeight;
    if (!W || !H) return false;
    var lands = landsOf(s);
    if (lands.some(function (l) { return !l.img.complete || !l.img.naturalWidth; })) return false;
    // the field covers the land and its shores, and no more of the sea
    // than the wide shot can see (an islet with nowhere to go is parked
    // well off it, js/pages.js)
    var reach = CONFIG.shoreReach + 8, l0 = Infinity, t0 = Infinity, r0 = -Infinity, b0 = -Infinity;
    lands.forEach(function (l) {
      var b = l.box = layout(l.img, cam);
      l0 = Math.min(l0, b.x - reach); t0 = Math.min(t0, b.y - reach);
      r0 = Math.max(r0, b.x + b.w + reach); b0 = Math.max(b0, b.y + b.h + reach);
    });
    l0 = Math.max(l0, -W); t0 = Math.max(t0, -1.2 * H); r0 = Math.min(r0, 3 * W); b0 = Math.min(b0, 2.8 * H);
    if (!(r0 > l0 && b0 > t0)) { s.field = null; return true; }
    var cell = Math.max(2, W / 512), cells = (r0 - l0) * (b0 - t0) / (cell * cell);
    if (cells > CONFIG.maxCells) cell *= Math.sqrt(cells / CONFIG.maxCells);
    var gw = Math.ceil((r0 - l0) / cell), gh = Math.ceil((b0 - t0) / cell), n = gw * gh;
    var c = s.fieldCanvas || (s.fieldCanvas = doc.createElement('canvas'));
    c.width = gw; c.height = gh;
    var cx = c.getContext('2d', { willReadFrequently: true });
    var boxes = [];
    lands.forEach(function (l, i) {
      var b = l.box, x = (b.x - l0) / cell, y = (b.y - t0) / cell, w = b.w / cell, h = b.h / cell;
      if (x + w < 0 || y + h < 0 || x > gw || y > gh) return;
      var pic = silhouette(l.img);
      if (l.flip) { cx.save(); cx.translate(x + w, y); cx.scale(-1, 1); cx.drawImage(pic, 0, 0, w, h); cx.restore(); }
      else cx.drawImage(pic, x, y, w, h);
      boxes.push([i, Math.max(0, Math.floor(x)), Math.max(0, Math.floor(y)),
        Math.min(gw, Math.ceil(x + w)), Math.min(gh, Math.ceil(y + h))]);
    });
    var alpha = cx.getImageData(0, 0, gw, gh).data, owner = new Uint8Array(n), land = new Uint8Array(gw), INF = 1e10;
    boxes.forEach(function (b) {
      for (var y = b[2]; y < b[4]; y++) for (var x = b[1]; x < b[3]; x++) {
        if (alpha[(y * gw + x) * 4 + 3] > 127) { owner[y * gw + x] = b[0] + 1; land[x] = 1; }
      }
    });
    // Only distances inside the shore's reach are kept, so most of the sea
    // -- a column with no land in it, a row with none within reach -- is
    // open water without being measured.
    var m = Math.max(gw, gh), f = new Float64Array(m), d = new Float64Array(m), arg = new Int32Array(m);
    var v = new Int32Array(m), z = new Float64Array(m + 1), far = Math.pow(CONFIG.shoreReach / cell + 1, 2);
    var col = new Float64Array(n).fill(INF), rowOf = new Int32Array(n), x, y, i;
    for (x = 0; x < gw; x++) {
      if (!land[x]) continue;
      for (y = 0; y < gh; y++) f[y] = owner[y * gw + x] ? 0 : INF;
      edt(f, gh, d, arg, v, z);
      for (y = 0; y < gh; y++) { col[y * gw + x] = d[y] > far ? INF : d[y]; rowOf[y * gw + x] = arg[y]; }
    }
    var px = new Uint8Array(n * 4), ids = new Uint8Array(n), reach = CONFIG.shoreReach;
    for (i = 0; i < n; i++) { px[i * 4] = 255; px[i * 4 + 1] = px[i * 4 + 2] = 128; px[i * 4 + 3] = 255; }
    for (y = 0; y < gh; y++) {
      var near = false;
      for (x = 0; x < gw; x++) { f[x] = col[y * gw + x]; near = near || f[x] < INF; }
      if (!near) continue;
      edt(f, gw, d, arg, v, z);
      for (x = 0; x < gw; x++) {
        i = y * gw + x;
        var dist = Math.sqrt(d[x]) * cell, sx = arg[x], sy = rowOf[y * gw + sx];
        if (!(dist < reach) || d[x] >= INF) continue;
        var dx = x - sx, dy = y - sy, len = Math.hypot(dx, dy) || 1;
        px[i * 4] = Math.round(dist / reach * 250);
        px[i * 4 + 1] = Math.round((dx / len * .5 + .5) * 255);
        px[i * 4 + 2] = Math.round((dy / len * .5 + .5) * 255);
        ids[i] = owner[sy * gw + sx];
      }
    }
    var gl = s.gl;
    upload(gl, s.fieldTex, gl.RGBA, gw, gh, px);
    upload(gl, s.idTex, gl.LUMINANCE, gw, gh, ids);
    s.field = { x: l0, y: t0, w: gw * cell, h: gh * cell, lands: lands };
    s.landBytes.fill(0); s.landSent = null;
    return true;
  }
  // How much shore each land has now: the big rocks always, an island
  // from its breach on (css/reef.css times the same rise) until it sinks.
  function landStates(s) {
    var bytes = s.landBytes, changed = !s.landSent;
    s.field.lands.forEach(function (l, i) {
      var k = l.edge ? 1 : shoreOf(s, l.el), b = Math.round(k * 255);
      if (bytes[i + 1] !== b) { bytes[i + 1] = b; changed = true; }
    });
    if (changed) { upload(s.gl, s.landTex, s.gl.LUMINANCE, MAX_LANDS, 1, bytes); s.landSent = true; }
  }
  function clamp01(v) { return Math.min(1, Math.max(0, v)); }
  function shoreOf(s, el) {
    var up = s.upAt.get(el), down = s.downAt.get(el);
    if (up == null) return 0;
    var k = s.reduced ? 1 : clamp01((s.clock - up - CONFIG.shoreIn) / CONFIG.shoreFade);
    if (down != null) k *= s.reduced ? 0 : 1 - clamp01((s.clock - down) / CONFIG.sinkFade);
    return k;
  }

  // Land coming up: css/style.css and css/reef.css play the land's half off
  // `.is-up` on an island or an islet, each small rock after its own
  // --satellite-delay; the water's half is timed from the same moment, on
  // this pass's real-time clock. A decoy on site A going back under
  // (`.is-sunk`) takes its shore with it.
  function watch(s) {
    var mo = new MutationObserver(function (records) {
      records.forEach(function (rec) {
        var el = rec.target, old = rec.oldValue || '';
        if (rec.attributeName !== 'class') { s.fieldDirty = true; return; }
        var up = el.classList.contains('is-up'), was = /\bis-up\b/.test(old);
        if (up && !was) surface(s, el);
        else if (!up && was) rising(el).forEach(function (l) { s.upAt.delete(l); });
        var sunk = el.classList.contains('is-sunk');
        if (sunk && !/\bis-sunk\b/.test(old)) s.downAt.set(el, s.clock);
        else if (!sunk) s.downAt.delete(el);
      });
    });
    s.cam.querySelectorAll('.pad, .islet').forEach(function (el) {
      mo.observe(el, { attributes: true, attributeFilter: ['class', 'style', 'hidden'], attributeOldValue: true });
      if (el.classList.contains('is-up')) rising(el).forEach(function (l) { s.upAt.set(l, -1e3); });
    });
    // the land itself changing: a strew, or a decoration hidden for room
    new MutationObserver(function (records) {
      if (records.some(function (rec) {
        return rec.target.nodeType === 1 && rec.target.matches(
          rec.type === 'childList' ? '.env-satellites, .env-bigs' : '.env-object');
      })) s.fieldDirty = true;
    }).observe(s.cam, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden'] });
    new ResizeObserver(function () { s.fieldDirty = true; }).observe(s.cam);
  }
  // what comes up with an island: site B's platform, or the island or islet
  // itself, and the small rocks round it
  function rising(el) {
    var parts = Array.prototype.slice.call(el.querySelectorAll('.env-platform, .env-satellite'));
    return el.querySelector('.env-platform') ? parts : [el].concat(parts);
  }
  function zoomOf(s) {
    return s.cam.offsetWidth ? s.cam.getBoundingClientRect().width / s.cam.offsetWidth : 1;
  }
  // The box a breach follows, as shares of the element's own: an island
  // laid out in a square box (js/pages.js) breaks the water only where its
  // outline is. The slanted ones round off more at the corners, and a
  // rhombus is a rhombus (a corner below 0, for the shader).
  function outlineOf(el) {
    if (el.classList.contains('env-satellite')) return { ext: [0, 0, 1, 1], corner: .5 };
    // site B's platform is its island's shape, filling its own box
    var platform = el.classList.contains('env-platform') && el.closest('.pad');
    var shape = (platform || el).dataset.shape;
    var land = !platform && global.GeoPages && global.GeoPages.land[shape];
    return { ext: land ? land.ext : [0, 0, 1, 1],
      corner: shape === 'rhombus' ? -1 : !shape || /^(square|rectangle)$/.test(shape) ? .12 : .4 };
  }
  function surface(s, riser) {
    var far = zoomOf(s) < CONFIG.rockZoom;
    rising(riser).forEach(function (el) {
      if (el.hidden) return;
      var start = s.clock + (parseFloat(el.style.getPropertyValue('--satellite-delay')) || 0) / 1000;
      var rock = el.classList.contains('env-satellite');
      s.upAt.set(el, start);
      if (s.reduced || !s.ok || !s.screen.classList.contains('is-active') || (rock && far)) return;
      var shape = outlineOf(el);
      s.events.push({ el: el, land: !rock, start: start, seed: Math.random() * 97, ext: shape.ext, corner: shape.corner });
    });
    while (s.events.length > MAX_EVENTS) s.events.shift();
  }
  // Each live breach as the shader reads it: the land's box as it stands
  // now (it never moves; only its artwork does), its age and strength.
  function events(s, cr, kx, ky) {
    s.ev.fill(0); s.evT.fill(0);
    s.events = s.events.filter(function (e) {
      return e.el.isConnected && s.clock - e.start < CONFIG.eventLife;
    });
    var n = 0;
    s.events.forEach(function (e, i) {
      var age = s.clock - e.start, b = e.el.getBoundingClientRect(), x = e.ext;
      if (age < 0 || !b.width) return;
      var l = b.left + x[0] * b.width, t = b.top + x[1] * b.height;
      var w = (x[2] - x[0]) * b.width, h = (x[3] - x[1]) * b.height;
      var hx = w / 2 * kx * .96, hy = h / 2 * ky * .96;
      s.ev.set([(l + w / 2 - cr.left) * kx, (t + h / 2 - cr.top) * ky, hx, hy], i * 4);
      s.evT.set([age, e.land ? 1 : CONFIG.rockStrength, Math.min(hx, hy) * e.corner, e.seed], i * 4);
      n++;
    });
    return n;
  }

  // Backing store: device pixels, but never more than the painting holds.
  function fit(s) {
    var c = s.canvas, w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return false;
    var k = Math.min(global.devicePixelRatio || 1, ART.ocean.size[0] * CONFIG.resolution / w) * s.quality;
    var bw = Math.max(1, Math.round(w * k)), bh = Math.max(1, Math.round(h * k));
    if (c.width !== bw || c.height !== bh) { c.width = bw; c.height = bh; }
    return true;
  }

  function draw(s) {
    var gl = s.gl;
    if (!s.ok || !fit(s)) return false;
    var c = s.canvas, cr = c.getBoundingClientRect();
    if (!cr.width || !cr.height) return false;
    var kx = c.width / cr.width, ky = c.height / cr.height;
    // the ocean plate, through whatever the camera is doing to it, then
    // the painting covering it (background-size: cover, centred)
    var br = s.bg.getBoundingClientRect(), size = ART.ocean.size;
    var cover = Math.max(br.width / size[0], br.height / size[1]);
    var ow = size[0] * cover, oh = size[1] * cover;
    var ox = br.left + (br.width - ow) / 2 - cr.left, oy = br.top + (br.height - oh) / 2 - cr.top;
    gl.viewport(0, 0, c.width, c.height);
    gl.useProgram(s.prog);
    gl.uniform2f(s.u.uRes, c.width, c.height);
    gl.uniform1f(s.u.uTime, s.time);
    gl.uniform1f(s.u.uAmp, s.reduced ? CONFIG.reducedAmplitude : CONFIG.amplitude);
    gl.uniform4f(s.u.uOcean, ox * kx, oy * ky, ow * kx, oh * ky);
    gl.uniform1f(s.u.uUnit, cover * kx);
    s.rocks.fill(0); s.cells.fill(0);
    var n = 0;
    for (var i = 0; i < s.deep.length && n < MAX_ROCKS; i++) {
      var el = s.deep[i], cell = s.atlas.cells[el.dataset.art];
      if (el.hidden || !cell || el.classList.contains('is-missing')) continue;
      var r = el.getBoundingClientRect();
      if (!r.width || r.right < cr.left || r.left > cr.right || r.bottom < cr.top || r.top > cr.bottom) continue;
      s.rocks.set([(r.left - cr.left) * kx, (r.top - cr.top) * ky, r.width * kx, r.height * ky], n * 4);
      s.cells.set(cell, n * 4); n++;
    }
    gl.uniform4fv(s.u.uRock, s.rocks);
    gl.uniform4fv(s.u.uCell, s.cells);
    gl.uniform1f(s.u.uRockAlpha, s.rockAlpha);
    gl.uniform1f(s.u.uEvents, events(s, cr, kx, ky));
    gl.uniform4fv(s.u.uEv, s.ev);
    gl.uniform4fv(s.u.uEvT, s.evT);
    // the shores: the field rides the camera plate
    if (s.fieldDirty && buildField(s)) s.fieldDirty = false;
    var cam = s.cam.getBoundingClientRect(), zoom = s.cam.offsetWidth ? cam.width / s.cam.offsetWidth : 1;
    gl.uniform1f(s.u.uZoom, Math.max(zoom, CONFIG.breachZoom));
    if (s.field) {
      landStates(s);
      var world = zoom * kx, worldY = (s.cam.offsetHeight ? cam.height / s.cam.offsetHeight : 1) * ky;
      gl.uniform4f(s.u.uSite, (cam.left - cr.left) * kx + s.field.x * world, (cam.top - cr.top) * ky + s.field.y * worldY,
        s.field.w * world, s.field.h * worldY);
      gl.uniform1f(s.u.uWorld, world);
    }
    gl.uniform1f(s.u.uShore, s.field ? 1 : 0);
    gl.uniform3f(s.u.uShoreMix, CONFIG.shoreGlow, CONFIG.shoreFoam, CONFIG.shoreSwell);
    gl.uniform1f(s.u.uClock, s.reduced ? 0 : s.clock);
    gl.uniform3f(s.u.uSurf, s.reduced ? 0 : s.clock * CONFIG.surfaceSpeed, CONFIG.refract, CONFIG.shade);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, s.seaTex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, s.atlasTex);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, s.fieldTex);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, s.idTex);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, s.landTex);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (!s.live) { s.live = true; s.screen.dataset.seaWater = 'live'; }
    return true;
  }

  function frame(s, now) {
    s.raf = 0;
    if (!running(s)) return;
    var dt = s.last ? Math.min(.1, (now - s.last) / 1000) : 0;
    s.last = now;
    s.clock += dt;
    if (!s.reduced) {
      s.time += dt * CONFIG.speed;
      // drop resolution once if frames keep running long, like the reference
      s.slow = dt * 1000 > CONFIG.slowFrameMs ? s.slow + dt : Math.max(0, s.slow - dt);
      if (s.slow > 2 && s.quality > CONFIG.slowQuality) s.quality = CONFIG.slowQuality;
    }
    draw(s);
    // a still sea under reduced motion: redrawn a few times a second only
    // to keep up with the camera and the strew
    if (s.reduced) s.timer = setTimeout(function () { s.timer = 0; schedule(s); }, 250);
    else schedule(s);
  }
  // and not while a landing plays as a cut-scene over the whole screen
  // (js/cinematic.js), where none of this sea can be seen
  function running(s) {
    return s.ok && s.screen.classList.contains('is-active') && !doc.hidden &&
      !s.screen.classList.contains('is-cinema') &&
      !(global.GeoLife && global.GeoLife.isPaused && global.GeoLife.isPaused());
  }
  // A camera move driven from its own frame loop (js/close-up.js) has the
  // sea drawn again straight after it moves the plates: whichever loop
  // runs first in a frame, the water shown is drawn off that frame's land.
  function redraw(screen) {
    var s = states.get(screen);
    if (s && running(s)) draw(s);
  }
  function schedule(s) {
    if (s.raf || s.timer || !running(s)) return;
    s.raf = global.requestAnimationFrame(function (now) { frame(s, now); });
  }
  function stop(s) {
    if (s.raf) global.cancelAnimationFrame(s.raf);
    if (s.timer) clearTimeout(s.timer);
    s.raf = s.timer = 0; s.last = 0;
  }
  function update(s) {
    s.reduced = reducedMotion();
    if (running(s)) schedule(s);
    else {
      stop(s);
      // a breach left half-played on a screen the player has left is over
      if (!s.screen.classList.contains('is-active')) s.events = [];
    }
  }

  function mount(screen, sea, atlas) {
    if (states.has(screen)) return;
    var bg = screen.querySelector('.s3-bg');
    if (!bg) return;
    var canvas = doc.createElement('canvas');
    canvas.className = 'layer reef-water';
    canvas.setAttribute('aria-hidden', 'true');
    var gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false,
      stencil: false, premultipliedAlpha: false, powerPreference: 'low-power' });
    if (!gl) return;
    var reef = global.GeoReef && global.GeoReef.config;
    var site = screen.querySelector('.site--b'), cam = screen.querySelector('.cam');
    if (!site || !cam) return;
    var s = { screen: screen, bg: bg, site: site, cam: cam, canvas: canvas, gl: gl, sea: sea, atlas: atlas,
      upAt: new WeakMap(), downAt: new WeakMap(),
      deep: screen.getElementsByClassName('env-submerged'),
      rockAlpha: reef ? reef.deepOpacity : .62,
      time: 0, clock: 0, events: [], last: 0, slow: 0, quality: 1, raf: 0, timer: 0, live: false, ok: true };
    try { setup(s); } catch (e) { console.warn('Reef water unavailable:', e.message); return; }
    bg.after(canvas);
    states.set(screen, s);
    watch(s);
    canvas.addEventListener('webglcontextlost', function (e) {
      e.preventDefault(); s.ok = false; stop(s);
      s.live = false; delete screen.dataset.seaWater;
    });
    canvas.addEventListener('webglcontextrestored', function () {
      try { setup(s); s.ok = true; update(s); } catch (e) { /* stays on the plain sea */ }
    });
    new MutationObserver(function () { update(s); })
      .observe(screen, { attributes: true, attributeFilter: ['class'] });
    update(s);
  }

  function init(stage) {
    if (!ART || !ART.ocean || !ART.deep) return;
    var screens = (stage || doc).querySelectorAll('.screen[data-reef]');
    if (!screens.length) return;
    Promise.all([load(ART.ocean.src), Promise.all(ART.deep.map(function (m) { return load(m.src); }))])
      .then(function (art) {
        var atlas = atlasOf(art[1]);
        screens.forEach(function (screen) { mount(screen, art[0], atlas); });
      })
      .catch(function (e) { console.warn('Reef water artwork unavailable:', e && e.message); });
  }

  function each(fn) { states.forEach(fn); }
  doc.addEventListener('visibilitychange', function () { each(update); });
  if (global.GeoLife) {
    global.GeoLife.on('suspend', function () { each(stop); });
    global.GeoLife.on('resume', function () { each(update); });
  }

  global.GeoReefWater = { init: init, redraw: redraw };
})(window);
