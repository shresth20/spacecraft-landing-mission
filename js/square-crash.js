/* ============================================================
   Geo Drone — THE SQUARE'S CRASH ON THE BIG ISLAND, close up

   When the craft is set down on an island too BIG for it (screen 3,
   GO), the screen cuts to the angle and plays the crash: the same two
   pictures as the successful landing (js/square-landing.js), the
   craft and the island, on the screen's own sea. Every jet, cloud of
   dust, puff of gas, rock, crack, fireball and wisp of smoke is made
   here and in css/square-crash.css.

   ── WHY IT CRASHES ────────────────────────────────────────────
   The island is laid in exactly as for the fit, then scaled up about
   the middle of its top face by sqrt(land area / craft area): the
   craft's footprint (the red guide) is lost on it. With no edge to
   settle edge for edge on, the craft wanders on its jets as it comes
   down, the jets choke, and it drops onto the rock far too fast.

   ── THE TIMELINE (ms) ─────────────────────────────────────────
     0      the cut (0.5s), over the hover: four long jets
     700    the descent: no edge to lock on to, it starts to wander
     1250   the jets choke and sputter; it falls
            (only ever the four jets burn: in the air, then flaring out
            from under the hull on the rock)
     1700   IMPACT: flash, shock, a jolt of the lens, the rock cracks,
            dust out over the whole of the big top, rocks thrown
     1700   it bounces, tipping...
     2080   ...and comes down on its corner: a second blow
     2200   the blast: fireballs off the hull, sparks, a last throw of
            rock; the hull scorched, its lamps out
     2900   down, wrecked, still; its four jets' fires dying under it,
            soot rising
     4400   the smoke thinning, the dust settled: the cut back

   One clock, js/square-landing.js's player's: `run.t`. The craft,
   the jets, the debris and the camera are worked out from t every
   frame (the debris from paths simulated once per play); the clouds,
   flames and flashes are an anime.js timeline that is only SEEKED.

   It plugs into that player as its third kind of shot:
   GeoSquareLanding.register('loose', dress), so
   play(site, 'loose', hooks) with hooks.areas = { craft, land }, and
   the player's play() / pause() / restart() / destroy() / seek(t).
   Hooks: alive(), onImpact() (the rock is hit: the heart and its
   bang), onSettle() (the verdict), onReturn() (the cut back).
   ============================================================ */

