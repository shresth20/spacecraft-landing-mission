/* ============================================================
   Geo Drone — THE SUCCESSFUL LANDING, close up

   When the craft is set down on the island that fits it (GO, on any
   landing), the screen cuts to the same moment seen from the angle:
   the island standing in the sea, the craft hovering over it on its
   jets, coming down, and settling on it edge for edge.

   Written for the square's landing, and since 2026-10-21 played on
   every round's: each shape brings its own two pictures, and
   everything below is worked out from their corners.

   ── THE ART ───────────────────────────────────────────────────
   Two pictures per shape and nothing else: the craft and the island
   seen from the angle (assets/images/landing, cut and measured by
   tools/build_landings.py into js/landing-assets.js), on the screen's
   own sea. Neither is redrawn, resized or turned while the shot
   plays. The jets, the light they throw, the shadow and all of the
   smoke are made here and in css/square-landing.css.

   The touchdown is set from the SLABS, not the images: the build
   tool measures the four corners of the craft's underside and of the
   island's top face off their silhouettes, and the island is laid
   into the stage by the homography that takes its top face's four
   corners onto the four corners of the craft's underside at rest.
   Exact, corner for corner, whatever the view.

   The corners are named l, b, r, f -- the leftmost first, then
   clockwise -- which on a diamond view (the square, the rhombus) is
   left, back, right, front, and on a view from the front is
   front-left, back-left, back-right, front-right. Which of the four
   walls under them face the camera (and so where the jets hang, where
   the smoke banks up, where the sea's line runs on a sinking hull) is
   read off the corners themselves: viewOf(), below.

   ── THE CINEMATIC ─────────────────────────────────────────────
   Shot exactly as the other landings' cut-scene is (js/cinematic.js):
   the same overlay (it wears .cine, so css/cinematic.css dresses it),
   the letterbox, the vignette -- but a cut in of its own, a slow
   cross-zoom: the overhead view, still on the island the lens came
   down onto (js/close-up.js), pushes on in at the craft and softens
   away, while the close-up comes up through it out of a soft zoom
   blur, its craft where the overhead one was, and eases back to its
   own framing. Nothing flashes. Then a slow push in, the engine juddering the
   hull while the jets burn, a smear on the fast part of the drop, the
   landing guide on the rock, and at touchdown a jolt of the lens, the
   ring of light, the seam lit edge for edge, the match drawn round
   and the sparks -- with the same synthesised sounds.

   ── THE TIMELINE (shot ms, played at RATE: x1.43 on the clock) ─
     0      the cut (0.76s), over the hover: long flickering jets
     800    the descent, slowing all the way; the jets shorten
     1600   the jets reach the rock: smoke rolls out over it
     2000   touchdown: a little compression, the jets go out,
            a last soft burst of gas round the base, the lens jolts
     2400   the seam lights, the match is drawn round, sparks fly
     2600   down and still; the smoke spreads and clears
     4000   the cut back to the sea

   One clock, `run.t`, which runs at RATE of the frame's and stops
   with the rest of the mission while the tab is away
   (js/lifecycle.js). The craft, the jets, the light and the shadow
   are worked out from t every frame; the smoke is a timeline of
   anime.js tweens that is never played, only SEEKED to t (timeline(),
   below); the sounds and the hooks are cues fired off the same t.

   ── THE CONTRACT ──────────────────────────────────────────────
   create(site, hooks) returns a player with play(), pause(),
   restart(), destroy() and seek(t), and `done`, a Promise that settles once
   the cut is back on the sea (true) or was cut off (false).
   play(site, hooks) is create + play, and returns `done` -- the same
   shape as GeoCinema.play, so js/script.js can swap one for the
   other. Hooks:

     alive()        false once the screen has been left: stop dead
     onTouchdown()  the craft is down and still: the success
     onSettle()     the verdict can be spoken
     onReturn()     the cut is fading back to the sea

   Stage px: the scene is a 1600x900 stage, scaled to keep the scene
   inside the letterboxed frame.

   ── THE MISFIT ────────────────────────────────────────────────
   The same two pictures play the failure too, when the island is too
   small for the craft (THE MISFIT, below): play(site, 'tight', hooks)
   with hooks.areas = { craft, land }. The island is cut down to the
   land's area against the craft's, the craft comes down on it only
   part on, rocks, tips off into the sea and sinks. Every splash,
   ring, bubble and patch of foam is made here. Its extra hook:

     onImpact()     the water is hit: the heart, and its sound
   ============================================================ */

