/* ============================================================
   Geo Drone — THE LANDING ENGINE

   The three outcomes of screens 3 to 8, and everything they need:

     successfulLanding(ship, pad, opts)   the exact fit
     crashOnLand(ship, pad, opts)         the island was TOO LARGE
     sinkInWater(ship, pad, opts)         the island was TOO SMALL
     resetSpaceship(ship)                 back on the rail, ready again
     isAnimating(ship)                    the click guard

   All three return a Promise that settles when the beat is over.

   ── WHAT THIS FILE ACTUALLY DOES ───────────────────────────────
   Almost nothing, on purpose. The motion is CSS (css/failure.css);
   this file only:

     1. MEASURES — getBoundingClientRect() on the craft, the island
        and the island the craft actually fits, once per attempt,
        and writes the answer onto .ship as --target-x, --crash-y,
        --fall-x and the rest, in px. Nothing is hard-coded and
        nothing is cached, so a resized window is simply measured
        again on the next attempt.

     2. SEQUENCES — adds one phase class per beat, in order, and
        waits. The durations are read back OUT of the stylesheet
        (msVar below), so retuning a beat is a one-number change in
        css/failure.css and this file follows it automatically.

     3. BUILDS PARTICLES — the dust, debris, spray and bubbles,
        each with its own size, direction, delay and tint as custom
        properties. One append, then the compositor owns them.

   ── WHY THE CRAFT IS ALWAYS DRAWN AT ITS TRUE SIZE ─────────────
   Both pieces of artwork are square canvases with a shape painted
   on them, measured off the alpha channel (see js/pages.js). The
   camera looks straight down, so a landing is one flat shape coming
   down onto another and the anchor on both sides is the CENTRE OF
   AREA — line those two points up and the craft is square on the
   island by construction, at any --pu, aspect ratio or zoom.

   `fit` is sqrt(land fill / hull fill): the ratio of how much of
   its own canvas each shape covers, square-rooted because it scales
   a length and the fills are areas.

   The critical line is the one that computes `s`: the scale ALWAYS
   comes from the island the craft actually matches (opts.refPad),
   never from the island it is being flown to. That is what makes
   all three outcomes honest — the craft is drawn at its true size,
   so it visibly overhangs an island that is too small and visibly
   rattles about on one that is too big. Neither failure is staged.
   ============================================================ */

