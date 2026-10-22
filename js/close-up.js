/* ============================================================
   Geo Drone — THE CLOSE-UP: the lens down onto the island, and back

   On the square's landing (screen 3) GO plays the landing as a
   cut-scene (js/square-landing.js, js/cinematic.js). Around it, the
   overhead lens comes down onto the island GO was pressed over, and
   goes back up again to exactly where it was:

     GO    the island under the craft is locked on
     in    a zoom in towards it (IN_MS), eased in and out and settling
           gently at the end; the rest of the sea and the other islands
           are carried out past the edges of the frame, never hidden.
           The lens then stops dead, and the shot is played over it.
     hold  once the shot says it has finished: a beat on the result
           (HOLD_MS)
     out   the same zoom backwards, from the island (OUT_MS), ending on
           the very transforms the plates wore before GO

   Nothing here starts, times or touches the shot itself: js/script.js
   plays it between zoomIn() and zoomOut(), and calls zoomOut() off the
   shot's own `done`, so a longer shot is never cut short.

   ── THE LENS ──────────────────────────────────────────────────
   A zoom about one point, put IN FRONT of whatever transform the
   camera's plates already wear (js/animation.js parks them; the lens
   never changes that), and taken off again at the end:

     .cam     the world -- the islands, the craft, the rocks and the
              fragments along the frame's edges
     .s3-bg   the sea's photograph

   so all of it moves as one picture. The live sea (js/reef-water.js)
   is drawn off those plates' boxes, so it zooms with them, and it is
   redrawn here straight after every move, in the same frame, so its
   shores never trail the land.

   The point is picked so that the island ends up in the middle of
   the frame -- or as near as it can be: the lens never sees past the
   edge of the frame it started from, where nothing is painted (the
   fragments on the left and right are cut off square at it). A zoom
   about a point inside the frame cannot see past it, and every point
   -- the island too -- slides straight out from that point as it
   grows, so the island glides towards the middle the whole way in.

   One clock, the frame's, frozen with the rest of the mission while
   the tab is away (js/lifecycle.js), and capped so a stall holds the
   move instead of jumping it on.

   ── THE CONTRACT ──────────────────────────────────────────────
   `site` is the screen, or a site on it (js/pages.js's siteOf).

     zoomIn(site, pad, opts)     the lens in on `pad`, the craft over
                                 it kept in frame too; resolves true
                                 once it has stopped, false if cut off
                                 (opts.alive() went false)
     zoomOut(site, opts)         the hold, then back out; resolves
                                 true once the plates wear exactly
                                 what they wore before zoomIn
     bare(site, fn)              fn run with the lens off, for code
                                 that measures the world on screen as
                                 the parked camera lays it out
                                 (js/failure.js's plan())
     stop(site)                  gone at once (the screen is reset)

   While the lens is down the screen wears .is-close, and the stick
   steps aside for it as it does for the shot (css/cinematic.css).
   ============================================================ */