(function (global) {
  'use strict';

  var doc = document;
  /* every shape's two pictures, by shape (js/landing-assets.js); the
     file this one grew out of held the square's alone */
  var ART = global.GeoLandingAssets || global.GeoSquareLandingAssets || null;
  if (ART && ART.craft && ART.land) ART = { square: ART };
  var SEA = global.GeoEnvironmentAssets && global.GeoEnvironmentAssets.ocean;

  /* a screen's own art: the shape it is the round of */
  function artOf(screen) {
    var a = ART && screen && ART[screen.dataset.shape];
    return a && a.craft && a.land ? a : null;
  }

  var STAGE_W = 1600;
  var STAGE_H = 900;
  /* what must be seen, in stage px: from the craft's top at the hover
     to the island's foot, and kept inside the letterbox */
  var SAFE_W = 1320;
  var SAFE_H = 790;
  var SAFE_Y = 494;             /* its middle */
  var BAR = 0.085;              /* each letterbox bar, a share of the height */

  var K = 0.48;                 /* stage px per craft px: the square's craft's one size */
  /* every craft's underside is drawn to the same area on stage as the
     square's, so one shape's shot is the size of another's */
  var FOOT = 103800;            /* that area, stage px squared; set from the square's below */
  var AT = [800, 612];          /* the centre of the island's top face, on stage */
  var HOVER = 240;              /* how high it hangs over the rock at first */
  var JET = 200;                /* a jet's full length, stage px */

  /* the beats */
  var DESCEND = 800;
  var SMOKE = 1600;
  var TOUCH = 2000;
  var STILL = 2600;
  var END = 4000;
  var FADE = 560;               /* the cut back, after END (css/cinematic.css) */

  /* The shot's clock against the frame's. Every beat, here and in the
     shots played through this one (js/square-crash.js), is in shot ms,
     and they are played this much slower than they are written, so the
     drop, the touchdown and the wreck can be followed by eye. */
  var RATE = .7;

  /* the cut: a slow cross-zoom (cut(), below) */
  var WARP = 760;
  var DIVE = .45;               /* how far the overhead view pushes on in */
  var DIVE_BLUR = 6;
  var WIN = ['#8dffc0', '#c6ffe0', '#ffe27a', '#7ff6ff'];

  var ease = {
    inOut: function (u) { return u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; }
  };

  /* The jets: four big ones, under the walls that face the camera --
     two under each of a diamond view's two front walls, four along a
     front view's one -- at these shares of the wall's length. */
  var STREAKS = { 2: [.27, .73], 1: [.12, .37, .63, .88] };

  var shots = new Map();        /* screen -> { fit, tight }: its overlays */

  function shotsOf(screen) {
    var o = shots.get(screen);
    if (!o) shots.set(screen, o = {});
    return o;
  }

  function clamp(lo, v, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function seg(t, a, b) { return clamp(0, (t - a) / (b - a), 1); }
  function mix(a, b, u) { return a + (b - a) * u; }
  function rand(lo, hi) { return lo + Math.random() * (hi - lo); }

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

  function px(n) { return n.toFixed(1) + 'px'; }
  function ms(n) { return Math.round(n) + 'ms'; }
  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

  var NS = 'http://www.w3.org/2000/svg';

  /* a stage-sized SVG holding `n` shapes, classed for css/cinematic.css */
  function svgOf(parent, cls, shape, n) {
    var svg = doc.createElementNS(NS, 'svg');
    svg.setAttribute('class', cls);
    svg.setAttribute('viewBox', '0 0 ' + STAGE_W + ' ' + STAGE_H);
    for (var i = 0; i < n; i++) {
      var el = doc.createElementNS(NS, shape);
      if (shape === 'polyline') el.setAttribute('pathLength', '100');
      svg.appendChild(el);
    }
    parent.appendChild(svg);
    return svg;
  }

  /* vertical-only gaussian blurs, as filter: url(#id) values: the
     smear on the fast part of the drop */
  var defsMade = 0;

  function svgDefs(parent, strengths) {
    var svg = doc.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'cine__defs');
    svg.setAttribute('aria-hidden', 'true');
    var out = [''];
    defsMade++;
    strengths.forEach(function (sd, i) {
      var id = 'sqlMb' + defsMade + '_' + i;
      var f = doc.createElementNS(NS, 'filter');
      f.setAttribute('id', id);
      f.setAttribute('x', '-5%');
      f.setAttribute('y', '-15%');
      f.setAttribute('width', '110%');
      f.setAttribute('height', '130%');
      var g = doc.createElementNS(NS, 'feGaussianBlur');
      g.setAttribute('stdDeviation', '0 ' + sd);
      f.appendChild(g);
      svg.appendChild(f);
      out.push('url(#' + id + ')');
    });
    parent.appendChild(svg);
    return out;
  }

  function pts(list) {
    return list.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ');
  }

  /* A shot's timeline: anime.js tweens, each set at its own moment on
     the shot's clock, never played, only seeked. anime's own timeline
     did this, but it seeks every tween it holds over again on each
     add(), and a strew of a few hundred froze the screen for most of a
     second between the lens coming down and the cut. Same add(params,
     at) and seek(t); `duration` is where the last tween ends. */
  function timeline() {
    var A = global.anime;
    var kids = [];
    var now = 0;
    var tl = {
      duration: 0,
      add: function (params, at) {
        if (at == null) at = tl.duration;
        openOn(params);
        var ins = A(Object.assign({ easing: 'linear', duration: 1000 }, params, { autoplay: false }));
        kids.push({ at: at, ins: ins });
        tl.duration = Math.max(tl.duration, at + ins.duration);
        return tl;
      },
      /* in the order they were added going on, the other way going
         back, as anime's does */
      seek: function (t) {
        var back = t < now, n = kids.length;
        now = t;
        for (var i = 0; i < n; i++) {
          var k = kids[back ? n - 1 - i : i];
          k.ins.seek(t - k.at);
        }
      }
    };
    return tl;
  }

  /* A tween's opening opacity, put on its elements before anime looks
     for it: anime reads an element's own style before its computed
     one, and a computed style asked for just after the element was
     made costs a restyle of the page -- one for every particle. anime
     sets the same value itself as soon as the tween is made. */
  function openOn(params) {
    var v = params.opacity;
    if (Array.isArray(v) && v[0] && v[0].value !== undefined) v = v[0].value;
    if (!Array.isArray(v) || typeof v[0] !== 'number') return;
    var els = params.targets;
    els = els && els.length !== undefined && !els.nodeType ? els : [els];
    for (var i = 0; i < els.length; i++) {
      if (els[i] && els[i].style && !els[i].style.opacity) els[i].style.opacity = v[0];
    }
  }


  /* ============================================================
     THE GEOMETRY
     ============================================================ */

  /* a point across a face, by (u, v) from its back corner */
  function across(q, u, v) {
    return [
      (1 - u) * (1 - v) * q.b[0] + u * (1 - v) * q.r[0] + u * v * q.f[0] + (1 - u) * v * q.l[0],
      (1 - u) * (1 - v) * q.b[1] + u * (1 - v) * q.r[1] + u * v * q.f[1] + (1 - u) * v * q.l[1]
    ];
  }

  /* The homography taking four points onto four others, as the 3x3
     [h00 .. h22] with h22 = 1: the 8x8 system solved by elimination. */
  function homography(src, dst) {
    var A = [];
    for (var i = 0; i < 4; i++) {
      var x = src[i][0], y = src[i][1], X = dst[i][0], Y = dst[i][1];
      A.push([x, y, 1, 0, 0, 0, -x * X, -y * X, X]);
      A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y, Y]);
    }
    for (var c = 0; c < 8; c++) {
      var p = c;
      for (var r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      var tmp = A[c]; A[c] = A[p]; A[p] = tmp;
      for (r = 0; r < 8; r++) {
        if (r === c) continue;
        var f = A[r][c] / A[c][c];
        for (var k = c; k < 9; k++) A[r][k] -= f * A[c][k];
      }
    }
    var h = [];
    for (c = 0; c < 8; c++) h.push(A[c][8] / A[c][c]);
    h.push(1);
    return h;
  }

  /* the affine taking three points onto three others, as canvas
     setTransform(a, b, c, d, e, f) arguments: near enough to the
     island's homography for the cut's blurred snapshot */
  function affine(src, dst) {
    var x1 = src[0][0], y1 = src[0][1], x2 = src[1][0], y2 = src[1][1], x3 = src[2][0], y3 = src[2][1];
    var det = x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2);
    var solve = function (v1, v2, v3) {
      return [(v1 * (y2 - y3) + v2 * (y3 - y1) + v3 * (y1 - y2)) / det,
              (x1 * (v3 - v2) + x2 * (v1 - v3) + x3 * (v2 - v1)) / det,
              (x1 * (y2 * v3 - y3 * v2) + x2 * (y3 * v1 - y1 * v3) + x3 * (y1 * v2 - y2 * v1)) / det];
    };
    var X = solve(dst[0][0], dst[1][0], dst[2][0]), Y = solve(dst[0][1], dst[1][1], dst[2][1]);
    return [X[0], Y[0], X[1], Y[1], X[2], Y[2]];
  }

  function project(h, p) {
    var w = h[6] * p[0] + h[7] * p[1] + h[8];
    return [(h[0] * p[0] + h[1] * p[1] + h[2]) / w, (h[3] * p[0] + h[4] * p[1] + h[5]) / w];
  }

  /* as a CSS matrix3d, for an element with transform-origin 0 0 */
  function matrix3d(h) {
    return 'matrix3d(' + [h[0], h[3], 0, h[6], h[1], h[4], 0, h[7], 0, 0, 1, 0, h[2], h[5], 0, h[8]]
      .map(function (n) { return +n.toFixed(8); }).join(',') + ')';
  }

  function polygon(pts) {
    return 'polygon(' + pts.map(function (p) { return px(p[0]) + ' ' + px(p[1]); }).join(', ') + ')';
  }

  var KEYS = ['l', 'b', 'r', 'f'];

  function quadArea(q) {
    var a = 0, pts = KEYS.map(function (k) { return q[k]; });
    for (var i = 0, j = 3; i < 4; j = i++) a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
    return Math.abs(a) / 2;
  }

  if (ART && ART.square) FOOT = K * K * quadArea(ART.square.craft.base);

  /* stage px per craft px, for this craft: its underside the same area
     on stage as the square's */
  function kOf(art) {
    return Math.sqrt(FOOT / (quadArea(art.craft.base) || 1));
  }

  /* the convex hull of some points (Andrew's monotone chain), clockwise
     on screen */
  function hull(points) {
    var pts = points.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    if (pts.length < 3) return pts;
    var cross = function (o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); };
    var lower = [], upper = [], i;
    for (i = 0; i < pts.length; i++) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pts[i]) <= 0) lower.pop();
      lower.push(pts[i]);
    }
    for (i = pts.length - 1; i >= 0; i--) {
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pts[i]) <= 0) upper.pop();
      upper.push(pts[i]);
    }
    upper.pop(); lower.pop();
    return lower.concat(upper);
  }

  /* Which of a slab's four walls face the camera, read off its four
     corners (an underside or a top face, l b r f): a wall whose outward
     side points down the screen is seen.

       faces   those walls, left to right, each [left corner, right corner]
       chain   the corners along them, in x order
       rear    the other walls, each [corner, next corner] in cycle order
       apex    the corner nearest the camera on the chain: where the sea's
               line on a sinking hull has its vertex
       hug     the corner the misfit's small island is tucked up against
               (the chain's right end), and tip the wall the craft goes
               off over -- the left front wall, or on a front view the
               left side */
  function viewOf(q) {
    var mid = across(q, .5, .5), faces = [], rear = [];
    KEYS.forEach(function (k, i) {
      var j = KEYS[(i + 1) % 4], a = q[k], b = q[j];
      var ox = (a[0] + b[0]) / 2 - mid[0], oy = (a[1] + b[1]) / 2 - mid[1];
      if (oy / (Math.hypot(ox, oy) || 1) > .3) faces.push(a[0] <= b[0] ? [k, j] : [j, k]);
      else rear.push([k, j]);
    });
    faces.sort(function (p, s) { return q[p[0]][0] + q[p[1]][0] - q[s[0]][0] - q[s[1]][0]; });
    if (!faces.length) faces.push(['l', 'f']);
    var chain = [];
    faces.forEach(function (f) {
      f.forEach(function (k) { if (chain.indexOf(k) < 0) chain.push(k); });
    });
    chain.sort(function (a, b) { return q[a][0] - q[b][0]; });
    var two = faces.length >= 2;
    var first = chain[0], last = chain[chain.length - 1];
    var side = rear.filter(function (e) { return e.indexOf(first) >= 0; })[0];
    return {
      faces: faces, chain: chain, rear: rear,
      streaks: STREAKS[two ? 2 : 1],
      apex: two ? faces[0][1] : first,
      hug: last,
      tip: two ? faces[0] : (side || faces[0]),
      pivots: [first, last]
    };
  }

  /* the underside's seen edges, in the craft's own box (stage px): the
     corners along the front walls, and the box round them */
  function edgeOf(c, K, view) {
    var chain = view.chain.map(function (k) { return [c.base[k][0] * K, c.base[k][1] * K]; });
    var xs = chain.map(function (p) { return p[0]; }), ys = chain.map(function (p) { return p[1]; });
    return {
      chain: chain,
      x0: Math.min.apply(null, xs), x1: Math.max.apply(null, xs),
      yTop: Math.min.apply(null, ys), yBot: Math.max.apply(null, ys)
    };
  }

  /* Where everything is, in stage px, with the craft at rest. Fixed
     for the art, so worked out once. */
  function layout(art) {
    var c = art.craft, l = art.land;
    var K = kOf(art);
    var view = viewOf(c.base);
    var mid = across(c.base, .5, .5);
    var onStage = function (p) { return [AT[0] + (p[0] - mid[0]) * K, AT[1] + (p[1] - mid[1]) * K]; };

    /* the craft's underside at rest IS the island's top face */
    var face = {};
    KEYS.forEach(function (key) { face[key] = onStage(c.base[key]); });
    var h = homography(KEYS.map(function (key) { return l.top[key]; }),
                       KEYS.map(function (key) { return face[key]; }));
    var base = KEYS.map(function (key) { return project(h, l.base[key]); });

    return {
      art: art, K: K, view: view,
      craft: { left: AT[0] - mid[0] * K, top: AT[1] - mid[1] * K, w: c.size[0] * K, h: c.size[1] * K,
               origin: [mid[0] * K, mid[1] * K] },
      land: h,
      landFlat: affine(['l', 'b', 'r'].map(function (key) { return l.top[key]; }),
                       ['l', 'b', 'r'].map(function (key) { return face[key]; })),
      face: face,
      quad: KEYS.map(function (key) { return face[key]; }),
      base: base,
      mid: onStage(mid),
      /* the underside's front edges, in the craft's own box (stage px) */
      edge: edgeOf(c, K, view)
    };
  }


  /* ============================================================
     THE OVERLAY — built once per screen marked data-cinema, at boot,
     so its two pictures are fetched behind the start gate.

     Back to front: the sea, the island (with the shadow, the jets'
     light and the smoke behind the craft on it), the jets, the craft,
     the jets' light on its underside's edge, and the smoke in front.
     ============================================================ */

  function dress(screen) {
    var art = artOf(screen);
    if (shotsOf(screen).fit || !art) return;
    var geo = layout(art);

    /* .cine: the cut-scene's own overlay, letterbox and lens */
    var root = node('div', 'cine sql');
    root.setAttribute('aria-hidden', 'true');
    var cam = node('div', 'cine__cam', root);
    var sea = SEA ? image(SEA.src, 'cine__sea', cam) : null;

    var stage = node('div', 'cine__stage', cam);

    var seat = node('div', 'sql__seat', stage);
    node('i', '', seat).style.clipPath = polygon(geo.base);

    var land = image(art.land.src, 'sql__land', stage);
    land.style.width = px(art.land.size[0]);
    land.style.height = px(art.land.size[1]);
    land.style.transform = matrix3d(geo.land);

    var faceClip = polygon(geo.quad);
    var shade = node('div', 'sql__shade', stage);
    node('i', '', shade).style.clipPath = faceClip;
    var glow = node('div', 'sql__glow', stage);
    glow.style.clipPath = faceClip;
    var spot = node('i', '', glow);
    spot.style.left = px(geo.mid[0]);
    spot.style.top = px(geo.mid[1]);

    /* the landing guide: the footprint on the rock, a bracket on each
       corner -- green, edge for edge */
    var guide = svgOf(stage, 'cine__guide', 'polygon', 1);
    guide.children[0].setAttribute('points', pts(geo.quad));
    geo.quad.forEach(function (p, i) {
      var prev = geo.quad[(i + 3) % 4], next = geo.quad[(i + 1) % 4];
      var br = doc.createElementNS(NS, 'polyline');
      br.setAttribute('points', pts([[mix(p[0], prev[0], .2), mix(p[1], prev[1], .2)], p,
                                     [mix(p[0], next[0], .2), mix(p[1], next[1], .2)]]));
      guide.appendChild(br);
    });

    var back = node('div', 'cine__fx', stage);
    var rear = node('div', 'sql__smoke', stage);

    var jets = rigOf(stage, geo);
    var rig = jets.rig, aura = jets.aura, bands = jets.bands;

    var craft = image(art.craft.src, 'sql__craft', stage);

    var lit = litOf(stage, geo);

    var front = node('div', 'sql__smoke', stage);
    var over = node('div', 'cine__fx', stage);

    /* the seam where hull meets rock, and the match drawn round it once
       it is down: far edges as hidden lines, a bracket on every corner */
    var seam = svgOf(stage, 'cine__seam', 'polyline', Math.max(1, geo.view.chain.length - 1));
    var match = svgOf(stage, 'cine__match is-ok', 'polygon', 2);
    for (var m = 0; m < 5; m++) match.appendChild(doc.createElementNS(NS, 'polyline'));
    ['m-foot', 'm-face', 'm-corner', 'm-corner', 'm-corner', 'm-corner', 'm-far'].forEach(function (cls, i) {
      match.children[i].setAttribute('class', cls);
    });
    var mk = match.children, q = geo.quad;
    mk[0].setAttribute('points', pts(q));
    mk[1].setAttribute('points', pts(q));
    mk[6].setAttribute('points', pts([q[0], q[1], q[2]]));
    q.forEach(function (p, i) {
      var prev = q[(i + 3) % 4], next = q[(i + 1) % 4];
      mk[i + 2].setAttribute('points', pts([[mix(p[0], prev[0], .24), mix(p[1], prev[1], .24)], p,
                                            [mix(p[0], next[0], .24), mix(p[1], next[1], .24)]]));
    });

    [rig, craft, lit].forEach(function (el) {
      el.style.left = px(geo.craft.left);
      el.style.top = px(geo.craft.top);
      el.style.width = px(geo.craft.w);
      el.style.height = px(geo.craft.h);
      el.style.transformOrigin = px(geo.craft.origin[0]) + ' ' + px(geo.craft.origin[1]);
    });

    /* the lens: the cut's canvas, the blurs, the flash, the letterbox */
    var warpCv = node('canvas', 'cine__warp', root);
    warpCv.hidden = true;
    var blurs = svgDefs(root, [1.5, 3, 5]);
    var flash = node('i', 'cine__flash', root);
    node('i', 'cine__bar cine__bar--top', root);
    node('i', 'cine__bar cine__bar--bottom', root);

    screen.appendChild(root);

    var st = {
      kind: 'fit', hover: HOVER, end: END, frame: frame, strew: strew, reset: resetFit,
      screen: screen, root: root, cam: cam, stage: stage, sea: sea, land: land, craft: craft,
      rig: rig, lit: lit, aura: aura, bands: bands, shade: shade, glow: glow, guide: guide,
      seam: seam, match: match, warp: warpCv, blurs: blurs, flash: flash,
      fx: { back: back, front: over },
      smoke: { rear: rear, front: front }, layers: [rear, front, back, over],
      geo: geo, run: null, scale: 1, ox: 0, oy: 0
    };
    shotsOf(screen).fit = st;

    fit(st);
    new ResizeObserver(function () { fit(st); }).observe(root);
  }

  /* The jets: a rig under each of the two front faces, skewed to hang
     off its edge (a skewY keeps the jets in it upright), with the heat
     haze round the whole of it, wider than the craft. In the craft's
     own box, stage px. */
  function rigOf(parent, geo) {
    var rig = node('div', 'sql__rig', parent);
    var E = geo.edge, c = geo.art.craft, K = geo.K, view = geo.view;
    var aura = node('i', 'sql__aura', rig);
    aura.style.left = px(E.x0 - 40);
    aura.style.width = px(E.x1 - E.x0 + 80);
    aura.style.top = px(E.yTop - 30);
    var n = 0, all = [];
    var bands = view.faces.map(function (pair, fi) {
      var a = [c.base[pair[0]][0] * K, c.base[pair[0]][1] * K];
      var b = [c.base[pair[1]][0] * K, c.base[pair[1]][1] * K];
      var band = node('div', 'sql__band', rig);
      band.style.left = px(a[0]);
      band.style.top = px(a[1] - 6);
      band.style.width = px(b[0] - a[0]);
      band.style.transform = 'skewY(' + Math.atan2(b[1] - a[1], b[0] - a[0]).toFixed(4) + 'rad)';
      view.streaks.forEach(function (u) {
        var j = node('i', 'sql__jet', band);
        j.style.left = (u * 100).toFixed(1) + '%';
        j.style.setProperty('--k', rand(.86, 1.06).toFixed(3));
        j.style.setProperty('--d', (-n * .043).toFixed(3) + 's');
        j.style.setProperty('--r', (.09 + (n % 3) * .022).toFixed(3) + 's');
        node('b', 'sql__fire', j);
        /* where it leaves the hull, in the craft's box */
        all.push({ el: j, at: [mix(a[0], b[0], u), mix(a[1], b[1], u)], side: fi });
        n++;
      });
      return band;
    });
    return { rig: rig, aura: aura, bands: bands, jets: all };
  }

  /* the jets' light caught on the underside's front edges */
  function litOf(parent, geo) {
    var E = geo.edge;
    var lit = node('div', 'sql__rig sql__lit', parent);
    var svg = doc.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + geo.craft.w.toFixed(1) + ' ' + geo.craft.h.toFixed(1));
    var rim = doc.createElementNS(NS, 'polyline');
    rim.setAttribute('points', pts(E.chain.map(function (p) { return [p[0], p[1] - 4]; })));
    svg.appendChild(rim);
    lit.appendChild(svg);
    return lit;
  }

  function resetFit(st) {
    st.guide.classList.remove('is-ok');
    st.match.style.opacity = '0';
    Array.prototype.forEach.call(st.match.children, function (el) { el.style.cssText = ''; });
  }

  /* The stage, scaled to keep the scene inside the letterboxed frame,
     and centred on it. */
  function fit(st) {
    var W = st.root.clientWidth, H = st.root.clientHeight;
    if (!W || !H) return;
    var bar = Math.round(H * BAR);
    var s = Math.min(W / SAFE_W, (H - 2 * bar) / SAFE_H);
    st.scale = s;
    st.ox = (W - STAGE_W * s) / 2;
    st.oy = H / 2 - SAFE_Y * s;
    st.stage.style.transform = 'translate(' + px(st.ox) + ',' + px(st.oy) + ') scale(' + s.toFixed(5) + ')';
    st.root.style.setProperty('--cine-bar', bar + 'px');
  }


  /* ============================================================
     THE MOTION — all of it a function of t
     ============================================================ */

  /* how high the underside is over the rock */
  function gapAt(t) {
    if (t < DESCEND) return HOVER + 5 * Math.sin(t / DESCEND * Math.PI * 2);
    /* eased in off the hover, then slowing all the way down: no
       speed at either end, most of the drop early */
    var w = Math.pow(seg(t, DESCEND, TOUCH), 1.5);
    return HOVER * Math.pow(1 - w, 2);
  }

  /* how hard the jets are burning, 0..1 */
  function burnAt(t) {
    if (t < TOUCH) return seg(t, 0, 160) * mix(1, .52, seg(t, DESCEND, TOUCH));
    return .52 * (1 - Math.pow(seg(t, TOUCH, TOUCH + 320), .6));
  }

  /* the touchdown's give: a soft squash and one small rebound */
  function squashAt(t) {
    if (t < TOUCH || t > STILL) return 1;
    var a = seg(t, TOUCH, TOUCH + 300);
    var b = seg(t, TOUCH + 300, STILL);
    return 1 - .026 * Math.sin(Math.PI * a) + .006 * Math.sin(Math.PI * b);
  }

  function frame(st, run) {
    var t = run.t;
    var gap = Math.max(0, gapAt(t));
    var burn = burnAt(t);
    var near = 1 - gap / HOVER;
    run.st = st;

    /* the timeline's tweens -- the cut, the smoke, the success -- to
       this moment of the shot */
    if (run.tl) run.tl.seek(Math.min(t, run.tl.duration));

    /* the engine shaking the hull while the jets burn: the craft only,
       so its shadow and the rock stay still under it */
    var vx = 0, vy = 0;
    if (burn > .02) {
      vx = burn * 1.5 * (Math.sin(t * .071) + .5 * Math.sin(t * .193 + 1.7));
      vy = burn * 1.1 * (Math.cos(t * .083) + .5 * Math.sin(t * .157 + .6));
    }
    st.rig.style.transform = st.lit.style.transform = st.craft.style.transform =
      'translate(' + px(vx) + ',' + px(vy - gap) + ') scaleY(' + squashAt(t).toFixed(4) + ')';

    /* a smear straight down on the fast part of the drop, gone well
       before the touchdown, so that is sharp */
    var speed = (gapAt(t - 16) - gapAt(t)) / 16;
    var mbv = clamp(0, speed / .45, 1) * (1 - seg(t, 1050, 1300));
    var mb = st.blurs[Math.min(st.blurs.length - 1, Math.ceil(mbv * (st.blurs.length - 1) - .15))] || '';
    if (mb !== run.mb) {
      st.craft.style.filter = mb;
      run.mb = mb;
    }

    /* the fire as long as it burns, and never through the rock: the
       island's front edges are right under the craft's, `gap` down */
    var len = 0;
    st.bands.forEach(function (band, i) {
      var wob = 1 + .05 * Math.sin(t / (71 + i * 23) + i * 2.1);
      len = Math.max(0, Math.min(JET * burn * wob, gap + 10));
      band.style.height = px(len + 6);
      band.style.opacity = clamp(0, burn * 3, 1).toFixed(3);
      band.classList.toggle('is-hit', len >= gap && burn > .05);
    });
    var E = st.geo.edge;
    st.aura.style.height = px(E.yBot - E.yTop + 30 + len * 1.15);
    st.aura.style.opacity = clamp(0, burn * 1.5, 1).toFixed(3);
    /* the edge stays warm a moment after the jets are out */
    st.lit.style.opacity = clamp(0, burn * 1.8 + .5 * (1 - seg(t, TOUCH, STILL + 300)) * seg(t, 0, 160), 1).toFixed(3);

    st.shade.style.opacity = (.12 + .46 * near * near).toFixed(3);
    st.shade.style.setProperty('--blur', px(3 + 12 * (1 - near)));
    st.glow.style.opacity = (burn * (.25 + .75 * near)).toFixed(3);

    /* the guide: in as the cut opens, its verdict half way down, gone
       as the hull comes down over it */
    st.guide.style.opacity = (seg(t, WARP - 120, WARP + 200) * clamp(0, (gap - 20) / 60, 1)).toFixed(3);
    if (gap < HOVER * .55 && once(run, 'verdict')) st.guide.classList.add('is-ok');

    camera(st, run, t);
    cues(st, run, t, burn, gap);
    warp(st, run, t);
  }


  /* ============================================================
     THE LENS

     The camera: easing back out through the cut, then a slow push in
     on the island, and a jolt and a shake at touchdown. The cut: the
     overhead view pushes on in at the craft and blurs while the
     close-up dissolves in over it, the close-up first drawn on a
     canvas from a snapshot of its opening frame -- softly smeared out
     from the craft -- then sharpening and handing over to the live
     scene.
     ============================================================ */

  function calm() {
    return { veil: 1, dive: 0, zoom: 1, shift: 0, blur: 0, snap: 0 };
  }

  /* what the lens is centred on, in frame px: over the island, or
     where the shot wants it at t */
  function focus(st, t) {
    var f = st.focusAt ? st.focusAt(t) : [AT[0], AT[1] - 60];
    return [st.ox + f[0] * st.scale, st.oy + f[1] * st.scale];
  }

  function camera(st, run, t) {
    var fx = run.fx;
    var z = (1 + .06 * ease.inOut(seg(t, WARP + 400, st.end))) * fx.zoom;
    var p = run.punch;
    if (p && t >= p.t0 && t < p.t0 + p.ms) z += p.amt * Math.pow(1 - (t - p.t0) / p.ms, 2);
    var dx = 0, dy = 0;
    var q = run.shake;
    if (q && t >= q.t0 && t < q.t0 + q.ms) {
      var u = 1 - (t - q.t0) / q.ms;
      var a = q.amp * u * u;
      dx = a * (Math.sin(t * .113) + .6 * Math.sin(t * .271 + 1.3));
      dy = a * (Math.cos(t * .097) + .6 * Math.sin(t * .233 + .4));
    }
    var F = focus(st, t);
    var off = [dx * st.scale, dy * st.scale];
    if (run.warp && fx.shift) {
      off[0] += run.warp.off[0] * fx.shift;
      off[1] += run.warp.off[1] * fx.shift;
    }
    run.cam = { z: z, F: F, off: off };
    st.cam.style.transformOrigin = px(F[0]) + ' ' + px(F[1]);
    st.cam.style.transform = 'translate(' + px(off[0]) + ',' + px(off[1]) + ') scale(' + z.toFixed(4) + ')';
  }

  /* Where the dive goes: the craft on the overhead view, and the
     camera offset that puts the close-up's craft on that same spot as
     the cut opens. The overhead view's plates, to dive with. */
  function dive(st, run) {
    var screen = st.screen;
    var W = st.root.clientWidth || 1, H = st.root.clientHeight || 1;
    var box = screen.getBoundingClientRect();
    var ship = screen.querySelector('.ship__img') || screen.querySelector('.ship');
    var P = [W / 2, H / 2];
    if (ship) {
      var r = ship.getBoundingClientRect();
      if (r.width) P = [r.left + r.width / 2 - box.left, r.top + r.height / 2 - box.top];
    }

    /* the close-up's craft as the shot opens: the middle of it, hovering */
    var g = st.geo.craft;
    var so = st.from || [0, 0];
    var C = [st.ox + (g.left + g.w / 2 + so[0]) * st.scale, st.oy + (g.top + g.h / 2 - st.hover + so[1]) * st.scale];
    var F = focus(st, 0);
    /* kept to what the sea (6% past every edge) can cover at the cut's
       closest, so no edge of it is ever carried into the frame */
    var z = run.fx.zoom;
    var room = function (f, L) {
      var m = .06 * L - 12;
      return [L - f - (L + m - f) * z, -f + (m + f) * z];
    };
    var rx = room(F[0], W), ry = room(F[1], H);
    run.warp = {
      C: C,
      off: [clamp(rx[0], P[0] - F[0] - (C[0] - F[0]) * z, rx[1]),
            clamp(ry[0], P[1] - F[1] - (C[1] - F[1]) * z, ry[1])]
    };

    run.dive = [];
    Array.prototype.forEach.call(screen.querySelectorAll('.s3-bg, .reef-water, .cam'), function (el) {
      if (el.parentNode !== screen) return;
      var o = (global.getComputedStyle(el).transformOrigin || '0 0').split(' ').map(parseFloat);
      run.dive.push({
        el: el,
        at: [P[0] - el.offsetLeft - (o[0] || 0), P[1] - el.offsetTop - (o[1] || 0)],
        keep: [el.style.scale, el.style.translate, el.style.filter]
      });
    });
  }

  function diveTo(run, v) {
    var s = 1 + DIVE * v;
    var blur = v > .02 ? 'blur(' + (DIVE_BLUR * v).toFixed(2) + 'px)' : '';
    run.dive.forEach(function (p) {
      p.el.style.scale = s.toFixed(4);
      p.el.style.translate = px(p.at[0] * (1 - s)) + ' ' + px(p.at[1] * (1 - s));
      p.el.style.filter = blur;
    });
  }

  function undive(run) {
    if (!run.dive) return;
    run.dive.forEach(function (p) {
      p.el.style.scale = p.keep[0];
      p.el.style.translate = p.keep[1];
      p.el.style.filter = p.keep[2];
    });
    run.dive = null;
  }

  function canvasOf(w, h) {
    var cv = doc.createElement('canvas');
    cv.width = w;
    cv.height = h;
    return cv;
  }

  /* The close-up's opening frame, drawn once with the camera at rest:
     the sea (with its bleed past the frame), the island, the craft at
     its hover. */
  function snapshot(st, run) {
    var w = run.warp;
    if (!w) return;
    var W = st.root.clientWidth || 1, H = st.root.clientHeight || 1;
    var q = Math.min(1, 960 / W);
    var M = [W * .06, H * .06];
    var sw = Math.max(1, Math.round(W * 1.12 * q)), sh = Math.max(1, Math.round(H * 1.12 * q));
    var cw = Math.max(1, Math.round(W * q)), ch = Math.max(1, Math.round(H * q));
    var shot = canvasOf(sw, sh);
    var x = shot.getContext('2d');
    var geo = st.geo, g = geo.craft;

    try {
      x.setTransform(q, 0, 0, q, q * M[0], q * M[1]);
      if (st.sea) {
        var sea = st.sea, nw = sea.naturalWidth, nh = sea.naturalHeight;
        var bw = W * 1.12, bh = H * 1.12, f = Math.max(bw / nw, bh / nh);
        x.drawImage(sea, -W * .06 + (bw - nw * f) / 2, -H * .06 + (bh - nh * f) / 2, nw * f, nh * f);
      }
      x.translate(st.ox, st.oy);
      x.scale(st.scale, st.scale);
      x.save();
      x.transform.apply(x, geo.landFlat);
      x.drawImage(st.land, 0, 0, st.geo.art.land.size[0], st.geo.art.land.size[1]);
      x.restore();
      var so = st.from || [0, 0];
      x.drawImage(st.craft, g.left + so[0], g.top - st.hover + so[1], g.w, g.h);
    } catch (e) {
      return;     /* nothing to resolve from: the cut is a plain fade */
    }

    w.shot = shot;
    w.buf = canvasOf(cw, ch);
    w.q = q;
    w.M = M;
    st.warp.width = cw;
    st.warp.height = ch;
    st.warp.hidden = false;
    w.ctx = st.warp.getContext('2d');
  }

  /* One frame of the cut. */
  function warp(st, run, t) {
    var fx = run.fx;
    if (st.root.classList.contains('is-warping')) {
      if (fx.veil >= 1 && t > WARP / 2) {
        st.root.style.opacity = '';
        st.root.classList.remove('is-warping');
        undive(run);
      } else {
        st.root.style.opacity = fx.veil.toFixed(3);
        if (run.dive) diveTo(run, fx.dive);
      }
    }

    var w = run.warp;
    if (!w || !w.ctx) return;
    if (fx.snap < .004) {
      if (t > WARP / 2) unwarp(st, run);
      return;
    }

    var g = w.ctx, q = w.q, cam = run.cam;
    var z = cam.z, F = cam.F, off = cam.off;
    var O = [F[0] + (w.C[0] - F[0]) * z + off[0], F[1] + (w.C[1] - F[1]) * z + off[1]];
    var M = w.M;
    var lens = function (b, k2) {
      var s = z * k2;
      b.setTransform(s, 0, 0, s,
        q * (O[0] * (1 - k2) + k2 * (F[0] * (1 - z) + off[0]) - s * M[0]),
        q * (O[1] * (1 - k2) + k2 * (F[1] * (1 - z) + off[1]) - s * M[1]));
    };

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.clearRect(0, 0, st.warp.width, st.warp.height);

    if (fx.blur > .01) {
      /* the zoom blur: copies of it, each a little further in about
         the craft, averaged */
      var b = w.buf.getContext('2d'), N = 5;
      b.setTransform(1, 0, 0, 1, 0, 0);
      b.globalCompositeOperation = 'source-over';
      b.globalAlpha = 1;
      b.fillStyle = '#000';
      b.fillRect(0, 0, w.buf.width, w.buf.height);
      b.globalCompositeOperation = 'lighter';
      b.globalAlpha = 1 / N;
      for (var i = 0; i < N; i++) {
        lens(b, 1 + .16 * fx.blur * i / (N - 1));
        b.drawImage(w.shot, 0, 0);
      }
      g.globalAlpha = fx.snap;
      g.drawImage(w.buf, 0, 0);
    } else {
      g.globalAlpha = fx.snap;
      lens(g, 1);
      g.drawImage(w.shot, 0, 0);
    }
  }

  function unwarp(st, run) {
    var w = run.warp;
    if (!w) return;
    run.warp = null;
    st.warp.hidden = true;
    st.warp.width = st.warp.height = 1;
    [w.shot, w.buf].forEach(function (cv) {
      if (cv) cv.width = cv.height = 0;
    });
  }

  /* a particle of css/cinematic.css's, on the stage's back (under the
     craft) or front layer; `keep` ones are tweened by the timeline */
  function emit(st, layer, cls, x, y, vars, keep) {
    var p = doc.createElement('i');
    p.className = 'cine-p ' + cls;
    p.style.left = px(x);
    p.style.top = px(y);
    for (var key in vars) p.style.setProperty(key, vars[key]);
    if (!keep) p.addEventListener('animationend', function () { p.remove(); });
    st.fx[layer].appendChild(p);
    return p;
  }

  /* The base of the hull, where it meets the rock: lit out from the
     front corner to the left and right ones, a glint on each corner */
  function lightSeam(st) {
    var face = st.geo.face, chain = st.geo.view.chain;
    var apex = face[st.geo.view.apex];
    var lines = st.seam.querySelectorAll('polyline');
    /* each seen edge, lit out from the corner nearest the camera */
    chain.forEach(function (k, i) {
      if (i + 1 >= chain.length || !lines[i]) return;
      var a = face[k], b = face[chain[i + 1]];
      var from = a === apex ? a : b, to = from === a ? b : a;
      lines[i].setAttribute('points', from.join(',') + ' ' + to.join(','));
    });
    st.seam.classList.remove('is-lit');
    void st.seam.getBoundingClientRect();
    st.seam.classList.add('is-lit');
    chain.forEach(function (k, i) {
      var p = face[k];
      emit(st, 'front', 'cine-glint', p[0], p[1], { '--delay': ms(260 + i * 120) });
    });
  }


  /* ============================================================
     THE SMOKE — strewn afresh on every play, timed on the timeline

     A bank of it, hugging the base: lumpy clusters of white puffs set
     side by side along the island's front edges (in front of the
     craft) and round its two side corners (behind it), that roll a
     little way out over the edge, swell, lift a touch and thin away.
     The jets light their tops orange while they burn. At touchdown a
     last breath of gas pushes out round the base, a little further.
     ============================================================ */

  function strew(st, run) {
    var A = global.anime;
    if (!A) return null;
    var geo = st.geo, view = geo.view;
    var tl = timeline();

    /* the island's edges, as seen: the front ones (the walls facing
       the camera) and the rest, behind */
    var edges = {};
    view.faces.forEach(function (f, i) { edges['f' + i] = [f[0], f[1], 'front']; });
    view.rear.forEach(function (f, i) { edges['r' + i] = [f[0], f[1], 'rear']; });

    var puff = function (edge, s, born, burst) {
      var e = edges[edge];
      var a = geo.face[e[0]], b = geo.face[e[1]];
      var p = [mix(a[0], b[0], s), mix(a[1], b[1], s)];
      var out = [p[0] - geo.mid[0], p[1] - geo.mid[1]];
      var n = Math.hypot(out[0], out[1]) || 1;
      out = [out[0] / n, out[1] / n];
      var x0 = mix(p[0], geo.mid[0], rand(0, .05)), y0 = mix(p[1], geo.mid[1], rand(0, .05));
      var reach = burst ? rand(45, 95) : rand(16, 50);
      var dx = out[0] * reach;
      var dy = out[1] * reach * .7;
      var size = rand(135, 175) * (burst ? 1.08 : 1);
      var life = Math.min(burst ? rand(1500, 1850) : rand(1700, 2200), END - born - 40);
      var peak = rand(.88, 1);

      var el = node('i', 'sql__puff', st.smoke[e[2]]);
      el.style.left = px(x0);
      el.style.top = px(y0);
      el.style.setProperty('--s', px(size));
      var warm = node('b', '', el);

      tl.add({
        targets: el,
        translateX: [{ value: [0, dx * .65], duration: life * .35, easing: 'easeOutQuad' },
                     { value: dx, duration: life * .65, easing: 'easeOutSine' }],
        /* over the edge and a little down it, then lifting */
        translateY: [{ value: [0, dy * .65 + (e[2] === 'front' ? rand(6, 14) : 0)], duration: life * .35, easing: 'easeOutQuad' },
                     { value: dy - rand(6, 26), duration: life * .65, easing: 'easeInOutSine' }],
        scale: [{ value: [rand(.55, .7), rand(1.15, 1.45)], duration: life, easing: 'easeOutCubic' }],
        rotate: [{ value: [rand(-8, 8), rand(-14, 14)], duration: life, easing: 'linear' }],
        opacity: [{ value: [0, peak], duration: life * .14, easing: 'easeOutQuad' },
                  { value: peak * .9, duration: life * .42, easing: 'linear' },
                  { value: 0, duration: life * .44, easing: 'easeInQuad' }]
      }, born);

      tl.add({
        targets: warm,
        opacity: [{ value: [clamp(0, burnAt(born) * 1.7, .9), 0], duration: life * .5, easing: 'easeOutQuad' }]
      }, born);
    };

    /* a spot `u` (0..1) of the way along the front edges together, as
       [edge, share along it], the edges taken by their length */
    var lens = view.faces.map(function (f) {
      return Math.hypot(geo.face[f[1]][0] - geo.face[f[0]][0], geo.face[f[1]][1] - geo.face[f[0]][1]);
    });
    var total = lens.reduce(function (a, b) { return a + b; }, 0) || 1;
    var alongFront = function (u) {
      var d = u * total;
      for (var i = 0; i < lens.length; i++) {
        if (d <= lens[i] || i === lens.length - 1) return ['f' + i, clamp(0, d / lens[i], 1)];
        d -= lens[i];
      }
      return ['f0', 0];
    };
    /* the rear edge behind each end of the front, at that corner */
    var behind = [];
    [view.chain[0], view.chain[view.chain.length - 1]].forEach(function (k) {
      view.rear.forEach(function (f, i) {
        if (f[0] === k) behind.push(['r' + i, rand(0, .1)]);
        else if (f[1] === k) behind.push(['r' + i, rand(.9, 1)]);
      });
    });

    /* the bank, building as the jets reach the rock: eleven along the
       front edges, overlapping, and one behind each side corner */
    var bank = [];
    for (var i = 0; i < 11; i++) bank.push(alongFront((i + rand(.25, .75)) / 11));
    bank = bank.concat(behind);
    bank.forEach(function (slot, k) {
      puff(slot[0], slot[1], SMOKE - 80 + rand(0, 480) + (k > 10 ? 120 : 0), false);
    });
    /* and the last breath of gas round the base at touchdown */
    for (i = 0; i < 5; i++) {
      var g = alongFront((i + rand(.2, .8)) / 5);
      puff(g[0], g[1], TOUCH + 20 + rand(0, 140), true);
    }

    cut(run, tl);
    success(st, run, tl);

    /* the timeline must run to the end of the shot */
    tl.add({ targets: {}, duration: 1 }, END);
    return tl;
  }

  /* The cut's tweens: a slow cross-zoom, all of it eased in and out,
     so it starts from the lens at rest and nothing in it jumps. The
     overhead view pushes on in and blurs over the whole of the cut;
     the close-up dissolves in over it, from well in on the craft --
     in far enough that its craft can be laid right over the overhead
     one, wherever on the frame the lens left that (dive()) -- back
     out to its own framing, its zoom blur clearing on the way, and is
     wholly in before the overhead view stops moving under it. */
  function cut(run, tl) {
    var fx = run.fx;
    var from = 1.45;
    fx.veil = 0;
    fx.zoom = from;
    fx.shift = 1;
    fx.blur = .8;
    fx.snap = 1;
    tl.add({ targets: fx, dive: [0, 1], duration: WARP, easing: 'easeInOutSine' }, 0)
      .add({ targets: fx, veil: [0, 1], duration: 640, easing: 'easeInOutSine' }, 40)
      .add({ targets: fx, zoom: [from, 1], duration: 1200, easing: 'easeInOutSine' }, 0)
      .add({ targets: fx, shift: [1, 0], duration: 1200, easing: 'easeInOutSine' }, 0)
      .add({ targets: fx, blur: [.8, 0], duration: 620, easing: 'easeOutSine' }, 140)
      .add({ targets: fx, snap: [1, 0], duration: 320, easing: 'easeInOutSine' }, 440);
  }

  /* The fit, seen, as the cut-scene shows it: a ring of light out over
     the rock from under the hull; then the match -- the far edges
     through the hull, a bracket on every corner -- and sparks of light
     up off the outline all the way round. */
  function success(st, run, tl) {
    var A = global.anime, geo = st.geo, q = geo.quad;
    var mk = st.match.children;
    var fw = faceWidth(q);

    var ring = emit(st, 'back', 'cine-shock', geo.mid[0], geo.mid[1], { '--sz': px(fw * 1.4) }, true);
    tl.add({ targets: ring, scale: [.3, 1.9], duration: 620, easing: 'easeOutCubic' }, TOUCH)
      .add({ targets: ring, opacity: [{ value: 1, duration: 50 },
                                      { value: 0, duration: 560, easing: 'easeInQuad' }] }, TOUCH);

    tl.add({ targets: st.match, opacity: [{ value: 1, duration: 140 },
                                          { value: 1, duration: 950 },
                                          { value: 0, duration: 420, easing: 'easeInQuad' }] }, TOUCH + 380)
      .add({ targets: mk[6], opacity: [0, .75], duration: 360, easing: 'easeOutQuad' }, TOUCH + 460)
      .add({ targets: Array.prototype.slice.call(mk, 2, 6), opacity: [0, 1], duration: 200,
             delay: A.stagger(70), easing: 'easeOutQuad' }, TOUCH + 560);

    var bits = [];
    for (var i = 0; i < 26; i++) {
      var e = i % 4, a = q[e], b = q[(e + 1) % 4], u = Math.random();
      bits.push(emit(st, 'front', 'cine-win', mix(a[0], b[0], u), mix(a[1], b[1], u),
                     { '--tint': pick(WIN) }, true));
    }
    tl.add({
      targets: bits,
      translateX: function () { return [0, rand(-50, 50)]; },
      translateY: function () { return [0, -rand(70, 190)]; },
      rotate: function () { return [0, rand(-180, 180)]; },
      scale: [{ value: [0, 1.15], duration: 220, easing: 'easeOutBack' },
              { value: .2, duration: 700, easing: 'easeInQuad' }],
      opacity: [{ value: [0, 1], duration: 120 }, { value: 1, duration: 420 },
                { value: 0, duration: 380 }],
      duration: 920,
      delay: A.stagger(22),
      easing: 'easeOutCubic'
    }, TOUCH + 400);
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

  /* how wide a face is on screen, corner to corner */
  function faceWidth(quad) {
    var xs = quad.map(function (p) { return p[0]; });
    return Math.max.apply(null, xs) - Math.min.apply(null, xs);
  }

  /* the burner's roar (js/audio.js), by how many jets are lit */
  function roar(run, jets) {
    if (run.jets === jets) return;
    run.jets = jets;
    var A = global.GeoAudio;
    if (A && A.thrust) A.thrust(jets);
  }

  /* the cut-scene's cues, on this shot's beats */
  function cues(st, run, t, burn, gap) {
    /* the burner roars as the shot opens, throttles back over the last
       of the drop and is cut at touchdown */
    roar(run, t >= TOUCH ? 0 : (gap < HOVER * .3 ? 2 : 4));

    /* the engine's hum with the burn, and a thruster pulse on it every
       so often while the jets are lit */
    var hum = burn > .02 ? Math.round(burn * 20) / 20 : 0;
    if (hum !== run.hum) {
      run.hum = hum;
      sfx('engine', hum);
    }
    if (burn > .02 && t >= WARP - 120 && t >= run.pulseAt) {
      run.pulseAt = t + rand(150, 210);
      sfx('pulse', burn);
    }

    /* the gas: hissing out as the jets reach the rock, and let go at
       touchdown */
    if (t >= SMOKE && once(run, 'vent')) sfx('vent', .6);

    if (t >= TOUCH && once(run, 'touchdown')) {
      sfx('clank', 1);
      sfx('vent', 1);
      run.shake = { amp: 2.2, ms: 320, t0: t };
      run.punch = { amt: .016, ms: 320, t0: t };
      call(run, 'onTouchdown');
    }
    if (t >= TOUCH + 400 && once(run, 'seam')) {
      lightSeam(st);
      sfx('sparkle');
      call(run, 'onSettle');
    }
    if (t >= END && once(run, 'return')) {
      st.root.classList.add('is-leaving');
      call(run, 'onReturn');
    }
  }


  /* ============================================================
     THE MISFIT — set down on an island too small for it

     The same two pictures. The island's top face is the craft's
     underside scaled by sqrt(land area / craft area) -- and then a
     little more (C_SHOW), so it plainly reads as smaller -- laid in by
     the same homography as the fit's. It sits wholly inside the
     craft's footprint, toward its back-right: the craft hangs out over
     the sea on every side, furthest at the front left, so the red
     footprint dwarfs the rock under it before it is even down.

     ── THE TIMELINE (shot ms, played at RATE) ─────────────────────
       0      the cut (0.76s), over the hover; the guide comes up red
       650    the descent: the jets that miss the island blast the sea
       1450   down, part on: it judders, the jets over the drop choke
       2100   it tips over the island's front-left edge and slides off
       2600   its low side hits the sea: the crown, the spray, the
              rings, the foam; the jets drown in a gasp of steam
              going under, rolled over: bubbles, the water churning
       3900   gone; the bubbles still coming up, the rings spreading
       4600   the cut back, over water settling

     The sea is the plane the island stands in. Where it meets the
     hull -- a V along the base's two front edges, the way any level
     line on those faces runs -- is worked out every frame: the craft,
     jets and all, is clipped above it, and a drowned copy of it,
     tinted by the water, shows below it. Once in, the line climbs the
     hull faster than the hull drops, so the top floods from the front,
     as a craft rolled over and going down nose first does.

     Layers, back to front: the sea; the water's own rings, foam and
     swell; the island, the craft's shadow and the jets' light on it,
     the guide; the splash behind; the drowned craft; the foam at the
     hull; the craft and its jets; the splash in front; the bubbles.
     ============================================================ */

  var C_AT = [960, 540];        /* the middle of the craft's underside, set down */
  var C_SHOW = .85;             /* the island's side, against the true one: smaller still, to read */
  var C_INSET = .06;            /* how far in from the craft's back-right edges it sits */
  var C_HOVER = 180;
  var C_FROM = -290;            /* where it comes in from: this far to the left of the island, so
                                   the island is seen whole beside it, and how much smaller it is */
  var C_DESCEND = 650;
  var C_TOUCH = 1450;
  var C_TIP = 2100;
  var C_HIT = 2600;
  var C_UNDER = 3900;
  var C_END = 4600;
  var C_SLIDE = [70, 150];      /* how far it slides off, stage px: by the hit, by the end */
  var C_SINK = 80;              /* how far the hull drops once in */
  var C_ROLL = -21;             /* how far over it is once under, degrees */
  var FLAT = .56;               /* a circle on the sea, seen from here: its height over its width */
  var DEG = Math.PI / 180;

  /* a steady stand-in for noise: the same n, the same 0..1 */
  function noise(n) {
    var x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  function inside(quad, p) {
    var sign = 0;
    for (var i = 0; i < quad.length; i++) {
      var a = quad[i], b = quad[(i + 1) % quad.length];
      var c = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
      if (c === 0) continue;
      if (sign && (c > 0) !== (sign > 0)) return false;
      sign = c;
    }
    return true;
  }

  /* ---------------------------------------------------------- the pose
     Where the craft is: turned by th about P, then moved by off. Any
     point of it at rest, p, is then at P + R(th)(p - P) + off. `slide`
     is how far it has gone off the edge, along the sea. */
  function poseOf(g, th, P, slide, fall, jx, jy) {
    return { th: th, c: Math.cos(th), s: Math.sin(th), P: P, slide: slide, fall: fall,
             off: [g.n[0] * slide + jx, g.n[1] * slide + fall + jy] };
  }

  function place(q, p) {
    var dx = p[0] - q.P[0], dy = p[1] - q.P[1];
    return [q.P[0] + q.c * dx - q.s * dy + q.off[0], q.P[1] + q.s * dx + q.c * dy + q.off[1]];
  }

  /* the sea's line on the hull: its vertex under the front corner, at
     the sea's height there -- which the slide carries toward us */
  function seaAt(g, q) {
    return [place(q, g.foot[g.apex])[0], g.sea + g.n[1] * q.slide];
  }

  /* and the line itself, at x: up each arm as the front edges run */
  function lineY(g, W, x) {
    return W[1] + (x - W[0]) * (x < W[0] ? g.slope[0] : g.slope[1]);
  }

  /* how far over the sea the lowest of these corners is (min), or the
     highest (max), in the pose q */
  function clearance(g, q, pts, most) {
    var W = seaAt(g, q);
    var out = most === 'max' ? -Infinity : Infinity;
    pts.forEach(function (p) {
      var at = place(q, p);
      var d = lineY(g, W, at[0]) - at[1];
      out = most === 'max' ? Math.max(out, d) : Math.min(out, d);
    });
    return out;
  }

  /* Where everything is, for a land this share of the craft's area */
  function misfitGeo(ratio, art) {
    var c = art.craft, l = art.land;
    var K = kOf(art);
    var view = viewOf(c.base);
    var s = clamp(.45, Math.sqrt(ratio > 0 ? ratio : 24 / 36) * C_SHOW, .88);
    var mid = across(c.base, .5, .5);
    var onStage = function (p) { return [C_AT[0] + (p[0] - mid[0]) * K, C_AT[1] + (p[1] - mid[1]) * K]; };
    var foot = {}, top = {};
    KEYS.forEach(function (k) { foot[k] = onStage(c.base[k]); top[k] = onStage(c.top[k]); });

    /* the island's top face, across the craft's underside (u from its
       back corner toward its right, v toward its left): inside it,
       C_INSET in from the two edges that meet at the corner it is
       tucked up against (the right end of the front: view.hug), so all
       of its overhang is away from that -- to the front left on a
       diamond view, to the left on a front one */
    var UV = { b: [0, 0], r: [1, 0], f: [1, 1], l: [0, 1] };
    var hug = UV[view.hug];
    var u0 = hug[0] ? 1 - C_INSET - s : C_INSET, v0 = hug[1] ? 1 - C_INSET - s : C_INSET;
    var uv = { b: [u0, v0], r: [u0 + s, v0], f: [u0 + s, v0 + s], l: [u0, v0 + s] };
    var face = {};
    KEYS.forEach(function (k) { face[k] = across(foot, uv[k][0], uv[k][1]); });
    var h = homography(KEYS.map(function (k) { return l.top[k]; }),
                       KEYS.map(function (k) { return face[k]; }));
    var base = {};
    KEYS.forEach(function (k) { base[k] = project(h, l.base[k]); });

    var box = { left: C_AT[0] - mid[0] * K, top: C_AT[1] - mid[1] * K, w: c.size[0] * K, h: c.size[1] * K };
    var centre = across(face, .5, .5);
    /* off the edge: out across the island's wall the craft goes over */
    var tip = view.tip;
    var te = [(face[tip[0]][0] + face[tip[1]][0]) / 2, (face[tip[0]][1] + face[tip[1]][1]) / 2];
    var n = [te[0] - centre[0], te[1] - centre[1]], nl = Math.hypot(n[0], n[1]) || 1;
    /* the sea's line on the hull: a V with its vertex at the corner
       nearest the camera, each arm as the front edge beside it runs (a
       front view's one edge: a straight line) */
    var apex = view.apex, chain = view.chain, ai = chain.indexOf(apex);
    var slopeTo = function (k) {
      var a = foot[apex], b = foot[k];
      return (b[1] - a[1]) / ((b[0] - a[0]) || 1e-6);
    };
    var leftK = ai > 0 ? chain[ai - 1] : chain[ai + 1];
    var rightK = ai + 1 < chain.length ? chain[ai + 1] : chain[ai - 1];

    var g = {
      art: art, K: K, view: view, apex: apex,
      s: s, foot: foot, top: top, face: face, base: base, land: h,
      landFlat: affine(['l', 'b', 'r'].map(function (k) { return l.top[k]; }),
                       ['l', 'b', 'r'].map(function (k) { return face[k]; })),
      craft: box,
      quad: KEYS.map(function (k) { return foot[k]; }),
      faceQuad: KEYS.map(function (k) { return face[k]; }),
      baseQuad: KEYS.map(function (k) { return base[k]; }),
      centre: centre,
      wall: base[apex][1] - face[apex][1],
      n: [n[0] / nl, n[1] / nl],
      slope: [slopeTo(leftK), slopeTo(rightK)],
      /* what it rocks on: the island's left corner, or its right */
      pivot: [face[view.pivots[0]], face[view.pivots[1]]],
      edge: edgeOf(c, K, view)
    };
    g.sea = foot[apex][1] + g.wall;
    /* the box's outline, as seen: round the top, down one side, along
       the base's front edges, up the other */
    g.outline = hull(KEYS.map(function (k) { return top[k]; }).concat(KEYS.map(function (k) { return foot[k]; })));
    /* and all along it: the sea's line is a V, so an edge can stand
       clear of it between two corners that are both under */
    var all = [];
    g.outline.forEach(function (p, i) {
      var b = g.outline[(i + 1) % g.outline.length];
      for (var u = 0; u < 1; u += 1 / 16) all.push([mix(p[0], b[0], u), mix(p[1], b[1], u)]);
    });
    var lows = chain.map(function (k) { return foot[k]; });

    /* how far over it is as it hits: as far as it goes, up to 18
       degrees, and still clear of the sea until the slide has carried
       it off the edge */
    for (var a = 18; a >= 6; a--) {
      g.tilt = -a * DEG;
      g.fallHit = clearance(g, poseOf(g, g.tilt, g.pivot[0], C_SLIDE[0], 0, 0, 0), lows, 'min');
      if (g.fallHit >= 16) break;
    }
    g.fallHit = Math.max(0, g.fallHit);

    /* how far the line has to climb the hull for all of it to be under
       by the time it is gone, and to stay under while it rolls on */
    g.liftEnd = 0;
    for (var t = C_UNDER; t <= C_END + FADE; t += 50) {
      var qa = 1 - Math.pow(1 - seg(t, C_HIT, C_UNDER + 300), 2);
      var qu = poseOf(g, mix(g.tilt, C_ROLL * DEG, qa), g.pivot[0], mix(C_SLIDE[0], C_SLIDE[1], qa),
                      g.fallHit + C_SINK * sinkAt(t), 0, 0);
      g.liftEnd = Math.max(g.liftEnd, clearance(g, qu, all, 'max') + 18);
    }

    /* where it goes in: the low side, on the sea */
    var qh = poseOf(g, g.tilt, g.pivot[0], C_SLIDE[0], g.fallHit, 0, 0);
    var Wh = seaAt(g, qh);
    var ix = mix(place(qh, foot[chain[0]])[0], place(qh, foot[chain[1]])[0], .38);
    g.I = [ix, lineY(g, Wh, ix) + 8];

    /* the lens: over the island and the craft at first, then down
       between the island and the splash */
    g.focus = [[C_AT[0] - 20, C_AT[1] - 70],
               [mix(g.I[0], centre[0], .5), mix(g.I[1], centre[1], .5) - 30]];
    return g;
  }

  /* ---------------------------------------------------------- the motion */

  /* sideways, along the sea's level: in from the left, over the
     island as it comes down */
  function approachAt(t) {
    return C_FROM * (1 - ease.inOut(seg(t, 650, C_TOUCH - 200)));
  }

  function misfitGap(t) {
    if (t < C_DESCEND) return C_HOVER + 5 * Math.sin(t / C_DESCEND * Math.PI * 2);
    var w = Math.pow(seg(t, C_DESCEND, C_TOUCH), 1.5);
    return C_HOVER * Math.pow(1 - w, 2);
  }

  /* rocking on a footing too small for it: right, then left, harder
     each time, and over the edge on the left */
  function rockAt(t) {
    var u = (t - C_TOUCH) / 1000;
    var amp = mix(1.4, 5, seg(t, C_TOUCH, C_TIP));
    return amp * DEG * Math.sin(Math.PI * 2 * 2.5 * u) * seg(t, C_TOUCH, C_TOUCH + 120);
  }

  /* how far down it has gone, 0..1, once in: a heavy plunge, a check
     as the water takes it, then going down steadily */
  function sinkAt(t) {
    var a = seg(t, C_HIT, C_HIT + 450);
    return .4 * (1 - Math.pow(1 - a, 3)) + .6 * ease.inOut(seg(t, C_HIT + 300, C_END));
  }

  function liftAt(g, t) {
    /* near enough steady, so the hull goes under at an even pace */
    var u = seg(t, C_HIT + 80, C_UNDER);
    return g.liftEnd * (.55 * u + .45 * ease.inOut(u));
  }

  function misfitPose(g, t) {
    var th = 0, P = g.pivot[0], slide = 0, fall = 0, j = 0;
    if (t < C_TOUCH) {
      fall = -misfitGap(t);
      var side = approachAt(t);
      j = misfitBurn(t) * 1.4;
    } else if (t < C_TIP) {
      th = rockAt(t);
      P = th < 0 ? g.pivot[0] : g.pivot[1];
      j = 1.6;
    } else if (t < C_HIT) {
      /* over it goes, faster and faster, and off the edge */
      var w = Math.pow(seg(t, C_TIP, C_HIT), 2);
      th = mix(rockAt(C_TIP), g.tilt, w);
      slide = C_SLIDE[0] * w;
      fall = g.fallHit * w;
      j = 2.4;
    } else {
      var a = 1 - Math.pow(1 - seg(t, C_HIT, C_UNDER + 300), 2);
      th = mix(g.tilt, C_ROLL * DEG, a);
      slide = mix(C_SLIDE[0], C_SLIDE[1], a);
      fall = g.fallHit + C_SINK * sinkAt(t);
      j = 2.4 * (1 - seg(t, C_HIT, C_HIT + 500));
    }
    return poseOf(g, th, P, slide, fall,
      (side || 0) + j * (Math.sin(t * .071) + .5 * Math.sin(t * .193 + 1.7)),
      j * .8 * (Math.cos(t * .083) + .5 * Math.sin(t * .157 + .6)));
  }

  /* how hard the jets are burning, 0..1: throttled back over the drop,
     opened up to save it once it starts to go, drowned as it goes in */
  function misfitBurn(t) {
    if (t < C_TOUCH) return seg(t, 0, 160) * mix(1, .55, seg(t, C_DESCEND, C_TOUCH));
    if (t < C_HIT) return mix(.55, .85, seg(t, C_TOUCH, C_TOUCH + 220));
    return .85 * (1 - seg(t, C_HIT, C_HIT + 240));
  }

  /* each jet's own: the ones over the drop choke and cough, more and
     more; the ones over the rock roar, and push it over */
  function jetBurn(t, jet, i) {
    var b = misfitBurn(t);
    if (t < C_TOUCH + 60 || t >= C_HIT) return b;
    var r = noise(Math.floor(t / 55) * 7 + i * 13);
    if (!jet.onLand) {
      if (r < .25 + .5 * seg(t, C_TOUCH + 100, C_TIP)) b *= .12 + .3 * r;
    } else {
      b *= 1 + .25 * seg(t, C_TOUCH, C_TIP) + .3 * (r - .5);
    }
    return b;
  }

  function jetLen(st, q, t, jet, i) {
    var b = jetBurn(t, jet, i);
    var len = JET * b * (1 + .05 * Math.sin(t / (71 + i * 23) + i * 2.1));
    /* the one over the rock is stopped by it */
    if (jet.onLand && t < C_TIP + 200) {
      var rest = [st.geo.craft.left + jet.at[0], st.geo.craft.top + jet.at[1]];
      len = Math.min(len, Math.max(0, rest[1] - place(q, rest)[1]) + 10);
    }
    return { b: b, len: len };
  }


  /* ---------------------------------------------------------- the overlay */

  function dressMisfit(screen) {
    var o = shotsOf(screen);
    var art = artOf(screen);
    if (o.tight || !art) return;
    var geo = misfitGeo(24 / 36, art);

    var shell = shellOf('sqc');
    var root = shell.root, cam = shell.cam, sea = shell.sea, stage = shell.stage;

    var seat = node('div', 'sql__seat', stage);
    var seatShape = node('i', '', seat);
    /* the craft's shadow on the sea, where it hangs off the rock */
    var wshade = node('div', 'sqc__wshade', stage);
    var wshadeShape = node('i', '', wshade);

    /* the water's own motion round the crash, and the rings and foam
       on it: under the island, which stands in front of them */
    var swell = node('div', 'sqc__layer', stage);
    var swells = [];
    for (var i = 0; i < 6; i++) swells.push(node('i', 'sqc__swell' + (i % 2 ? ' is-dark' : ''), swell));
    var heave = node('i', 'sqc__heave', swell);

    /* the heap of water thrown up round it as it goes in */
    var pool = poolOf(stage);

    /* the craft under the water: tinted by it, the jets still glowing
       red in it a moment, and behind the island, which stands up out
       of it in front */
    var wet = node('div', 'sqc__body sqc__wet', stage);
    image(art.craft.src, 'sqc__ghost', wet);
    var tint = node('i', 'sqc__tint', wet);
    tint.style.webkitMaskImage = tint.style.maskImage = 'url("' + art.craft.src + '")';
    var ember = node('i', 'sqc__ember', wet);
    ember.style.left = px(geo.edge.x0 - 30);
    ember.style.width = px(geo.edge.x1 - geo.edge.x0 + 60);
    ember.style.top = px(geo.edge.yTop - 40);
    ember.style.height = px(geo.edge.yBot - geo.edge.yTop + 120);
    /* and the water's near side over it, where it is in */
    var lip = lipOf(stage);

    var waves = node('div', 'sqc__layer', stage);

    var land = image(art.land.src, 'sql__land', stage);
    land.style.width = px(art.land.size[0]);
    land.style.height = px(art.land.size[1]);

    var onland = node('div', 'sqc__onland', stage);
    var shade = node('div', 'sql__shade', onland);
    var shadeShape = node('i', '', shade);
    var glow = node('div', 'sql__glow', stage);
    var spot = node('i', '', glow);

    var guide = svgOf(stage, 'cine__guide', 'polygon', 1);
    for (i = 0; i < 4; i++) guide.appendChild(doc.createElementNS(NS, 'polyline'));

    var rear = node('div', 'sqc__layer', stage);

    /* the foam where it goes in */
    var lapping = node('div', 'sqc__layer', stage);
    var laps = [];
    for (i = 0; i < 9; i++) laps.push(node('i', 'sqc__lap', lapping));
    var surf = node('div', 'sqc__layer', stage);

    /* the craft over it, with its jets */
    var dry = node('div', 'sqc__body sqc__dry', stage);
    var jets = rigOf(dry, geo);
    var craft = image(art.craft.src, 'sql__craft', dry);
    var lit = litOf(dry, geo);

    /* fire spreading out over the sea where each jet hits it */
    var hitLayer = node('div', 'sqc__layer', stage);
    var hits = jets.jets.map(function () { return node('i', 'sqc__hit', hitLayer); });

    var front = node('div', 'sqc__layer', stage);
    var bubbles = node('div', 'sqc__layer', stage);

    var lens = lensOf(root);
    var warpCv = lens.warp, flash = lens.flash;

    screen.appendChild(root);

    var st = {
      kind: 'tight', art: art, hover: C_HOVER, end: C_END, from: [C_FROM, 0],
      frame: misfitFrame, strew: misfitStrew, reset: resetMisfit,
      focusAt: function (t) {
        var f = st.geo.focus, u = ease.inOut(seg(t, C_TOUCH, C_HIT + 400));
        return [mix(f[0][0], f[1][0], u), mix(f[0][1], f[1][1], u)];
      },
      screen: screen, root: root, cam: cam, stage: stage, sea: sea, land: land, craft: craft,
      dry: dry, wet: wet, rig: jets.rig, aura: jets.aura, jets: jets.jets, lit: lit,
      seat: seatShape, wshade: wshade, wshadeShape: wshadeShape, onland: onland,
      shade: shade, shadeShape: shadeShape, glow: glow, spot: spot, guide: guide,
      swells: swells, heave: heave, laps: laps, pool: pool, lip: lip, ember: ember, hits: hits,
      warp: warpCv, flash: flash,
      fx: { waves: waves, rear: rear, surf: surf, front: front, bubbles: bubbles },
      layers: [waves, rear, surf, front, bubbles],
      geo: geo, run: null, scale: 1, ox: 0, oy: 0
    };
    o.tight = st;

    fit(st);
    new ResizeObserver(function () { fit(st); }).observe(root);
  }

  /* The overlay every shot is played in: .cine (css/cinematic.css
     frames it) and .sql, plus the shot's own class; the camera, the
     sea on it, and the 1600x900 stage. */
  function shellOf(cls) {
    var root = node('div', 'cine sql' + (cls ? ' ' + cls : ''));
    root.setAttribute('aria-hidden', 'true');
    var cam = node('div', 'cine__cam', root);
    var sea = SEA ? image(SEA.src, 'cine__sea', cam) : null;
    var stage = node('div', 'cine__stage', cam);
    return { root: root, cam: cam, sea: sea, stage: stage };
  }

  /* and over it, the lens: the cut's canvas, the flash, the letterbox */
  function lensOf(root) {
    var warpCv = node('canvas', 'cine__warp', root);
    warpCv.hidden = true;
    var flash = node('i', 'cine__flash', root);
    node('i', 'cine__bar cine__bar--top', root);
    node('i', 'cine__bar cine__bar--bottom', root);
    return { warp: warpCv, flash: flash };
  }

  /* Laid out afresh for each play, for the land's own area */
  function resetMisfit(st, run) {
    var a = run.hooks.areas || {};
    var ratio = a.craft > 0 && a.land > 0 ? a.land / a.craft : 24 / 36;
    var g = st.geo = misfitGeo(ratio, st.art);

    st.land.style.transform = matrix3d(g.land);
    st.seat.style.clipPath = polygon(g.baseQuad);
    st.onland.style.clipPath = st.glow.style.clipPath = polygon(g.faceQuad);
    st.shadeShape.style.clipPath = polygon(g.quad);
    st.wshadeShape.style.clipPath = polygon(g.quad.map(function (p) { return [p[0], p[1] + g.wall]; }));
    st.spot.style.left = px(g.centre[0]);
    st.spot.style.top = px(g.centre[1]);

    /* the guide: the craft's footprint, laid over an island it runs
       off -- red, and a bracket on every corner */
    var gq = st.guide.children;
    gq[0].setAttribute('points', pts(g.quad));
    g.quad.forEach(function (p, i) {
      var prev = g.quad[(i + 3) % 4], next = g.quad[(i + 1) % 4];
      gq[i + 1].setAttribute('points', pts([[mix(p[0], prev[0], .2), mix(p[1], prev[1], .2)], p,
                                            [mix(p[0], next[0], .2), mix(p[1], next[1], .2)]]));
    });
    st.guide.classList.remove('is-bad');

    [st.dry, st.wet].forEach(function (el) {
      el.style.left = px(g.craft.left);
      el.style.top = px(g.craft.top);
      el.style.width = px(g.craft.w);
      el.style.height = px(g.craft.h);
      el.style.clipPath = '';
    });
    st.wet.style.opacity = '0';

    /* which jets come down on the rock, and which miss it: the one over
       the flush edge is on it (tested a little in from the edge) */
    st.jets.forEach(function (jet) {
      var p = [g.craft.left + jet.at[0], g.craft.top + jet.at[1]];
      var d = Math.hypot(C_AT[0] - p[0], C_AT[1] - p[1]) || 1;
      jet.onLand = inside(g.faceQuad, [p[0] + (C_AT[0] - p[0]) / d * 6, p[1] + (C_AT[1] - p[1]) / d * 6]);
    });
  }

  function misfitFrame(st, run) {
    var t = run.t, g = st.geo, box = g.craft;
    run.st = st;
    if (run.tl) run.tl.seek(Math.min(t, run.tl.duration));

    /* the craft and its drowned copy, posed together */
    var q = misfitPose(g, t);
    var e = place(q, [box.left, box.top]);
    var m = 'matrix(' + [q.c, q.s, -q.s, q.c, e[0] - box.left, e[1] - box.top]
      .map(function (n) { return +n.toFixed(5); }).join(',') + ')';
    st.dry.style.transform = st.wet.style.transform = m;

    /* the sea's line on the hull, climbing it once in, and lapping */
    var W = seaAt(g, q);
    var V = [W[0], W[1] - liftAt(g, t)];
    var lap = seg(t, C_HIT, C_HIT + 200) * (1 - .6 * seg(t, C_UNDER, C_END));
    var R = 2600, line = [[V[0] - R, lineY(g, V, V[0] - R)]];
    for (var k = -6; k <= 6; k++) {
      var x = V[0] + k * 36;
      line.push(k ? [x, lineY(g, V, x) + lap * 2.6 * Math.sin(x * .05 + t * .012 + k)] : V);
    }
    line.push([V[0] + R, lineY(g, V, V[0] + R)]);
    var local = function (p) {
      var dx = p[0] - e[0], dy = p[1] - e[1];
      return [q.c * dx + q.s * dy, -q.s * dx + q.c * dy];
    };
    /* (only once it is in: before that nothing of it is under, and the
       jets are made to end at the sea themselves, not cut off by it) */
    st.dry.style.clipPath = t < C_HIT ? '' : polygon([[V[0] - R, -R]].concat(line, [[V[0] + R, -R]]).map(local));
    st.wet.style.clipPath = polygon([[V[0] - R, 2 * R]].concat(line, [[V[0] + R, 2 * R]]).map(local));
    st.wet.style.opacity = t < C_HIT ? '0' : (.7 * (1 - seg(t, C_HIT + 300, C_UNDER))).toFixed(3);

    /* the jets, each its own length and strength */
    var burn = 0, most = 0;
    st.jets.forEach(function (jet, i) {
      var j = jetLen(st, q, t, jet, i);
      /* a jet that would reach past the sea is made only as long as it
         takes for its tapered tip to dip into it -- so it ends in its
         own point, in the fire spreading over the water, never in a
         cut -- and the more of it there is, the wider that spreads */
      var foot = place(q, [box.left + jet.at[0], box.top + jet.at[1]]);
      var sy = lineY(g, W, foot[0]);
      var room = Math.max(0, (sy - foot[1]) / Math.max(.5, q.c));
      var len = Math.min(j.len, room + 16);
      jet.el.style.height = px(len);
      jet.el.style.opacity = clamp(0, j.b * 3, 1).toFixed(3);
      var reach = j.len - room;
      var hit = st.hits[i];
      if (reach > 0 && j.b > .08 && !(jet.onLand && t < C_TIP + 200)) {
        hit.style.transform = 'translate(' + px(foot[0] - q.s * room) + ',' + px(sy) + ') scale(' +
          ((.6 + .9 * clamp(0, reach / 160, 1)) * (1 + .1 * Math.sin(t * .05 + i * 2))).toFixed(3) + ')';
        hit.style.opacity = clamp(0, j.b * 1.5, 1).toFixed(3);
      } else {
        hit.style.opacity = '0';
      }
      burn += j.b / st.jets.length;
      most = Math.max(most, len);
    });
    var E = g.edge;
    st.aura.style.height = px(E.yBot - E.yTop + 30 + most * 1.15);
    st.aura.style.opacity = clamp(0, burn * 1.5, 1).toFixed(3);
    st.lit.style.opacity = clamp(0, burn * 1.8, 1).toFixed(3);

    /* its shadow and the jets' light, on the rock and on the sea under
       the overhang, until it goes over */
    var gap = t < C_TOUCH ? misfitGap(t) : 0;
    var near = 1 - gap / C_HOVER;
    var on = 1 - seg(t, C_TIP, C_TIP + 300);
    /* the footprint, the shadows: under the craft as it comes over */
    var under = 'translateX(' + px(approachAt(t)) + ')';
    st.shadeShape.style.transform = st.wshadeShape.style.transform = st.guide.style.transform = under;
    st.shade.style.opacity = ((.12 + .46 * near * near) * on).toFixed(3);
    st.shade.style.setProperty('--blur', px(3 + 12 * (1 - near)));
    st.wshade.style.opacity = ((.1 + .4 * near * near) * on).toFixed(3);
    st.glow.style.opacity = (burn * (.25 + .75 * near) * (1 - seg(t, C_TIP, C_HIT))).toFixed(3);

    /* the guide: in, red, as the cut opens -- the footprint plainly
       bigger than the island -- and gone as the hull comes down over it */
    st.guide.style.opacity = (seg(t, WARP - 120, WARP + 200) * clamp(0, (gap - 20) / 60, 1)).toFixed(3);
    if (t < C_TOUCH && t >= WARP - 120 && once(run, 'verdict')) st.guide.classList.add('is-bad');

    var hull = water(st, g, q, V, t);
    heap(st, g, q, V, t, hull);
    st.ember.style.opacity = t < C_HIT ? '0' : (1 - seg(t, C_HIT + 200, C_HIT + 1500)).toFixed(3);
    camera(st, run, t);
    misfitCues(st, run, t, burn, gap);
    warp(st, run, t);
  }

  /* The water's own motion where it went in: swells and troughs
     wheeling round the spot, a heave of the surface spreading from it,
     and foam lapping at the hull along the line */
  function water(st, g, q, V, t) {
    var S = [place(q, C_AT)[0], C_AT[1] + g.wall + g.n[1] * q.slide];
    var churn = seg(t, C_HIT, C_HIT + 250) * (1 - .7 * seg(t, C_HIT + 900, C_END));
    st.swells.forEach(function (el, i) {
      if (!churn) { el.style.opacity = '0'; return; }
      var a = i / st.swells.length * Math.PI * 2 + t * .0011 * (i % 2 ? 1 : -1);
      var r = (90 + 40 * Math.sin(t * .003 + i)) * (1 + .6 * seg(t, C_HIT, C_END));
      el.style.transform = 'translate(' + px(S[0] + Math.cos(a) * r * 1.2) + ',' + px(S[1] + Math.sin(a) * r * FLAT) +
        ') scale(' + (1 + .25 * Math.sin(t * .004 + i * 1.7)).toFixed(3) + ')';
      el.style.opacity = (churn * (.5 + .5 * Math.sin(t * .005 + i * 2.3))).toFixed(3);
    });
    st.heave.style.transform = 'translate(' + px(S[0]) + ',' + px(S[1]) + ') scale(' +
      (.5 + 1.2 * seg(t, C_HIT, C_END)).toFixed(3) + ')';
    st.heave.style.opacity = (churn * .8).toFixed(3);

    var a = seg(t, C_HIT, C_HIT + 120) * (1 - seg(t, C_UNDER - 300, C_UNDER + 300));
    if (!a) {
      st.laps.forEach(function (el) { el.style.opacity = '0'; });
      return null;
    }
    /* only where the line is on the hull: sampled across it */
    var hull = g.outline.map(function (p) { return place(q, p); });
    var xs = hull.map(function (p) { return p[0]; });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    var on = [];
    for (var k = 0; k <= 40; k++) {
      var sx = mix(x0, x1, k / 40);
      if (inside(hull, [sx, lineY(g, V, sx) - 3])) on.push(sx);
    }
    st.laps.forEach(function (el, i) {
      if (on.length < 2) { el.style.opacity = '0'; return; }
      var x = on[Math.round((i + .5) / st.laps.length * (on.length - 1))];
      el.style.transform = 'translate(' + px(x) + ',' + px(lineY(g, V, x) + 2 * Math.sin(t * .011 + i)) +
        ') scale(' + (1 + .3 * Math.sin(t * .007 + i * 1.3)).toFixed(3) + ')';
      el.style.opacity = (a * (.65 + .35 * Math.sin(t * .009 + i * 2.1))).toFixed(3);
    });
    /* where the hull is in the water, across: for the water over it */
    return on.length < 2 ? null : [on[0], on[on.length - 1]];
  }

  /* ---------------------------------------------------------- the heap
     The water it throws up as it goes in, and churns as it goes down:
     a heap of deep blue round it, lighter where it is piled up, its
     rim a ring of white foam breaking (a broken stroke over a cyan
     glow), curls of foam turning inside it, and its far side standing
     up as a wall behind the hull. Its near side runs over the hull as a
     lip of clear water, so what is under the line is seen through it.
     Drawn afresh every frame from t: the rim's shape is a few waves
     running round it at their own speeds. */

  var POOL_N = 44;

  function svgLayer(parent, cls) {
    var svg = doc.createElementNS(NS, 'svg');
    svg.setAttribute('class', cls);
    svg.setAttribute('viewBox', '0 0 ' + STAGE_W + ' ' + STAGE_H);
    parent.appendChild(svg);
    return svg;
  }

  function pathIn(svg, cls) {
    var p = doc.createElementNS(NS, 'path');
    p.setAttribute('class', cls);
    svg.appendChild(p);
    return p;
  }

  /* a vertical gradient, by id, in the svg's own defs */
  function gradient(svg, stops) {
    defsMade++;
    var id = 'sqcG' + defsMade;
    var defs = svg.querySelector('defs') || svg.insertBefore(doc.createElementNS(NS, 'defs'), svg.firstChild);
    var lg = doc.createElementNS(NS, 'linearGradient');
    lg.setAttribute('id', id);
    lg.setAttribute('x1', '0');
    lg.setAttribute('y1', '0');
    lg.setAttribute('x2', '0');
    lg.setAttribute('y2', '1');
    stops.forEach(function (s) {
      var st = doc.createElementNS(NS, 'stop');
      st.setAttribute('offset', s[0]);
      st.setAttribute('stop-color', s[1]);
      st.setAttribute('stop-opacity', s[2]);
      lg.appendChild(st);
    });
    defs.appendChild(lg);
    return 'url(#' + id + ')';
  }

  function poolOf(stage) {
    var svg = svgLayer(stage, 'sqc__pool');
    var o = { svg: svg };
    o.glow = pathIn(svg, 'sqc__pool-glow');
    o.body = pathIn(svg, 'sqc__pool-body');
    o.body.setAttribute('fill', gradient(svg, [[0, '#56d6ff', 1], [.4, '#1a98f2', 1], [1, '#0a4fca', 1]]));
    o.heap = pathIn(svg, 'sqc__pool-heap');
    o.heap.setAttribute('fill', gradient(svg, [[0, '#c8f7ff', .55], [1, '#6ad8ff', 0]]));
    o.rim = pathIn(svg, 'sqc__pool-rim');
    o.curls = [];
    for (var i = 0; i < 14; i++) o.curls.push(pathIn(svg, 'sqc__pool-curl'));
    return o;
  }

  function lipOf(stage) {
    var svg = svgLayer(stage, 'sqc__lip');
    var o = { svg: svg };
    o.body = pathIn(svg, 'sqc__lip-body');
    o.body.setAttribute('fill', gradient(svg, [[0, '#7ae8ff', .55], [1, '#0c5fd0', .78]]));
    o.crest = pathIn(svg, 'sqc__lip-crest');
    return o;
  }

  function f1(n) { return n.toFixed(1); }

  /* a closed curve through the points, smoothed by their midpoints */
  function loop(pts) {
    var n = pts.length, z = pts[n - 1], a = pts[0];
    var d = 'M' + f1((z[0] + a[0]) / 2) + ',' + f1((z[1] + a[1]) / 2);
    for (var i = 0; i < n; i++) {
      var p = pts[i], b = pts[(i + 1) % n];
      d += 'Q' + f1(p[0]) + ',' + f1(p[1]) + ' ' + f1((p[0] + b[0]) / 2) + ',' + f1((p[1] + b[1]) / 2);
    }
    return d + 'Z';
  }

  /* and an open one */
  function curve(pts) {
    var d = 'M' + f1(pts[0][0]) + ',' + f1(pts[0][1]);
    for (var i = 1; i < pts.length - 1; i++) {
      var p = pts[i], b = pts[i + 1];
      d += 'Q' + f1(p[0]) + ',' + f1(p[1]) + ' ' + f1((p[0] + b[0]) / 2) + ',' + f1((p[1] + b[1]) / 2);
    }
    var e = pts[pts.length - 1];
    return d + 'L' + f1(e[0]) + ',' + f1(e[1]);
  }

  function backOut(u) {
    var c = 1.70158;
    return 1 + (c + 1) * Math.pow(u - 1, 3) + c * Math.pow(u - 1, 2);
  }

  function heap(st, g, q, V, t, span) {
    var P = st.pool, L = st.lip;
    var rise = t < C_HIT ? 0 : backOut(seg(t, C_HIT, C_HIT + 340));
    if (!rise) {
      P.svg.style.opacity = L.svg.style.opacity = '0';
      return;
    }
    /* on the sea round where it is going down */
    var C = [place(q, C_AT)[0] - 10, C_AT[1] + g.wall + g.n[1] * q.slide + 10];
    var rx = 240 * rise * (1 + .12 * seg(t, C_HIT, C_END)) * (1 - .15 * seg(t, C_UNDER, C_END));
    var ry = rx * FLAT;
    var wall = 86 * rise * (1 - .82 * seg(t, C_HIT + 450, C_END));
    var at = function (a, k, lift) {
      var r = k * (1 + .07 * Math.sin(5 * a + t * .005) + .045 * Math.sin(9 * a - t * .008 + 1) +
                   .03 * Math.sin(13 * a + t * .013 + 2));
      var up = Math.pow(Math.max(0, -Math.sin(a)), 1.4) * wall * lift;
      return [C[0] + Math.cos(a) * rx * r, C[1] + Math.sin(a) * ry * r - up];
    };

    var rim = [], core = [];
    for (var i = 0; i < POOL_N; i++) {
      var a = i / POOL_N * Math.PI * 2;
      rim.push(at(a, 1, 1));
      core.push(at(a + .2, .55, .7));
    }
    var d = loop(rim);
    P.glow.setAttribute('d', d);
    P.body.setAttribute('d', d);
    P.rim.setAttribute('d', d);
    P.rim.style.strokeDashoffset = f1(-t * .04);
    P.heap.setAttribute('d', loop(core));
    P.curls.forEach(function (c, k) {
      var a0 = k / P.curls.length * Math.PI * 2 + t * .0009 * (k % 2 ? 1 : -1);
      var pts = [];
      for (var j = 0; j <= 6; j++) pts.push(at(a0 + j * (.06 + .02 * (k % 3)), .5 + .4 * ((k * 7) % 5) / 4, .85));
      c.setAttribute('d', curve(pts));
    });
    /* settling: the heap sinks back into the sea */
    var fade = 1 - .8 * seg(t, C_UNDER - 200, C_END);
    P.svg.style.opacity = (seg(t, C_HIT, C_HIT + 80) * fade).toFixed(3);

    /* the near side, over the hull only: down from the sea's line on
       it to the heap's front edge */
    if (!span) {
      L.svg.style.opacity = '0';
      return;
    }
    var top = [], bottom = [];
    for (i = 0; i <= 20; i++) {
      var x = mix(span[0] - 6, span[1] + 6, i / 20);
      var u = clamp(-1, (x - C[0]) / (rx * .96), 1);
      var y2 = C[1] + ry * .96 * Math.sqrt(1 - u * u) * (1 + .05 * Math.sin(x * .03 + t * .006));
      /* drawn in to a point at each end, so it has no hard sides */
      var y = mix(y2, lineY(g, V, x) + 2 * Math.sin(x * .05 + t * .012), Math.sqrt(Math.sin(Math.PI * i / 20)));
      top.push([x, y]);
      bottom.push([x, Math.max(y, y2)]);
    }
    L.body.setAttribute('d', curve(top.concat(bottom.reverse())) + 'Z');
    L.crest.setAttribute('d', curve(top));
    L.svg.style.opacity = (seg(t, C_HIT, C_HIT + 120) * (1 - seg(t, C_UNDER - 200, C_UNDER + 300))).toFixed(3);
  }


  /* ---------------------------------------------------------- the water's events
     Every splash, drop, ring, puff of spray and bubble is strewn afresh
     on each play, and timed on the timeline, which the frame seeks.
     All of a piece's transforms are in one tween, which owns them. */

  function bit(layer, cls, x, y, vars) {
    var p = node('i', cls, layer);
    p.style.left = px(x);
    p.style.top = px(y);
    for (var key in vars) p.style.setProperty(key, vars[key]);
    return p;
  }

  function ring(st, tl, layer, x, y, w, at, dur, peak) {
    var el = bit(layer, 'sqc__ring', x, y, { '--w': px(w) });
    tl.add({
      targets: el,
      scale: [{ value: [.12, 1], duration: dur, easing: 'easeOutCubic' }],
      opacity: [{ value: [0, peak], duration: dur * .12, easing: 'easeOutQuad' },
                { value: 0, duration: dur * .88, easing: 'easeInQuad' }]
    }, at);
  }

  /* a drop thrown up out of the sea and back into it */
  function drop(tl, layer, x, y, dx, up, dy, size, at, dur) {
    var el = bit(layer, 'sqc__drop', x, y, { '--s': px(size) });
    tl.add({
      targets: el,
      translateX: [{ value: [0, dx], duration: dur, easing: 'linear' }],
      translateY: [{ value: [0, -up], duration: dur * .42, easing: 'easeOutQuad' },
                   { value: dy, duration: dur * .58, easing: 'easeInQuad' }],
      scale: [{ value: [.6, 1], duration: dur * .3 }, { value: .7, duration: dur * .7 }],
      opacity: [{ value: [0, 1], duration: 50 }, { value: 1, duration: dur - 200 },
                { value: 0, duration: 150 }]
    }, at);
  }

  /* a soft billow -- spray, mist or steam -- swelling and thinning */
  function mist(tl, layer, cls, x, y, size, dx, rise, at, dur, peak) {
    var el = bit(layer, cls, x, y, { '--s': px(size) });
    tl.add({
      targets: el,
      translateX: [{ value: [0, dx], duration: dur, easing: 'easeOutQuad' }],
      translateY: [{ value: [0, -rise], duration: dur, easing: 'easeOutQuad' }],
      scale: [{ value: [.4, 1.6], duration: dur, easing: 'easeOutCubic' }],
      opacity: [{ value: [0, peak], duration: dur * .15, easing: 'easeOutQuad' },
                { value: 0, duration: dur * .85, easing: 'easeInQuad' }]
    }, at);
  }

  function misfitStrew(st, run) {
    var A = global.anime;
    if (!A) return null;
    var tl = timeline();
    cut(run, tl);
    spray(st, tl);
    splash(st, tl);
    sinking(st, tl);
    /* the timeline must run to the end of the shot */
    tl.add({ targets: {}, duration: 1 }, C_END);
    return tl;
  }

  /* The jets that miss the rock blasting the sea below it: spray off
     it, drops and rings; and a little dust off the rock where the one
     on it lands. Worked out from the same pose the frame will have. */
  function spray(st, tl) {
    var g = st.geo, box = g.craft, F = st.fx;
    for (var t = C_DESCEND + 100, step = 0; t < C_HIT; t += 90, step++) {
      var q = misfitPose(g, t), W = seaAt(g, q);
      st.jets.forEach(function (jet, i) {
        var j = jetLen(st, q, t, jet, i);
        if (j.b < .15) return;
        var foot = place(q, [box.left + jet.at[0], box.top + jet.at[1]]);
        var land = jet.onLand && t < C_TIP + 200;
        var y = land ? foot[1] + j.len - 6 : lineY(g, W, foot[0]);
        if (foot[1] + j.len < y - 4) return;
        var x = foot[0];
        mist(tl, F.front, land ? 'sqc__mist is-dust' : 'sqc__mist is-steam', x + rand(-10, 10), y - 6,
             rand(60, 100), rand(-40, 40), rand(25, 60), t + rand(0, 60), rand(600, 900), land ? .5 : .32);
        if (land) return;
        for (var d = 0; d < 2; d++) {
          var a = rand(0, Math.PI * 2);
          drop(tl, F.front, x, y - 4, Math.cos(a) * rand(20, 80), rand(30, 90), Math.sin(a) * rand(6, 30) + 10,
               rand(4, 8), t + rand(0, 80), rand(420, 640));
        }
        if ((step + i) % 3 === 0) ring(st, tl, F.waves, x, y + 6, rand(120, 170), t, 900, .6);
      });
    }
  }

  /* The hit: the low side slaps in and throws up a crown of water --
     sheets round a ring, the far half behind the hull, the near half in
     front -- a column out of the middle, drops flung high and wide,
     mist, foam thrown open, the rings, and the jets drowned in steam */
  function splash(st, tl) {
    var g = st.geo, I = g.I, F = st.fx, H = C_HIT;

    var fl = bit(F.front, 'sqc__flash', I[0], I[1]);
    tl.add({ targets: fl, scale: [{ value: [.3, 1.5], duration: 420, easing: 'easeOutCubic' }],
             /* from 0: before its start the timeline holds a tween at
                its first value */
             opacity: [{ value: [0, .95], duration: 30 },
                       { value: 0, duration: 390, easing: 'easeInQuad' }] }, H);

    /* the crown's wall: an arch of water thrown up round the back of
       the hole, the sheets standing out of it */
    [[F.rear, 300, 150, 0], [F.rear, 380, 210, 70]].forEach(function (k) {
      var sk = bit(k[0], 'sqc__skirt', I[0], I[1] + 10, { '--w': px(k[1]), '--h': px(k[2]) });
      var sd = 950;
      tl.add({
        targets: sk,
        scaleX: [{ value: [.35, 1.25], duration: sd, easing: 'easeOutCubic' }],
        scaleY: [{ value: [0, 1], duration: sd * .32, easing: 'easeOutCubic' },
                 { value: .1, duration: sd * .68, easing: 'easeInQuad' }],
        opacity: [{ value: [0, .95], duration: 70 }, { value: .85, duration: sd * .35 },
                  { value: 0, duration: sd * .65 - 70, easing: 'easeOutQuad' }]
      }, H + k[3]);
    });

    var N = 30;
    for (var i = 0; i < N; i++) {
      var a = (i + rand(-.3, .3)) / N * Math.PI * 2;
      var cx = Math.cos(a), cy = Math.sin(a);
      var r0 = 46, r1 = rand(120, 200), dur = rand(850, 1100);
      var h = rand(110, 220) * (cy > 0 ? .78 : 1) * (.8 + .3 * Math.abs(cx));
      var lean = cx * rand(26, 44);
      var el = bit(cy > 0 ? F.front : F.rear, 'sqc__sheet', I[0] + cx * r0, I[1] + cy * r0 * FLAT,
                   { '--w': px(rand(34, 60)), '--h': px(h) });
      tl.add({
        targets: el,
        translateX: [{ value: [0, cx * (r1 - r0)], duration: dur, easing: 'easeOutCubic' }],
        translateY: [{ value: [0, cy * (r1 - r0) * FLAT], duration: dur, easing: 'easeOutCubic' }],
        rotate: [{ value: [lean * .4, lean * 1.25], duration: dur, easing: 'easeOutQuad' }],
        scaleY: [{ value: [0, 1], duration: dur * .3, easing: 'easeOutCubic' },
                 { value: .05, duration: dur * .7, easing: 'easeInQuad' }],
        scaleX: [{ value: [.5, 1.1], duration: dur * .3, easing: 'easeOutQuad' },
                 { value: 1.4, duration: dur * .7 }],
        opacity: [{ value: [0, 1], duration: 60 }, { value: 1, duration: dur * .32 },
                  { value: 0, duration: dur * .68 - 60, easing: 'easeOutQuad' }]
      }, H + rand(0, 50));
    }

    /* the column, behind the hull, a beat after */
    for (i = 0; i < 3; i++) {
      var cd = rand(800, 1000);
      var col = bit(F.rear, 'sqc__sheet', I[0] + rand(-30, 30), I[1] - 4,
                    { '--w': px(rand(34, 56)), '--h': px(rand(230, 320)) });
      tl.add({
        targets: col,
        rotate: [{ value: [rand(-8, 8), rand(-14, 14)], duration: cd }],
        scaleY: [{ value: [0, 1], duration: cd * .38, easing: 'easeOutCubic' },
                 { value: 0, duration: cd * .62, easing: 'easeInQuad' }],
        scaleX: [{ value: [.6, 1], duration: cd * .38 }, { value: 1.6, duration: cd * .62 }],
        opacity: [{ value: [0, 1], duration: 80 }, { value: 1, duration: cd * .6 },
                  { value: 0, duration: cd * .4 - 80 }]
      }, H + 110 + i * 40);
    }

    for (i = 0; i < 46; i++) {
      a = rand(0, Math.PI * 2);
      cx = Math.cos(a);
      cy = Math.sin(a);
      drop(tl, cy > 0 ? F.front : F.rear, I[0] + cx * 40, I[1] + cy * 40 * FLAT - 10,
           cx * rand(60, 300), rand(90, 300), cy * rand(40, 180) * FLAT + 20,
           rand(5, 13), H + rand(0, 140), rand(650, 1150));
    }

    for (i = 0; i < 7; i++) {
      mist(tl, i % 2 ? F.front : F.rear, 'sqc__mist', I[0] + rand(-60, 60), I[1] - rand(10, 40),
           rand(110, 170), rand(-120, 120), rand(30, 100), H + rand(40, 180), rand(800, 1100), .3);
    }

    /* white water thrown open round it, on the sea, and lingering */
    for (i = 0; i < 9; i++) {
      a = rand(0, Math.PI * 2);
      var reach = rand(20, 80);
      var at = H + rand(0, 200);
      var fm = bit(F.waves, 'sqc__foam', I[0] + Math.cos(a) * reach, I[1] + Math.sin(a) * reach * FLAT,
                   { '--w': px(rand(160, 320)) });
      tl.add({
        targets: fm,
        translateX: [{ value: [0, Math.cos(a) * rand(40, 120)], duration: C_END - at, easing: 'easeOutCubic' }],
        translateY: [{ value: [0, Math.sin(a) * rand(40, 120) * FLAT], duration: C_END - at, easing: 'easeOutCubic' }],
        rotate: [{ value: [0, rand(-25, 25)], duration: C_END - at }],
        scale: [{ value: [.25, rand(1.3, 1.9)], duration: 2000, easing: 'easeOutCubic' }],
        opacity: [{ value: [0, .6], duration: 120 }, { value: .45, duration: 800 },
                  { value: .18, duration: C_END - at - 920, easing: 'easeOutQuad' }]
      }, at);
    }
    var hot = bit(F.surf, 'sqc__foam is-hot', I[0], I[1], { '--w': px(280) });
    tl.add({ targets: hot, scale: [{ value: [.2, 1.2], duration: 700, easing: 'easeOutCubic' }],
             opacity: [{ value: [0, .85], duration: 80 }, { value: 0, duration: 700, easing: 'easeInQuad' }] }, H);

    [[0, 420, 1300, .9], [140, 560, 1500, .8], [320, 720, 1800, .7], [560, 860, 2000, .55],
     [860, 980, 2200, .45], [1250, 1100, 2400, .35]].forEach(function (r) {
      ring(st, tl, F.waves, I[0], I[1] + 6, r[1], H + r[0], r[2], r[3]);
    });

    /* the jets drowning: a gasp of steam off each, where it went under */
    var q = misfitPose(g, H + 80), box = g.craft;
    st.jets.forEach(function (jet) {
      var p = place(q, [box.left + jet.at[0], box.top + jet.at[1]]);
      for (var k = 0; k < 2; k++) {
        mist(tl, F.front, 'sqc__mist is-steam', p[0] + rand(-20, 20), p[1] + rand(0, 30),
             rand(110, 170), rand(-30, 30), rand(70, 140), H + 60 + rand(0, 220), rand(1000, 1300), .7);
      }
    });
  }

  /* a point on the sea clear of the island (which stands in front of
     the water there), from the picker, tried a few times */
  function offLand(g, pick) {
    var rock = hull(g.faceQuad.concat(g.baseQuad));
    var p = pick();
    for (var i = 0; i < 6 && inside(rock, p); i++) p = pick();
    return inside(rock, p) ? null : p;
  }

  /* Going down: air coming up out of it all the way, in bursts as it
     floods -- each a boil of white water and a ring -- and the last of
     it once it is gone; and the rings spreading wide as it settles */
  function sinking(st, tl) {
    var g = st.geo, F = st.fx, H = C_HIT;
    var under = function (t) {
      var q = misfitPose(g, t);
      return [place(q, C_AT)[0], C_AT[1] + g.wall + g.n[1] * q.slide];
    };

    for (var i = 0; i < 70; i++) {
      var born = H + 150 + (C_END - H - 250) * Math.pow(i / 70, 1.3);
      var S = under(born);
      var spread = 150 * (1 - .5 * seg(born, H, C_END));
      var at = offLand(g, function () { return [S[0] + rand(-1, 1) * spread, S[1] + rand(-1, 1) * 34 * FLAT]; });
      if (!at) continue;
      var x = at[0], y = at[1];
      var depth = rand(30, 150) * (born < C_UNDER ? 1 : .6);
      var big = Math.random() < .1;
      var size = big ? rand(18, 28) : rand(5, 15);
      var dur = rand(500, 1100);
      var w = rand(4, 12);
      var b = bit(F.bubbles, 'sqc__bubble', x, y, { '--s': px(size) });
      tl.add({
        targets: b,
        translateX: [{ value: [0, w], duration: dur * .33, easing: 'easeInOutSine' },
                     { value: -w * .6, duration: dur * .33, easing: 'easeInOutSine' },
                     { value: w * .3, duration: dur * .34, easing: 'easeInOutSine' }],
        translateY: [{ value: [depth, 0], duration: dur, easing: 'easeInSine' }],
        scale: [{ value: [.5, 1], duration: dur * .9 }, { value: 1.7, duration: dur * .1 }],
        opacity: [{ value: [0, .9], duration: 120 }, { value: .9, duration: dur - 220 },
                  { value: 0, duration: 100 }]
      }, born);
      if (big) ring(st, tl, F.surf, x, y, rand(50, 80), born + dur - 60, 600, .7);
    }

    /* and on the heap: bubbles of foam welling up round its rim,
       floating up off it and bursting */
    for (i = 0; i < 40; i++) {
      born = H + 200 + (C_END - H - 400) * (i / 40) + rand(0, 60);
      S = under(born);
      at = offLand(g, function () {
        var a = rand(Math.PI * .25, Math.PI * 1.75);
        var rr = 240 * rand(.45, 1) * (1 + .12 * seg(born, H, C_END));
        return [S[0] + Math.cos(a) * rr, S[1] + 10 + Math.sin(a) * rr * FLAT - rand(0, 50)];
      });
      if (!at) continue;
      x = at[0];
      y = at[1];
      size = rand(8, 24);
      dur = rand(700, 1200);
      b = bit(F.bubbles, 'sqc__bubble', x, y, { '--s': px(size) });
      tl.add({
        targets: b,
        translateX: [{ value: [0, rand(-16, 16)], duration: dur, easing: 'easeInOutSine' }],
        translateY: [{ value: [0, -rand(20, 70)], duration: dur, easing: 'easeOutSine' }],
        scale: [{ value: [.3, 1], duration: dur * .3, easing: 'easeOutBack' }, { value: 1.05, duration: dur * .6 },
                { value: 1.6, duration: dur * .1 }],
        opacity: [{ value: [0, .95], duration: 100 }, { value: .95, duration: dur - 200 },
                  { value: 0, duration: 100 }]
      }, born);
    }

    [300, 650, 1000, 1350, 1750].forEach(function (d, k) {
      var at = H + d, S = under(at);
      var bw = rand(110, 170) * (1 - k * .1);
      var boil = bit(F.surf, 'sqc__boil', S[0] + rand(-40, 40), S[1], { '--w': px(bw) });
      tl.add({ targets: boil, scale: [{ value: [.3, 1.2], duration: 520, easing: 'easeOutCubic' }],
               opacity: [{ value: [0, .9], duration: 90 }, { value: 0, duration: 430, easing: 'easeInQuad' }] }, at);
      ring(st, tl, F.waves, S[0], S[1] + 4, rand(260, 340), at + 60, 1300, .6);
      for (var j = 0; j < 5; j++) {
        var a = rand(Math.PI * 1.1, Math.PI * 1.9);
        drop(tl, F.front, S[0], S[1] - 6, Math.cos(a) * rand(10, 50), rand(30, 80), rand(4, 16),
             rand(4, 8), at + rand(0, 80), rand(420, 620));
      }
    });

    var E = under(C_UNDER);
    ring(st, tl, F.waves, E[0], E[1] + 6, 900, C_UNDER - 100, 1400, .45);
    ring(st, tl, F.waves, E[0], E[1] + 6, 1200, C_UNDER + 300, 1300, .3);
    for (i = 0; i < 3; i++) {
      var fm = bit(F.waves, 'sqc__foam', E[0] + rand(-60, 60), E[1] + rand(-10, 10), { '--w': px(rand(180, 260)) });
      tl.add({ targets: fm, scale: [{ value: [.4, 1.2], duration: 1400, easing: 'easeOutCubic' }],
               opacity: [{ value: [0, .6], duration: 200 }, { value: .35, duration: 900 }] }, C_UNDER - 300 + i * 120);
    }
  }


  /* ---------------------------------------------------------- the cues */

  function misfitCues(st, run, t, burn, gap) {
    /* the burner: all four over the drop, back as it nears, open again
       to save it once down, coughing as it goes over, out in the sea */
    roar(run, t >= C_HIT ? 0 : t >= C_TIP ? 1 : t >= C_TOUCH ? 4 : (gap < C_HOVER * .3 ? 2 : 4));

    var hum = burn > .02 ? Math.round(burn * 20) / 20 : 0;
    if (hum !== run.hum) {
      run.hum = hum;
      sfx('engine', hum);
    }
    if (burn > .02 && t < C_HIT && t >= WARP - 120 && t >= run.pulseAt) {
      run.pulseAt = t + rand(150, 210);
      sfx('pulse', burn);
    }

    if (t >= C_TOUCH && once(run, 'touchdown')) {
      sfx('clank', .55);
      run.shake = { amp: 1.6, ms: 260, t0: t };
      run.punch = { amt: .01, ms: 260, t0: t };
    }
    /* "too small", said over the struggle */
    if (t >= C_TOUCH + 250 && once(run, 'settle')) call(run, 'onSettle');
    if (t >= C_TOUCH + 380 && once(run, 'choke')) sfx('sputter');
    if (t >= C_TIP && once(run, 'tip')) sfx('sputter');

    if (t >= C_HIT && once(run, 'hit')) {
      sfx('splash');
      sfx('bass');
      run.shake = { amp: 9, ms: 760, t0: t };
      run.punch = { amt: .03, ms: 420, t0: t };
      call(run, 'onImpact');
    }
    if (t >= C_HIT + 90 && once(run, 'steam')) sfx('vent', .9);

    if (t >= C_END && once(run, 'return')) {
      st.root.classList.add('is-leaving');
      call(run, 'onReturn');
    }
  }


  /* ============================================================
     THE PLAYER
     ============================================================ */

  function screenOf(site) {
    var n = site && (site.node || site);
    return n && n.closest ? n.closest('.screen') : null;
  }

  /* one of the screen's shots: 'fit' (the default) or 'tight' */
  function shotOf(site, kind) {
    var o = shots.get(screenOf(site));
    return (o && o[kind || 'fit']) || null;
  }

  /* Can this site's screen play it? Only with its art all in -- and a
     screen whose shape has no angle art never has a shot at all. */
  function has(site, kind) {
    var st = shotOf(site, kind);
    if (!st) return false;
    return [st.land, st.craft].concat(st.sea || []).every(function (img) {
      return img.complete && img.naturalWidth > 0;
    });
  }

  function decoded(st) {
    var all = Promise.all([st.land, st.craft].concat(st.sea || []).map(function (img) {
      return img.decode ? img.decode().catch(function () {}) : Promise.resolve();
    }));
    return Promise.race([all, new Promise(function (r) { setTimeout(r, 900); })]);
  }

  function create(site, hooks, kind) {
    var st = shotOf(site, kind);
    var run = null;
    var resolve = null;
    var done = new Promise(function (r) { resolve = r; });
    var settled = false;
    hooks = hooks || {};

    if (!st) { resolve(false); settled = true; }

    function fresh() {
      clear(st);
      run = {
        t: 0, last: 0, raf: 0, paused: true, fired: {}, hooks: hooks,
        jets: 0, hum: 0, pulseAt: 0, mb: '', tl: null, fx: calm(),
        warp: null, dive: null, shake: null, punch: null
      };
      fit(st);
      st.reset(st, run);
      st.flash.style.opacity = '0';
      run.tl = st.strew(st, run);
      st.root.classList.remove('is-leaving', 'is-cut', 'is-paused', 'is-warping');
      st.root.style.opacity = '';
      if (run.tl) {
        /* the cut is the timeline's: it fades the close-up in itself */
        st.root.classList.add('is-warping');
        st.root.style.opacity = '0';
        dive(st, run);
      }
      void st.root.offsetWidth;
      st.root.classList.add('is-on');
      st.screen.classList.add('is-cinema');
      /* the first frame drawn, then caught for the cut to resolve */
      st.frame(st, run);
      if (run.tl) snapshot(st, run);
      sfx('warp');
    }

    function tick() {
      run.raf = global.requestAnimationFrame(function step(now) {
        if (!run || run.paused) return;
        if (hooks.alive && !hooks.alive()) return end(false);
        /* capped, so a stall holds the shot where it was instead of
           jumping it on; frozen with the mission while the tab is away */
        var dt = run.last ? Math.min(50, now - run.last) : 0;
        run.last = now;
        if (!(global.GeoLife && global.GeoLife.isPaused())) run.t += dt * RATE;
        st.frame(st, run);
        if (run.t >= st.end + FADE) return end(true);
        run.raf = global.requestAnimationFrame(step);
      });
    }

    function hush() {
      if (!run) return;
      roar(run, 0);
      if (run.hum) sfx('engine', 0);
      run.hum = 0;
    }

    function end(ok) {
      if (!run) return;
      global.cancelAnimationFrame(run.raf);
      hush();
      /* the cut's leftovers, if it was cut off inside it */
      undive(run);
      unwarp(st, run);
      st.root.style.opacity = '';
      run = null;
      st.run = null;
      if (!ok) st.root.classList.add('is-cut');
      st.root.classList.remove('is-on', 'is-leaving', 'is-paused', 'is-warping');
      st.screen.classList.remove('is-cinema');
      clear(st);
      if (!settled) { settled = true; resolve(ok); }
    }

    var player = {
      done: done,

      play: function () {
        if (!st || settled) return player;
        if (!run) {
          if (st.run && st.run !== player) st.run.destroy();
          st.run = player;
          var S = global.GeoCinemaSFX;
          if (S) S.prepare();
          decoded(st).then(function () {
            if (settled || st.run !== player) return;
            if (hooks.alive && !hooks.alive()) return end(false);
            fresh();
            run.paused = false;
            tick();
          });
          return player;
        }
        if (run.paused) {
          run.paused = false;
          run.last = 0;
          st.root.classList.remove('is-paused');
          tick();
        }
        return player;
      },

      pause: function () {
        if (!run || run.paused) return player;
        run.paused = true;
        global.cancelAnimationFrame(run.raf);
        st.root.classList.add('is-paused');
        hush();
        return player;
      },

      /* hold the shot at t ms (paused): for checking a moment by eye */
      seek: function (t) {
        if (!run) return player;
        player.pause();
        run.t = clamp(0, t, st.end + FADE);
        st.frame(st, run);
        hush();
        return player;
      },

      /* from the top: the hover, a new strew of smoke, every cue again */
      restart: function () {
        if (!st || settled) return player;
        if (run) {
          global.cancelAnimationFrame(run.raf);
          hush();
          undive(run);
          unwarp(st, run);
          fresh();
          run.paused = false;
          tick();
          return player;
        }
        return player.play();
      },

      /* stop dead and take it all down; `done` settles false */
      destroy: function () {
        if (run) end(false);
        else if (!settled) { settled = true; resolve(false); }
        if (st && st.run === player) st.run = null;
        return player;
      }
    };
    return player;
  }

  function clear(st) {
    st.layers.forEach(function (layer) { layer.textContent = ''; });
    if (st.seam) st.seam.classList.remove('is-lit');
    st.craft.style.filter = '';
  }

  /* play(site, hooks), or play(site, 'fit' | 'tight', hooks) as
     GeoCinema takes it */
  function play(site, kind, hooks) {
    if (typeof kind !== 'string') { hooks = kind; kind = 'fit'; }
    return create(site, hooks, kind).play().done;
  }

  /* Cut it off where it stands: the screen is being left or reset. */
  function stop(site) {
    var o = shots.get(screenOf(site));
    if (!o) return;
    Object.keys(o).forEach(function (kind) {
      if (o[kind].run) o[kind].run.destroy();
    });
  }

  /* ---------------------------------------------------------- more shots
     Another file can add a shot to this player: register(kind, dress)
     with dress(screen, kit) returning its state, as dressMisfit's is
     (st: kind, hover, end, frame(st, run), strew(st, run) -> an anime
     timeline or null, reset(st, run), focusAt(t) (optional), screen,
     root, cam, stage, sea, land, craft, geo.craft, geo.landFlat,
     layers, warp, flash; run, scale, ox, oy, and a ResizeObserver
     calling kit.fit(st)). It is then played by play(site, kind, hooks)
     like the two here. The screen's own two pictures are
     kit.artOf(screen); a screen without them gets no shot, and is
     landed from overhead. */
  var dressers = [['fit', dress], ['tight', dressMisfit]];
  var dressed = null;

  function dressWith(screen, kind, fn) {
    var o = shotsOf(screen);
    if (o[kind]) return;
    var st = fn(screen, kit);
    if (st && !o[kind]) {
      st.kind = st.kind || kind;
      o[kind] = st;
    }
  }

  function register(kind, fn) {
    dressers.push([kind, fn]);
    if (!dressed || !ART) return;
    dressed.querySelectorAll('.screen[data-cinema]').forEach(function (screen) {
      dressWith(screen, kind, fn);
    });
  }

  function init(stage) {
    if (!ART) return;
    dressed = stage || doc;
    dressed.querySelectorAll('.screen[data-cinema]').forEach(function (screen) {
      dressers.forEach(function (d) { dressWith(screen, d[0], d[1]); });
    });
  }

  /* what a shot needs from here, for one played from another file */
  var kit = {
    ART: ART, SEA: SEA, STAGE_W: STAGE_W, STAGE_H: STAGE_H, K: K, AT: AT, JET: JET,
    WARP: WARP, FADE: FADE, KEYS: KEYS, ease: ease,
    artOf: artOf, kOf: kOf, viewOf: viewOf, edgeOf: edgeOf, hull: hull, faceWidth: faceWidth,
    node: node, image: image, px: px, ms: ms, clamp: clamp, seg: seg, mix: mix, rand: rand,
    pick: pick, svgOf: svgOf, svgDefs: svgDefs, pts: pts, across: across, timeline: timeline,
    homography: homography, project: project, matrix3d: matrix3d, polygon: polygon,
    affine: affine, layout: layout, rigOf: rigOf, litOf: litOf, shellOf: shellOf,
    lensOf: lensOf, shotsOf: shotsOf, fit: fit, emit: emit, once: once, call: call,
    sfx: sfx, roar: roar, cut: cut, camera: camera, warp: warp, calm: calm
  };

  global.GeoSquareLanding = {
    init: init,
    has: has,
    create: create,
    play: play,
    stop: stop,
    register: register,
    kit: kit
  };
})(window);
