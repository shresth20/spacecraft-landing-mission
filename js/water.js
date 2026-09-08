/* ============================================================
   Geo Drone — the water

   The mission is played out on one photograph of open sea with
   flat PNG islands laid over it. Each of those PNGs has a hard
   alpha edge and no idea what is underneath it, so out of the box
   the land sits ON the water rather than IN it: a razor coastline,
   no shallows, no shadow, and a sea that never reacts to a rock
   the size of a city block coming up through it.

   This module builds the water's half of that scene. css/water.css
   styles everything it makes and documents the layer stack; what
   is here is the GEOMETRY and the EVENTS.

   ── the geometry comes from the artwork, not from a guess ──────

   js/pages.js already holds, per shape of island, the silhouette
   traced off the PNG's alpha channel — as a clip polygon, and with
   the centre of area that everything on these screens is anchored
   on. Every layer below is built from that one polygon:

     · the coastline path is its vertices, so the shore of a
       rhombus is a rhombus and the shore of a square is square
     · the shallows, the shadow, the wet rim and the foam are that
       path STROKED at a width, which is a constant-width offset of
       a real coast rather than a scaled copy standing further off
       at the corners than along the edges
     · the ripples are the same path scaled about the centre of
       area, so a ripple leaving a triangle is triangular while it
       is still near it
     · the bubbles are sampled along the real perimeter and drift
       along the outward normal of the edge each one landed on

   Nothing here writes a coordinate of its own. That is deliberate:
   this project keeps one copy of every measurement (see the header
   of js/pages.js), and a second set of coastlines living in the
   water module is a second set to correct when a PNG is redrawn.

   ── the events ────────────────────────────────────────────────

     breach(island)   an island coming up: the sea is pushed aside
     close(island)    one going back under: the surface closes
     approve(island)  the right shape: a cyan front off its shore,
                      over the green the island itself has gone
     reject(island)   the wrong one: a short red front
     settle(island)   a craft's weight coming onto it: untinted
     impact(el, pt)   the water hit at a point — a craft going in,
                      a wreck coming down. The front then reaches
                      the other islands in the order the water
                      would actually reach them.

   js/script.js calls these from the beats it already had.

   ── load order ────────────────────────────────────────────────

   After js/pages.js, whose LAND table is the source above, and
   before js/script.js, which calls init() from boot() once the
   round screens have been built. With pages.js missing this
   module stands down and says so, exactly as script.js does.
   ============================================================ */