(function (global) {
  'use strict';

  var L = global.GeoSquareLanding;
  if (!L || !L.register || !L.kit) return;
  var kit = L.kit;
  var ART = kit.ART;
    var doc = document;

  var AT = kit.AT;
  var JET = kit.JET;
  var WARP = kit.WARP;

  var HOVER = 240;
  /* the beats */
  var DESCEND = 700;
  var CHOKE = 1250;
  var TOUCH = 1700;
  var REST = 2080;              /* the second blow, on the corner */
  var BLAST = 2200;
  var STILL = 2900;
  var END = 4400;
  var FADE = kit.FADE;

  var G = .0026;                /* gravity, stage px / ms^2 */
  var BOUNCE = 34;              /* how high it is thrown back up */
  var TILT = 6;                 /* deg: how far over it ends, dug in */

  var DUST = ['#d8c6a6', '#cbb796', '#bcae9a', '#a99f92', '#e2d4ba'];
  /* broken rock, lit from the top left: mostly dark earth-brown
     chunks, a few with the island's orange still on them */
  var ROCK = [
    'linear-gradient(150deg, #a07a5c, #7a5640 38%, #573a28 66%, #2e1e14)',
    'linear-gradient(140deg, #8e6a50, #6a4a36 40%, #4a3122 68%, #26180f)',
    'linear-gradient(160deg, #b08868, #886248 36%, #614230 64%, #362418)',
    'linear-gradient(150deg, #7c6050, #5c4436 40%, #3e2c22 70%, #1e140e)',
    'linear-gradient(150deg, #e8964a, #b8662a 38%, #7a3c16 66%, #3a1a08)'
  ];

  function clamp(lo, v, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function seg(t, a, b) { return clamp(0, (t - a) / (b - a), 1); }
  function mix(a, b, u) { return a + (b - a) * u; }
  function rand(lo, hi) { return lo + Math.random() * (hi - lo); }
  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }
  function px(n) { return n.toFixed(1) + 'px'; }
  function outCubic(u) { return 1 - Math.pow(1 - u, 3); }

  function node(tag, cls, parent) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (parent) parent.appendChild(n);
    return n;
  }

  function image(src, cls, parent) {
    var img = node('img', cls, parent);
    img.alt = '';
    img.decoding = 'async';
    img.draggable = false;
    img.src = src;
    return img;
  }

  function pts(list) {
    return list.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ');
  }

  function polygon(list) {
    return 'polygon(' + list.map(function (p) { return px(p[0]) + ' ' + px(p[1]); }).join(', ') + ')';
  }

  var NS = 'http://www.w3.org/2000/svg';

  function svg(parent, cls) {
    var s = doc.createElementNS(NS, 'svg');
    s.setAttribute('class', cls);
    s.setAttribute('viewBox', '0 0 ' + kit.STAGE_W + ' ' + kit.STAGE_H);
    parent.appendChild(s);
    return s;
  }

  /* a point across a face, by (u, v) from its back corner */
  function across(q, u, v) {
    return [
      (1 - u) * (1 - v) * q.b[0] + u * (1 - v) * q.r[0] + u * v * q.f[0] + (1 - u) * v * q.l[0],
      (1 - u) * (1 - v) * q.b[1] + u * (1 - v) * q.r[1] + u * v * q.f[1] + (1 - u) * v * q.l[1]
    ];
  }

  var KEYS = ['l', 'b', 'r', 'f'];

  /* inside a convex quad, wound l b r f */
  function inside(q, p) {
    var sign = 0;
    for (var i = 0; i < 4; i++) {
      var a = q[i], b = q[(i + 1) % 4];
      var c = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
      if (c === 0) continue;
      if (!sign) sign = c > 0 ? 1 : -1;
      else if ((c > 0 ? 1 : -1) !== sign) return false;
    }
    return true;
  }


  /* ============================================================
     THE BIG ISLAND — the fit's island, scaled up about the middle of
     its top face by how much bigger its area is than the craft's
     ============================================================ */

  /* the side, by the square root of the areas -- pushed well past it,
     so the platform is plainly far too big for the craft at a glance */
  function scaleOf(areas) {
    var c = areas && +areas.craft, l = areas && +areas.land;
    var ratio = c > 0 && l > c ? l / c : 1.5;
    return clamp(1.75, Math.sqrt(ratio) * 1.5, 2.3);
  }

  /* the homography H, then a scale by s about m */
  function grown(h, m, s) {
    return [
      s * h[0] + (1 - s) * m[0] * h[6], s * h[1] + (1 - s) * m[0] * h[7], s * h[2] + (1 - s) * m[0] * h[8],
      s * h[3] + (1 - s) * m[1] * h[6], s * h[4] + (1 - s) * m[1] * h[7], s * h[5] + (1 - s) * m[1] * h[8],
      h[6], h[7], h[8]
    ];
  }

  function project(h, p) {
    var w = h[6] * p[0] + h[7] * p[1] + h[8];
    return [(h[0] * p[0] + h[1] * p[1] + h[2]) / w, (h[3] * p[0] + h[4] * p[1] + h[5]) / w];
  }

  function size(st, s) {
    var g = st.geo, m = g.mid;
    st.big = s;
    var h = grown(g.fitLand, m, s);
    g.land = h;
    var f = g.fitFlat;
    g.landFlat = [f[0] * s, f[1] * s, f[2] * s, f[3] * s, m[0] + (f[4] - m[0]) * s, m[1] + (f[5] - m[1]) * s];
    g.top = KEYS.map(function (key) { return project(h, ART.land.top[key]); });
    g.base = KEYS.map(function (key) { return project(h, ART.land.base[key]); });
    st.land.style.transform = kit.matrix3d(h);
    st.seat.style.clipPath = polygon(g.base);
    var topClip = polygon(g.top);
    st.cracks.style.clipPath = topClip;
    st.scorch.style.clipPath = topClip;
    st.hazeClip.forEach(function (el) { el.style.clipPath = topClip; });
  }


  /* ============================================================
     THE OVERLAY — built once per screen marked data-cinema

     Back to front: the sea, the big island, its cracks and scorch, the
     shadow and the jets' light on it, the dust and gas behind the
     craft, the jets, the craft (and on it its scorch, its red-hot
     underside and the fires), the jets' light on its edge, the dust
     and smoke in front, the fire licking out from under the hull, the
     fireballs, and the rocks thrown.
     ============================================================ */

  function dress(screen) {
    var geo = kit.layout();
    geo.fitLand = geo.land;
    geo.fitFlat = geo.landFlat;

    var shell = kit.shellOf('sqx');
    var root = shell.root, cam = shell.cam, sea = shell.sea, stage = shell.stage;

    var seat = node('div', 'sql__seat', stage);
    node('i', '', seat);
    var land = image(ART.land.src, 'sql__land', stage);
    land.style.width = px(ART.land.size[0]);
    land.style.height = px(ART.land.size[1]);

    var scorch = node('div', 'sqx__scorch', stage);
    var sc = node('i', '', scorch);
    sc.style.left = px(geo.mid[0]);
    sc.style.top = px(geo.mid[1]);

    var cracks = svg(stage, 'sqx__cracks');

    var faceClip = polygon(geo.quad);
    var shade = node('div', 'sql__shade', stage);
    node('i', '', shade).style.clipPath = faceClip;
    var glow = node('div', 'sql__glow', stage);
    var spot = node('i', '', glow);
    spot.style.left = px(geo.mid[0]);
    spot.style.top = px(geo.mid[1]);

    /* the ground haze, lying on the top: behind the craft and in front */
    var hazeRear = node('div', 'sqx__flat', stage);
    var hazeR = node('i', 'sqx__haze', hazeRear);

    /* the footprint the craft needs, lost on the big top: red */
    var guide = svg(stage, 'cine__guide');
    var fp = doc.createElementNS(NS, 'polygon');
    fp.setAttribute('points', pts(geo.quad));
    guide.appendChild(fp);
    geo.quad.forEach(function (p, i) {
      var prev = geo.quad[(i + 3) % 4], next = geo.quad[(i + 1) % 4];
      var br = doc.createElementNS(NS, 'polyline');
      br.setAttribute('points', pts([[mix(p[0], prev[0], .2), mix(p[1], prev[1], .2)], p,
                                     [mix(p[0], next[0], .2), mix(p[1], next[1], .2)]]));
      guide.appendChild(br);
    });

    var rear = node('div', 'sqx__layer', stage);

    var jets = kit.rigOf(stage, geo);
    var craft = image(ART.craft.src, 'sql__craft', stage);
    var hull = hullOf(stage, geo);
    var lit = kit.litOf(stage, geo);

    var hazeFront = node('div', 'sqx__flat', stage);
    var hazeF = node('i', 'sqx__haze sqx__haze--front', hazeFront);
    var front = node('div', 'sqx__layer', stage);
    /* the fire from under the hull, over the bank it lights */
    var under = underOf(stage, geo, jets.jets);
    var blast = node('div', 'sqx__layer', stage);
    var debris = node('div', 'sqx__layer', stage);

    [jets.rig, under.box, craft, hull.box, lit].forEach(function (el) {
      el.style.left = px(geo.craft.left);
      el.style.top = px(geo.craft.top);
      el.style.width = px(geo.craft.w);
      el.style.height = px(geo.craft.h);
      el.style.transformOrigin = px(geo.craft.origin[0]) + ' ' + px(geo.craft.origin[1]);
    });

    [hazeR, hazeF].forEach(function (el) {
      el.style.left = px(geo.mid[0]);
      el.style.top = px(geo.mid[1] + 10);
    });

    var blurs = kit.svgDefs(root, [1.5, 3, 5]);
    var lens = kit.lensOf(root);

    screen.appendChild(root);

    var st = {
      kind: 'loose', hover: HOVER, end: END, fade: FADE,
      frame: frame, strew: strew, reset: reset, focusAt: focusAt,
      screen: screen, root: root, cam: cam, stage: stage, sea: sea, land: land, craft: craft,
      seat: seat.firstChild, scorch: scorch, cracks: cracks, guide: guide,
      shade: shade, glow: glow, rig: jets.rig, aura: jets.aura, bands: jets.bands, jets: jets.jets,
      lit: lit, hull: hull, under: under, haze: [hazeR, hazeF], hazeClip: [hazeRear, hazeFront],
      layers: [rear, front, blast, debris, cracks],
      fx: { rear: rear, front: front, blast: blast, debris: debris },
      warp: lens.warp, blurs: blurs, flash: lens.flash,
      geo: geo, big: 1, run: null, scale: 1, ox: 0, oy: 0
    };
    size(st, scaleOf(null));
    refit(st);
    new ResizeObserver(function () { refit(st); }).observe(root);
    return st;
  }

  /* Moving with the craft: the four jets once the hull is down. Each
     of the four flares out from under the base edge it burned from --
     out and down over the rock, away from the middle of the hull -- so
     there are only ever the four fires, in the air and on the rock. */
  function underOf(parent, geo, jets) {
    var box = node('div', 'sqx__under', parent);
    var E = geo.edge, c = [(E.l[0] + E.r[0]) / 2, Math.min(E.l[1], E.r[1]) - 40];
    var tongues = jets.map(function (jt, i) {
      var at = jt.at;
      var d = [at[0] - c[0], at[1] - c[1]];
      var n = Math.hypot(d[0], d[1]) || 1;
      d = [d[0] / n, d[1] / n + .55];
      var el = node('i', 'sqx__tongue', box);
      el.style.left = px(at[0]);
      el.style.top = px(at[1] - 8);
      el.style.setProperty('--a', (Math.atan2(-d[0], d[1]) + rand(-.1, .1)).toFixed(3) + 'rad');
      el.style.setProperty('--k', rand(1.75, 2.05).toFixed(2));
      el.style.setProperty('--d', (-i * .037).toFixed(3) + 's');
      node('b', '', el);
      return el;
    });
    return { box: box, tongues: tongues };
  }

  /* On the craft, moving with it: the scorch and the red heat masked
     to its own picture; and the points on its top the soot rises from. */
  function hullOf(parent, geo) {
    var box = node('div', 'sqx__hull', parent);
    var mask = 'url("' + ART.craft.src + '")';
    var char = node('i', 'sqx__char', box);
    var heat = node('i', 'sqx__heat', box);
    [char, heat].forEach(function (el) {
      el.style.webkitMaskImage = el.style.maskImage = mask;
    });
    var K = geo.craft.w / ART.craft.size[0];
    var vents = [[.32, .72], [.7, .58], [.52, .3], [.86, .9]].map(function (a) {
      var p = across(ART.craft.top, a[0], a[1]);
      return [p[0] * K, p[1] * K];
    });
    return { box: box, char: char, heat: heat, vents: vents };
  }

  /* kit.fit frames the fit's island; this one is bigger, so the stage
     is pulled back until all of it, and the craft at its hover, are
     inside the letterbox (with room for the camera's push in) */
  function refit(st) {
    kit.fit(st);
    var W = st.root.clientWidth, H = st.root.clientHeight;
    if (!W || !H) return;
    var g = st.geo;
    var top = g.craft.top - HOVER - 16;
    var bottom = Math.max.apply(null, g.base.map(function (p) { return p[1]; })) + 24;
    var left = Math.min.apply(null, g.base.map(function (p) { return p[0]; })) - 60;
    var right = Math.max.apply(null, g.base.map(function (p) { return p[0]; })) + 60;
    var bar = Math.round(H * .085);
    var s = Math.min(st.scale, (H - 2 * bar) / ((bottom - top) * 1.08), W / ((right - left) * 1.08));
    st.scale = s;
    st.ox = W / 2 - (left + right) / 2 * s;
    st.oy = H / 2 - (top + bottom) / 2 * s;
    st.stage.style.transform = 'translate(' + px(st.ox) + ',' + px(st.oy) + ') scale(' + s.toFixed(5) + ')';
  }

  function reset(st, run) {
    st.layers.forEach(function (el) { el.textContent = ''; });
    st.guide.classList.remove('is-ok', 'is-bad');
    st.flash.style.opacity = '0';
    st.craft.style.filter = '';
    var hooks = (run && run.hooks) || {};
    size(st, scaleOf(hooks.areas || (run && run.areas)));
    refit(st);
  }

  function focusAt(t) {
    return [AT[0], AT[1] - mix(90, 40, seg(t, DESCEND, TOUCH))];
  }


  /* ============================================================
     THE MOTION — all of it a function of t
     ============================================================ */

  /* how high the underside is over the rock */
  function gapAt(t) {
    if (t < DESCEND) return HOVER + 5 * Math.sin(t / DESCEND * Math.PI * 2);
    if (t < TOUCH) {
      /* the jets hold it a little, then let it fall: fastest at the rock */
      var u = seg(t, DESCEND, TOUCH);
      return HOVER * (1 - (.3 * u + .7 * Math.pow(u, 2.5)));
    }
    if (t < REST) return BOUNCE * Math.sin(Math.PI * seg(t, TOUCH + 50, REST));
    return 0;
  }

  /* pressed into the broken rock once it is down on its corner */
  function sinkAt(t) {
    return 7 * outCubic(seg(t, REST, REST + 320));
  }

  /* the wander: no edge to lock on to, it sways side to side and over */
  function driftAt(t) {
    var a = seg(t, DESCEND, TOUCH);
    return 12 * a * a * Math.sin(t / 150);
  }

  /* its tilt, deg (clockwise: the right corner down) */
  function tiltAt(t) {
    if (t < TOUCH) {
      var a = seg(t, DESCEND + 200, TOUCH);
      return 3.2 * a * Math.sin(t / 118 + .6);
    }
    if (t < REST) {
      /* thrown over as it bounces */
      return mix(-3, 10, Math.sin(Math.PI * .5 * seg(t, TOUCH, REST)));
    }
    /* down on the corner, rocking back, then still */
    var b = seg(t, REST, STILL);
    return TILT + 3.3 * Math.cos(Math.PI * 2.2 * b) * Math.pow(1 - b, 2);
  }

  /* the blows: a squash on each */
  function squashAt(t) {
    var s = 0;
    if (t >= TOUCH && t < TOUCH + 220) s = .075 * Math.sin(Math.PI * seg(t, TOUCH, TOUCH + 220));
    if (t >= REST && t < REST + 200) s += .04 * Math.sin(Math.PI * seg(t, REST, REST + 200));
    return s;
  }

  /* how hard the jets burn, 0..1, and how wildly */
  function burnAt(t) {
    if (t < CHOKE) return seg(t, 0, 160) * mix(1, .8, seg(t, DESCEND, CHOKE));
    if (t < TOUCH) return mix(.8, .62, seg(t, CHOKE, TOUCH));
    /* out from under the hull now: the flares (underOf) take them on */
    return .62 * (1 - seg(t, TOUCH, TOUCH + 140));
  }

  function wildAt(t) {
    return seg(t, CHOKE - 150, CHOKE + 150) * (t > TOUCH ? 1.4 : 1);
  }

  /* a stuttering noise in -1..1 for each jet */
  function stutter(t, i) {
    var v = Math.sin(t / (23 + i * 7) + i * 1.9) + .7 * Math.sin(t / (11 + i * 3) + i * 4.3);
    return clamp(-1, v / 1.5, 1);
  }

  function frame(st, run) {
    var t = run.t;
    var gap = Math.max(0, gapAt(t));
    var burn = burnAt(t);
    var wild = wildAt(t);
    var near = 1 - Math.min(1, gap / HOVER);
    run.st = st;

    if (run.tl) run.tl.seek(Math.min(t, run.tl.duration));

    /* the hull: the engine's judder while it burns, the wander, the
       blows, then the violent shaking of the crash dying away */
    var vx = 0, vy = 0;
    if (burn > .02) {
      var j = burn * (1.5 + 2.5 * wild);
      vx = j * (Math.sin(t * .071) + .5 * Math.sin(t * .193 + 1.7));
      vy = j * .75 * (Math.cos(t * .083) + .5 * Math.sin(t * .157 + .6));
    }
    if (t >= TOUCH) {
      var q = Math.pow(1 - seg(t, TOUCH, STILL), 2) * 6;
      vx += q * Math.sin(t * .37 + 1.1);
      vy += q * .6 * Math.sin(t * .29);
    }
    var sq = squashAt(t);
    var hullT = 'translate(' + px(vx + driftAt(t)) + ',' + px(vy - gap + sinkAt(t)) + ') rotate(' +
      tiltAt(t).toFixed(3) + 'deg) scale(' + (1 + sq * .5).toFixed(4) + ',' + (1 - sq).toFixed(4) + ')';
    st.rig.style.transform = st.lit.style.transform = st.craft.style.transform =
      st.hull.box.style.transform = st.under.box.style.transform = hullT;

    /* a smear on the fall, gone just before it hits */
    var speed = (gapAt(t - 16) - gapAt(t)) / 16;
    var mbv = t < TOUCH ? clamp(0, (speed - .12) / .3, 1) * (1 - seg(t, TOUCH - 90, TOUCH - 20)) : 0;
    var mb = st.blurs[Math.min(st.blurs.length - 1, Math.ceil(mbv * (st.blurs.length - 1) - .15))] || '';
    if (mb !== run.mb) {
      st.craft.style.filter = mb;
      run.mb = mb;
    }

    /* the jets: steady, then choking -- each its own length, cutting
       out and catching -- and after the blow thrashing, then out */
    var len = 0;
    st.bands.forEach(function (band, i) {
      var wob = 1 + .05 * Math.sin(t / (71 + i * 23) + i * 2.1);
      var l = JET * burn * wob * (1 + .32 * wild * stutter(t, i));
      len = Math.max(len, Math.max(0, Math.min(l, gap + 14)));
      band.style.height = px(Math.max(0, Math.min(l, gap + 14)) + 6);
      band.style.opacity = clamp(0, burn * 3, 1).toFixed(3);
      band.classList.toggle('is-hit', l >= gap && burn > .05);
    });
    st.jets.forEach(function (jt, i) {
      var cut = wild > 0 ? stutter(t * 1.7, i + 5) : 1;
      var k = wild > 0 ? clamp(.15, .9 + .45 * cut * wild, 1.35) : '';
      jt.el.style.height = k === '' ? '' : 'calc(100% * ' + k.toFixed(3) + ')';
      jt.el.style.opacity = wild > 0 && cut < -.55 ? '.25' : '';
    });
    var E = st.geo.edge;
    st.aura.style.height = px(E.f[1] - Math.min(E.l[1], E.r[1]) + 30 + len * 1.15);
    st.aura.style.opacity = clamp(0, burn * 1.5, 1).toFixed(3);

    /* the edge lit by the jets, and red-hot after the blast */
    st.lit.style.opacity = clamp(0, burn * 1.8 * seg(t, 0, 160) + .7 * seg(t, BLAST, BLAST + 120) *
      (1 - .75 * seg(t, BLAST + 300, END)), 1).toFixed(3);

    st.shade.style.opacity = (.12 + .5 * near * near).toFixed(3);
    st.shade.style.setProperty('--blur', px(3 + 12 * (1 - near)));
    st.glow.style.opacity = (burn * (.25 + .75 * near)).toFixed(3);

    /* the footprint: in as the cut opens, red as soon as it is plain
       the island is too big, flickering as the craft wanders over it */
    var g = seg(t, WARP - 120, WARP + 200) * clamp(0, (gap - 20) / 60, 1);
    if (t > CHOKE) g *= .65 + .35 * Math.sin(t / 30);
    st.guide.style.opacity = g.toFixed(3);
    if (t >= DESCEND + 100 && once(run, 'verdict')) st.guide.classList.add('is-bad');

    /* the rocks, on the paths thrown for them */
    fly(st, run, t);

    kit.camera(st, run, t);
    cues(st, run, t, burn, gap);
    kit.warp(st, run, t);
  }


  /* ============================================================
     THE ROCKS — thrown from the rock round the hull at the blows and
     the blast. Each one's path is simulated once, as it is strewn:
     out over the top under gravity, bouncing to rest on the rock if
     it comes down on the island, falling away down its side if not.
     ============================================================ */

  var STEP = 16;

  function throwRock(st, run, at, out, born, o) {
    var el = node('i', 'sqx__rock' + (o.spark ? ' sqx__spark' : ''), st.fx.debris);
    var s = rand(o.size[0], o.size[1]);
    el.style.width = el.style.height = px(s);
    el.style.margin = px(-s / 2) + ' 0 0 ' + px(-s / 2);
    el.style.left = px(at[0]);
    el.style.top = px(at[1]);
    if (!o.spark) {
      var n = 5 + Math.floor(Math.random() * 3), poly = [];
      for (var i = 0; i < n; i++) {
        var a = (i + rand(-.3, .3)) / n * Math.PI * 2, r = rand(.34, .5);
        poly.push([50 + Math.cos(a) * r * 100, 50 + Math.sin(a) * r * 100]);
      }
      el.style.clipPath = 'polygon(' + poly.map(function (p) {
        return p[0].toFixed(0) + '% ' + p[1].toFixed(0) + '%';
      }).join(',') + ')';
      el.style.background = pick(ROCK);
    }
    el.style.opacity = '0';

    /* the path: across the ground (x, y), and up off it (h) */
    var sp = rand(o.speed[0], o.speed[1]);
    var p = { x: at[0], y: at[1], h: rand(0, 10), vx: out[0] * sp, vy: out[1] * sp * .58,
              vh: rand(o.up[0], o.up[1]), r: rand(0, 360), spin: rand(-.9, .9) * (o.spark ? 0 : 1) };
    var life = o.life ? rand(o.life[0], o.life[1]) : END + FADE - born;
    var path = [], gone = 0, rested = false, off = false, top = st.geo.top;
    for (var tt = 0; tt <= life; tt += STEP) {
      if (!rested) {
        for (var k = 0; k < 2; k++) {
          var dt = STEP / 2;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.vh -= G * dt;
          p.h += p.vh * dt;
          p.r += p.spin * dt;
          if (p.h <= 0 && !off && !o.spark) {
            if (inside(top, [p.x, p.y])) {
              p.h = 0;
              if (Math.abs(p.vh) < .09) { rested = true; break; }
              p.vh = -p.vh * .32;
              p.vx *= .5; p.vy *= .5; p.spin *= .45;
            } else off = true;
          }
        }
      }
      if (off) gone += STEP;
      var fade = o.spark ? 1 - tt / life : (off ? 1 - gone / (p.y < st.geo.mid[1] ? 90 : 360) : 1);
      path.push([p.x - at[0], p.y - p.h - at[1], p.r, clamp(0, fade, 1)]);
      if (fade <= 0) break;
    }
    run.rocks.push({ el: el, born: born, path: path });
  }

  function fly(st, run, t) {
    if (!run.rocks) return;
    run.rocks.forEach(function (r) {
      var i = (t - r.born) / STEP;
      if (i < 0 || i >= r.path.length) {
        if (r.shown !== false) { r.el.style.opacity = '0'; r.shown = false; }
        return;
      }
      var a = r.path[Math.floor(i)], b = r.path[Math.min(r.path.length - 1, Math.floor(i) + 1)], u = i % 1;
      r.el.style.transform = 'translate(' + px(mix(a[0], b[0], u)) + ',' + px(mix(a[1], b[1], u)) +
        ') rotate(' + mix(a[2], b[2], u).toFixed(1) + 'deg)';
      r.el.style.opacity = mix(a[3], b[3], u).toFixed(3);
      r.shown = true;
    });
  }

  /* points round the craft's footprint, each with the way out from it */
  function rim(st, n, grow) {
    var q = st.geo.quad, m = st.geo.mid, out = [];
    for (var i = 0; i < n; i++) {
      var e = Math.floor(Math.random() * 4), a = q[e], b = q[(e + 1) % 4], u = Math.random();
      var p = [mix(a[0], b[0], u), mix(a[1], b[1], u)];
      p = [m[0] + (p[0] - m[0]) * grow, m[1] + (p[1] - m[1]) * grow];
      var d = [p[0] - m[0], (p[1] - m[1]) / .58];
      var l = Math.hypot(d[0], d[1]) || 1;
      var spread = rand(-.35, .35);
      var c = Math.cos(spread), s = Math.sin(spread);
      d = [d[0] / l, d[1] / l];
      out.push({ at: p, out: [d[0] * c - d[1] * s, d[0] * s + d[1] * c], back: p[1] < m[1] });
    }
    return out;
  }


  /* ============================================================
     THE CLOUDS, THE FIRE, THE CRACKS — strewn afresh on every play,
     timed on the timeline
     ============================================================ */

  function strew(st, run) {
    var A = global.anime;
    if (!A) return null;
    var geo = st.geo;
    var tl = A.timeline({ autoplay: false, easing: 'linear' });
    run.rocks = [];

    /* a billow parked at `at`, rolled out by `d`, on a layer */
    var cloud = function (cls, layer, at, d, born, o) {
      var el = node('i', cls, layer);
      el.style.left = px(at[0]);
      el.style.top = px(at[1]);
      el.style.setProperty('--s', px(o.size));
      if (o.tint) el.style.setProperty('--tint', o.tint);
      var life = Math.min(o.life, END + FADE - born - 20);
      tl.add({
        targets: el,
        translateX: [{ value: [0, d[0]], duration: life, easing: o.ease || 'easeOutCubic' }],
        translateY: [{ value: [0, d[1]], duration: life, easing: o.ease || 'easeOutCubic' }],
        scale: [{ value: [o.from || .45, o.to || 1.5], duration: life, easing: 'easeOutCubic' }],
        rotate: [{ value: [rand(-10, 10), rand(-25, 25)], duration: life }],
        opacity: [{ value: [0, o.peak], duration: life * (o.rise || .1), easing: 'easeOutQuad' },
                  { value: o.peak * (o.hold || .85), duration: life * .35 },
                  { value: 0, duration: life * (.55 - (o.rise || .1)), easing: 'easeInQuad' }]
      }, born);
      return el;
    };

    var layerFor = function (pt) { return pt.back ? st.fx.rear : st.fx.front; };

    /* the jets' dust, kicked up off the big top as the craft nears it */
    rim(st, 8, 1.05).forEach(function (pt) {
      cloud('sqx__dust', layerFor(pt), pt.at, [pt.out[0] * rand(60, 130), pt.out[1] * rand(40, 80) * .58 - rand(0, 14)],
            rand(TOUCH - 420, TOUCH - 120), { size: rand(90, 140), life: rand(1300, 1700), peak: .55, tint: pick(DUST) });
    });

    /* IMPACT: the dust out over the whole of the big top, lumped thick
       round the hull, and hot gas blown out from under it */
    var reach = 150 + 260 * (st.big - 1);
    rim(st, 24, 1).forEach(function (pt) {
      var r = rand(.45, 1) * reach + 70;
      cloud('sqx__dust', layerFor(pt), pt.at, [pt.out[0] * r, pt.out[1] * r * .58 - rand(8, 40)],
            TOUCH + rand(0, 90), { size: rand(130, 210), life: rand(1900, 2500), peak: rand(.8, .95),
                                    tint: pick(DUST), ease: 'easeOutExpo', hold: .8 });
    });
    rim(st, 9, .9).forEach(function (pt) {
      cloud('sqx__gas', layerFor(pt), pt.at, [pt.out[0] * rand(90, 170), pt.out[1] * rand(50, 100) - rand(20, 60)],
            TOUCH + rand(-10, 60), { size: rand(110, 170), life: rand(520, 760), peak: .75, from: .3, to: 1.9,
                                      ease: 'easeOutQuart', rise: .06, hold: .6 });
    });

    /* the ground haze: spreading low over the top and staying, thinning */
    st.haze.forEach(function (el, i) {
      el.style.setProperty('--w', px((geo.top[2][0] - geo.top[0][0]) * 1.1));
      tl.add({
        targets: el,
        scale: [{ value: [.25, 1], duration: 900, easing: 'easeOutExpo' },
                { value: 1.12, duration: END - TOUCH - 900 }],
        opacity: [{ value: [0, i ? .5 : .62], duration: 260, easing: 'easeOutQuad' },
                  { value: i ? .42 : .55, duration: 1100 },
                  { value: 0, duration: END + FADE - TOUCH - 1600, easing: 'easeInQuad' }]
      }, TOUCH);
    });

    /* the shocks: a dusty ring at the blow, a hot one at the blast */
    var fw = geo.face.r[0] - geo.face.l[0];
    [[TOUCH, 'sqx__ring', 2.2, 700], [BLAST, 'sqx__ring sqx__ring--hot', 1.6, 480]].forEach(function (s) {
      var ring = node('i', s[1], st.fx.rear);
      ring.style.left = px(geo.mid[0]);
      ring.style.top = px(geo.mid[1]);
      ring.style.setProperty('--s', px(fw * 1.1));
      tl.add({ targets: ring, scale: [.4, s[2] * (.7 + .3 * st.big)], duration: s[3], easing: 'easeOutCubic' }, s[0])
        .add({ targets: ring, opacity: [{ value: [0, 1], duration: 40 }, { value: 0, duration: s[3] - 60, easing: 'easeInQuad' }] }, s[0]);
    });

    /* the flashes: the lens's, and the burst of light on the rock */
    tl.add({ targets: st.flash, opacity: [{ value: [0, .4], duration: 40 }, { value: 0, duration: 260, easing: 'easeOutQuad' },
                                         { value: 0, duration: BLAST - TOUCH - 300 },
                                         { value: .65, duration: 50 }, { value: 0, duration: 420, easing: 'easeOutQuad' }] }, TOUCH);
    [[TOUCH, 1.1, .8], [BLAST, 1.3, .7]].forEach(function (b) {
      var el = node('i', 'sqx__burst', st.fx.blast);
      el.style.left = px(geo.mid[0]);
      el.style.top = px(geo.mid[1] - 20);
      el.style.setProperty('--s', px(fw * b[1]));
      tl.add({ targets: el, scale: [.5, 1.25], duration: 520, easing: 'easeOutExpo' }, b[0])
        .add({ targets: el, opacity: [{ value: [0, b[2]], duration: 50 }, { value: 0, duration: 520, easing: 'easeInQuad' }] }, b[0]);
    });

    /* the rock cracks, out from under the hull, at each blow */
    cracksAt(st, tl, TOUCH, 7, 1);
    cracksAt(st, tl, REST, 4, .7);

    /* the rocks: a throw at the blow, a smaller one off the corner,
       the blast's, and a few late tumbles */
    rim(st, 30, 1.04).forEach(function (pt) {
      throwRock(st, run, pt.at, pt.out, TOUCH + rand(0, 60),
                { size: Math.random() < .25 ? [24, 44] : [8, 20], speed: [.22, .7], up: [.35, 1.05] });
    });
    rim(st, 10, 1.02).forEach(function (pt) {
      throwRock(st, run, pt.at, pt.out, REST + rand(0, 40), { size: [7, 18], speed: [.15, .45], up: [.3, .7] });
    });
    rim(st, 16, .9).forEach(function (pt) {
      throwRock(st, run, pt.at, pt.out, BLAST + rand(0, 50),
                { size: Math.random() < .3 ? [20, 36] : [8, 18], speed: [.3, .85], up: [.6, 1.25] });
    });
    rim(st, 22, .85).forEach(function (pt) {
      throwRock(st, run, [pt.at[0], pt.at[1] - rand(10, 60)], pt.out, BLAST + rand(0, 80),
                { spark: true, size: [3, 6], speed: [.4, 1.1], up: [.4, 1.2], life: [380, 700] });
    });
    rim(st, 5, 1).forEach(function (pt, i) {
      throwRock(st, run, pt.at, pt.out, BLAST + 500 + i * rand(120, 220), { size: [5, 11], speed: [.08, .22], up: [.12, .3] });
    });

    /* the blast: fireballs off the hull, each rolling into soot */
    var c = ART.craft, K = geo.craft.w / c.size[0];
    var onHull = function (u, v, face) {
      var p = across(c[face], u, v);
      return [geo.craft.left + p[0] * K, geo.craft.top + p[1] * K + 4];
    };
    [[.5, .5, 'base', 1.15], [.15, .85, 'base', .9], [.85, .85, 'base', .9], [.5, 1, 'base', 1],
     [.3, .6, 'top', .8], [.75, .45, 'top', .75], [.95, .55, 'base', .7]].forEach(function (f, i) {
      var at = onHull(f[0], f[1], f[2]);
      var born = BLAST + i * 26;
      cloud('sqx__fire', st.fx.blast, at, [rand(-30, 30), -rand(20, 70)], born,
            { size: 215 * f[3], life: rand(420, 600), peak: 1, from: .2, to: 1.45, ease: 'easeOutExpo', rise: .05, hold: .9 });
      cloud('sqx__soot', i % 2 ? st.fx.rear : st.fx.front, at, [rand(10, 50), -rand(80, 140)], born + 220,
            { size: 180 * f[3], life: rand(1500, 1900), peak: .78, from: .5, to: 1.9, ease: 'easeOutSine', rise: .15 });
    });

    /* the hull: scorched and its lamps out at the blast, the underside
       red-hot and cooling */
    tl.add({ targets: st.hull.char, opacity: [{ value: [0, .3], duration: 60 }, { value: .3, duration: BLAST - TOUCH - 60 },
                                              { value: .82, duration: 220, easing: 'easeOutQuad' }] }, TOUCH)
      .add({ targets: st.hull.heat, opacity: [{ value: [0, 1], duration: 90 }, { value: .9, duration: 300 },
                                              { value: .2, duration: END - BLAST - 390, easing: 'easeOutSine' }] }, BLAST);

    /* the soot rising off it, thinning as the fires die; the wind takes
       it to the right */
    for (var i = 0; i < 16; i++) {
      var u = i / 15;
      var vt = st.hull.vents[i % st.hull.vents.length];
      var at = [geo.craft.left + vt[0], geo.craft.top + vt[1] - 30];
      cloud('sqx__soot', st.fx.front, at, [rand(40, 110), -rand(140, 240)], BLAST + 300 + u * 1600 + rand(-60, 60),
            { size: rand(90, 140) * (1 - .3 * u), life: rand(1500, 1900), peak: mix(.7, .28, u),
              from: .4, to: 2.2, ease: 'easeOutSine', rise: .18 });
    }

    /* THE WRECK'S BANK, as the reference shows it: a dense, low bank of
       dust and smoke hugging the base on both front sides and round its
       side corners, churning up in waves from the blow to the end and
       never quite gone -- warm-lit while the fire burns under it */
    var faces = [['l', 'f'], ['f', 'r']];
    var bankAt = function (born, n, o) {
      for (var b = 0; b < n; b++) {
        var side = faces[b % 2], u = rand(.05, .95);
        var a = geo.face[side[0]], e = geo.face[side[1]];
        var p0 = [mix(a[0], e[0], u), mix(a[1], e[1], u)];
        var d = [p0[0] - geo.mid[0], (p0[1] - geo.mid[1]) / .58];
        var dl = Math.hypot(d[0], d[1]) || 1;
        /* kept low and out from the wall, so the hull stands up out of it */
        var out = rand(40, 100);
        var at = [p0[0] + d[0] / dl * out, p0[1] + d[1] / dl * out * .58 + rand(18, 40)];
        var el = cloud('sqx__dust sqx__dust--bank', st.fx.front, at,
                       [d[0] / dl * rand(30, 70), -rand(6, 30)], born + rand(0, o.spread),
                       { size: rand(o.size[0], o.size[1]), life: o.life, peak: o.peak, tint: pick(DUST),
                         from: .55, to: 1.35, ease: 'easeOutSine', rise: .16, hold: .92 });
        var warm = node('b', '', el);
        tl.add({ targets: warm, opacity: [{ value: [0, o.warm], duration: 200 },
                                          { value: 0, duration: o.life * .7, easing: 'easeInQuad' }] }, born);
      }
      /* and one behind each side corner, so the bank wraps the hull */
      ['l', 'r'].forEach(function (k) {
        var q = geo.face[k];
        cloud('sqx__dust', st.fx.rear, [q[0] + (k === 'l' ? -30 : 30), q[1] - 10], [(k === 'l' ? -1 : 1) * rand(20, 50), -rand(30, 70)],
              born + rand(0, o.spread), { size: rand(o.size[0], o.size[1]) * 1.1, life: o.life, peak: o.peak * .9,
                                           tint: pick(DUST), from: .55, to: 1.35, ease: 'easeOutSine', rise: .16, hold: .92 });
      });
    };
    bankAt(TOUCH + 40, 12, { spread: 160, size: [130, 185], life: 1500, peak: .95, warm: .6 });
    bankAt(REST, 10, { spread: 200, size: [130, 190], life: 1600, peak: .95, warm: .75 });
    bankAt(BLAST + 300, 10, { spread: 300, size: [135, 195], life: 1700, peak: .9, warm: .5 });
    bankAt(BLAST + 1000, 10, { spread: 400, size: [135, 195], life: 1800, peak: .82, warm: .25 });
    bankAt(BLAST + 1700, 8, { spread: 400, size: [130, 185], life: END + FADE - BLAST - 1800, peak: .7, warm: 0 });

    /* the four jets, on the rock: flaring out from under the edges as
       the hull hits (the jets in the air go out as they do), roaring up
       at the blast, and dying down */
    st.under.tongues.forEach(function (el, i) {
      tl.add({ targets: el,
               opacity: [{ value: [0, .95], duration: 90 }, { value: .8, duration: BLAST - TOUCH - 90 },
                         { value: 1, duration: 80 }, { value: .9, duration: 700 },
                         { value: 0, duration: END - BLAST - 500 - i * 120, easing: 'easeInQuad' }],
               scale: [{ value: [.4, 1], duration: 150, easing: 'easeOutQuad' }, { value: .8, duration: BLAST - TOUCH - 150 },
                       { value: 1.2, duration: 120, easing: 'easeOutQuad' }, { value: .45, duration: END - BLAST - 120, easing: 'easeInSine' }]
      }, TOUCH + i * 20);
    });

    /* hot gas venting from under the edges, thinner and thinner */
    for (i = 0; i < 14; i++) {
      var side = faces[i % 2], gu = rand(.1, .9);
      var ga = geo.face[side[0]], gb = geo.face[side[1]];
      var gp = [mix(ga[0], gb[0], gu), mix(ga[1], gb[1], gu) - 6];
      cloud('sqx__gas', st.fx.front, gp, [(gp[0] - geo.mid[0]) * .25, -rand(60, 120)], TOUCH + 200 + i * 150 + rand(0, 80),
            { size: rand(80, 120), life: rand(700, 950), peak: mix(.55, .25, i / 13), from: .4, to: 1.7, ease: 'easeOutSine', rise: .1, hold: .7 });
    }

    /* rubble: chunks broken off round the base that hop out and settle
       right beside it, in the bank */
    rim(st, 18, 1.03).forEach(function (pt) {
      throwRock(st, run, pt.at, pt.out, TOUCH + rand(10, 120), { size: Math.random() < .3 ? [18, 30] : [8, 16], speed: [.05, .16], up: [.18, .42] });
    });
    rim(st, 10, 1.02).forEach(function (pt) {
      throwRock(st, run, pt.at, pt.out, BLAST + rand(10, 120), { size: [8, 20], speed: [.05, .14], up: [.2, .4] });
    });

    /* the scorch spreading on the rock under it */
    tl.add({ targets: st.scorch, opacity: [{ value: [0, .5], duration: 120 }, { value: .5, duration: BLAST - TOUCH - 120 },
                                          { value: .85, duration: 300, easing: 'easeOutQuad' }] }, TOUCH);

    kit.cut(run, tl);
    tl.add({ targets: {}, duration: 1 }, END + FADE);
    return tl;
  }

  /* jagged cracks out across the top from round the hull */
  function cracksAt(st, tl, born, n, len) {
    var m = st.geo.mid, q = st.geo.quad;
    var lines = [];
    for (var i = 0; i < n; i++) {
      var e = Math.floor(Math.random() * 4), a = q[e], b = q[(e + 1) % 4], u = rand(.1, .9);
      var p = [mix(a[0], b[0], u), mix(a[1], b[1], u)];
      var ang = Math.atan2((p[1] - m[1]) / .58, p[0] - m[0]) + rand(-.3, .3);
      var list = [[mix(m[0], p[0], .85), mix(m[1], p[1], .85)]];
      var L = rand(90, 220) * len * st.big, steps = 6;
      for (var s = 1; s <= steps; s++) {
        ang += rand(-.45, .45);
        var d = L / steps;
        var last = list[list.length - 1];
        list.push([last[0] + Math.cos(ang) * d, last[1] + Math.sin(ang) * d * .58]);
      }
      [['sqx__crack-lo', 0], ['sqx__crack', 1]].forEach(function (k) {
        var pl = doc.createElementNS(NS, 'polyline');
        pl.setAttribute('class', k[0]);
        pl.setAttribute('pathLength', '100');
        pl.setAttribute('points', pts(list.map(function (pp) { return [pp[0], pp[1] + k[1] * 1.5]; })));
        st.cracks.appendChild(pl);
        lines.push(pl);
      });
    }
    tl.add({ targets: lines, strokeDashoffset: [100, 0], duration: 300, easing: 'easeOutQuad',
             delay: global.anime.stagger(8) }, born);
  }


  /* ============================================================
     THE CUES — sounds and hooks, each once, off t
     ============================================================ */

  function once(run, name) {
    if (run.fired[name]) return false;
    run.fired[name] = true;
    return true;
  }

  function call(run, name) {
    var f = run.hooks[name];
    if (f) { try { f(); } catch (e) { setTimeout(function () { throw e; }); } }
  }

  function sfx(name, v) {
    var S = global.GeoCinemaSFX;
    if (S && S[name]) S[name](v);
  }

  function roar(run, jets) {
    if (run.jets === jets) return;
    run.jets = jets;
    var A = global.GeoAudio;
    if (A && A.thrust) A.thrust(jets);
  }

  function cues(st, run, t, burn, gap) {
    roar(run, t >= BLAST ? 0 : (t >= CHOKE ? 2 : 4));

    var hum = burn > .02 ? Math.round(burn * 20) / 20 : 0;
    if (hum !== run.hum) {
      run.hum = hum;
      sfx('engine', hum);
    }
    if (burn > .02 && t >= WARP - 120 && t < CHOKE && t >= run.pulseAt) {
      run.pulseAt = t + rand(150, 210);
      sfx('pulse', burn);
    }
    /* the jets choking */
    if (t >= CHOKE && t < TOUCH && t >= (run.chokeAt || 0)) {
      run.chokeAt = t + rand(130, 200);
      sfx('sputter');
    }

    if (t >= TOUCH && once(run, 'impact')) {
      sfx('clank', 1);
      sfx('vent', 1);
      run.shake = { amp: 9, ms: 760, t0: t };
      run.punch = { amt: .04, ms: 380, t0: t };
      call(run, 'onImpact');
    }
    if (t >= REST && once(run, 'corner')) {
      sfx('clank', .7);
      run.shake = { amp: 4.5, ms: 420, t0: t };
    }
    if (t >= BLAST && once(run, 'blast')) {
      sfx('crash', 1);
      sfx('bass');
      run.shake = { amp: 11, ms: 900, t0: t };
      run.punch = { amt: .05, ms: 460, t0: t };
    }
    if (t >= STILL && once(run, 'settle')) call(run, 'onSettle');
    if (t >= END && once(run, 'return')) {
      st.root.classList.add('is-leaving');
      call(run, 'onReturn');
    }
  }

  L.register('loose', dress);
})(window);
