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

     Screen 2 is one continuous shot. The lens opens on open water
     at the drone's survey height, holds while the islands break
     the surface a long way below it, and then comes down onto
     them; the voice-over and the shape task start when it has
     landed. Three calls, in that order:

       camWide(screen, focus)   park the lens high, and set it
                                loitering. Called from the screen's
                                RESET, which runs under the veil,
                                so the feed fades up already high.
       camFix(screen, box)      the acquisition bracket, on the
                                frame the islands arrive on.
       camPush(screen, opts)    fly it down. Resolves when the lens
                                has settled and the world has been
                                handed back untransformed.
       camReset(screen)         and back to the ground state, with
                                nothing running.

     ── the plates ────────────────────────────────────────────────

     Four elements, moved as one shot -- same clock, same easing,
     one call -- and each with its own travel:

       .cam        the world: the five islands and the fronts they
                   throw. --cam-wide up to 1, and 1 exactly, because
                   1 is the layout the shape task is played on.

       the water   .s2-bg, .sea__deep and .sea__swell. A fraction of
                   the world's travel, and never below 1: the sea is
                   one photograph stretched to the frame and a plate
                   scaled under 1 shows its own edge. These are also
                   the only three of the sea's nine sheets with no
                   transform of their own -- the caustic drift, the
                   glint sweep, the glare drift and the three roll
                   sheets all own theirs -- so they are the three
                   the camera is allowed to move.

       .aerial     the haze between a lens at height and the water
                   under it: full at the top of the descent, gone at
                   the bottom.

       .fix        the bracket. Drifts with the world but does not
                   zoom with it, and is released halfway down.

     ── why the two shots join without a step ────────────────────

     The loiter is a long drift that nothing waits for: the islands
     surface on their own clock and the descent is asked for
     whenever the script gets to it, which is never a round number
     of frames into the drift. So camPush does not assume where the
     loiter is -- it READS each plate's current transform off the
     computed style, uses that matrix as its own first keyframe, and
     only then cancels the loiter. Both happen in one task, with no
     frame boundary between them, so there is no value the browser
     could paint in between: the descent starts from exactly the
     frame the loiter was showing.

     ── generations ──────────────────────────────────────────────

     camPush's tail clears the world's transform, and a player who
     jumps screens mid-descent would otherwise have that tail land
     on a camera the reset has already re-parked. Every park and
     every reset bumps camGen; the tail checks the generation it
     was started under, exactly as sequence() in js/script.js checks
     runId.
     ============================================================ */

  /* every animation this module starts is tagged, so camStop can
     cancel the camera's own without touching .sea__swell's
     swellBreathe -- a CSS animation cancelled through the Web
     Animations API does not come back */
  var CAM_ID = 'geo-cam';

  /* The loiter, in per cent of the FRAME. Every plate it moves is
     frame-sized, so one pair of figures is the same drift on a
     phone as on a desktop -- and it is kept small on purpose: the
     water's plate is only oversized by 1.05 while the lens is high
     (see camPlates), and a drift wider than that would walk the
     photograph's own edge into the frame. */
  var LOITER = { x: 0.85, y: 0.5, ms: 17000 };

  var camGen = 0;

  function camVar(screen, name, fallback) {
    var v = parseFloat(global.getComputedStyle(screen).getPropertyValue(name));
    return isFinite(v) ? v : fallback;
  }

  /* The plates and their two ends. `wide` is the scale while the
     lens is high, `near` the scale it comes down to.

     .fix is in the table for its DRIFT, not for a zoom: 1 at both
     ends of the shot but for the flourish it is released on. */
  function camPlates(screen) {
    var wide = camVar(screen, '--cam-wide', 0.32);
    var near = camVar(screen, '--cam-water', 1.13);
    var out = [];

    function add(el, w, n) { if (el) out.push({ el: el, wide: w, near: n }); }

    add(screen.querySelector('.cam'), wide, 1);
    Array.prototype.forEach.call(
      screen.querySelectorAll('.s2-bg, .sea__deep, .sea__swell'),
      function (el) { add(el, 1.05, near); }
    );
    add(screen.querySelector('.fix'), 1, 1.5);

    return out;
  }

  function camStop(el) {
    if (!el || !el.getAnimations) return;
    el.getAnimations().forEach(function (a) {
      if (a.id === CAM_ID) a.cancel();
    });
  }

  /* what the plate is showing RIGHT NOW, as a keyframe value */
  function camNow(el, prop) {
    var v = global.getComputedStyle(el)[prop];
    if (prop === 'transform') return (!v || v === 'none') ? 'none' : v;
    return v;
  }

  /* One plate, one leg of the shot. Resolves the same three ways
     sweep() does: the animation finishing, the animation being
     cancelled, or the clock running out -- so a browser that never
     fires onfinish cannot strand the script. */
  function camAnim(el, frames, ms, easing) {
    if (!el || !el.animate) return wait(ms);

    return new Promise(function (resolve) {
      var anim = el.animate(frames, {
        duration: ms,
        easing: easing,
        fill: 'forwards'
      });
      anim.id = CAM_ID;
      anim.onfinish = resolve;
      anim.oncancel = resolve;
      wait(ms + 250).then(resolve);
    });
  }

  /* One plate's transform. The scale is written LAST, so it is
     applied first and the drift that follows it is in per cent of
     the frame rather than of the shrunken world -- which is what
     lets one pair of figures in LOITER move every plate by the same
     distance across the glass, whatever scale each of them is at. */
  function camWrite(scale, tx, ty) {
    return 'translate(' + tx.toFixed(3) + '%, ' + ty.toFixed(3) + '%) ' +
           'scale(' + scale + ')';
  }

  /* Everything back to the ground state: no animations of ours
     running, no inline transform, and the shape task played on the
     layout itself. */
  function camReset(screen) {
    if (!screen) return;
    camGen++;

    var els = camPlates(screen).map(function (p) { return p.el; });
    var haze = screen.querySelector('.aerial');
    var fix = screen.querySelector('.fix');
    if (haze) els.push(haze);

    els.forEach(function (el) {
      camStop(el);
      el.style.transform = '';
      el.style.transformOrigin = '';
      el.style.willChange = '';
      el.style.opacity = '';
    });

    if (fix) {
      fix.classList.remove('is-on');
      var box = fix.querySelector('.fix__box');
      if (box) box.removeAttribute('style');
    }
  }

  /* Park the lens at survey height and set it loitering. `focus` is
     the point the descent will end on, in per cent of the frame,
     and it is the transform origin of every plate -- so the shot
     converges on the archipelago rather than on the middle of the
     frame, and the islands the lens is holding on stay where they
     are all the way down.

     No promise: the loiter is a state, not a beat. Whatever asks
     for the descent interrupts it. */
  function camWide(screen, focus) {
    if (!screen || !focus) return;
    camGen++;

    var origin = focus.x.toFixed(2) + '% ' + focus.y.toFixed(2) + '%';
    var d = LOITER;

    camPlates(screen).forEach(function (p) {
      camStop(p.el);
      p.el.style.transformOrigin = origin;
      p.el.style.willChange = 'transform';
      camAnim(p.el, [
        { transform: camWrite(p.wide, -d.x, -d.y) },
        { transform: camWrite(p.wide,  d.x,  d.y * 0.6) }
      ], d.ms, 'cubic-bezier(.42, 0, .58, 1)');
    });

    var haze = screen.querySelector('.aerial');
    if (haze) { camStop(haze); haze.style.opacity = '1'; }

    var fix = screen.querySelector('.fix');
    if (fix) fix.style.opacity = '0';
  }

  /* The bracket, over the patch of water the islands have just
     broken. `box` is that patch in per cent of the frame, already
     projected to what the wide lens is showing it as -- see
     fixBox() in js/script.js, which owns that arithmetic because it
     is the side that knows where the islands were strewn. */
  function camFix(screen, box, ms) {
    var fix = screen && screen.querySelector('.fix');
    if (!fix || !box) return Promise.resolve();

    var inner = fix.querySelector('.fix__box');
    if (inner) {
      inner.style.left = box.l.toFixed(2) + '%';
      inner.style.top = box.t.toFixed(2) + '%';
      inner.style.width = (box.r - box.l).toFixed(2) + '%';
      inner.style.height = (box.b - box.t).toFixed(2) + '%';
    }

    fix.classList.add('is-on');
    return camAnim(fix, [{ opacity: 0 }, { opacity: 1 }],
                   ms || 620, 'cubic-bezier(.2, .8, .3, 1)');
  }

  /* And down. Long, and eased so that it leaves slowly, carries
     through the middle and settles for a good half-second at the
     bottom -- a descent that arrives at speed reads as a cut. */
  function camPush(screen, opts) {
    opts = opts || {};
    if (!screen) return Promise.resolve();

    var gen = camGen;
    var ms = opts.ms || 3400;
    var ease = opts.easing || 'cubic-bezier(.46, .02, .16, 1)';

    var plates = camPlates(screen);
    if (!plates.length) return Promise.resolve();

    var haze = screen.querySelector('.aerial');
    var fix = screen.querySelector('.fix');

    /* Every plate's live value FIRST, before a single animation is
       cancelled: the loiter is still running, and where its drift
       has got to is where the descent has to start from. */
    plates.forEach(function (p) { p.from = camNow(p.el, 'transform'); });
    var hazeFrom = haze ? camNow(haze, 'opacity') : null;
    var fixFrom = fix ? camNow(fix, 'opacity') : null;

    var jobs = plates.map(function (p) {
      camStop(p.el);
      p.el.style.willChange = 'transform';
      return camAnim(p.el, [
        { transform: p.from },
        { transform: 'scale(' + p.near + ')' }
      ], ms, ease);
    });

    if (haze) {
      camStop(haze);
      jobs.push(camAnim(haze, [
        { opacity: hazeFrom },
        { opacity: 0 }
      ], ms, 'cubic-bezier(.35, 0, .6, 1)'));
    }

    /* the bracket brightens as the lens commits, then lets go well
       before the islands are big enough for it to be a box drawn
       round the answer */
    if (fix) {
      jobs.push(camAnim(fix, [
        { opacity: fixFrom, offset: 0 },
        { opacity: 1, offset: 0.14 },
        { opacity: 0, offset: 0.48 },
        { opacity: 0, offset: 1 }
      ], ms, 'linear'));
    }

    return Promise.all(jobs).then(function () {
      /* A jump during the descent re-parks the lens before this
         lands, and clearing the world's transform then would strand
         the new shot at ground scale. */
      if (gen !== camGen) return;

      var world = screen.querySelector('.cam');
      if (world) {
        camStop(world);
        world.style.transform = '';
        world.style.transformOrigin = '';
      }
      plates.forEach(function (p) { p.el.style.willChange = ''; });
      if (fix) fix.classList.remove('is-on');
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
    camWide: camWide,
    camFix: camFix,
    camPush: camPush,
    sinkZones: sinkZones,
    confetti: confetti,
    confettiClear: confettiClear,
    swapScreens: swapScreens
  };
})(window);
