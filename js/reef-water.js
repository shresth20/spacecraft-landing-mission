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

   The ocean painting is not held still under all that: it runs on a
   slow current (two copies sliding along it in turn, fading in and
   out), which wanders in broad swirls and turns along the shores rather
   than into the land. The rocks under the water stay put.

   Over the whole canvas runs a wave simulation (a height field on the
   GPU, stepped at a fixed rate): the craft's downwash beats rings out
   from under its hull, each burning jet churns the water white where its
   blast meets it, leaving a wake of foam, and every wave stops dead
   against land, so it comes back off it and bends round it. Its waves
   bend the sea under them and light their own faces. It lives on the
   canvas and is carried along with the world plate whenever the camera
   moves, so it stays where it was on the sea.

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
  var MAX_ROCKS = 16, MAX_EVENTS = 32, MAX_LANDS = 255;
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
    // the current: the painting is carried `flow` painting px each
    // `flowCycle` seconds (a drift of flow / flowCycle px a second)
    flow: 36, flowCycle: 4.5,
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
    resolution: 1.15, slowQuality: .65, slowFrameMs: 24,
    // The water's own motion: a wave simulation over the frame, a grid
    // `simCells` across, stepped `simRate` times a second. Waves run at
    // `simWave` with the lens down (.6 of a cell a step; slower by the
    // camera's scale from higher up, so a wave keeps its size on the sea),
    // keep `simDamp` of themselves each step and stop dead against land,
    // so they bounce off it and bend round it. `simSmooth` takes the
    // finest ripples, a cell or two long, out before they build into grit.
    simCells: 560, simRate: 60, simWave: 1.5, simDamp: .985, simSmooth: .1,
    // what stirs it: the craft's downwash (a beat under the hull, `washHz`
    // a second, and a churn round it) and each burning jet where its blast
    // hits the water. Land breaking the surface keeps the breach above: as
    // a wave of the simulation it hugged the land's outline like a drawn line.
    wash: 16, washHz: 2, jet: 3, jetHz: 3.2,
    // Where a burning jet's blast meets the water it churns it white
    // (`jetFoam` at full burn), and the foam keeps `foamKeep` of itself a
    // step where it was raised (gone in a second or so), so a moving craft
    // leaves a wake of it; `simFoam` is how white it shows.
    jetFoam: 1, foamKeep: .98, simFoam: .75,
    // how it shows: its slope times `simGain` is how far a face tips
    // (eased so it never tips past 1), which bends what is under it by
    // `simRefract` painting px and lights the faces turned to the sun by
    // `simShade`; its crests gather light onto the sea under them
    simGain: 45, simRefract: 7, simShade: .55, simCaustic: .2
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
    'uniform sampler2D uField;',     // distance to land
    'uniform sampler2D uFieldId;',   // which land is nearest (its index / 255)
    'uniform sampler2D uLand;',      // each land's shore strength, in a row
    'uniform vec4 uSite;',           // the field's box, canvas px
    'uniform vec2 uFieldTexel;',     // one of its cells, in uv
    'uniform float uWorld;',         // canvas px per camera plate px
    'uniform float uClock;',         // real seconds (0: still)
    'uniform float uShore;',         // 0 until the field is built
    'uniform vec3 uShoreMix;',       // glow, foam, swell
    'uniform vec3 uSurf;',           // surface clock (s), refract, shade
    'uniform float uZoom;',          // the camera's scale (1: a site's frame)
    'uniform sampler2D uSim;',       // the wave simulation, over the canvas: height, speed
    'uniform vec2 uSimCell;',        // one of its cells, in uv
    'uniform vec4 uSimMix;',         // gain, refract, shade, caustic (0: no simulation)
    'uniform float uSimFoam;',
    'uniform vec2 uFlow;',           // how far the current carries the painting a cycle (painting px; 0: still), cycles so far
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
    // the land and draws back again. Nothing in it steps at the field's
    // cells or where one land's water meets the next: how much shore there
    // is blends between the lands of the four nearest cells (shoreK), the
    // way off the land is the distance's slope over three cells (so it
    // fades out where two lands' waters meet instead of turning round),
    // and the swell and the lap keep time by the place, not by the land.
    'float landK(vec2 uv) {',
    '  float id = floor(texture2D(uFieldId, uv).r * 255.0 + 0.5);',
    '  return texture2D(uLand, vec2((id + 0.5) / LANDS, 0.5)).r;',
    '}',
    'float shoreK(vec2 fuv) {',
    '  vec2 c = fuv / uFieldTexel - 0.5, i = floor(c), f = c - i;',
    '  vec2 a = (i + 0.5) * uFieldTexel, b = a + uFieldTexel;',
    '  return mix(mix(landK(a), landK(vec2(b.x, a.y)), f.x), mix(landK(vec2(a.x, b.y)), landK(b), f.x), f.y);',
    '}',
    'void shore(vec2 p, inout vec2 disp, inout float glow, inout float foam, inout vec3 coast) {',
    '  vec2 fuv = (p - uSite.xy) / uSite.zw;',
    '  if (fuv.x < 0.0 || fuv.y < 0.0 || fuv.x > 1.0 || fuv.y > 1.0) return;',
    '  float f = texture2D(uField, fuv).r;',
    '  if (f > 0.99) return;',
    '  float k = shoreK(fuv);',
    '  if (k <= 0.0) return;',
    '  float d = f * REACH, t = uClock;',               // plate px from that land
    '  vec2 e = uFieldTexel * 1.5, w = (p - uSite.xy) / uWorld;',
    '  vec2 dir = vec2(texture2D(uField, fuv + vec2(e.x, 0.0)).r - texture2D(uField, fuv - vec2(e.x, 0.0)).r,',
    '                  texture2D(uField, fuv + vec2(0.0, e.y)).r - texture2D(uField, fuv - vec2(0.0, e.y)).r) *',
    '    REACH * uWorld / (2.0 * e * uSite.zw);',
    '  dir /= max(1.0, length(dir));',
    '  float here = noise(w * 0.006) * 6.2832;',
    '  coast = vec3(dir, mix(REACH, d, k));',
    '  float swell = sin(d * 0.17 + t * 1.3 + here) * exp(-d / 30.0) * smoothstep(0.0, 5.0, d);',
    '  disp += dir * swell * uShoreMix.z * k * uWorld / uUnit;',
    '  glow += k * (1.0 - smoothstep(REACH * 0.6, REACH, d)) *',
    '    (0.55 * exp(-d / 12.0) + 0.45 * exp(-d / 32.0)) * (0.88 + 0.12 * swell);',
    '  if (d < 22.0) {',
    '    float lap = 0.5 + 0.5 * sin(t * 1.1 + here * 1.35 + dot(w, vec2(0.013, 0.009)));',
    '    float reach = 2.5 + 6.5 * lap;',
    '    float fn = noise(w * 0.09 + vec2(t * 0.11, -t * 0.08)) * 0.65 + noise(w * 0.23 - vec2(t * 0.09, t * 0.13)) * 0.35;',
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
    '      float fn = noise(s * 0.055 + drift * 0.46 + et.w) * 0.6 + noise(s * 0.14 - drift * 0.72 + et.w) * 0.4;',
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

    // The painting itself runs on a slow current: two copies of it slide
    // along the flow, each fading out before it has gone too far and back
    // in from where it started, half a cycle apart (and out of step from
    // place to place, so the sea never pulses as one). The current wanders
    // in broad swirls and turns along the shore instead of into the land.
    // The blend keeps the painting's own contrast.
    'vec3 sea(vec2 q) { return texture2D(uSea, clamp((q - uOcean.xy) / uOcean.zw, 0.0, 1.0)).rgb; }',
    'vec3 flow(vec2 s, vec2 q, vec3 coast) {',
    '  if (uFlow.x <= 0.0) return sea(q);',
    '  vec3 n = noised(s / 520.0 + vec2(uFlow.y * 0.07, 0.0));',
    '  vec2 f = normalize(vec2(1.0, 0.42)) + vec2(n.z, -n.y) * 0.55;',
    '  float near = 1.0 - smoothstep(0.0, REACH, coast.z);',
    '  f -= coast.xy * min(dot(f, coast.xy), 0.0) * near * 1.4;',
    '  float ph = uFlow.y + noise(s * 0.0035) * 1.7;',
    '  float p0 = fract(ph), p1 = fract(ph + 0.5), w0 = 1.0 - abs(1.0 - 2.0 * p0), w1 = 1.0 - w0;',
    '  vec3 a = sea(q - f * (p0 - 0.5) * uFlow.x * uUnit), b = sea(q - f * (p1 - 0.5) * uFlow.x * uUnit);',
    '  vec3 mean = vec3(0.0, 0.56, 0.95);',
    '  return mean + (a * w0 + b * w1 - mean) / sqrt(w0 * w0 + w1 * w1);',
    '}',

    // The simulation read through a cubic B-spline over its cells, four
    // bilinear taps for the sixteen cells (the texture is LINEAR wherever
    // floats filter): smooth through and across every cell, so at no zoom
    // does its grid show in the light, the shade or the foam.
    'vec4 simAt(vec2 uv) {',
    '  vec2 c = uv / uSimCell - 0.5, i = floor(c), f = c - i, f2 = f * f, f3 = f2 * f;',
    '  vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0, w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;',
    '  vec2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0, w3 = f3 / 6.0;',
    '  vec2 g0 = w0 + w1, g1 = w2 + w3;',
    '  vec2 a = (i - 0.5 + w1 / g0) * uSimCell, b = (i + 1.5 + w3 / g1) * uSimCell;',
    '  return g0.y * (g0.x * texture2D(uSim, a) + g1.x * texture2D(uSim, vec2(b.x, a.y))) +',
    '         g1.y * (g0.x * texture2D(uSim, vec2(a.x, b.y)) + g1.x * texture2D(uSim, b));',
    '}',

    'void main() {',
    '  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);',
    '  vec2 s = (p - uOcean.xy) / uUnit;',
    '  float t = uTime;',
    '  vec2 disp = vec2(0.0);',
    '  float light = 0.0, foam = 0.0, bub = 0.0;',
    '  float glow = 0.0;',
    '  vec3 coast = vec3(0.0, 0.0, REACH);',          // the way off the nearest land, and how far it is
    '  if (uShore > 0.5) shore(p, disp, glow, foam, coast);',
    '  if (uEvents > 0.5) breach(s, disp, light, foam, bub);',
    '  float h;',
    '  vec2 g = surface(s, uSurf.x, h);',
    '  disp += g * uSurf.y * uAmp;',
    // the simulated waves: their slope (down the screen is +y) bends the
    // sea under them, and their crests gather light onto it
    '  vec2 gw = vec2(0.0);',
    '  float lap = 0.0;',
    '  if (uSimMix.x > 0.0) {',
    '    vec2 su = gl_FragCoord.xy / uRes;',
    '    vec4 st = simAt(su);',
    '    float c0 = st.r;',
    '    float wl = simAt(su - vec2(uSimCell.x, 0.0)).r, wr = simAt(su + vec2(uSimCell.x, 0.0)).r;',
    '    float wd = simAt(su - vec2(0.0, uSimCell.y)).r, wu = simAt(su + vec2(0.0, uSimCell.y)).r;',
    '    gw = vec2(wr - wl, wd - wu) * 0.5 * uSimMix.x;',
    '    gw /= 1.0 + length(gw);',
    '    lap = (wl + wr + wd + wu - 4.0 * c0) * uSimMix.x;',
    '    disp += gw * uSimMix.y;',
    // churned water, broken up into foam and bubbles by two sizes of noise
    // that drift with the clock
    '    vec2 fw = p / uZoom;',
    '    float fn = noise(fw * 0.045 + vec2(uClock * 0.25, -uClock * 0.16)) * 0.6 + noise(fw * 0.12 - vec2(uClock * 0.2, uClock * 0.29)) * 0.4;',
    '    foam += uSimFoam * st.b * smoothstep(0.45, 0.8, fn * 0.6 + st.b * 0.55);',
    '  }',
    '  vec2 q = p + (displace(s, t) + disp) * uUnit;',
    '  vec3 color = flow(s, q, coast);',
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
    '  shimmer += dot(gw, normalize(vec2(-0.6, -0.8))) * uSimMix.z;',
    '  light += clamp(-lap, 0.0, 1.0) * uSimMix.w;',
    '  color = color * (1.0 + shimmer * uAmp) + vec3(0.75, 0.93, 1.0) * (rays * uAmp + light);',
    '  color = mix(color, vec3(0.33, 0.88, 0.97), clamp(glow * uShoreMix.x, 0.0, 0.6));',
    '  color = mix(color, vec3(0.9, 0.98, 1.0), clamp(foam, 0.0, 0.85));',
    '  color = mix(color, vec3(0.86, 0.97, 1.0), clamp(bub, 0.0, 0.9));',
    '  gl_FragColor = vec4(color, 1.0);',
    '}'
  ].join('\n');

  /* ------------------------------------------------- the wave simulation
     The surface as a height field over the canvas, one cell per texel:
     height in r, its speed in g, foam in b. Each step every cell is pulled towards
     the mean of its four neighbours (the wave equation), loses a little,
     and is held flat where there is land, so a wave that reaches a shore
     comes back off it. Whatever stirs the water is added on the frame's
     first step, as round spots of height and of foam (centre and radius
     in cells, top down). Cells near the canvas's edges soak waves up instead of
     returning them. */
  var MAX_STIR = 24;
  var STEP = [
    'precision highp float;',
    'uniform sampler2D uState;',
    'uniform vec2 uCell;',           // one cell, in uv
    'uniform float uK, uDamp, uSmooth;',
    'uniform float uFoam;',          // foam kept a step
    'uniform vec4 uStir[' + MAX_STIR + '];',    // centre, radius, height added (0: unused)
    'uniform float uFroth[' + MAX_STIR + '];',  // foam raised there
    'uniform sampler2D uField;',
    'uniform sampler2D uFieldId;',
    'uniform sampler2D uLand;',
    'uniform vec4 uSite;',           // the shore field's box, canvas px
    'uniform vec2 uCanvas;',         // canvas px
    'uniform float uShore;',
    'const float LANDS = ' + MAX_LANDS.toFixed(1) + ';',
    'void main() {',
    '  vec2 uv = gl_FragCoord.xy * uCell;',
    '  vec4 c = texture2D(uState, uv);',
    '  float mean = 0.25 * (texture2D(uState, uv - vec2(uCell.x, 0.0)).r + texture2D(uState, uv + vec2(uCell.x, 0.0)).r +',
    '    texture2D(uState, uv - vec2(0.0, uCell.y)).r + texture2D(uState, uv + vec2(0.0, uCell.y)).r);',
    '  c.g = (c.g + (mean - c.r) * uK) * uDamp;',
    '  vec2 at = vec2(gl_FragCoord.x, 1.0 / uCell.y - gl_FragCoord.y);',
    '  for (int i = 0; i < ' + MAX_STIR + '; i++) {',
    '    vec4 e = uStir[i];',
    '    if (e.w == 0.0) continue;',
    '    vec2 q = (at - e.xy) / e.z;',
    '    float k = exp(-dot(q, q));',
    '    c.r += e.w * k;',
    '    c.b = max(c.b, uFroth[i] * k);',
    '  }',
    '  c.r += c.g + (mean - c.r) * uSmooth;',
    '  c.b *= uFoam;',
    // land: the water against it is held still, so waves come back off it
    '  if (uShore > 0.5) {',
    '    vec2 fuv = (vec2(uv.x, 1.0 - uv.y) * uCanvas - uSite.xy) / uSite.zw;',
    '    if (fuv.x > 0.0 && fuv.y > 0.0 && fuv.x < 1.0 && fuv.y < 1.0) {',
    '      float f = texture2D(uField, fuv).r;',
    '      float id = floor(texture2D(uFieldId, fuv).r * 255.0 + 0.5);',
    '      float k = texture2D(uLand, vec2((id + 0.5) / LANDS, 0.5)).r;',
    '      float dry = (1.0 - smoothstep(0.0, 0.03, f)) * smoothstep(0.2, 0.8, k);',
    '      c.rgb *= 1.0 - dry;',
    '    }',
    '  }',
    // the canvas's edges soak waves up
    '  vec2 edge = min(gl_FragCoord.xy, 1.0 / uCell - gl_FragCoord.xy);',
    '  float soak = smoothstep(0.0, 14.0, min(edge.x, edge.y));',
    '  c.g *= mix(0.8, 1.0, soak); c.r *= mix(0.96, 1.0, soak);',
    // and nothing ever runs away with itself
    '  c.rg = clamp(c.rg, -2.0, 2.0);',
    '  gl_FragColor = vec4(c.rgb, 1.0);',
    '}'
  ].join('\n');
  // The water stays where the world is when the camera moves: a cell now
  // was at uMove.xy + uMove.zw * here (uv, top down) before the move.
  var MOVE = [
    'precision highp float;',
    'uniform sampler2D uState;',
    'uniform vec2 uCell;',
    'uniform vec4 uMove;',
    'void main() {',
    '  vec2 uv = gl_FragCoord.xy * uCell;',
    '  vec2 was = uMove.xy + uMove.zw * vec2(uv.x, 1.0 - uv.y);',
    '  if (was.x < 0.0 || was.y < 0.0 || was.x > 1.0 || was.y > 1.0) { gl_FragColor = vec4(0.0); return; }',
    '  gl_FragColor = texture2D(uState, vec2(was.x, 1.0 - was.y));',
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

  // every pass draws the same quad, its corners always at attribute 0
  function program(gl, fragment) {
    function compile(type, src) {
      var sh = gl.createShader(type);
      gl.shaderSource(sh, src); gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
      return sh;
    }
    var prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fragment));
    gl.bindAttribLocation(prog, 0, 'aPos');
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

  function uniforms(gl, prog, names) {
    var u = {};
    names.forEach(function (name) { u[name] = gl.getUniformLocation(prog, name); });
    return u;
  }
  function setup(s) {
    var gl = s.gl;
    s.prog = program(gl, FRAGMENT);
    gl.useProgram(s.prog);
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    s.u = uniforms(gl, s.prog, ['uRes', 'uTime', 'uAmp', 'uOcean', 'uUnit', 'uSea', 'uAtlas', 'uRock', 'uCell',
      'uRockAlpha', 'uLight', 'uEv', 'uEvT', 'uEvents', 'uField', 'uFieldId', 'uLand', 'uSite', 'uFieldTexel', 'uWorld', 'uClock',
      'uShore', 'uShoreMix', 'uSurf', 'uZoom', 'uSim', 'uSimCell', 'uSimMix', 'uSimFoam', 'uFlow']);
    gl.activeTexture(gl.TEXTURE0); s.seaTex = texture(gl, s.sea, false);
    gl.activeTexture(gl.TEXTURE1); s.atlasTex = texture(gl, s.atlas.canvas, true);
    s.fieldTex = dataTexture(gl, gl.LINEAR); s.idTex = dataTexture(gl, gl.NEAREST);
    s.landTex = dataTexture(gl, gl.NEAREST);
    s.landBytes = new Uint8Array(MAX_LANDS);
    upload(gl, s.landTex, gl.LUMINANCE, MAX_LANDS, 1, s.landBytes);
    gl.uniform1i(s.u.uSea, 0); gl.uniform1i(s.u.uAtlas, 1);
    gl.uniform1i(s.u.uField, 2); gl.uniform1i(s.u.uFieldId, 3); gl.uniform1i(s.u.uLand, 4);
    gl.uniform1i(s.u.uSim, 5);
    gl.uniform2f(s.u.uLight, CONFIG.rays, CONFIG.shimmer);
    s.rocks = new Float32Array(MAX_ROCKS * 4); s.cells = new Float32Array(MAX_ROCKS * 4);
    s.ev = new Float32Array(MAX_EVENTS * 4); s.evT = new Float32Array(MAX_EVENTS * 4);
    s.field = null; s.fieldDirty = true;
    s.sim = null;
    try { s.sim = simSetup(gl); } catch (e) { console.warn('Reef waves unavailable:', e.message); }
  }

  // The simulation's two state textures, read from one and written to the
  // other each pass. Half floats where the device can draw into them,
  // else full floats; without either the sea keeps its painted motion.
  function simSetup(gl) {
    var half = gl.getExtension('OES_texture_half_float'), full = gl.getExtension('OES_texture_float');
    var kinds = [];
    if (half) kinds.push({ type: half.HALF_FLOAT_OES, linear: !!gl.getExtension('OES_texture_half_float_linear') });
    if (full) kinds.push({ type: gl.FLOAT, linear: !!gl.getExtension('OES_texture_float_linear') });
    gl.getExtension('EXT_color_buffer_half_float'); gl.getExtension('WEBGL_color_buffer_float');
    for (var i = 0; i < kinds.length; i++) {
      var m = { type: kinds[i].type, filter: kinds[i].linear ? gl.LINEAR : gl.NEAREST, w: 0, h: 0 };
      if (simAlloc(gl, m, 8, 8)) {
        m.step = program(gl, STEP); m.move = program(gl, MOVE);
        m.su = uniforms(gl, m.step, ['uState', 'uCell', 'uK', 'uDamp', 'uSmooth', 'uFoam', 'uStir', 'uFroth', 'uField', 'uFieldId',
          'uLand', 'uSite', 'uCanvas', 'uShore']);
        m.mu = uniforms(gl, m.move, ['uState', 'uCell', 'uMove']);
        gl.useProgram(m.step);
        gl.uniform1i(m.su.uState, 5); gl.uniform1i(m.su.uField, 2); gl.uniform1i(m.su.uFieldId, 3);
        gl.uniform1i(m.su.uLand, 4);
        gl.useProgram(m.move); gl.uniform1i(m.mu.uState, 5);
        m.stir = new Float32Array(MAX_STIR * 4); m.froth = new Float32Array(MAX_STIR);
        m.clock = 0; m.cam = null;
        return m;
      }
    }
    return null;
  }
  // (Re)size the state to w x h cells, flat. False if the device cannot
  // draw into this kind of texture.
  function simAlloc(gl, m, w, h) {
    (m.tex || []).forEach(function (t) { gl.deleteTexture(t); });
    (m.fb || []).forEach(function (f) { gl.deleteFramebuffer(f); });
    m.tex = []; m.fb = [];
    for (var i = 0; i < 2; i++) {
      var tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      [[gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
        [gl.TEXTURE_MIN_FILTER, m.filter], [gl.TEXTURE_MAG_FILTER, m.filter]]
        .forEach(function (p) { gl.texParameteri(gl.TEXTURE_2D, p[0], p[1]); });
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, m.type, null);
      var fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      var ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      if (ok) { gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
      m.tex.push(tex); m.fb.push(fb);
      if (!ok) { gl.bindFramebuffer(gl.FRAMEBUFFER, null); return false; }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    m.w = w; m.h = h; m.cur = 0;
    return true;
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
  // The site Bs' first (a screen can hold more than one round): they are
  // where the landings are flown, so they are never the land left over
  // when there is more than the field can tell apart.
  function landsOf(s) {
    var out = [], all = Array.prototype.slice.call(s.cam.querySelectorAll('.site--b :is(' + LAND + ')'));
    s.cam.querySelectorAll(LAND).forEach(function (el) { if (!el.closest('.site--b')) all.push(el); });
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
    // than lies within half a frame or so of a site (an islet with nowhere
    // to go is parked well off them all, js/pages.js)
    var reach = CONFIG.shoreReach + 8, l0 = Infinity, t0 = Infinity, r0 = -Infinity, b0 = -Infinity;
    lands.forEach(function (l) {
      var b = l.box = layout(l.img, cam);
      l0 = Math.min(l0, b.x - reach); t0 = Math.min(t0, b.y - reach);
      r0 = Math.max(r0, b.x + b.w + reach); b0 = Math.max(b0, b.y + b.h + reach);
    });
    var sl = Infinity, st = Infinity, sr = -Infinity, sb = -Infinity;
    cam.querySelectorAll('.site').forEach(function (site) {
      var b = layout(site, cam);
      sl = Math.min(sl, b.x - .6 * W); st = Math.min(st, b.y - .6 * H);
      sr = Math.max(sr, b.x + b.w + .6 * W); sb = Math.max(sb, b.y + b.h + .6 * H);
    });
    if (sr > sl) { l0 = Math.max(l0, sl); t0 = Math.max(t0, st); r0 = Math.min(r0, sr); b0 = Math.min(b0, sb); }
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
    var px = new Uint8Array(n).fill(255), ids = new Uint8Array(n), reach = CONFIG.shoreReach;
    for (y = 0; y < gh; y++) {
      var near = false;
      for (x = 0; x < gw; x++) { f[x] = col[y * gw + x]; near = near || f[x] < INF; }
      if (!near) continue;
      edt(f, gw, d, arg, v, z);
      for (x = 0; x < gw; x++) {
        i = y * gw + x;
        var dist = Math.sqrt(d[x]) * cell, sx = arg[x], sy = rowOf[y * gw + sx];
        if (!(dist < reach) || d[x] >= INF) continue;
        px[i] = Math.round(dist / reach * 250);
        ids[i] = owner[sy * gw + sx];
      }
    }
    var gl = s.gl;
    upload(gl, s.fieldTex, gl.LUMINANCE, gw, gh, px);
    upload(gl, s.idTex, gl.LUMINANCE, gw, gh, ids);
    gl.useProgram(s.prog);
    gl.uniform2f(s.u.uFieldTexel, 1 / gw, 1 / gh);
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

  /* ------------------------------------------------- stepping the waves */
  // What stirs the water this step, read off the page: each craft in
  // frame, a beat of downwash under its hull, and a churn where each
  // burning jet's blast meets the sea (css/pilot.css and css/rounds.css
  // light them off `.is-lit`).
  var CRAFT = '.ship.is-in:not(.is-committed) .ship__img, .hover-ship.is-in:not(.is-gone) .hover-ship__img';
  var JET = { t: [0, -1], r: [1, 0], b: [0, 1], l: [-1, 0] };
  function stir(s, cr, dt) {
    var m = s.sim, n = 0, kx = m.w / cr.width, ky = m.h / cr.height;
    m.stir.fill(0); m.froth.fill(0);
    function spot(x, y, r, a, froth) {
      if (n >= MAX_STIR || !a) return;
      m.stir.set([(x - cr.left) * kx, (y - cr.top) * ky, Math.max(1.5, r * kx), a], n * 4);
      m.froth[n++] = froth || 0;
    }
    s.screen.querySelectorAll(CRAFT).forEach(function (img) {
      var b = img.getBoundingClientRect();
      if (!b.width || b.right < cr.left || b.left > cr.right || b.bottom < cr.top || b.top > cr.bottom) return;
      var size = Math.min(b.width, b.height), x = b.left + b.width / 2, y = b.top + b.height / 2;
      spot(x, y, size * .2, CONFIG.wash * dt * Math.sin(m.clock * CONFIG.washHz * 6.2832));
      spot(x + (Math.random() - .5) * size * .5, y + (Math.random() - .5) * size * .5, size * .12,
        CONFIG.wash * .5 * dt * (Math.random() * 2 - 1));
      img.parentNode.querySelectorAll('.thruster.is-lit').forEach(function (jet) {
        var side = /thruster--([trbl])/.exec(jet.className), bell = jet.querySelector('.thruster__bell');
        if (!side || !bell) return;
        var d = JET[side[1]], j = bell.getBoundingClientRect(), pow = parseFloat(jet.style.getPropertyValue('--pow')) || 1;
        var reach = size * (.22 + .2 * pow), jx = j.left + j.width / 2 + d[0] * reach, jy = j.top + j.height / 2 + d[1] * reach;
        // a beat of its own, a little off the hull's, so the two never lock
        var beat = Math.sin(m.clock * CONFIG.jetHz * 6.2832 + 'trbl'.indexOf(side[1]) * 1.7);
        spot(jx, jy, size * .15, CONFIG.jet * pow * dt * beat, CONFIG.jetFoam * pow);
      });
    });
    return n;
  }
  // The fastest the waves can be stepped: past it the finest ripple, a
  // cell long, grows every step instead of dying away, and the whole sea
  // fills with it (the lens zoomed in on a landing asked for more). With
  // the loss (d) and the smoothing (s) each step takes, that is
  // (1 + d)(1 - s) / d; kept a tenth under it.
  function waveLimit() {
    var d = CONFIG.simDamp, s = CONFIG.simSmooth;
    return .9 * (1 + d) * (1 - s) / d;
  }
  function simPass(gl, m) {
    gl.bindTexture(gl.TEXTURE_2D, m.tex[m.cur]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, m.fb[1 - m.cur]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    m.cur = 1 - m.cur;
  }
  function simClear(gl, m) {
    m.fb.forEach(function (fb) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    });
  }
  // The steps owed since the last frame, after carrying the water along
  // with any move of the camera (the world plate's box against the
  // canvas's). The shore field's textures are bound already (units 2-4);
  // the state goes on unit 5.
  function simulate(s, cr, site) {
    var gl = s.gl, m = s.sim, w = CONFIG.simCells, h = Math.max(8, Math.round(w * cr.height / cr.width));
    if (m.w !== w || m.h !== h) {
      if (!simAlloc(gl, m, w, h)) { s.sim = null; gl.bindFramebuffer(gl.FRAMEBUFFER, null); return; }
      m.cam = null; m.clock = s.clock;
    }
    gl.viewport(0, 0, m.w, m.h);
    if (m.clear) { simClear(gl, m); m.clear = false; m.cam = null; m.clock = s.clock; }
    gl.activeTexture(gl.TEXTURE5);
    var b = s.cam.getBoundingClientRect();
    if (b.width && b.height) {
      var now = [(b.left - cr.left) / cr.width, (b.top - cr.top) / cr.height, b.width / cr.width, b.height / cr.height];
      var was = m.cam;
      if (was && now.some(function (v, i) { return Math.abs(v - was[i]) > 1e-6; })) {
        var rx = was[2] / now[2], ry = was[3] / now[3];
        gl.useProgram(m.move);
        gl.uniform2f(m.mu.uCell, 1 / m.w, 1 / m.h);
        gl.uniform4f(m.mu.uMove, was[0] - rx * now[0], was[1] - ry * now[1], rx, ry);
        simPass(gl, m);
      }
      m.cam = now;
    }
    var owed = Math.floor((s.clock - m.clock) * CONFIG.simRate);
    if (owed > 0) {
      m.clock += owed / CONFIG.simRate;
      owed = Math.min(owed, 4);
      var stirs = stir(s, cr, owed / CONFIG.simRate);
      gl.useProgram(m.step);
      gl.uniform2f(m.su.uCell, 1 / m.w, 1 / m.h);
      var zoom = zoomOf(s);
      gl.uniform1f(m.su.uK, Math.min(waveLimit(), CONFIG.simWave * zoom * zoom));
      gl.uniform1f(m.su.uDamp, CONFIG.simDamp);
      gl.uniform1f(m.su.uSmooth, CONFIG.simSmooth);
      gl.uniform1f(m.su.uFoam, CONFIG.foamKeep);
      gl.uniform1f(m.su.uShore, site ? 1 : 0);
      if (site) gl.uniform4fv(m.su.uSite, site);
      gl.uniform2f(m.su.uCanvas, s.canvas.width, s.canvas.height);
      gl.uniform4fv(m.su.uStir, m.stir); gl.uniform1fv(m.su.uFroth, m.froth);
      for (var i = 0; i < owed; i++) {
        // stirred on the first step only
        if (i === 1 && stirs) { m.stir.fill(0); gl.uniform4fv(m.su.uStir, m.stir); }
        simPass(gl, m);
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
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
    var live = events(s, cr, kx, ky);
    // the shores: the field rides the camera plate
    if (s.fieldDirty && buildField(s)) s.fieldDirty = false;
    var cam = s.cam.getBoundingClientRect(), zoom = s.cam.offsetWidth ? cam.width / s.cam.offsetWidth : 1;
    var world = zoom * kx, site = null;
    if (s.field) {
      landStates(s);
      var worldY = (s.cam.offsetHeight ? cam.height / s.cam.offsetHeight : 1) * ky;
      site = [(cam.left - cr.left) * kx + s.field.x * world, (cam.top - cr.top) * ky + s.field.y * worldY,
        s.field.w * world, s.field.h * worldY];
    }
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, s.fieldTex);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, s.idTex);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, s.landTex);
    var waves = s.sim && !s.reduced;
    if (waves) simulate(s, cr, site);
    waves = waves && s.sim;
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
    gl.uniform1f(s.u.uEvents, live);
    gl.uniform4fv(s.u.uEv, s.ev);
    gl.uniform4fv(s.u.uEvT, s.evT);
    gl.uniform1f(s.u.uZoom, Math.max(zoom, CONFIG.breachZoom));
    if (site) { gl.uniform4fv(s.u.uSite, site); gl.uniform1f(s.u.uWorld, world); }
    gl.uniform1f(s.u.uShore, site ? 1 : 0);
    if (waves) {
      gl.uniform2f(s.u.uSimCell, 1 / s.sim.w, 1 / s.sim.h);
      gl.uniform4f(s.u.uSimMix, CONFIG.simGain, CONFIG.simRefract, CONFIG.simShade, CONFIG.simCaustic);
      gl.uniform1f(s.u.uSimFoam, CONFIG.simFoam);
    } else gl.uniform4f(s.u.uSimMix, 0, 0, 0, 0);
    gl.uniform3f(s.u.uShoreMix, CONFIG.shoreGlow, CONFIG.shoreFoam, CONFIG.shoreSwell);
    gl.uniform1f(s.u.uClock, s.reduced ? 0 : s.clock);
    gl.uniform3f(s.u.uSurf, s.reduced ? 0 : s.clock * CONFIG.surfaceSpeed, CONFIG.refract, CONFIG.shade);
    gl.uniform2f(s.u.uFlow, s.reduced ? 0 : CONFIG.flow, s.clock / CONFIG.flowCycle);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, s.seaTex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, s.atlasTex);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, s.fieldTex);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, s.idTex);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, s.landTex);
    if (waves) { gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, s.sim.tex[s.sim.cur]); }
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
      // a breach left half-played on a screen the player has left is over,
      // and so are its waves; and the sea comes back from a landing's
      // cut-scene calm, not with the waves it had before the shot
      if (!s.screen.classList.contains('is-active')) {
        s.events = [];
        if (s.sim) s.sim.clear = true;
      } else if (s.screen.classList.contains('is-cinema') && s.sim) s.sim.clear = true;
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
    var cam = screen.querySelector('.cam');
    if (!cam || !screen.querySelector('.site--b')) return;
    var s = { screen: screen, bg: bg, cam: cam, canvas: canvas, gl: gl, sea: sea, atlas: atlas,
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