(function (global) {
  'use strict';

  var doc = document;

  /* ---------------------------------------------------------- the warp
     Two families of turbulence displacement, three seeds each, so
     that three triangles standing in a row do not share a coast.

     Two rather than one because the two things being displaced are
     nothing like the same size. The shore's bands are up to 40
     user units wide and want lobes to match — a low frequency and
     a big push. The waterline is a few units wide and wants the
     ragged detail of an actual tide line.

     `scale` is in USER UNITS, and one user unit is one per cent of
     an island's box: a scale of 5 moves the line by up to 2.5% of
     the island either way, which is the difference between a coast
     and a geometric offset of one. `baseFrequency` is per user
     unit too, so 0.085 puts a feature about twelve units across.

     The region has to be opened up by hand on both. It defaults to
     the OBJECT bounding box plus a tenth, and an object bounding
     box in SVG excludes stroke width — so on the shore, whose
     widest band hangs 20 units outside the path, the default would
     cut the halo off square.

     sRGB rather than the filter default of linearRGB: there is no
     colour maths in either filter, only displacement, so the
     conversion each way would be work done for nothing. */
  var WARPS = {
    shore: {
      region: 'x="-60%" y="-60%" width="220%" height="220%"',
      /* and blurred. The shore is five bands of stroke standing in
         for a gradient, and five discrete alphas across nine units
         are legible AS five bands @ which is a stepped frame round
         the island, not a shelf under it. One blur at the end of
         the chain melts the lot into the gradient they were
         standing in for, and it also turns the contact shadow's
         cut edge into a penumbra.

         It is free, too: nothing inside .shore__warp animates (the
         sway is on the <svg> above it), so this rasterises once per
         island and is then a cached bitmap. That is the whole
         reason the layer stack is split the way it is. */
      blur: 2.4,
      seeds: [
        { id: 'wtrShoreA', freq: '0.055 0.048', seed: 5,  scale: 9 },
        { id: 'wtrShoreB', freq: '0.048 0.058', seed: 23, scale: 8 },
        { id: 'wtrShoreC', freq: '0.060 0.052', seed: 47, scale: 10 }
      ]
    },
    surf: {
      region: 'x="-35%" y="-35%" width="170%" height="170%"',
      /* Barely blurred. The waterline's job is the seam where the
         water meets the rock, and blurring a seam away would be
         the end of it — but under a per cent of the island it is
         not softness, it is the difference between a WATERLINE
         and a bevel. A stroke has two hard edges, and the one
         facing inland has no business being visible at all. */
      blur: 0.9,
      seeds: [
        { id: 'wtrSurfA', freq: '0.085 0.072', seed: 11, scale: 5 },
        { id: 'wtrSurfB', freq: '0.072 0.090', seed: 37, scale: 4.4 },
        { id: 'wtrSurfC', freq: '0.095 0.078', seed: 71, scale: 5.6 }
      ]
    }
  };

  /* the classes that pick each seed out. Index 0 is the base rule
     in css/water.css, so it needs no class of its own. */
  var SEED_CLASS = ['', '--b', '--c'];

  /* Bubbles per island. Enough that the shore is never still, few
     enough that five islands do not put seventy animated elements
     on one screen — which is what fourteen each came to, for a
     layer nobody would miss two of. */
  var BUBBLES = 9;

  /* How far the corners of each ripple are rounded off, in box
     units. A wave front loses its curvature as it travels — the
     sharp corner of a triangular island is a point source, and a
     point source spreads into an arc — so the copy that is
     furthest out is the roundest, and by the third one the front
     has nearly forgotten what shape threw it. Which is also where
     nearly forgotten what shape threw it. */
  var LAP_ROUND = [12, 26, 42];

  /* How many waves each screen keeps to fire. Three, because the
     five islands on a round screen breach 380ms apart and a single
     re-used element would cut its own front off each time. */
  var WAVES = 3;

  var warpIndex = 0;
  var clipIndex = 0;
  var ready = false;
  var lean = false;


  /* ---------------------------------------------------------- helpers */
  function wait(ms) {
    return global.GeoLife
      ? global.GeoLife.wait(ms)
      : new Promise(function (r) { setTimeout(r, ms); });
  }

  function reduced() {
    return global.matchMedia &&
           global.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function round2(n) { return Math.round(n * 100) / 100; }

  /* Few cores means a phone or a school laptop, and the turbulence
     filter is the one thing in this module that costs real time to
     rasterise. `.is-lean` in css/water.css trades it — and the
     bubbles, and the second caustic sheet — for the frame rate. */
  function leanDevice() {
    var cores = global.navigator && global.navigator.hardwareConcurrency;
    return typeof cores === 'number' && cores > 0 && cores <= 4;
  }


  /* ============================================================
     GEOMETRY
     ============================================================ */

  /* The silhouette's vertices, in per cent of the island's box,
     read out of the shape's own clip polygon — the same string
     `.pad__hit` is clipped with, so the water's coast and the
     player's tap target can never be two different shapes. */
  function vertices(land) {
    var n = land.clip.match(/-?[\d.]+(?=%)/g).map(Number);
    var pts = [], i;
    for (i = 0; i < n.length; i += 2) pts.push([n[i], n[i + 1]]);
    return pts;
  }

  function coastPath(pts) {
    return 'M' + pts.map(function (p) { return p[0] + ' ' + p[1]; }).join('L') + 'Z';
  }

  /* The same outline with its corners rounded off by `r` box
     units, for the ripples. Each corner is cut back along both of
     its edges and rejoined with a quadratic through the vertex
     itself, and the cut is capped at 45% of an edge so that two
     corners sharing a short edge cannot eat past each other —
     which is what would happen on the rhombus, whose narrow ends
     are 44 units from a centre its wide ones are 43 from. */
  function roundedCoast(pts, r) {
    var n = pts.length, d = '', i;

    function step(from, to) {
      var dx = to[0] - from[0], dy = to[1] - from[1];
      var len = Math.hypot(dx, dy) || 1;
      var k = Math.min(r, len * 0.45) / len;
      return round2(from[0] + dx * k) + ' ' + round2(from[1] + dy * k);
    }

    for (i = 0; i < n; i++) {
      var cur = pts[i];
      d += (i ? 'L' : 'M') + step(cur, pts[(i - 1 + n) % n]) +
           'Q' + round2(cur[0]) + ' ' + round2(cur[1]) +
           ' ' + step(cur, pts[(i + 1) % n]);
    }

    return d + 'Z';
  }

  /* Furthest vertex from the centre of area. It sets how wide the
     ripple <svg>s have to be for the outline to fit inside them
     with room for the stroke. */
  function reachOf(pts, cx, cy) {
    return pts.reduce(function (max, p) {
      return Math.max(max, Math.hypot(p[0] - cx, p[1] - cy));
    }, 0);
  }

  /* Points spread evenly along the real perimeter, each with the
     OUTWARD normal of the edge it landed on. Which of an edge's two
     normals points outward is settled by walking a step along it
     and seeing whether that moves away from the centre of area —
     true for every shape in this mission, all of which are convex.

     The half-step offset (`i + .5`) keeps the samples off the
     vertices, where two normals meet and a bubble would drift
     along neither of them. */
  function alongCoast(pts, cx, cy, count) {
    var segs = [], total = 0, i, a, b, len;

    for (i = 0; i < pts.length; i++) {
      a = pts[i];
      b = pts[(i + 1) % pts.length];
      len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      segs.push({ a: a, b: b, len: len, at: total });
      total += len;
    }

    var out = [];
    for (i = 0; i < count; i++) {
      var d = total * (i + 0.5) / count;

      var s = segs[segs.length - 1], j;
      for (j = 0; j < segs.length; j++) {
        if (d < segs[j].at + segs[j].len) { s = segs[j]; break; }
      }

      var u = (d - s.at) / s.len;
      var x = s.a[0] + (s.b[0] - s.a[0]) * u;
      var y = s.a[1] + (s.b[1] - s.a[1]) * u;

      var ex = (s.b[0] - s.a[0]) / s.len;
      var ey = (s.b[1] - s.a[1]) / s.len;
      var nx = ey, ny = -ex;
      if ((x + nx - cx) * (x + nx - cx) + (y + ny - cy) * (y + ny - cy) <
          (x - cx) * (x - cx) + (y - cy) * (y - cy)) {
        nx = -nx; ny = -ny;
      }

      out.push({ x: x, y: y, nx: nx, ny: ny });
    }

    return out;
  }

  /* Layout offset from the screen. offset* rather than
     getBoundingClientRect, for the reason originOf() in
     js/animation.js gives: these are the LAYOUT box and ignore the
     transforms a screen is in the middle of applying, so a point
     worked out mid-transition is in the same frame of reference as
     one worked out before it. */
  function originOf(el) {
    var x = 0, y = 0;
    while (el && !(el.classList && el.classList.contains('screen'))) {
      x += el.offsetLeft;
      y += el.offsetTop;
      el = el.offsetParent;
    }
    return { x: x, y: y };
  }

  /* An island's centre of area, in the screen's own coordinates —
     the frame `.wave` and the landing's `.fx-layer`s are parked in.

     A `.zone` is placed by its MIDDLE (left/top plus a
     translate(-50%,-50%)) while a `.pad` is placed by its box, so
     the half-box has to come back off the zones: the transform is
     invisible to offsetLeft. */
  function centreOf(el) {
    var o = originOf(el);
    var w = el.offsetWidth;
    var h = el.offsetHeight;
    var centred = el.classList.contains('zone');
    var g = geoOf(el);

    return {
      x: o.x + (centred ? -w / 2 : 0) + w * g.cx,
      y: o.y + (centred ? -h / 2 : 0) + h * g.cy
    };
  }

  function geoOf(el) {
    var land = landOf(el);
    return land ? { cx: land.cx, cy: land.cy } : { cx: 0.5, cy: 0.5 };
  }

  /* Which shape of island this is. `data-shape` is on every zone
     and on every pad; screens 4-8 set it from js/pages.js and
     index.html carries it on the three landing pads. */
  function landOf(el) {
    var table = global.GeoPages && global.GeoPages.land;
    if (!table) return null;
    return table[el.dataset.shape] || table.triangle || null;
  }


  /* ============================================================
     MARKUP
     ============================================================ */

  function defsHTML() {
    var out = '';

    Object.keys(WARPS).forEach(function (family) {
      var f = WARPS[family];
      f.seeds.forEach(function (w) {
        out += '<filter id="' + w.id + '" ' + f.region + ' ' +
                       'color-interpolation-filters="sRGB">' +
          '<feTurbulence type="fractalNoise" baseFrequency="' + w.freq + '" ' +
                        'numOctaves="2" seed="' + w.seed + '" result="churn" />' +
          '<feDisplacementMap in="SourceGraphic" in2="churn" ' +
                             'scale="' + w.scale + '" ' +
                             'xChannelSelector="R" yChannelSelector="G" />' +
          (f.blur ? '<feGaussianBlur stdDeviation="' + f.blur + '" />' : '') +
        '</filter>';
      });
    });

    return '<svg class="wtr-defs" aria-hidden="true" focusable="false">' +
             '<defs>' + out + '</defs>' +
           '</svg>';
  }

  function path(cls, d) {
    return '<path class="' + cls + '" d="' + d + '" />';
  }

  /* Below the land, and all of it inside one warped group — a
     shoreline that is the coast offset by a constant is the tell
     that gave the sticker away in the first place.

     The order is the order the water is layered in, and it is not
     the order it was first written in: deep water beyond the
     shelf, then the wide sandy fringe the rock itself puts into
     it, then the pale shallows tight against the coast, and the
     island's shadow over all three — because a shadow on water
     falls on whatever the water happens to be showing.

     The filter and the seed go on the WARP group and not on the
     <svg>: the sway animation lives on the svg, and a transform
     animating on a filtered element re-rasterises the filter every
     frame. Split like this, the filter runs once and the sway is
     composited. */
  function shoreHTML(d, seed) {
    return '<svg class="shore" viewBox="0 0 100 100" ' +
                'preserveAspectRatio="none" aria-hidden="true">' +
      '<g class="shore__warp shore__warp' + seed + '">' +
        '<g class="shore__mass">' +
          path('shore__l1', d) + path('shore__l2', d) +
        '</g>' +
        '<g class="shore__bleed">' +
          path('shore__b1', d) + path('shore__b2', d) +
        '</g>' +
        '<g class="shore__shelf">' +
          path('shore__s1', d) + path('shore__s2', d) + path('shore__s3', d) +
          path('shore__s4', d) + path('shore__s5', d) +
        '</g>' +
        '<g class="shore__cast">' +
          path('shore__c0', d) + path('shore__c1', d) +
          path('shore__c2', d) + path('shore__c3', d) +
        '</g>' +
      '</g>' +
    '</svg>';
  }

  /* One ripple: the front in an <svg> whose viewBox is centred on
     the centre of area, so growing the ELEMENT grows the outline
     about that point. Positioned and scaled in css/water.css off
     --wcx/--wcy/--lw, which attach() sets on the island. */
  function lapHTML(letter, d, cx, cy, r) {
    var box = [round2(cx - r), round2(cy - r), round2(r * 2), round2(r * 2)].join(' ');
    return '<svg class="lap lap--' + letter + '" viewBox="' + box + '" ' +
                'preserveAspectRatio="none" aria-hidden="true">' +
      '<path d="' + d + '" />' +
    '</svg>';
  }

  /* Above the land: the waterline. This is the group that answers
     the alpha edge itself, and it does it three ways at once — a
     dark seam where the water meets the rock, a graded film of sea
     laid across the join, and broken foam over the top.

     The film is four strokes of falling width and rising alpha
     rather than one blurred band. An SVG stroke cannot carry a
     gradient across its own width, and a blur here would have to
     re-rasterise behind the wobble; four strokes are a ramp made
     of geometry, and geometry is free.

     Everything inside .surf__warp is displaced and otherwise
     still. The lace and the bubbles sit outside it, because a dash
     pattern or a transform moving INSIDE a filtered group would
     re-run the filter on every frame. */
  function surfHTML(d, clipId, seed) {
    return '<svg class="surf" viewBox="0 0 100 100" ' +
                'preserveAspectRatio="none" aria-hidden="true">' +
      '<defs>' +
        '<clipPath id="' + clipId + '"><path d="' + d + '" /></clipPath>' +
      '</defs>' +

      '<g class="surf__warp surf__warp' + seed + '">' +
        /* the wet rock, and the dark seam at the waterline — both
           clipped to the coast, so they can only ever darken LAND */
        '<g class="surf__wet" clip-path="url(#' + clipId + ')">' +
          path('surf__w1', d) + path('surf__w2', d) + path('surf__w3', d) +
        '</g>' +
        /* the film of sea lying across the edge — NOT clipped: it
           has to fall on both sides of the coastline, which is what
           turns the alpha cliff into a shore */
        '<g class="surf__film">' +
          path('surf__v1', d) + path('surf__v2', d) +
          path('surf__v3', d) + path('surf__v4', d) +
        '</g>' +
        /* and the foam over the join. Dashed, in long uneven runs:
           a continuous stroke around a silhouette is a BORDER, and
           a border was the problem, not the fix. */
        '<g class="surf__foam">' +
          path('surf__crest', d) + path('surf__edge', d) +
        '</g>' +
      '</g>' +

      '<g class="surf__lace">' +
        path('surf__d1', d) + path('surf__d2', d) +
      '</g>' +
    '</svg>';
  }

  /* The bubbles on the shore.

     HTML, not the <circle>s these started as, and the reason is
     the only performance rule this module really has to obey:
     Blink accelerates a transform or opacity animation by putting
     the element on its own compositor layer, and an SVG child
     cannot have one — SVG paints into whatever layer its root is
     in. Nine animated <circle>s per island therefore cost nine
     style recalculations every frame, and being inside the surf
     svg they dragged its filter into the bargain.

     As HTML they are nine composited layers that cost nothing per
     frame, and they lose nothing by the move: the sample points
     are already in per cent of the island's box, which is exactly
     what `left`/`top` want. */
  function sprayHTML(samples) {
    var dots = samples.map(function (s, i) {
      /* straddling the coast rather than standing off it, and given
         a drift out along the normal of the edge it landed on */
      var out = -0.3 + Math.random() * 1.1;
      var drift = 3 + Math.random() * 5.5;
      return '<i style="' +
             'left:' + round2(s.x + s.nx * out) + '%' +
             ';top:' + round2(s.y + s.ny * out) + '%' +
             ';--br:' + round2(0.7 + Math.random() * 1.1) +
             ';--bx:' + round2(s.nx * drift) +
             ';--by:' + round2(s.ny * drift) +
             ';--bd:' + round2(Math.random() * 3.2 + i * 0.06) + 's' +
             ';--bt:' + round2(2.6 + Math.random() * 2.2) + 's' +
             '"></i>';
    }).join('');

    return '<span class="spray" aria-hidden="true">' + dots + '</span>';
  }

  /* The craft over the water.

     Everything else in this module is about the LAND meeting the
     sea, and it left one thing on these screens that plainly was
     not in the same place as everything else: a spacecraft hanging
     a few metres over open water, throwing no shadow onto it and
     disturbing nothing.

     Two pieces, both anchored on the hull's own centre of area @
     --scx/--scy, which the screen already carries for the landing
     arithmetic, so this needs no measurement of its own:

       .ship__cast   the shadow on the water, offset down-sun by
                     the same bearing every island uses, and soft,
                     because a shadow read through a couple of
                     metres of water has no edge left
       .ship__wash   what the thruster is doing to the surface:
                     a bright specular core where the hull's own
                     light lands, and two rings running out from
                     under it on a loop */
  function shipHTML() {
    return '<span class="ship__cast" aria-hidden="true"></span>' +
           '<span class="ship__wash" aria-hidden="true">' +
             '<i class="ship__glint"></i>' +
             '<i class="ship__ring"></i>' +
             '<i class="ship__ring ship__ring--b"></i>' +
           '</span>';
  }

  function washHTML() {
    return '<span class="wash" aria-hidden="true"><i></i><i></i></span>';
  }

  /* The verdict: a BORDER on the coastline, and a shock that puts
     it there.

     `.shock` is the border. Three copies of the coast at three
     widths — a soft halo, a rim and a crisp line — so the edge has
     a glow around it instead of being one hard stroke, and all
     three take their colour from one pair of custom properties set
     on the island by its state, so green and red are the same
     drawing twice.

     `.blast` is the shock itself: the outline again, expanding away
     from the centre of area, once. Built the way the ripples are
     (its own <svg>, viewBox centred on that point, scaled as an
     HTML box) so growing it composites. */
  function shockHTML(d, ring, cx, cy, r) {
    var box = [round2(cx - r), round2(cy - r),
               round2(r * 2), round2(r * 2)].join(' ');

    function front(cls) {
      return '<svg class="' + cls + '" viewBox="' + box + '" ' +
                  'preserveAspectRatio="none" aria-hidden="true">' +
        '<path d="' + ring + '" />' +
      '</svg>';
    }

    return '<svg class="shock" viewBox="0 0 100 100" ' +
                'preserveAspectRatio="none" aria-hidden="true">' +
        path('shock__halo', d) +
        path('shock__rim', d) +
        path('shock__line', d) +
      '</svg>' +
      front('blast') +
      front('blast blast--b');
  }

  /* Nine sheets, and no wrapper around them. See the THE SEA block
     in css/water.css: most of these blend, and a wrapper with a
     z-index on it would become the stacking context they blend
     inside, which is a context containing nothing but themselves.
     As direct children of the screen they blend with the screen,
     and the screen is the sea.

     The order is the order the water is built up in, and the three
     `sea__roll` sheets — the wave train, see THE SWELL in css/
     water.css — go in UNDER the caustics and the glint on purpose.
     A swell is the shape of the surface; the caustic net and the
     sun's sheet are light falling on that shape, and light that
     went under the waves it is lighting would read as two separate
     seas laid over each other.

     All nine are full-frame and none is tied to an island, so the
     wave train runs edge to edge on every screen the artwork is on
     — the survey feed, the landing, and every round. */
  function seaHTML() {
    return '<span class="sea sea__deep" aria-hidden="true"></span>' +
           '<span class="sea sea__roll sea__roll--a" aria-hidden="true"></span>' +
           '<span class="sea sea__roll sea__roll--b" aria-hidden="true"></span>' +
           '<span class="sea sea__roll sea__roll--c" aria-hidden="true"></span>' +
           '<span class="sea sea__caustic sea__caustic--a" aria-hidden="true"></span>' +
           '<span class="sea sea__caustic sea__caustic--b" aria-hidden="true"></span>' +
           '<span class="sea sea__glint" aria-hidden="true"></span>' +
           '<span class="sea sea__swell" aria-hidden="true"></span>' +
           '<span class="sea sea__glare" aria-hidden="true"></span>';
  }

  function waveHTML() {
    var one = '<div class="wave" aria-hidden="true">' +
        '<span class="wave__warp"></span>' +
        '<span class="wave__crest"></span>' +
        '<span class="wave__crest wave__crest--b"></span>' +
        '<span class="wave__foam"></span>' +
      '</div>';

    var all = '', i;
    for (i = 0; i < WAVES; i++) all += one;
    return all;
  }


  /* ============================================================
     BUILDING
     ============================================================ */

  /* One island. Idempotent: a second pass over a stage that has
     already been fitted out leaves it alone, so init() can be
     called again if screens are ever added after boot. */
  function attach(el) {
    if (el.dataset.wtr) return;

    var land = landOf(el);
    if (!land) return;

    var img = el.querySelector('.zone__img, .pad__img');
    if (!img) return;

    var pts = vertices(land);
    var d = coastPath(pts);
    var cx = land.cx * 100;
    var cy = land.cy * 100;
    /* room for the stroke, which straddles the outline and would
       otherwise be clipped by the ripple's own viewBox */
    var r = reachOf(pts, cx, cy) + 2;

    var seed = SEED_CLASS[warpIndex % SEED_CLASS.length];
    warpIndex++;

    var clipId = 'wtrLand' + (++clipIndex);

    /* what css/water.css positions the ripples and clips the wash
       with. --clip is already inline on the round screens' pads
       (js/pages.js puts it there for .pad__hit); writing the same
       string again is harmless, and it means the zones and the
       landing pads do not each need their own path to it. */
    el.style.setProperty('--wcx', round2(cx) + '%');
    el.style.setProperty('--wcy', round2(cy) + '%');
    el.style.setProperty('--lw', round2(r * 2) + '%');
    el.style.setProperty('--clip', land.clip);

    /* Under the land, and before the image rather than at the top
       of the element: on a zone that puts the shore over
       `.zone__wake` — the dark circle that used to stand in for the
       island's bulk, and now only wells up at the breach — which is
       z-index 1 like the shore, so document order is what
       decides. */
    img.insertAdjacentHTML('beforebegin',
      shoreHTML(d, seed) +
      lapHTML('a', roundedCoast(pts, LAP_ROUND[0]), cx, cy, r) +
      lapHTML('b', roundedCoast(pts, LAP_ROUND[1]), cx, cy, r) +
      lapHTML('c', roundedCoast(pts, LAP_ROUND[2]), cx, cy, r));

    /* Over it: the light on the rock, then the waterline on top of
       that. Both z-index 2, the same as the land, so again the
       order here is the paint order — and both land under
       `.zone__hit` / `.pad__hit`, which is z-index 4, so nothing
       about this touches what is tappable. */
    img.insertAdjacentHTML('afterend',
      washHTML() +
      shockHTML(d, roundedCoast(pts, LAP_ROUND[0]), cx, cy, r) +
      surfHTML(d, clipId, seed) +
      sprayHTML(alongCoast(pts, cx, cy, BUBBLES)));

    el.dataset.wtr = '1';
  }

  /* Every screen painted on water gets a sea under it, a sheet of
     glare over it, and its waves. Which screens those are is asked
     of the artwork rather than listed: the two backgrounds that
     ARE the sea are .s2-bg (the survey) and .s3-bg (every round
     screen). */
  function dress(screen) {
    if (screen.dataset.wtr) return;

    var bg = screen.querySelector('.s2-bg, .s3-bg');
    if (!bg) return;

    bg.insertAdjacentHTML('afterend', seaHTML());

    /* The fronts go inside the screen's CAMERA plate where it has
       one (the survey feed does; nothing else on the mission
       does), and this is the one concession the water makes to it.

       Everything in EVENTS below works in layout coordinates:
       centreOf() adds up offsetLeft, which cannot see a transform,
       and waveSize() comes off offsetWidth, which cannot either.
       Both figures are therefore in the WORLD's frame and not the
       lens's — so a front fired while the feed's camera is high is
       only in the right place, and only the right size, if it is a
       sibling of the island that threw it. Mounted here, the
       camera scales the front along with the island and neither
       side has to know the other exists.

       See the .cam block in css/style.css, and THE CAMERA in
       js/animation.js. */
    var lens = screen.querySelector('.cam') || screen;
    lens.insertAdjacentHTML('beforeend', waveHTML());

    /* Before .ship__craft rather than inside it: both are
       positioned and neither takes a z-index, so document order is
       the paint order and the craft lands over its own shadow. And
       hung off .ship rather than off .ship__craft so the shadow
       follows the FLIGHT and not the idle bob @ a shadow on the
       water does not bob with the thing above it. */
    var ship = screen.querySelector('.ship');
    if (ship) ship.insertAdjacentHTML('afterbegin', shipHTML());

    screen.dataset.wtr = '1';
  }

  function init(stage) {
    if (!global.GeoPages || !global.GeoPages.land) {
      if (global.console) {
        console.warn('GeoDrone: js/pages.js did not load — the islands keep ' +
                     'their hard edges and the sea stays still.');
      }
      return;
    }

    stage = stage || doc.getElementById('stage');
    if (!stage || ready) return;

    lean = leanDevice();
    if (lean) doc.body.classList.add('is-lean');

    /* on the body rather than in the stage: it is a 0x0 element
       holding three <filter>s, and the stage is where the mission
       is drawn */
    doc.body.insertAdjacentHTML('beforeend', defsHTML());

    Array.prototype.forEach.call(stage.querySelectorAll('.screen'), dress);
    Array.prototype.forEach.call(stage.querySelectorAll('.zone, .pad'), attach);

    ready = true;
  }


  /* ============================================================
     EVENTS

     The one rule these all share: a point is in the SCREEN's
     coordinates, which is the frame the landing's effect layers are
     already parked in by js/script.js, so a caller that has a
     point for one of those has a point for this.
     ============================================================ */

  function screenOf(el) {
    return el && el.closest ? el.closest('.screen') : null;
  }

  function vmin() {
    return Math.min(global.innerWidth || 1, global.innerHeight || 1) / 100;
  }

  /* Fire the next wave in this screen's rota, from the middle out.
     Round-robin rather than one shared element: five islands
     breaching 380ms apart would otherwise each cut the last
     front off. */
  function impact(el, point, opts) {
    if (!ready || !point) return;
    opts = opts || {};

    var screen = screenOf(el);
    if (!screen) return;

    var waves = screen.querySelectorAll('.wave');
    if (!waves.length) return;

    var at = (parseInt(screen.dataset.wave, 10) || 0) % waves.length;
    screen.dataset.wave = (at + 1) % waves.length;

    var wave = waves[at];
    wave.classList.remove('wave--good', 'wave--bad');
    if (opts.tint) wave.classList.add('wave--' + opts.tint);
    wave.style.setProperty('--wave-w', (opts.size || 40) + 'vmin');
    wave.style.transform =
      'translate(' + point.x.toFixed(1) + 'px,' + point.y.toFixed(1) + 'px)';

    /* restart from zero, the same way burstAt() does in
       js/script.js — a retry has to replay the front, not find it
       already finished */
    wave.classList.remove('is-on');
    void wave.offsetWidth;
    wave.classList.add('is-on');

    if (!reduced()) spread(screen, point, wave.offsetWidth, opts.from);
  }

  /* The rest of the archipelago answering. `front` is how wide the
     wave that was just fired is, so how far it carries and how
     long it takes to get there both come off the same figure the
     player is watching — and an island only reacts if the water
     actually reached it.

     TRAVEL is the wave's own front time (see waveFront in
     css/water.css): the crest is at the edge of its box after
     1.5s, so an island at the edge of the reach is rocked at
     about the moment the line arrives on it. */
  var TRAVEL = 1500;

  function spread(screen, point, front, from) {
    var reach = front * 0.85;
    if (reach <= 0) return;

    Array.prototype.forEach.call(
      screen.querySelectorAll('.zone.is-up, .pad.is-up'),
      function (island) {
        if (island === from || island.classList.contains('is-sunk')) return;

        var c = centreOf(island);
        var d = Math.hypot(c.x - point.x, c.y - point.y);
        if (d > reach) return;

        wait(TRAVEL * (d / reach) * 0.85).then(function () { rock(island); });
      }
    );
  }

  /* `.is-rocked` is the one class in this module that is not
     already a state of the island's own, so it is the one class
     this module has to take away again. Harmless if a screen jump
     strands it — the animations under it do not fill forwards —
     but it would stop the NEXT wave re-triggering them. */
  function rock(island) {
    if (!island.isConnected) return;
    island.classList.remove('is-rocked');
    void island.offsetWidth;
    island.classList.add('is-rocked');
    wait(1150).then(function () { island.classList.remove('is-rocked'); });
  }

  /* An island coming up. The land's own rise (zoneRise / padRise)
     and the water's surge are both keyed off `.is-up`, so all this
     has to add is the front the displacement throws out — sized to
     the island, because the 30-unit island moves rather more sea
     than the 12-unit one. */
  function breach(island) {
    if (!ready || !island) return;
    impact(island, centreOf(island), {
      size: waveSize(island, 2.4),
      from: island
    });
  }

  /* And one going back under. Smaller: the surface closing over a
     shape is a quieter event than the shape arriving, and the sink
     is already carrying its own splash. */
  function close(island) {
    if (!ready || !island) return;
    impact(island, centreOf(island), {
      size: waveSize(island, 1.8),
      from: island
    });
  }

  /* ---------------------------------------------------------- verdicts

     The two answers the shape task gives, and both of them are
     given by the ENVIRONMENT: the island and the water it stands
     in, rather than an object laid on top of it. That is not only
     a look — a badge stamped on an island is one more thing
     sitting on the water, which is the whole problem this module
     was written to fix.

     Neither throws a front at its neighbours (`from: island`): a
     pick is an answer about ONE island, and the archipelago
     answering it together would read as an event in the world
     rather than as a reply to a tap. */

  /* Both are sized at 2.2x the island, because both are fronts that
     leave its SHORE rather than a point in the middle of it: at
     that size the offshore keyframes in css/water.css start the
     crest at about the island's own width. The difference between
     the two is colour and CLOCK, not reach — the green one runs
     its full length and the red one is over in under a second.

     Right: the island's border snaps in green (css/water.css, off
     `.is-picked`) and a green front runs out through the water. */
  function approve(island) {
    if (!ready || !island) return;
    rock(island);
    impact(island, centreOf(island), {
      size: waveSize(island, 2.2),
      tint: 'good',
      from: island
    });
  }

  /* Wrong: a short red front, and nothing on the land. No `rock()`
     either — the shake already on the island is the "no", and this
     only has to say the water heard it. */
  function reject(island) {
    if (!ready || !island) return;
    impact(island, centreOf(island), {
      size: waveSize(island, 2.2),
      tint: 'bad',
      from: island
    });
  }

  /* And the beat that is neither: a craft's weight coming down onto
     an island. Untinted, because the verdict there is the fit
     outline traced on the land and the water has no opinion about
     it — all it does is take the load. */
  function settle(island) {
    if (!ready || !island) return;
    rock(island);
    impact(island, centreOf(island), {
      size: waveSize(island, 1.5),
      from: island
    });
  }

  /* A wave `mult` times the island's own width across, in vmin so
     that css/water.css can size the element without knowing which
     screen it is on — the survey feed has no --pu of its own. */
  function waveSize(island, mult) {
    var w = island.offsetWidth * mult / vmin();
    return Math.max(20, Math.min(70, round2(w)));
  }


  global.GeoWater = {
    init: init,
    attach: attach,
    breach: breach,
    close: close,
    approve: approve,
    reject: reject,
    settle: settle,
    impact: impact
  };
})(window);