(function (global) {
  'use strict';

  var IN_MS = 1300;
  var HOLD_MS = 400;
  var OUT_MS = 1250;

  /* how much of the frame the island and the craft over it fill once
     the lens is in, against the frame's side they are tightest in:
     the rest is water */
  var FILL = 0.4;
  var ZOOM_MIN = 1.3;
  var ZOOM_MAX = 2.6;

  var PLATES = ['.cam', '.s3-bg'];

  /* ease in and out, with a long soft settle at the end; the way out
     leaves the island a touch more slowly, so it is still the anchor
     as the pull back starts */
  var EASE_IN = bezier(0.42, 0, 0.2, 1);
  var EASE_OUT = bezier(0.5, 0, 0.2, 1);

  var lenses = new Map();       /* screen -> its lens, while it is down */

  function clamp(lo, v, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /* CSS's cubic-bezier(x1, y1, x2, y2), as a function of progress */
  function bezier(x1, y1, x2, y2) {
    function at(a, b, t) { return ((1 - 3 * b + 3 * a) * t + (3 * b - 6 * a)) * t * t + 3 * a * t; }
    function slope(a, b, t) { return 3 * (1 - 3 * b + 3 * a) * t * t + 2 * (3 * b - 6 * a) * t + 3 * a; }
    return function (x) {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      var t = x;
      for (var i = 0; i < 8; i++) {
        var d = at(x1, x2, t) - x;
        var s = slope(x1, x2, t);
        if (Math.abs(d) < 1e-6 || Math.abs(s) < 1e-6) break;
        t -= d / s;
      }
      if (!(t >= 0 && t <= 1) || Math.abs(at(x1, x2, t) - x) > 1e-4) {
        var lo = 0, hi = 1;
        for (var j = 0; j < 40; j++) {
          t = (lo + hi) / 2;
          if (at(x1, x2, t) < x) lo = t; else hi = t;
        }
      }
      return at(y1, y2, t);
    };
  }

  function paused() {
    return !!(global.GeoLife && global.GeoLife.isPaused && global.GeoLife.isPaused());
  }

  /* the screen, given it or a site on it (js/pages.js's siteOf) */
  function screenOf(site) {
    var n = site && (site.node || site);
    return n && n.closest ? n.closest('.screen') : null;
  }

  /* ---------------------------------------------------------- the aim */

  /* a box on the frame, in px from the screen's corner */
  function boxOf(el, frame) {
    var r = el.getBoundingClientRect();
    return [r.left - frame.left, r.top - frame.top, r.right - frame.left, r.bottom - frame.top];
  }

  /* the craft's hull, not its picture's box: the picture has room
     round it (--hull-l/t/r/b, per cent of the box -- js/pages.js) */
  function hullOf(ship, frame) {
    var b = boxOf(ship, frame);
    var w = b[2] - b[0], h = b[3] - b[1];
    var v = ['--hull-l', '--hull-t', '--hull-r', '--hull-b'].map(function (name, i) {
      var n = parseFloat(ship.style.getPropertyValue(name));
      return isFinite(n) ? n / 100 : (i < 2 ? 0 : 1);
    });
    return [b[0] + w * v[0], b[1] + h * v[1], b[0] + w * v[2], b[1] + h * v[3]];
  }

  /* Where the lens goes for `pad`: how far in (k) and the point it
     zooms about (p, as shares of the frame). The island's middle is
     put in the middle of the frame, with it and the craft over it
     filling FILL of the frame's tighter side -- and then the window
     is kept inside the frame, and p is the one point a zoom of k
     about which ends on exactly that window. */
  /* `ship`: the landing site's own craft -- a screen can carry more than
     one landing site (rounds sharing one sea, js/pages.js) */
  function aim(screen, pad, ship) {
    var frame = screen.getBoundingClientRect();
    var W = screen.clientWidth || frame.width || 1;
    var H = screen.clientHeight || frame.height || 1;

    var art = pad.querySelector('.env-platform') || pad.querySelector('.pad__img') || pad;
    var land = boxOf(art, frame);
    var c = [(land[0] + land[2]) / 2, (land[1] + land[3]) / 2];

    var all = land.slice();
    ship = ship || screen.querySelector('.site--b .ship');
    if (ship) {
      var hull = hullOf(ship, frame);
      all = [Math.min(all[0], hull[0]), Math.min(all[1], hull[1]),
             Math.max(all[2], hull[2]), Math.max(all[3], hull[3])];
    }
    var rx = Math.max(c[0] - all[0], all[2] - c[0], 1);
    var ry = Math.max(c[1] - all[1], all[3] - c[1], 1);

    var k = clamp(ZOOM_MIN, Math.min(FILL * W / (2 * rx), FILL * H / (2 * ry)), ZOOM_MAX);

    function about(mid, L) {
      var win = L / k;
      var lo = clamp(0, mid - win / 2, L - win);
      return lo * k / (k - 1) / L;
    }
    return { k: k, p: [about(c[0], W), about(c[1], H)] };
  }

  /* ---------------------------------------------------------- the plates */

  function platesOf(screen) {
    var out = [];
    PLATES.forEach(function (sel) {
      var el = screen.querySelector(sel);
      if (el && el.parentNode === screen) out.push({ el: el, base: el.style.transform });
    });
    return out;
  }

  /* where each plate's box and transform origin sit on the frame:
     its layout, so read once, and again after a resize */
  function measure(lens) {
    lens.W = lens.screen.clientWidth || 1;
    lens.H = lens.screen.clientHeight || 1;
    lens.plates.forEach(function (pl) {
      var o = (global.getComputedStyle(pl.el).transformOrigin || '0 0').split(' ').map(parseFloat);
      pl.at = [pl.el.offsetLeft + (o[0] || 0), pl.el.offsetTop + (o[1] || 0)];
    });
  }

  /* The lens at zoom k: every plate scaled k about the frame point p,
     in front of its own transform. At 1 it is the plate's own
     transform again, to the character. Then the sea, off the plates
     as they now are. */
  function apply(lens, k) {
    lens.k = k;
    var px = lens.p[0] * lens.W, py = lens.p[1] * lens.H;
    lens.plates.forEach(function (pl) {
      if (k === 1) {
        pl.el.style.transform = pl.base;
        return;
      }
      var tx = (1 - k) * (px - pl.at[0]), ty = (1 - k) * (py - pl.at[1]);
      pl.el.style.transform = 'translate(' + tx.toFixed(2) + 'px, ' + ty.toFixed(2) + 'px) ' +
                              'scale(' + k.toFixed(5) + ') ' + (pl.base || '');
    });
    var sea = global.GeoReefWater;
    if (sea && sea.redraw) sea.redraw(lens.screen);
  }

  /* Run `ms` of the lens's clock, calling step(u) every frame with u
     its share done (the last call is always 1). Resolves true at the
     end, false if it was cut off. */
  function run(lens, ms, alive, step) {
    return new Promise(function (resolve) {
      var t = 0, last = 0;
      lens.job = { resolve: resolve };
      function frame(now) {
        lens.raf = 0;
        if (lenses.get(lens.screen) !== lens) return;
        if (alive && !alive()) { stop(lens.screen); return; }
        var dt = last ? Math.min(50, now - last) : 0;
        last = now;
        if (!paused()) t += dt;
        var u = ms > 0 ? Math.min(1, t / ms) : 1;
        if (step) step(u);
        if (u >= 1) {
          lens.job = null;
          resolve(true);
          return;
        }
        lens.raf = global.requestAnimationFrame(frame);
      }
      lens.raf = global.requestAnimationFrame(frame);
    });
  }

  /* zoom from k0 to k1, eased, at an even rate on a log scale -- the
     way a zoom looks even to the eye */
  function zoom(lens, k0, k1, ms, ease, alive) {
    var a = Math.log(k0), b = Math.log(k1);
    return run(lens, ms, alive, function (u) {
      apply(lens, u >= 1 ? k1 : Math.exp(a + (b - a) * ease(u)));
    });
  }

  /* ---------------------------------------------------------- the moves */

  function zoomIn(site, pad, opts) {
    opts = opts || {};
    var screen = screenOf(site);
    if (!screen || !pad) return Promise.resolve(true);
    stop(screen);

    var plates = platesOf(screen);
    if (!plates.length) return Promise.resolve(true);

    var to = aim(screen, pad, site && site.el && site.el.ship);
    var lens = { screen: screen, plates: plates, p: to.p, k: 1, K: to.k, raf: 0, job: null };
    measure(lens);
    lenses.set(screen, lens);
    screen.classList.add('is-close');

    return zoom(lens, 1, to.k, opts.ms || IN_MS, EASE_IN, opts.alive);
  }

  function zoomOut(site, opts) {
    opts = opts || {};
    var screen = screenOf(site);
    var lens = lenses.get(screen);
    if (!lens) return Promise.resolve(true);
    if (lens.job) return Promise.resolve(false);   /* already moving */

    var hold = opts.hold == null ? HOLD_MS : opts.hold;
    return run(lens, hold, opts.alive, null).then(function (ok) {
      if (!ok || lenses.get(screen) !== lens) return false;
      return zoom(lens, lens.k, 1, opts.ms || OUT_MS, EASE_OUT, opts.alive);
    }).then(function (ok) {
      if (!ok || lenses.get(screen) !== lens) return false;
      finish(lens);
      return true;
    });
  }

  /* the plates back in what they wore, exactly, and the lens gone */
  function finish(lens) {
    if (lens.raf) global.cancelAnimationFrame(lens.raf);
    lens.raf = 0;
    lens.plates.forEach(function (pl) { pl.el.style.transform = pl.base; });
    lens.screen.classList.remove('is-close');
    if (lenses.get(lens.screen) === lens) lenses.delete(lens.screen);
    var sea = global.GeoReefWater;
    if (sea && sea.redraw) sea.redraw(lens.screen);
  }

  function stop(site) {
    var lens = lenses.get(screenOf(site));
    if (!lens) return;
    var job = lens.job;
    lens.job = null;
    finish(lens);
    if (job) job.resolve(false);
  }

  /* fn() with the plates as the parked camera has them, and the lens
     back on the moment it returns: nothing is painted in between */
  function bare(site, fn) {
    var lens = lenses.get(screenOf(site));
    if (!lens || lens.k === 1) return fn();
    lens.plates.forEach(function (pl) { pl.el.style.transform = pl.base; });
    try {
      return fn();
    } finally {
      apply(lens, lens.k);
    }
  }

  /* a resized frame: the same point, as a share of the new one */
  global.addEventListener('resize', function () {
    lenses.forEach(function (lens) {
      measure(lens);
      apply(lens, lens.k);
    });
  });

  global.GeoCloseUp = {
    zoomIn: zoomIn,
    zoomOut: zoomOut,
    bare: bare,
    stop: stop
  };
})(window);