(function (global) {
  'use strict';

  var doc = document;

  /* ---------------------------------------------------------- primitives */

  /* pausable: time spent on another tab does not count against a
     landing, exactly as everywhere else in the mission */
  function wait(ms) {
    return global.GeoLife
      ? global.GeoLife.wait(ms)
      : new Promise(function (r) { setTimeout(r, ms); });
  }

  function reduced() {
    return !!(global.matchMedia &&
              global.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function clamp(lo, v, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function rand(lo, hi) { return lo + Math.random() * (hi - lo); }

  /* Read a duration back out of the stylesheet. This is the whole
     reason the timings in css/failure.css are custom properties:
     JS never keeps its own copy of a number CSS is animating on, so
     the two cannot drift apart. */
  function msVar(el, name, fallback) {
    var raw = global.getComputedStyle(el).getPropertyValue(name).trim();
    if (!raw) return fallback;
    var n = parseFloat(raw);
    if (!isFinite(n)) return fallback;
    return /ms\s*$/.test(raw) ? n : n * 1000;   /* bare `s` values too */
  }

  /* the screen the craft is on — the box every effect is parked
     inside, and the box the fx layers are stretched over */
  function screenOf(el) {
    while (el && !(el.classList && el.classList.contains('screen'))) {
      el = el.parentElement;
    }
    return el || doc.body;
  }

  /* The transform .ship is wearing RIGHT NOW, so a rect taken
     mid-flight can be turned back into the layout box it came from.
     transform-origin on .ship is the box corner (css/style.css),
     which is what makes this two subtractions rather than a matrix
     decomposition. */
  function shiftOf(el) {
    var t = global.getComputedStyle(el).transform;
    if (!t || t === 'none') return { x: 0, y: 0, s: 1 };
    try {
      var m = new DOMMatrixReadOnly(t);
      return { x: m.e, y: m.f, s: Math.hypot(m.a, m.b) || 1 };
    } catch (e) {
      return { x: 0, y: 0, s: 1 };
    }
  }

  /* Screen 3's own figures, and the default when a caller hands
     over none. Screens 4-8 land a square, a rectangle, a
     parallelogram, a trapezium and a rhombus through this same
     arithmetic, so their four readings and their fill ratio arrive
     as opts.geo instead of being fixed here. */
  var TRI_GEO = {
    shipCX: 0.4992, shipCY: 0.4772,   /* hull centre of area, box units */
    padCX:  0.4994, padCY:  0.6345,   /* island centre of area          */
    fit:    1.0799                    /* sqrt(land fill / hull fill)    */
  };


  /* ============================================================
     THE PLAN

     One measurement, four destinations, all in px and all relative
     to where .ship is laid out:

       target   the island's centre of area — where a landing ends
       crash    where a wreck comes to rest, ON the rock
       fall     where a craft that slid off the edge hits the water
       sink     and where it is when the water has closed over it

     plus the two points an effect gets parked on (`hit` and
     `impact`), which are in SCREEN coordinates because that is the
     box the fx layers cover.
     ============================================================ */

  function plan(ship, pad, refPad, geo) {
    geo = geo || TRI_GEO;

    var cur = shiftOf(ship);
    var sr  = ship.getBoundingClientRect();
    var pr  = pad.getBoundingClientRect();
    var rr  = refPad.getBoundingClientRect();
    var hr  = screenOf(ship).getBoundingClientRect();

    /* the craft's LAYOUT box, with its own transform stripped back
       out — so a plan built mid-flight is built from the same
       origin as the one before it */
    var lw = sr.width / (cur.s || 1);
    var lx = sr.left - cur.x;
    var ly = sr.top  - cur.y;

    /* the craft's TRUE size on this screen: from the island it
       fits, never from the island it was sent to */
    var s = geo.fit * rr.width / lw;

    /* both anchored on the centre of area */
    var px = pr.left + geo.padCX * pr.width;
    var py = pr.top  + geo.padCY * pr.height;

    var dx = px - lx - s * geo.shipCX * lw;
    var dy = py - ly - s * geo.shipCY * lw;

    /* Which way it goes when it loses its footing.

       `dir` is AWAY from the middle of the frame, so a craft that
       slides off an island it was too big for always ends up in
       open water and never falls across one of its neighbours.

       `into` is the opposite, and it is what a craft going over on
       an island far bigger than itself uses: there the land IS what
       it comes down on, so it has to fall towards the middle of the
       island rather than off the outer edge of the row. */
    var dir  = px < hr.left + hr.width / 2 ? -1 : 1;
    var into = -dir;

    /* The skid, the drop and the bounce.

       `room` is the spare rock: the island and the craft are the
       same SHAPE, and the craft covers exactly the reference
       island's footprint, so half the difference between the two
       boxes is how much land there is beyond the hull on each side.
       On the 30-unit island against a 20-unit craft that is about
       24px at desktop size.

       The skid is capped by it. Sizing the slide off the CRAFT
       alone looked right on paper and then slid a 235px hull 44px
       across an island with 24px of margin, which put its nose in
       the water — and a wreck half in the sea is the other
       failure's ending, not this one's. So: proportional to the
       craft, capped by the room, and clamped into the band the
       effect was designed at. */
    var room  = Math.max(0, (pr.width - rr.width) / 2);
    var slide = clamp(12, Math.min(lw * 0.16, room * 0.62), 40);
    var drop  = clamp(8,  lw * 0.05, 14);
    var hop   = clamp(3,  lw * 0.022, 7);

    var crashX = dx + into * slide;
    var crashY = dy + drop;

    /* Mostly down, only a little sideways: sliding off the near
       edge keeps the whole fall inside the frame, where going out
       to the side puts the craft behind the painted bezel on the
       outer islands. The sideways component still says WHICH way
       it went. */
    var fallX = dx + dir * lw * 0.34;
    var fallY = dy + lw * 0.50;

    var sinkX = fallX + dir * clamp(6, lw * 0.05, 12);
    var sinkY = fallY + clamp(20, lw * 0.14, 36);

    /* Keep the whole thing on screen.

       The outer islands sit at 21% and 79% of the frame, and a
       craft sliding AWAY from the middle off one of those is
       heading for the edge. On a wide desktop there is room; in a
       narrow window there is not, and a spacecraft that sinks
       half-outside the frame reads as a rendering fault rather
       than as an answer.

       The clamp is on the ship's square BOX, which is bigger than
       the hull painted inside it, so the hull always keeps a
       little more daylight than these numbers promise. It only
       ever bites at the edges; anywhere else the fall is untouched. */
    var EDGE = 10;
    var loX = hr.left  + EDGE - lx;
    var hiX = hr.right - EDGE - lx - s * lw;
    var hiY = hr.bottom - EDGE - ly - s * lw;

    if (hiX > loX) {
      fallX = clamp(loX, fallX, hiX);
      sinkX = clamp(loX, sinkX, hiX);
    }
    if (hiY > dy) {
      fallY = Math.min(fallY, hiY);
      sinkY = Math.min(sinkY, hiY);
    }

    /* the craft's own lean at the end of each chain, which the CSS
       adds on top of the ship's translate (see craftCrashTilt and
       craftSlip in css/failure.css). Folded in here so the bursts
       are parked on the hull and not a dozen px beside it. */
    var leanCrash = { x: into * lw * 0.030, y: lw * 0.019 };
    var leanFall  = { x: dir  * lw * 0.044, y: lw * 0.022 };

    function screenPoint(ox, oy, lean, nose) {
      return {
        x: lx + ox + s * geo.shipCX * lw + lean.x + (nose || 0) - hr.left,
        y: ly + oy + s * geo.shipCY * lw + lean.y - hr.top
      };
    }

    return {
      s: s, sw: lw, dir: dir, into: into,
      dx: dx, dy: dy,
      crashX: crashX, crashY: crashY, hop: hop,
      fallX: fallX, fallY: fallY,
      sinkX: sinkX, sinkY: sinkY,
      lift: lw * 0.44,

      /* where the LAND gets hit: the nose end of the wreck, a third
         of a hull out from its centre along the way it went over */
      hit: screenPoint(crashX, crashY, leanCrash, into * s * lw * 0.26),

      /* where the WATER gets hit: the craft's centre at the bottom
         of the fall */
      impact: screenPoint(fallX, fallY, leanFall, 0)
    };
  }

  /* Hand the plan to the stylesheet. Everything css/failure.css
     animates towards is one of these. */
  function writePlan(ship, p, lean, rotation) {
    var v = ship.style;
    v.setProperty('--target-x', p.dx.toFixed(2) + 'px');
    v.setProperty('--target-y', p.dy.toFixed(2) + 'px');
    v.setProperty('--target-s', p.s.toFixed(4));
    v.setProperty('--hover-lift', p.lift.toFixed(2) + 'px');

    v.setProperty('--crash-x', p.crashX.toFixed(2) + 'px');
    v.setProperty('--crash-y', p.crashY.toFixed(2) + 'px');
    v.setProperty('--crash-hop', p.hop.toFixed(2) + 'px');

    v.setProperty('--fall-x', p.fallX.toFixed(2) + 'px');
    v.setProperty('--fall-y', p.fallY.toFixed(2) + 'px');
    v.setProperty('--sink-x', p.sinkX.toFixed(2) + 'px');
    v.setProperty('--sink-y', p.sinkY.toFixed(2) + 'px');

    if (lean != null) v.setProperty('--lean', String(lean));
    if (rotation != null) v.setProperty('--rotation', rotation + 'deg');
  }


  /* ============================================================
     THE EFFECT LAYERS

     Found from the craft rather than passed in, so a caller only
     ever has to know about the ship and the island it picked. Every
     round screen is built with the same three elements (see
     sectionHTML in js/pages.js), and screen 3 carries them in the
     document.
     ============================================================ */

  function sceneOf(ship) {
    var host = screenOf(ship);
    return {
      host:  host,
      back:  host.querySelector('.fx-layer--back'),
      front: host.querySelector('.fx-layer--front'),
      water: host.querySelector('.water-depth-overlay')
    };
  }

  /* One particle: parked on the impact point by left/top — set once
     and never animated — and moved only on transform and opacity.
     Everything else about it arrives as a custom property the
     stylesheet reads. */
  function particle(layer, cls, point, vars, life) {
    if (!layer) return null;

    var p = doc.createElement('i');
    p.className = cls;
    p.style.left = point.x.toFixed(1) + 'px';
    p.style.top  = point.y.toFixed(1) + 'px';

    for (var k in vars) {
      if (Object.prototype.hasOwnProperty.call(vars, k)) {
        p.style.setProperty(k, vars[k]);
      }
    }

    layer.appendChild(p);

    /* self-clearing, so a screen the player has moved on from is
       not left with a hundred dead <i>s under it */
    if (life) {
      global.setTimeout(function () {
        if (p.parentNode) p.parentNode.removeChild(p);
      }, life);
    }
    return p;
  }

  function clearLayer(layer) { if (layer) layer.textContent = ''; }

  function px(n) { return n.toFixed(1) + 'px'; }


  /* ---------------------------------------------------------- water impact
     Going in. Concentric with the point of entry — the camera is
     straight overhead, so the water opens outwards in every
     direction and nothing drifts up the screen.

     The spray is split between the two layers: roughly half of it
     goes up in FRONT of the hull and half BEHIND it, which is what
     makes the impact read as happening around the craft rather than
     being painted on top of it. */
  function waterImpact(fx, point, sw) {
    var soft = reduced();

    /* 1 · MAIN SPLASH RING */
    particle(fx.front, 'water-ripple', point, {
      '--sz': px(sw * 0.5),
      '--dur': '700ms',
      '--grow': '2.0',
      '--peak': '1'
    }, 900);

    /* 2 · SECOND RIPPLE — later, larger, thinner */
    particle(fx.front, 'water-ripple-secondary', point, {
      '--sz': px(sw * 0.66),
      '--dur': '950ms',
      '--delay': '140ms',
      '--grow': '2.3',
      '--peak': '.72'
    }, 1250);

    /* 4 · WATER GLOW — under the hull, so it is in the BACK layer */
    particle(fx.back, 'water-glow', point, {
      '--sz': px(sw * 0.62),
      '--dur': '620ms'
    }, 800);

    if (soft) return;

    /* 3 · SPRAY. Angles are jittered off an even fan rather than
       taken at random, so the crown is even all the way round
       without any two pieces being the same. */
    /* Near-white, and bigger than they look on paper. The sea these
       land in is a bright turquoise, so pale cyan drops at 6px
       simply are not there; what separates from that background is
       white with a cyan halo. */
    var TINTS = [
      'rgba(255, 255, 255, .96)',
      'rgba(226, 250, 255, .94)',
      'rgba(170, 234, 255, .9)'
    ];
    var n = 12;
    for (var i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2 + rand(-0.22, 0.22);
      /* far enough out to clear the main ring, which is half a hull
         across by the time the spray is at its peak — drops thrown
         only as far as the ring itself are lost in its glow */
      var reach = sw * rand(0.30, 0.60);
      var size = sw * rand(0.028, 0.072);

      particle(i % 2 ? fx.front : fx.back, 'water-splash', point, {
        '--sz': px(size),
        '--dx': px(Math.cos(a) * reach),
        '--dy': px(Math.sin(a) * reach),
        '--dur': Math.round(rand(450, 800)) + 'ms',
        '--delay': Math.round(rand(0, 90)) + 'ms',
        '--tint': TINTS[i % TINTS.length]
      }, 1000);
    }
  }

  /* ---------------------------------------------------------- bubbles
     Let go over the whole sink, not all at once: the craft is still
     going down, so the last of them leaves later and from further
     under. Each one gets its own size, climb, drift and pace. */
  function bubbles(fx, point, sw, ms) {
    if (reduced()) return;

    var n = 8;
    for (var i = 0; i < n; i++) {
      var size = sw * rand(0.022, 0.055);
      var climb = -sw * rand(0.14, 0.36);          /* 30-80px at usual sizes */
      var drift = sw * rand(-0.09, 0.09);
      var dur = Math.round(rand(900, 1500));
      var delay = Math.round((i / n) * ms * 0.62 + rand(0, 160));

      particle(fx.front, 'water-bubble', {
        /* they leave from around the hull, not from one point */
        x: point.x + sw * rand(-0.09, 0.09),
        y: point.y + sw * rand(-0.05, 0.09)
      }, {
        '--sz': px(size),
        '--dx': px(drift),
        '--dy': px(climb),
        '--dur': dur + 'ms',
        '--delay': delay + 'ms'
      }, delay + dur + 120);
    }
  }

  /* ---------------------------------------------------------- after-ripples
     What is left once the craft is gone: two or three slow, wide,
     almost transparent rings. The sea closing over it. */
  function afterRipples(fx, point, sw) {
    var n = reduced() ? 1 : 3;
    for (var i = 0; i < n; i++) {
      var cls = i === 0 ? 'water-ripple is-residual'
                        : 'water-ripple-secondary is-residual';
      particle(fx.front, cls, point, {
        '--sz': px(sw * (0.44 + i * 0.16)),
        '--dur': (900 + i * 260) + 'ms',
        '--delay': (i * 240) + 'ms',
        '--grow': (1.7 + i * 0.35).toFixed(2),
        '--peak': (0.42 - i * 0.1).toFixed(2)
      }, 1500 + i * 500);
    }
    return wait(reduced() ? 500 : 1400);
  }

  /* ---------------------------------------------------------- ground impact
     Going over ON the rock. Harder and shorter than the splash —
     rock does not give — and the dust hangs about after the ring
     has gone. `lean` is the way the craft went over, which is the
     way the debris is thrown and the way the scorch is smeared. */
  function landImpact(fx, point, sw, lean) {
    var soft = reduced();

    /* 2 · IMPACT RING */
    particle(fx.front, 'impact-ring', point, {
      '--sz': px(sw * 0.44),
      '--dur': '420ms',
      '--grow': '2.1'
    }, 600);

    /* 4 · SCORCH MARK — under the wreck, so it goes in the BACK
       layer, and it is the one thing here that arrives and STAYS */
    /* Wider than the hull is on purpose. It sits UNDER the wreck,
       so a mark the size of the craft is a mark nobody ever sees:
       what reads is the smear that fringes out past the edges. */
    particle(fx.back, 'scorch-mark', {
      x: point.x - lean * sw * 0.06,
      y: point.y
    }, {
      '--sz': px(sw * 0.92),
      '--dur': '520ms',
      '--delay': '80ms',
      '--peak': '.2',
      '--rot': (lean * 8).toFixed(0) + 'deg'
    }, 0);   /* 0 = left in place; resetSpaceship clears the layer */

    if (soft) return;

    /* 1 · DUST PUFF — thrown wider along the way it went over than
       against it, which is what makes the burst read as directional
       rather than as a firework */
    /* Paler than the island it comes off. Dust in the island's own
       orange disappears into the island, which is exactly what the
       first cut of this did: what reads against warm rock is the
       LIGHT end of it, so these run from near-sand to mid-ochre. */
    var TINTS = [
      'rgba(252, 226, 190, .82)',
      'rgba(240, 194, 144, .74)',
      'rgba(216, 156, 100, .64)'
    ];
    var n = 8;
    for (var i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2 + rand(-0.25, 0.25);
      var bias = 1 + 0.5 * Math.max(0, Math.cos(a) * lean);
      var reach = sw * rand(0.14, 0.30) * bias;

      particle(i % 2 ? fx.front : fx.back, 'crash-dust', point, {
        '--sz': px(sw * rand(0.07, 0.16)),
        '--dx': px(Math.cos(a) * reach),
        '--dy': px(Math.sin(a) * reach),
        '--dur': Math.round(rand(620, 900)) + 'ms',
        '--delay': Math.round(rand(0, 70)) + 'ms',
        '--tint': TINTS[i % TINTS.length]
      }, 1100);
    }

    /* 3 · SMALL DEBRIS — chips of rock, 10-30px and no further */
    var CHIPS = ['#c08249', '#a06a34', '#d29a5c'];
    for (var j = 0; j < 4; j++) {
      var ang = rand(-Math.PI, 0) + (lean > 0 ? 0.5 : -0.5);
      var far = clamp(10, sw * rand(0.05, 0.12), 30);

      particle(fx.front, 'crash-debris', point, {
        '--sz': px(sw * rand(0.022, 0.038)),
        '--dx': px(Math.cos(ang) * far),
        '--dy': px(Math.abs(Math.sin(ang)) * far * 0.5),
        '--rot': Math.round(rand(-320, 320)) + 'deg',
        '--dur': Math.round(rand(440, 640)) + 'ms',
        '--delay': Math.round(rand(0, 60)) + 'ms',
        '--tint': CHIPS[j % CHIPS.length]
      }, 800);
    }
  }


  /* ============================================================
     THE SEQUENCER

     Phase classes ACCUMULATE — none is ever taken off mid-attempt.
     css/failure.css is ordered so the newest class always wins on
     equal specificity, and every keyframe's 0% restates the
     previous one's 100%, so the chain has no seams in it.

     Taking a class off instead would drop that beat's `forwards`
     fill and snap the craft back to the top of the screen for a
     frame, which is the whole reason it is done this way.
     ============================================================ */

  var running = 0;                 /* how many attempts are in flight */
  var BUSY = 'geo-fail-busy';

  function isAnimating(ship) {
    return ship ? ship.classList.contains(BUSY) : running > 0;
  }

  function begin(ship) {
    running++;
    ship.classList.add(BUSY, 'is-committed');
  }

  function end(ship) {
    running = Math.max(0, running - 1);
    ship.classList.remove(BUSY);
  }

  /* Every phase goes through here, so an abort is checked for at
     one place: `alive` is the caller's generation test, and a
     screen the player has jumped away from stops mid-chain instead
     of finishing behind their back. */
  function phase(ship, cls, ms, alive) {
    if (alive && !alive()) return Promise.reject(new Error('aborted'));
    if (cls) ship.classList.add(cls);
    return wait(ms).then(function () {
      if (alive && !alive()) throw new Error('aborted');
    });
  }

  /* One exit for every chain. An abort is expected and silent; a
     real fault is reported and then swallowed, because a landing
     that throws must still hand the screen back to the player
     rather than leaving the controls disarmed. */
  function finish(ship, p, err) {
    end(ship);
    if (err && err.message !== 'aborted' && global.console) {
      global.console.warn('GeoFail: landing did not complete —', err);
    }
    return err ? null : p;
  }


  /* ============================================================
     A · TOO LARGE — CRASH ON LAND

       approach → touchdown → instability → crash → wreck

     The craft comes down on far more land than it needs, settles,
     finds nothing to brace against, hunts for a footing, gives up,
     tips, skids across the rock and stays there. It is never
     destroyed and never hidden: the beat the player has to read is
     a working spacecraft lying uselessly in the middle of an island
     three times the size it needed.
     ============================================================ */

  function crashOnLand(ship, pad, opts) {
    opts = opts || {};
    if (!ship || !pad || !opts.refPad) return Promise.resolve(null);

    var alive = opts.alive;
    var fx = sceneOf(ship);
    var p = plan(ship, pad, opts.refPad, opts.geo);

    /* the wobble, the tilt and the skid all have to lean the same
       way, or the craft swings back through vertical between them.
       `into`: it goes over TOWARDS the middle of the island, so the
       wreck ends up on rock and not hanging over the shoreline. */
    writePlan(ship, p, p.into, opts.rotation == null ? 9 : opts.rotation);

    begin(ship);

    return phase(ship, 'ship-approaching', msVar(ship, '--approach-ms', 860), alive)
      .then(function () {
        if (opts.onTouchdown) opts.onTouchdown();
        return phase(ship, 'ship-touchdown', msVar(ship, '--touchdown-ms', 200), alive);
      })
      .then(function () {
        /* the verdict is SPOKEN OVER the struggle, not after it —
           the line starts as the craft begins to lose its footing */
        if (opts.onSettle) opts.onSettle();
        return phase(ship, 'ship-unstable', msVar(ship, '--unstable-ms', 820), alive);
      })
      .then(function () {
        /* the crash class goes on first, then the burst is fired
           the moment the hull actually reaches the ground — 64% of
           the way through, where shipCrashSlide ends its skid */
        var ms = msVar(ship, '--crash-ms', 540);
        ship.classList.add('ship-crashing');
        return wait(ms * 0.6).then(function () {
          if (alive && !alive()) throw new Error('aborted');
          landImpact(fx, p.hit, p.sw, p.into);
          if (opts.onImpact) opts.onImpact(p.hit, 'land');
          return wait(ms * 0.4);
        });
      })
      .then(function () {
        /* `is-wrecked` as well: css/water.css hangs the shadow's
           own wreck state off that name, and it predates the phase
           classes */
        ship.classList.add('ship-wrecked', 'is-wrecked');
        return wait(opts.hold == null ? 620 : opts.hold);
      })
      .then(function () { return finish(ship, p, null); },
            function (e) { return finish(ship, p, e); });
  }


  /* ============================================================
     B · TOO SMALL — OFF THE EDGE AND UNDER

       approach → failed fit → slip → water impact → sinking

     The craft is drawn at its true size, so on an island smaller
     than its footprint it visibly hangs over the edges. It tries to
     settle anyway — and that short pause, with the overhang plainly
     visible, is the beat that has to teach. Then the unsupported
     side goes down, gravity takes it, and the next thing under it
     is water.
     ============================================================ */

  function sinkInWater(ship, pad, opts) {
    opts = opts || {};
    if (!ship || !pad || !opts.refPad) return Promise.resolve(null);

    var alive = opts.alive;
    var fx = sceneOf(ship);
    var p = plan(ship, pad, opts.refPad, opts.geo);

    /* `dir`: away from the middle of the frame, so it always goes
       into open water and never across one of its neighbours */
    writePlan(ship, p, p.dir, null);

    var sinkMs = msVar(ship, '--sink-ms', 1700);

    begin(ship);

    return phase(ship, 'ship-approaching', msVar(ship, '--approach-ms', 860), alive)
      .then(function () {
        if (opts.onTouchdown) opts.onTouchdown();
        /* it settles, holds for a beat — long enough to SEE that
           the hull is wider than the land — then one side drops */
        if (opts.onSettle) opts.onSettle();
        return phase(ship, 'ship-failed-fit', msVar(ship, '--misfit-ms', 620), alive);
      })
      .then(function () {
        return phase(ship, 'ship-slipping', msVar(ship, '--slip-ms', 560), alive);
      })
      .then(function () {
        /* The surface breaking. This beat gets its own time — a
           tenth of the sink — because `ship-sinking` overrides the
           plunge the moment it goes on, and without the gap the
           check as the hull meets the water would never be drawn. */
        var hitMs = Math.round(sinkMs * 0.12);

        ship.classList.add('ship-water-impact');
        waterImpact(fx, p.impact, p.sw);
        if (opts.onImpact) opts.onImpact(p.impact, 'water');

        return phase(ship, null, hitMs, alive);
      })
      .then(function () {
        /* the water closes over it: the overlay is painted ABOVE
           the craft (z 5 against the ship's 4), so the hull goes
           UNDER something rather than merely fading out */
        if (fx.water) {
          fx.water.style.transform =
            'translate(' + p.impact.x.toFixed(1) + 'px,' +
                           p.impact.y.toFixed(1) + 'px)';
          fx.water.style.setProperty('--overlay-ms', sinkMs + 'ms');
          fx.water.classList.remove('is-on');
          void fx.water.offsetWidth;                /* restart it */
          fx.water.classList.add('is-on');
        }

        bubbles(fx, p.impact, p.sw, sinkMs);
        return phase(ship, 'ship-sinking', sinkMs, alive);
      })
      .then(function () {
        return afterRipples(fx, p.impact, p.sw);
      })
      .then(function () { return finish(ship, p, null); },
            function (e) { return finish(ship, p, e); });
  }


  /* ============================================================
     C · THE EXACT FIT

     Same approach, same touchdown, and then nothing else happens —
     which is the point. No wobble, no tilt, no burst: it simply
     stops, and the island keeps the craft.
     ============================================================ */

  function successfulLanding(ship, pad, opts) {
    opts = opts || {};
    if (!ship || !pad || !opts.refPad) return Promise.resolve(null);

    var alive = opts.alive;
    var p = plan(ship, pad, opts.refPad, opts.geo);

    writePlan(ship, p, 1, null);

    begin(ship);

    return phase(ship, 'ship-approaching', msVar(ship, '--approach-ms', 860), alive)
      .then(function () {
        if (opts.onTouchdown) opts.onTouchdown();
        return phase(ship, 'ship-touchdown', msVar(ship, '--touchdown-ms', 200), alive);
      })
      .then(function () {
        ship.classList.add('ship-landed');
        if (opts.onSettle) opts.onSettle();
        return phase(ship, null, msVar(ship, '--plant-ms', 740), alive);
      })
      .then(function () { return finish(ship, p, null); },
            function (e) { return finish(ship, p, e); });
  }


  /* ============================================================
     RESET

     Back on the rail, ready for another go. Taking the phase
     classes off is enough on its own: every beat is a CSS animation
     whose only hold on the element is `forwards`, so with the class
     gone the craft falls back to the hover position its stylesheet
     puts it at.

     The legacy verdict classes are cleared here too, so a screen
     that is reset by a jump comes back clean whichever system last
     touched it.
     ============================================================ */

  var PHASES = [
    'ship-approaching', 'ship-touchdown', 'ship-unstable',
    'ship-crashing', 'ship-wrecked',
    'ship-failed-fit', 'ship-slipping', 'ship-water-impact', 'ship-sinking',
    'ship-landed',
    /* from the pre-phase system, in case one is still on */
    'is-teeter', 'is-rock', 'is-wrecked', 'is-planted',
    BUSY
  ];

  function resetSpaceship(ship) {
    if (!ship) return;

    ship.classList.remove.apply(ship.classList, PHASES);
    ship.classList.remove('is-committed');

    /* Force the style change to land now. Without it, a reset and
       the next attempt's `ship-approaching` inside one task look to
       the browser like no change at all, and the second landing
       plays the first one's finished animation — it never restarts. */
    void ship.offsetWidth;

    var fx = sceneOf(ship);
    clearLayer(fx.back);
    clearLayer(fx.front);
    if (fx.water) {
      fx.water.classList.remove('is-on');
      fx.water.style.transform = '';
    }

    /* any Web Animation left on the craft by an older code path —
       the CSS idle bob is declared, not driven, so it is left be */
    [ship, ship.querySelector('.ship__craft')].forEach(function (el) {
      if (el && el.getAnimations) {
        el.getAnimations().forEach(function (a) {
          if (a.animationName !== 'shipBob') a.cancel();
        });
      }
    });
  }


  global.GeoFail = {
    /* the three outcomes */
    crashOnLand: crashOnLand,
    sinkInWater: sinkInWater,
    successfulLanding: successfulLanding,

    /* housekeeping */
    resetSpaceship: resetSpaceship,
    isAnimating: isAnimating,

    /* exposed for anything that wants the measurements without the
       motion — the geometry is the same one the whole mission uses */
    plan: plan,
    sceneOf: sceneOf,
    TRI_GEO: TRI_GEO
  };
})(window);
