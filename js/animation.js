/* ============================================================
   Geo Drone — motion helpers

   Everything here returns a Promise so script.js can read as a
   straight-line script: await the line, await the sweep, await
   the shapes surfacing.

   Every delay goes through GeoLife.wait, so a hidden tab freezes
   the flow instead of running it out behind the player's back.
   ============================================================ */

(function (global) {
  'use strict';

  var doc = document;

  /* ---------------------------------------------------------- primitives */
  /* pausable: time spent on another tab does not count */
  function wait(ms) {
    return global.GeoLife
      ? global.GeoLife.wait(ms)
      : new Promise(function (r) { setTimeout(r, ms); });
  }

  function nextFrame() {
    return new Promise(function (r) { requestAnimationFrame(function () { r(); }); });
  }

  function reduced() {
    return global.matchMedia &&
           global.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /* ---------------------------------------------------------- starfield */
  function starfield(host, count) {
    if (!host) return;
    var frag = doc.createDocumentFragment();
    for (var i = 0; i < count; i++) {
      var s = doc.createElement('i');
      var size = Math.random() < 0.82 ? 1 + Math.random() : 2 + Math.random() * 1.4;
      /* keep them in the upper band — that is where the canopy is */
      s.style.left = (Math.random() * 100).toFixed(2) + '%';
      s.style.top = (Math.random() * 62).toFixed(2) + '%';
      s.style.width = size.toFixed(2) + 'px';
      s.style.height = size.toFixed(2) + 'px';
      s.style.setProperty('--dur', (2.6 + Math.random() * 5).toFixed(2) + 's');
      s.style.setProperty('--delay', (Math.random() * 6).toFixed(2) + 's');
      s.style.setProperty('--peak', (0.35 + Math.random() * 0.6).toFixed(2));
      frag.appendChild(s);
    }
    host.appendChild(frag);
  }

  /* ---------------------------------------------------------- drone fly-out
     Driven by the Web Animations API off a generated step list
     rather than a CSS @keyframes block.

     WHY: a CSS animation applies its timing function to EVERY pair
     of keyframes, not once across the whole run. The old five-stop
     @keyframes with cubic-bezier(.34,.06,.3,1) therefore eased in
     and out five separate times, braking at each stop — that is the
     stutter that read as the drone slowing down on its way out.

     Here the shape of the motion lives in the numbers and every
     step is `linear`, so screen velocity is continuous end to end.  */

  var STEPS = 48;
  var TRAVEL_VH = 47;        // how far up the canopy it climbs
  var DRIFT_VW = 3.2;        // and how far it leans toward the planet
  var END_SCALE = 0.06;

  function smoothstep(u) { return u * u * (3 - 2 * u); }

  /* Speed along the path: eases up out of the bay, then holds a
     steady cruise for the entire rest of the climb. Deliberately no
     ease-out — the drone must not appear to brake once it is far
     from the ship, which is exactly what the old curve did. The
     ramp is smoothstep, so it is flat-sloped where it meets the
     cruise and there is no kink. */
  function cruise(t) {
    return t < 0.16 ? 0.32 + 0.68 * smoothstep(t / 0.16) : 1;
  }

  /* Integrate cruise() into a cumulative distance table, normalised
     to 0..1. Position comes from this, so the drone can never stall
     or surge between steps. */
  function pathTable(steps) {
    var acc = [0], sum = 0, i;
    for (i = 1; i <= steps; i++) {
      sum += cruise((i - 0.5) / steps);   // midpoint sample
      acc.push(sum);
    }
    for (i = 0; i <= steps; i++) acc[i] /= sum;
    return acc;
  }

  /* Shrink with distance travelled, not with time — this is what
     sells "receding" while the screen speed stays even. */
  function depthScale(e) {
    return END_SCALE + (1 - END_SCALE) * Math.pow(1 - e, 1.35);
  }

  function droneOpacity(t) {
    if (t < 0.06) return t / 0.06;                       // clears the console
    if (t > 0.88) return Math.max(0, 1 - (t - 0.88) / 0.12);
    return 1;
  }

  function flyDrone(droneEl, trailEl) {
    if (!droneEl || !droneEl.animate) return Promise.resolve();

    var soft = reduced();
    var dur = soft ? 900 : 3400;
    var steps = soft ? 14 : STEPS;
    var path = pathTable(steps);
    var frames = [];
    var trail = [];
    var i, t, e;

    for (i = 0; i <= steps; i++) {
      t = i / steps;
      e = path[i];

      /* one slow sine of sway — smooth by construction, no kinks */
      var tilt = (Math.sin(t * Math.PI * 2.2) * 1.6).toFixed(3);

      frames.push({
        offset: t,
        opacity: droneOpacity(t),
        transform:
          'translate(calc(-50% + ' + (DRIFT_VW * e).toFixed(3) + 'vw),' +
          ' calc(-50% - ' + (TRAVEL_VH * e).toFixed(3) + 'vh))' +
          ' scale(' + depthScale(e).toFixed(4) + ')' +
          ' rotate(' + tilt + 'deg)',
        easing: 'linear'
      });

      /* exhaust puff: grows with the first third of the climb, then
         thins out and is gone well before the drone is */
      trail.push({
        offset: t,
        height: (15 * Math.min(1, e / 0.30)).toFixed(2) + '%',
        opacity: t < 0.10
          ? (t / 0.10) * 0.8
          : Math.max(0, 0.8 * (1 - (t - 0.10) / 0.38)),
        easing: 'linear'
      });
    }

    var opts = { duration: dur, easing: 'linear', fill: 'forwards' };
    var anim = droneEl.animate(frames, opts);
    if (trailEl && trailEl.animate) trailEl.animate(trail, opts);

    return Promise.race([
      anim.finished.catch(function () {}),
      wait(dur + 400)
    ]);
  }

  /* ---------------------------------------------------------- scanner sweep
     A hard red vertical line crossing the feed left → right, then
     back right → left. One round trip: any more and the sweep
     outstays the beat it sits in. Resolves when the last leg lands. */
  function sweep(scannerEl, opts) {
    opts = opts || {};
    if (!scannerEl) return Promise.resolve();

    var bar = scannerEl.querySelector('.scanner__bar');
    var legs = opts.legs || 2;
    var legMs = reduced() ? 420 : (opts.legMs || 1150);

    scannerEl.classList.add('is-on');

    /* the HUD frame eats the outer ~3%, so the line turns around
       just inside it instead of vanishing under the bezel */
    var INSET = 0.032;

    function bounds() {
      var stage = scannerEl.parentElement || doc.body;
      var W = stage.getBoundingClientRect().width;
      var bw = bar.getBoundingClientRect().width;
      var lo = W * INSET;
      var hi = W * (1 - INSET) - bw;
      return [lo, Math.max(lo, hi)];
    }

    function leg(n) {
      if (n >= legs) return Promise.resolve();
      var b = bounds();
      var toRight = n % 2 === 0;
      var from = toRight ? b[0] : b[1];
      var to = toRight ? b[1] : b[0];

      return new Promise(function (resolve) {
        var anim = bar.animate(
          [
            { transform: 'translateX(' + from + 'px)' },
            { transform: 'translateX(' + to + 'px)' }
          ],
          {
            duration: legMs,
            easing: n === legs - 1 ? 'cubic-bezier(.4,0,.2,1)'
                                   : 'cubic-bezier(.45,.05,.55,.95)',
            fill: 'forwards'
          }
        );
        anim.onfinish = resolve;
        anim.oncancel = resolve;
        wait(legMs + 250).then(resolve);
      }).then(function () { return leg(n + 1); });
    }

    return leg(0).then(function () {
      return wait(180);
    }).then(function () {
      scannerEl.classList.remove('is-on');
      return wait(420);
    });
  }

  /* ============================================================
     THE CAMERA

     Every playing screen -- the survey and the five rounds -- is one
     continuous shot over one sea, and the lens comes down on it
     twice. What this module owns is the LENS:
     where it is, how it gets somewhere else, and the four plates
     that have to move together for the move to read as a camera
     and not as things sliding about on a screen.

     ── a camera state ────────────────────────────────────────────

       { s, x, y }   s   the zoom: 1 is "down", --cam-wide is
                         survey height
                     x,y the WORLD point under the middle of the
                         frame, in per cent of one frame

     World coordinates are the camera plate's own: site A's frame
     is (0..100, 0..100), site B's is a frame to the right and
     45% down, the islets lie around both (see .site and .islets
     in css/style.css). A state with s = 1 and (x, y) on a site's
     centre is that site laid out exactly as a screen of its own
     would lay it out -- a translate and a scale of 1 -- which is
     what lets the landing's plan() measure it as though the
     camera were not there.

     ── the plates ────────────────────────────────────────────────

       .cam        the world. translate(50 - s*x, 50 - s*y) scale(s),
                   with the origin at the corner: the one transform
                   the state describes.

       the water   the screen's sea photograph (.s2-bg or .s3-bg),
                   .sea__deep and .sea__swell -- the sea sheets with
                   no transform of their own. The
                   sea is one photograph stretched to the frame, so
                   its plate can only be scaled UP, never under 1;
                   it grows a little with the zoom (--cam-water-wide
                   to --cam-water-near) and follows a pan at a
                   fraction of the world's travel (--cam-parallax),
                   clamped so its edge never comes into frame. That
                   fraction is the depth cue: water that stayed put
                   under a moving archipelago would read as islands
                   drifting on it, and water that moved with it
                   exactly would need a photograph three frames
                   wide.

       .aerial     the haze between a lens at height and the water:
                   1 - zoom, so it is full at survey height and gone
                   on the ground.

       .fix        the acquisition bracket. Frame-level and static;
                   the script puts it where a site is being SHOWN
                   (camProject) and takes it down partway through
                   each descent.

     ── one flight, many keyframes ────────────────────────────────

     camFly takes a LIST of states, each with an offset and the
     easing into the next, and writes one Web Animation per plate
     with the same offsets and easings -- so the climb out of site
     A, the crossing at altitude and the descent onto site B are a
     single animation that never stops, rather than three that
     each start from rest. The first keyframe is always the lens's
     LIVE state (camRead), read off the world plate's own matrix,
     so a flight asked for mid-loiter or mid-flight starts from the
     frame that is on screen and not from where the last one was
     supposed to end.

     Between two keyframes the browser interpolates translate and
     scale each on a straight line, and for a camera that turns out
     to be the right path: a zoom about a fixed point IS a straight
     line in (translate, scale), and so is a pan at a fixed height.

     ── pinning ───────────────────────────────────────────────────

     When a flight lands the plates are PINNED -- their animations
     cancelled and the end state written as inline style -- so
     nothing is left running under a task the player is about to
     spend a minute on. Inline needs the water's own CSS breathing
     switched off on this screen (css/water.css does this), because
     a CSS animation outranks an inline style and would take the
     photograph back to scale 1 the moment the pin went in.

     ── generations ───────────────────────────────────────────────

     A flight's tail pins the lens, and a player who jumps screens
     mid-flight would otherwise have that pin land on a camera the
     reset has re-parked. Every set and every reset bumps camGen;
     the tail checks the generation it was started under, exactly
     as sequence() in js/script.js checks runId.
     ============================================================ */

  /* every animation this module starts is tagged, so camStop can
     cancel the camera's own without touching .sea__swell's
     swellBreathe -- a CSS animation cancelled through the Web
     Animations API does not come back */
  var CAM_ID = 'geo-cam';

  var camGen = 0;

  function camVar(screen, name, fallback) {
    var v = parseFloat(global.getComputedStyle(screen).getPropertyValue(name));
    return isFinite(v) ? v : fallback;
  }

  /* the screen's figures, read once per call so a media query can
     retune them and the lens follows */
  function camVars(screen) {
    return {
      wide:      camVar(screen, '--cam-wide', 0.32),
      waterWide: camVar(screen, '--cam-water-wide', 1.14),
      waterNear: camVar(screen, '--cam-water-near', 1.24),
      parallax:  camVar(screen, '--cam-parallax', 0.10)
    };
  }

  function camWide(screen) { return camVars(screen).wide; }

  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

  /* 0 at survey height, 1 on the ground */
  function camZoom(screen, s) {
    var w = camWide(screen);
    return w >= 1 ? 1 : clamp01((s - w) / (1 - w));
  }

  function camPlates(screen) {
    var out = [];
    var world = screen.querySelector('.cam');
    if (world) out.push({ el: world, kind: 'world' });
    Array.prototype.forEach.call(
      screen.querySelectorAll('.s2-bg, .s3-bg, .sea__deep, .sea__swell'),
      function (el) { out.push({ el: el, kind: 'water' }); }
    );
    var haze = screen.querySelector('.aerial');
    if (haze) out.push({ el: haze, kind: 'haze' });
    return out;
  }

  function camStop(el) {
    if (!el || !el.getAnimations) return;
    el.getAnimations().forEach(function (a) {
      if (a.id === CAM_ID) a.cancel();
    });
  }

  function pct(n) { return n.toFixed(3) + '%'; }

  /* the world plate, for a state */
  function worldOf(st) {
    return 'translate(' + pct(50 - st.s * st.x) + ', ' + pct(50 - st.s * st.y) + ') ' +
           'scale(' + st.s.toFixed(5) + ')';
  }

  /* the water, for a state: a little bigger the lower the lens is,
     and a fraction of the way towards where the lens has gone */
  function waterOf(st, v) {
    var t = v.wide >= 1 ? 1 : clamp01((st.s - v.wide) / (1 - v.wide));
    var ws = v.waterWide + (v.waterNear - v.waterWide) * t;
    var room = (ws - 1) * 50 * 0.92;
    var dx = Math.max(-room, Math.min(room, -(st.x - 50) * v.parallax));
    var dy = Math.max(-room, Math.min(room, -(st.y - 50) * v.parallax));
    return 'translate(' + pct(50 - 50 * ws + dx) + ', ' + pct(50 - 50 * ws + dy) + ') ' +
           'scale(' + ws.toFixed(5) + ')';
  }

  function hazeOf(st, v) {
    var t = v.wide >= 1 ? 1 : clamp01((st.s - v.wide) / (1 - v.wide));
    return String(1 - t);
  }

  function valueOf(plate, st, v) {
    if (plate.kind === 'world') return { transform: worldOf(st) };
    if (plate.kind === 'water') return { transform: waterOf(st, v) };
    return { opacity: hazeOf(st, v) };
  }

  /* The lens's live state, read back off the world plate's matrix.
     m.a is the scale; m.e / m.f the translate in px, which is
     50 - s*x per cent of the frame. */
  function camRead(screen) {
    var world = screen && screen.querySelector('.cam');
    if (!world) return { s: 1, x: 50, y: 50 };

    var t = global.getComputedStyle(world).transform;
    if (!t || t === 'none') return { s: 1, x: 50, y: 50 };

    try {
      var m = new DOMMatrixReadOnly(t);
      var s = m.a || 1;
      var W = world.clientWidth || 1;
      var H = world.clientHeight || 1;
      return {
        s: s,
        x: (50 - m.e / W * 100) / s,
        y: (50 - m.f / H * 100) / s
      };
    } catch (e) {
      return { s: 1, x: 50, y: 50 };
    }
  }

  /* a world point, as the frame shows it under `st` -- per cent of
     the frame both in and out */
  function camProject(screen, st, wx, wy) {
    return { x: 50 + st.s * (wx - st.x), y: 50 + st.s * (wy - st.y) };
  }

  /* One plate, one animation. Resolves the same three ways sweep()
     does: finishing, being cancelled, or the clock running out --
     so a browser that never fires onfinish cannot strand the
     script. `frames` carry their own offsets and easings. */
  function camAnim(el, frames, ms) {
    if (!el || !el.animate) return wait(ms);

    return new Promise(function (resolve) {
      var anim = el.animate(frames, { duration: ms, fill: 'forwards' });
      anim.id = CAM_ID;
      /* A finished fill-forwards animation that a later one fully
         covers is "replaceable", and the browser may drop it from
         getAnimations() on its own. Every camera animation is
         cancelled by camStop through that list, so one that has
         quietly left it can neither be cancelled nor accounted for.
         persist() keeps it listed until the camera says otherwise. */
      if (anim.persist) anim.persist();
      anim.onfinish = resolve;
      anim.oncancel = resolve;
      wait(ms + 250).then(resolve);
    });
  }

  /* Park the lens at `st`, now, with nothing running. */
  function camSet(screen, st) {
    if (!screen || !st) return;
    camGen++;
    var v = camVars(screen);
    camPlates(screen).forEach(function (p) {
      camStop(p.el);
      var val = valueOf(p, st, v);
      p.el.style.transformOrigin = '0 0';
      p.el.style.willChange = p.kind === 'haze' ? 'opacity' : 'transform';
      if (val.transform != null) p.el.style.transform = val.transform;
      if (val.opacity != null) p.el.style.opacity = val.opacity;
    });
  }

  /* Everything back to the ground state: no animations of ours, no
     inline transform, the world at identity. */
  function camReset(screen) {
    if (!screen) return;
    camGen++;

    camPlates(screen).forEach(function (p) {
      camStop(p.el);
      p.el.style.transform = '';
      p.el.style.transformOrigin = '';
      p.el.style.willChange = '';
      p.el.style.opacity = '';
    });

    camUnfix(screen, 0);
  }

  /* Fly. `keys` is a list of states with `offset` (0..1; the last
     may omit it) and `easing` (OUT of that key, into the next; the
     last's is ignored, as the Web Animations API ignores it). The
     first keyframe is the live lens, and it leaves on opts.easing.
     Resolves once every plate has landed and the lens has been
     pinned. */
  function camFly(screen, keys, opts) {
    opts = opts || {};
    if (!screen || !keys || !keys.length) return wait(0);

    var gen = camGen;
    var ms = opts.ms || 3400;
    var v = camVars(screen);
    var ease = opts.easing || 'cubic-bezier(.46, .02, .16, 1)';

    /* the live lens leaves on the flight's own easing (opts.easing);
       from a key onwards, that key's easing carries the lens to the
       next one, so a state in the middle of a flight can say how it
       is left -- linear for a drift, a settle for a descent */
    var frames = [{ st: camRead(screen), offset: 0, easing: ease }];
    keys.forEach(function (k, i) {
      frames.push({
        st: k,
        offset: k.offset == null ? (i === keys.length - 1 ? 1 : null) : k.offset,
        easing: k.easing || ease
      });
    });
    /* any offset left null is spaced evenly between its neighbours */
    frames.forEach(function (f, i) {
      if (f.offset != null) return;
      var j = i + 1;
      while (frames[j].offset == null) j++;
      var prev = frames[i - 1].offset;
      f.offset = prev + (frames[j].offset - prev) / (j - i + 1);
    });

    var last = frames[frames.length - 1].st;

    var jobs = camPlates(screen).map(function (p) {
      camStop(p.el);
      p.el.style.transformOrigin = '0 0';
      p.el.style.willChange = p.kind === 'haze' ? 'opacity' : 'transform';
      var kfs = frames.map(function (f) {
        var val = valueOf(p, f.st, v);
        val.offset = f.offset;
        val.easing = f.easing;
        return val;
      });
      return camAnim(p.el, kfs, ms);
    });

    return Promise.all(jobs).then(function () {
      /* a jump mid-flight re-parks the lens before this lands */
      if (gen !== camGen) return;
      camSet(screen, last);
    });
  }

  /* A slow drift at the current height, for the lens to hold on
     while nothing is happening: `dx`/`dy` in world per cent. A
     state, not a beat -- whatever asks for the next flight reads
     the live lens and interrupts it wherever it has got to.

     Only ever called on a screen that is showing, and given a
     duration nothing on the screen can outwait: a camera animation
     that finishes on a hidden screen and is then cancelled leaves
     its last frame stuck on the element in Chromium (see the note
     at the end of resetRound() in js/script.js). */
  function camLoiter(screen, st, o) {
    o = o || {};
    if (!screen || !st) return;
    var to = { s: st.s, x: st.x + (o.dx || 1.6), y: st.y + (o.dy || 1.0) };
    var v = camVars(screen);
    camPlates(screen).forEach(function (p) {
      camStop(p.el);
      var a = valueOf(p, st, v); a.offset = 0; a.easing = 'cubic-bezier(.42, 0, .58, 1)';
      var b = valueOf(p, to, v); b.offset = 1;
      camAnim(p.el, [a, b], o.ms || 17000);
    });
  }

  /* The bracket, over `box` -- a patch of the FRAME in per cent,
     already projected (camProject) from wherever the site is. */
  function camFix(screen, box, ms) {
    var fix = screen && screen.querySelector('.fix');
    if (!fix || !box) return wait(0);

    var inner = fix.querySelector('.fix__box');
    if (inner) {
      inner.style.left = box.l.toFixed(2) + '%';
      inner.style.top = box.t.toFixed(2) + '%';
      inner.style.width = (box.r - box.l).toFixed(2) + '%';
      inner.style.height = (box.b - box.t).toFixed(2) + '%';
    }

    camStop(fix);
    fix.classList.add('is-on');
    return camAnim(fix, [
      { opacity: getComputedStyle(fix).opacity, offset: 0, easing: 'cubic-bezier(.2, .8, .3, 1)' },
      { opacity: 1, offset: 1 }
    ], ms || 620);
  }

  /* and down. `is-on` comes off at the end: with it off the
     stylesheet holds the bracket at 0 whatever else is happening
     (css/style.css), which is the guarantee a reset wants. */
  function camUnfix(screen, ms) {
    var fix = screen && screen.querySelector('.fix');
    if (!fix) return wait(0);

    if (!ms) {
      camStop(fix);
      fix.classList.remove('is-on');
      fix.style.opacity = '';
      return wait(0);
    }

    var from = getComputedStyle(fix).opacity;
    camStop(fix);
    return camAnim(fix, [
      { opacity: from, offset: 0, easing: 'cubic-bezier(.4, 0, .6, 1)' },
      { opacity: 0, offset: 1 }
    ], ms).then(function () {
      if (fix.classList.contains('is-on')) {
        camStop(fix);
        fix.classList.remove('is-on');
        fix.style.opacity = '';
      }
    });
  }


  /* ---------------------------------------------------------- landing zones
     Shapes breach the surface one after another, each with its
     own splash. Resolves once the last one has settled.        */
  function surfaceZones(zoneEls, onEach, opts) {
    opts = opts || {};
    var list = Array.prototype.slice.call(zoneEls || []);
    if (!list.length) return Promise.resolve();

    var gap = reduced() ? 120 : (opts.gap || 480);

    /* How long after the LAST island has been told to come up this
       resolves. 1600ms is the rise plus a beat, which is what a
       caller with nothing to follow it wants — but the survey feed
       starts its camera down onto the archipelago while the back of
       it is still settling, and waiting out the full rise there
       would put a dead second between the last splash and the
       lens moving. So it is an option, not a constant. */
    var settle = reduced() ? 300
               : (opts.settle == null ? 1600 : opts.settle);

    list.forEach(function (el, i) {
      wait(i * gap).then(function () {
        el.classList.add('is-up');
        if (onEach) onEach(el, i);
      });
    });

    return wait((list.length - 1) * gap + settle);
  }

  /* ---------------------------------------------------------- zones sink
     The mirror of surfaceZones: the shapes that do NOT match the
     spaceship slide back under the water, each with its own splash
     and rings, so the surface closes over them rather than the
     images simply blinking out.

     Ordered nearest-first (largest `--w`) so the sinking reads as a
     deliberate sweep instead of a random pop-pop.                */
  function sinkZones(zoneEls, onEach, opts) {
    opts = opts || {};
    var list = Array.prototype.slice.call(zoneEls || []);
    if (!list.length) return Promise.resolve();

    var gap = reduced() ? 120 : (opts.gap || 560);
    var settle = reduced() ? 300 : 1450;

    list.forEach(function (el, i) {
      wait(i * gap).then(function () {
        el.classList.add('is-sunk');
        if (onEach) onEach(el, i);
      });
    });

    return wait((list.length - 1) * gap + settle);
  }

  /* ---------------------------------------------------------- the landing
     Moved out. Screens 3 to 8 fly the craft down, wreck it on the
     rock and sink it in the sea through js/failure.js, which owns
     the centre-of-area arithmetic, the phase classes and the
     bursts. What used to be here — padPlan, shipDescend,
     shipTopple, shipCrash, shipSink and shipReset — has no callers
     left; GeoFail.plan() and GeoFail.resetSpaceship() are the two
     that replaced them. */

  /* ---------------------------------------------------------- confetti

     Built here rather than parked in the markup: the count follows
     the width of the frame, every piece gets its own fall time,
     sway and spin so the shower never reads as a repeating loop,
     and the whole burst can be torn down in one call when the
     screen is reset mid-celebration.

     The fall itself is a CSS keyframe driven by custom properties
     (same idiom as the starfield) — a hundred-odd pieces on the
     compositor, no per-frame JS. */

  var TINTS = ['#4fd8ff', '#3ff5c0', '#ffbe3d', '#eafaff', '#8fb4ff', '#ff8fa3'];

  function confettiClear(host) {
    if (host) host.textContent = '';
  }

  function confetti(host, opts) {
    opts = opts || {};
    if (!host) return Promise.resolve();

    confettiClear(host);

    /* a shower of paper is the one flourish here that is pure
       flourish, so it is the one that goes away entirely */
    if (reduced()) return Promise.resolve();

    /* one piece per ~13px of frame width: a phone is not buried and
       a wide desktop does not look under-dressed */
    var count = opts.count ||
      Math.max(54, Math.min(150, Math.round((host.offsetWidth || 900) / 13)));
    var spread = opts.spread == null ? 1500 : opts.spread;  // launch window
    var fall   = opts.fall   == null ? 2900 : opts.fall;    // slowest fall
    var last   = 0;

    var frag = doc.createDocumentFragment();

    for (var i = 0; i < count; i++) {
      var p = doc.createElement('i');

      /* ribbons tumble, discs flutter — a mix of the two is what
         stops the shower looking like falling pixels */
      var ribbon = Math.random() < 0.62;
      var w = ribbon ? 4 + Math.random() * 3.4 : 5 + Math.random() * 4.5;
      var h = ribbon ? w * (1.9 + Math.random() * 1.5) : w;

      var dur = fall * (0.6 + Math.random() * 0.4);
      var delay = Math.random() * spread;
      if (dur + delay > last) last = dur + delay;

      p.style.left = (Math.random() * 100).toFixed(2) + '%';
      p.style.width = w.toFixed(2) + 'px';
      p.style.height = h.toFixed(2) + 'px';
      p.style.background = TINTS[(Math.random() * TINTS.length) | 0];
      p.style.borderRadius = ribbon ? '1px' : '50%';
      p.style.setProperty('--dur', dur.toFixed(0) + 'ms');
      p.style.setProperty('--delay', delay.toFixed(0) + 'ms');
      p.style.setProperty('--sway', (1.1 + Math.random() * 3.4).toFixed(2) + 'vw');
      /* signed, so half the shower turns the other way */
      p.style.setProperty('--spin',
        ((Math.random() < 0.5 ? -1 : 1) * (240 + Math.random() * 900)).toFixed(0) + 'deg');

      frag.appendChild(p);
    }

    host.appendChild(frag);

    /* self-clearing: the pieces are gone from the DOM once the last
       one is off the bottom of the frame, so nothing is left
       animating behind a screen the player has moved on from */
    return wait(last + 260).then(function () { confettiClear(host); });
  }

  /* ---------------------------------------------------------- screen swap */
  function swapScreens(from, to, veil, ms) {
    ms = ms || 1250;

    if (veil) veil.classList.add('is-on');

    return wait(ms * 0.42).then(function () {
      if (from) {
        from.classList.add('is-leaving');
        from.classList.remove('is-active');
      }
      if (to) to.classList.add('is-active');
      return wait(ms * 0.34);
    }).then(function () {
      if (veil) veil.classList.remove('is-on');
      return wait(ms * 0.5);
    }).then(function () {
      if (from) from.classList.remove('is-leaving');
    });
  }

  global.GeoMotion = {
    wait: wait,
    nextFrame: nextFrame,
    reduced: reduced,
    starfield: starfield,
    flyDrone: flyDrone,
    sweep: sweep,
    surfaceZones: surfaceZones,
    camReset: camReset,
    camSet: camSet,
    camFly: camFly,
    camLoiter: camLoiter,
    camRead: camRead,
    camProject: camProject,
    camZoom: camZoom,
    camWide: camWide,
    camFix: camFix,
    camUnfix: camUnfix,
    sinkZones: sinkZones,
    confetti: confetti,
    confettiClear: confettiClear,
    swapScreens: swapScreens
  };
})(window);
