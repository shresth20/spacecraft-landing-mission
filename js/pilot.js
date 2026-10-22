/* ============================================================
   Geo Drone — THE HELM: every landing, flown by hand

   The shape questions are taps; the landings are flown. On every
   landing site the player flies the craft: it hovers in the middle
   of the frame with a nozzle on each side, the three islands are
   strewn round it
   (strewPilot in js/pages.js), and the joystick in the bottom
   right — or the arrow keys, or WASD — flies it any way round the
   compass. The stick is analog: the knob is dragged off the centre
   of its ring, and how far it goes is how hard the craft is pushed.
   The craft never turns; it only slides, the way the knob is held.
   The push comes from the nozzle OPPOSITE the way it should go —
   two of them on a diagonal, each burning as hard as its share of
   the push. At rest all four are stowed in the hull and the craft
   simply floats; pushed left, the right-hand nozzle runs out, the
   burn catches once it is out, the push arrives a beat after that,
   and the craft drifts on after the stick is let go, slowing as it
   goes, while the nozzle is drawn back in.

   Let go with the craft square over an island — the hull covering
   at least COVER of it — and once it has settled, the knob gives way
   to GO on the ring and the island's coast is traced round. GO
   lands it there. Dragging the stick again (from GO itself, or the
   ring) or a key takes it back to flying. Only clipping an island's
   corner marks it, and nothing more. What happens when
   it comes down is the same geometry every landing uses — js/script.js
   hands the island to onRoundAreaPick() exactly as a tap would have.

   Three hearts. A wrong island costs one, on the frame the craft
   hits the rock or the water, and the craft comes back to the middle
   of the frame to try again. With the last one gone, the autopilot
   flies it to the island that fits (flyTo), on the same four jets.

   ── WHAT THIS FILE OWNS ─────────────────────────────────────────
     · the flight: position, velocity, which jets are lit — written
       onto .ship as its individual `translate` (so every transform
       the landing chain in css/failure.css puts on the same element
       composes on top of it rather than replacing it), and `is-out`
       / `is-lit` on each nozzle that is run out / burning, and how
       hard it burns (`--pow`); and `is-flying` on .ship while any
       nozzle is out or the craft is still under way, which is what
       takes the dimension callouts off it (css/pilot.css) so it flies
       clean, and brings them back once it has settled
     · the joystick and the keys
     · which island the craft is over, and GO
     · the hearts
     · the autopilot

   It knows nothing about shapes or areas. The flow — when the helm
   is handed over, what a landing means, what is said — is js/script.js.

   ── COORDINATES ─────────────────────────────────────────────────
   Everything here is in the SITE's layout box (offsetLeft / offsetTop),
   which with the lens down on site B is the frame itself. The craft
   and the islands are both inside the site, so neither the camera's
   transform nor the screen's entrance scale ever enters the sums.
   ============================================================ */

(function (global) {
  'use strict';

  var doc = document;

  /* ---------------------------------------------------------- the feel

     In shares of the frame's SHORTER side, so a tap carries the
     craft the same part of the sea on a phone as on a monitor. Tuned
     so a tap nudges it about a tenth of that — well under the
     width of the smallest island, so it can always be put down on
     one — a held control crosses half the frame in about two
     seconds, unhurried, and a craft that has been let go is at rest
     within about a second. */
  var THRUST = 1.8;          /* per second², while a jet is pushing   */
  var DRAG = 2.6;            /* per second, proportional              */
  var GRIP = 0.26;           /* per second², a constant brake once the
                                jets are cut, so it does come to rest */
  var TOP = 0.44;            /* per second, never faster than this    */
  var SETTLE = 0.04;         /* per second: slow enough for GO to come
                                up -- the last of the drift, which the
                                grip has out of it a beat later       */

  /* A little of the craft's travel is handed to the camera. The
     world moves the other way, so islands ahead ease towards the
     craft instead of the whole flight reading as a token sliding
     over a still picture. This is visual only: the craft, hull and
     islands keep their original layout coordinates, which leaves
     every landing and collision calculation below untouched.

     The live water canvas is moved with the world so its underwater
     rocks and shores stay registered with the dry land. The cap is
     well inside the ocean plate's and that canvas's 8% overscan
     (css/reef.css), and the edge fragments carry a mirrored
     continuation past their straight side (js/reef.js), so no edge of
     anything can enter the frame. Kept slow and small on purpose: the
     world drifts behind the craft rather than chasing it. */
  var CAMERA_FOLLOW = 0.1;
  var CAMERA_RESPONSE = 2.6; /* per second: soft follow, no hard lock */
  var CAMERA_LIMIT = 0.045;  /* no more than 4.5% of either frame axis */

  /* How much of the island the hull has to cover before it will
     land on it -- the hull as drawn, its corners off `data-hull`, so
     a triangle is measured as a triangle and not as its box.
     Measured against whichever of the two is SMALLER:
     an island bigger than the craft (the 54 against a 36 hull) can
     never be four-fifths covered, so there it is four-fifths of the
     hull that has to be over land — the craft squarely on it either
     way, and the too-big island still a landing the player can make
     and learn from. */
  var COVER = 0.8;

  var DEPLOY_MS = 170;       /* the nozzle runs out before it is lit --
                                the bell's transition in css/pilot.css */
  var IGNITE_MS = 60;        /* the flame shows before the push       */
  var MIN_BURN_MS = 130;     /* a tap is a short burn, not a flicker  */
  var STOW_MS = 240;         /* a cut flame dies back before the nozzle
                                is drawn in; pressed again inside this,
                                it relights without running out again */

  /* how far the bell stands off the hull, in box units -- the craft
     is kept on screen by its nozzles, not by its hull */
  var BELL = 0.075;
  var EDGE = 6;              /* px of daylight at the frame's edge    */

  /* The way in (arrive): from far off, out past the frame's edge on
     a bearing picked at random, onto the hover point, on the
     craft's own jets. */
  var ARRIVE_MS = 2500;      /* out of sight to on its station, for a
                                run in 0.8 of the frame's shorter
                                side; a longer one takes a little
                                longer, so the speed holds            */
  var CRUISE = 0.4;          /* the share of that spent running in
                                under power; the rest is the braking
                                burn                                  */
  var ALTITUDE = 0.2;        /* how much bigger it starts: higher up,
                                nearer the lens -- smaller is lower,
                                as the landing has it                 */
  var FAR = 0.08;            /* how far past the frame's edge it
                                starts, in shares of its shorter side */
  var TURN = 70;             /* degrees: never in on nearly the
                                bearing the last one came in on       */

  /* the nozzle that has to burn to go each way: the one on the
     opposite side of the hull */
  var JET = { left: 'r', right: 'l', up: 'b', down: 't' };
  var BACK = { left: 'right', right: 'left', up: 'down', down: 'up' };
  var AXIS = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };

  /* and the other way round: which way each nozzle pushes the craft */
  var PUSH = { l: [1, 0], r: [-1, 0], t: [0, 1], b: [0, -1] };

  /* ---------------------------------------------------------- the stick

     In shares of the stick's width. THROW is how far the knob's
     centre goes from the ring's: with the knob 48% of the width
     (css/pilot.css), that puts its rim on the ring's bright rim at
     full throw. Inside DEAD of the throw the stick does nothing, so
     a resting thumb is not a burn. A nozzle is only run out for a
     share of the push above LIGHT -- the stick held a hair off
     straight up does not light a side jet for nothing. GO_SLOP is
     how far a finger put down on GO may wander and still be a tap
     on it; past that, it is the stick being taken again. */
  var THROW = 0.22;
  var DEAD = 0.12;
  var LIGHT = 0.08;
  var GO_SLOP = 0.1;

  /* how long the controls sit untouched, with the craft at rest,
     before the hand comes to show how (THE HAND, below) -- the same
     wait as the shape question's (js/script.js) */
  var NUDGE_MS = 2500;

  var KEYS = {
    ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
    a: 'left', d: 'right', w: 'up', s: 'down',
    A: 'left', D: 'right', W: 'up', S: 'down'
  };

  /* the helm whose controls are live -- one at a time, for the keys */
  var live = null;

  function clock() {
    return global.performance && global.performance.now
      ? global.performance.now() : Date.now();
  }

  function reduced() {
    return !!(global.matchMedia &&
              global.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function wait(ms) {
    return global.GeoLife
      ? global.GeoLife.wait(ms)
      : new Promise(function (r) { setTimeout(r, ms); });
  }

  function clamp(lo, v, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function sound(n) {
    var A = global.GeoAudio;
    if (A && A.thrust) A.thrust(n);
  }

  /* GO's tap tick: the game-wide one (onTap in js/script.js) never
     hears it, because the press is read off the stick's pointer and
     not off a click on the button */
  function tap() {
    var A = global.GeoAudio;
    if (A && A.sfx) A.sfx('click', { volume: 0.4, keep: true });
  }


  /* ============================================================
     THE FRAME — measured when the helm is handed over, and again
     after a resize. Nothing moves in it while the craft flies.
     ============================================================ */

  function measure(h) {
    var ship = h.ship;
    var site = h.site.node;
    var W = site.clientWidth || 1;
    var H = site.clientHeight || 1;
    var w = ship.offsetWidth || 1;
    var cs = global.getComputedStyle(ship);
    var scx = parseFloat(cs.getPropertyValue('--scx')) || 0.5;
    var scy = parseFloat(cs.getPropertyValue('--scy')) || 0.5;

    function hull(name, fallback) {
      var v = parseFloat(ship.style.getPropertyValue(name));
      return isFinite(v) ? v / 100 : fallback;
    }
    var hl = hull('--hull-l', 0.18), ht = hull('--hull-t', 0.2);
    var hr = hull('--hull-r', 0.82), hb = hull('--hull-b', 0.8);

    /* how far a run-out bell stands off the hull, for this craft's
       bell: BELL is the square's, whose nozzle is 21% of its box */
    var nzw = hull('--nozzle-w', 0.21);
    var bell = BELL * nzw / 0.21;

    /* the hover point: the craft's centre of area with no offset */
    var hx = ship.offsetLeft + scx * w;
    var hy = ship.offsetTop + scy * w;

    /* The hull's corners (`data-hull`, per cent of the box), from the
       hover point. A hull drawn as a plain box -- the square -- has
       none written, and its extent is its outline. */
    var n = (ship.getAttribute('data-hull') || '').trim().split(/\s+/).map(Number);
    var outline = [];
    for (var c = 0; c + 1 < n.length; c += 2) {
      if (isFinite(n[c]) && isFinite(n[c + 1])) {
        outline.push([(n[c] / 100 - scx) * w, (n[c + 1] / 100 - scy) * w]);
      }
    }
    if (outline.length < 3) {
      outline = [[hl, ht], [hr, ht], [hr, hb], [hl, hb]].map(function (p) {
        return [(p[0] - scx) * w, (p[1] - scy) * w];
      });
    }

    /* the islands in play, as polygons in the site's box */
    var pads = h.site.el.padList.filter(function (pad) {
      return !pad.hidden && pad.dataset.area != null;
    }).map(function (pad) {
      var pw = pad.offsetWidth;
      var l = pad.offsetLeft;
      var t = pad.offsetTop;
      var n = (pad.style.getPropertyValue('--clip').match(/-?[\d.]+(?=%)/g) || []).map(Number);
      var poly = [];
      for (var i = 0; i + 1 < n.length; i += 2) {
        poly.push([l + n[i] / 100 * pw, t + n[i + 1] / 100 * pw]);
      }
      return {
        pad: pad,
        poly: poly,
        area: polyArea(poly),
        cx: l + (parseFloat(pad.style.getPropertyValue('--pcx')) || 0.5) * pw,
        cy: t + (parseFloat(pad.style.getPropertyValue('--pcy')) || 0.5) * pw
      };
    });

    /* the knob's full throw, in px */
    h.throwPx = THROW * (h.stick.offsetWidth || 1);

    h.geo = {
      W: W,
      H: H,
      S: Math.min(W, H),
      hx: hx,
      hy: hy,
      /* how far the offset may go before a nozzle leaves the frame */
      minX: EDGE + (scx - hl + bell) * w - hx,
      maxX: W - EDGE - (hr - scx + bell) * w - hx,
      minY: EDGE + (scy - ht + bell) * w - hy,
      maxY: H - EDGE - (hb - scy + bell) * w - hy,
      /* how far the craft reaches from its centre of area, out to
         the farthest corner, bell and all -- what has to clear the
         frame's edge for it to be out of sight (arrive) */
      reach: w * Math.max(
        Math.hypot(scx - hl + bell, scy - ht + bell),
        Math.hypot(hr - scx + bell, scy - ht + bell),
        Math.hypot(scx - hl + bell, hb - scy + bell),
        Math.hypot(hr - scx + bell, hb - scy + bell)),
      /* the painted hull's outline, from the hover point */
      hull: outline,
      hullArea: polyArea(outline),
      pads: pads
    };
    return h.geo;
  }

  function polyArea(poly) {
    var a = 0;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      a += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]);
    }
    return Math.abs(a) / 2;
  }

  /* The part of `poly` inside `clip`: the polygon cut by each of the
     clip's sides in turn (Sutherland-Hodgman), which needs only the
     clip to be convex -- and every hull in the mission is. Either
     winding: the side of each edge that is "in" is the side the
     clip's own area is on. */
  function clipConvex(poly, clip) {
    var a = 0, i, j;
    for (i = 0, j = clip.length - 1; i < clip.length; j = i++) {
      a += (clip[j][0] + clip[i][0]) * (clip[j][1] - clip[i][1]);
    }
    var turn = a < 0 ? 1 : -1;

    var out = poly;
    for (var e = 0; e < clip.length && out.length; e++) {
      var c0 = clip[e];
      var c1 = clip[(e + 1) % clip.length];
      var side = function (p) {
        return turn * ((c1[0] - c0[0]) * (p[1] - c0[1]) - (c1[1] - c0[1]) * (p[0] - c0[0]));
      };
      var src = out;
      out = [];
      for (i = 0; i < src.length; i++) {
        var p = src[i];
        var q = src[(i + 1) % src.length];
        var sp = side(p), sq = side(q);
        if (sp >= 0) out.push(p);
        if ((sp >= 0) !== (sq >= 0)) {
          var u = sp / (sp - sq);
          out.push([p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u]);
        }
      }
    }
    return out;
  }

  /* how far the hull covers the island, against COVER */
  function cover(h, rec) {
    var g = h.geo;
    var x = g.hx + h.x;
    var y = g.hy + h.y;
    var hull = g.hull.map(function (p) { return [x + p[0], y + p[1]]; });
    var over = polyArea(clipConvex(rec.poly, hull));
    return over / (Math.min(rec.area, g.hullArea) || 1);
  }

  function inside(pt, poly) {
    var x = pt[0], y = pt[1], hit = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  }

  /* the island the craft's centre is over, as its record */
  function recUnder(h) {
    var g = h.geo;
    var pt = [g.hx + h.x, g.hy + h.y];
    for (var i = 0; i < g.pads.length; i++) {
      if (inside(pt, g.pads[i].poly)) return g.pads[i];
    }
    return null;
  }

  function padUnder(h) {
    var rec = recUnder(h);
    return rec ? rec.pad : null;
  }


  /* ============================================================
     THE STICK AND THE KEYS
     ============================================================ */

  /* the push asked for, as a vector no longer than 1: the stick's,
     with the keys' laid on top of it */
  function input(h) {
    var x = h.aim[0], y = h.aim[1];
    for (var dir in h.keys) {
      x += AXIS[dir][0];
      y += AXIS[dir][1];
    }
    var n = Math.hypot(x, y);
    return n > 1 ? [x / n, y / n] : [x, y];
  }

  /* anything held: the stick -- but not a finger resting on GO -- or
     a key */
  function holding(h) {
    if (h.grab && !h.grab.onGo) return true;
    for (var dir in h.keys) return true;
    return false;
  }

  /* the knob, in px off the ring's centre -- its individual
     `translate`, so the press's `scale` (css/pilot.css) composes on
     top of it */
  function knobTo(h, x, y) {
    if (!h.knob) return;
    var t = x.toFixed(1) + 'px ' + y.toFixed(1) + 'px';
    if (t !== h.knobAt) {
      h.knob.style.translate = t;
      h.knobAt = t;
    }
  }

  /* The knob under the finger, held inside its throw, and the push
     that asks for: its direction, and how far out it is past DEAD.
     `x`, `y` are the pointer in the viewport; the grab has the
     ring's centre there, and the viewport-to-layout ratio for a
     stick that is being scaled in. */
  function aimAt(h, x, y) {
    var g = h.grab;
    var dx = x - g.cx;
    var dy = y - g.cy;
    var d = Math.hypot(dx, dy);
    if (d > g.max) { dx *= g.max / d; dy *= g.max / d; d = g.max; }
    knobTo(h, dx * g.k, dy * g.k);

    var m = d / g.max;
    var p = m <= DEAD ? 0 : (m - DEAD) / (1 - DEAD);
    h.aim = d ? [dx / d * p, dy / d * p] : [0, 0];
    wake(h);
  }

  /* the finger off the stick: the knob springs home */
  function letGoStick(h) {
    var g = h.grab;
    if (!g) return;
    h.grab = null;
    h.aim = [0, 0];
    h.stick.classList.remove('is-held');
    if (h.goBtn) h.goBtn.classList.remove('is-down');
    knobTo(h, 0, 0);
    try { h.stick.releasePointerCapture(g.id); } catch (err) { /* already gone */ }
    wake(h);
  }

  function press(h, dir) {
    if (!h.armed || !AXIS[dir]) return;
    h.keys[dir] = true;
    wake(h);
  }

  function release(h, dir) {
    delete h.keys[dir];
    wake(h);
  }

  /* everything let go of, and every burn cut where it stands */
  function releaseAll(h) {
    h.keys = {};
    letGoStick(h);
    h.aim = [0, 0];
    for (var s in h.noz) {
      h.noz[s].on = false;
      h.noz[s].until = 0;
    }
    paint(h);
  }


  /* ============================================================
     THE JETS
     ============================================================ */

  /* Which nozzles the push asks for, and how hard each one burns:
     a nozzle's share is the push along the way it fires the craft,
     so a diagonal is two nozzles, each at its share. One that has
     just been asked for burns at least MIN_BURN_MS from when its
     fire catches -- which for a stowed nozzle is after it has run
     out -- so a flick of the stick or a tap on a key is a short burn,
     not a flicker. */
  function steer(h, now) {
    var v = input(h);
    var want = {};
    for (var s in h.noz) {
      var n = h.noz[s];
      var p = v[0] * PUSH[s][0] + v[1] * PUSH[s][1];
      var on = h.armed && p > LIGHT;
      if (on && !n.on) {
        n.until = (n.out ? Math.max(now, n.ready) : now + DEPLOY_MS) +
                  IGNITE_MS + MIN_BURN_MS;
      }
      n.on = on;
      if (on) n.pow = p;
      if (on || now < n.until) want[s] = true;
    }
    return want;
  }

  /* Which nozzles are out and which are lit, onto the craft, and
     how hard each lit one burns. Written only when it changes.

     A nozzle that is wanted runs out first and is lit DEPLOY_MS
     later; one that is no longer wanted is cut at once and drawn in
     STOW_MS later. Those two clocks are kept here, per nozzle, so
     every caller -- the stick, the loop, the autopilot -- gets the
     same order; and a timer brings paint() back for the next step,
     so a nozzle is drawn in even after the loop has stopped. */
  function paint(h) {
    var now = clock();
    var flight = h.auto || h.arrival;
    var want = h.want = flight ? flight.want : steer(h, now);
    var s;

    var lit = {};
    var next = Infinity;
    for (s in h.noz) {
      var n = h.noz[s];
      if (want[s]) {
        n.stow = 0;
        if (!n.out) { n.out = true; n.ready = now + DEPLOY_MS; }
        if (now >= n.ready) lit[s] = true;
        else next = Math.min(next, n.ready);
      } else if (n.out) {
        if (!n.stow) n.stow = now + STOW_MS;
        if (now >= n.stow) { n.out = false; n.stow = 0; }
        else next = Math.min(next, n.stow);
      }
    }

    var okey = Object.keys(h.noz).filter(function (k) { return h.noz[k].out; }).sort().join('');
    if (okey !== h.outKey) {
      for (s in h.jets) h.jets[s].classList.toggle('is-out', h.noz[s].out);
      h.outKey = okey;
    }

    /* under way: a nozzle out, or still sliding faster than GO would
       accept. The callouts go while it is, and come back when it is
       not -- the same moment GO comes up over an island. */
    setFlying(h, okey !== '' || (!!h.geo && Math.hypot(h.vx, h.vy) > SETTLE * h.geo.S));

    var key = Object.keys(lit).sort().join('');
    if (key !== h.litKey) {
      for (s in h.jets) h.jets[s].classList.toggle('is-lit', !!lit[s]);
      h.litKey = key;
      sound(key.length);
    }

    /* the flame's length: a stick pushed a little is a short burn,
       never less than 0.4 of the full one so it still reads as fire.
       In twentieths, so a steady thumb writes nothing. */
    for (s in lit) {
      var pw = flight ? (flight.pow && flight.pow[s]) || 1 : Math.round((0.4 + 0.6 * Math.min(1, h.noz[s].pow)) * 20) / 20;
      if (pw !== h.noz[s].shown) {
        h.jets[s].style.setProperty('--pow', pw);
        h.noz[s].shown = pw;
      }
    }

    if (next !== h.nozDue) {
      clearTimeout(h.nozTimer);
      h.nozTimer = 0;
      h.nozDue = next;
      if (next < Infinity) {
        h.nozTimer = setTimeout(function () {
          h.nozTimer = 0;
          h.nozDue = Infinity;
          paint(h);
        }, Math.max(0, next - now) + 1);
      }
    }
  }


  /* ============================================================
     GO

     The stick let go with the craft settled square over an island,
     covering at least COVER of it, is the player putting it there.
     The knob gives way to GO on the ring, the coast is traced round
     (css/pilot.css), and GO hands the island to the flow. Taking the
     stick or a key again, or the craft drifting off, takes GO back.
     ============================================================ */

  function setUnder(h, pad) {
    if (pad === h.under) return;
    if (h.under) h.under.classList.remove('is-under');
    h.under = pad;
    if (pad) pad.classList.add('is-under');
  }

  function lock(h, pad) {
    if (h.lockPad === pad) return;
    unlock(h);
    h.lockPad = pad;
    pad.classList.add('is-locking');
  }

  function unlock(h) {
    if (!h.lockPad) return;
    h.lockPad.classList.remove('is-locking');
    h.lockPad = null;
  }

  function showGo(h, pad) {
    h.go = pad;
    lock(h, pad);
    h.stick.classList.add('is-go');
    if (h.goBtn) {
      h.goBtn.tabIndex = 0;
      h.goBtn.removeAttribute('aria-hidden');
    }
  }

  function hideGo(h) {
    if (!h.go) return;
    h.go = null;
    unlock(h);
    h.stick.classList.remove('is-go');
    if (h.goBtn) {
      h.goBtn.classList.remove('is-down');
      if (doc.activeElement === h.goBtn) h.goBtn.blur();
      h.goBtn.tabIndex = -1;
      h.goBtn.setAttribute('aria-hidden', 'true');
    }
  }

  /* GO pressed: down on the island it is showing for */
  function go(h) {
    var pad = h.go;
    if (!h.armed || !pad) return;
    tap();
    /* taken before disarm(), which lets go of it */
    var land = h.onLand;
    disarm(h.site);
    if (land) land(pad);
  }


  /* ============================================================
     THE HAND

     The controls live, and nothing touched or moving for NUDGE_MS:
     the hand (js/pages.js) comes down on the knob and drags it out
     towards the nearest island and back, over and over -- or, with
     GO up, taps GO. Only the knob goes with it, never the craft
     (css/pilot.css). The stick or a key taken puts it away, and the
     wait starts over. Which island is nearest says nothing about
     which one fits: that is still the player's to work out.
     ============================================================ */

  function nudge(h, mode) {
    if (mode === h.nudging) return;
    h.nudging = mode;
    if (mode === 'fly') {
      var d = towards(h);
      h.stick.style.setProperty('--nudge-x', (d[0] * h.throwPx).toFixed(1) + 'px');
      h.stick.style.setProperty('--nudge-y', (d[1] * h.throwPx).toFixed(1) + 'px');
    }
    h.stick.classList.toggle('is-nudge-fly', mode === 'fly');
    h.stick.classList.toggle('is-nudge-go', mode === 'go');
  }

  /* the way to the nearest island from the craft, as a unit vector */
  function towards(h) {
    var g = h.geo || measure(h);
    var x = g.hx + h.x;
    var y = g.hy + h.y;
    var best = null, bd = Infinity;
    g.pads.forEach(function (p) {
      var d = Math.hypot(p.cx - x, p.cy - y);
      if (d < bd) { bd = d; best = p; }
    });
    if (!best || !bd) return [0, -1];
    return [(best.cx - x) / bd, (best.cy - y) / bd];
  }


  /* ============================================================
     THE LOOP — one frame of flight
     ============================================================ */

  function wake(h) {
    if (h.raf) return;
    h.last = clock();
    h.raf = global.requestAnimationFrame(function tick() {
      var now = clock();
      /* capped, so a frame that took a second (a hidden tab, a
         stall) does not fling the craft across the sea */
      var dt = Math.min(0.05, Math.max(0, (now - h.last) / 1000));
      h.last = now;
      h.raf = 0;
      if (frame(h, dt, now)) h.raf = global.requestAnimationFrame(tick);
    });
  }

  function sleep(h) {
    if (h.raf) global.cancelAnimationFrame(h.raf);
    h.raf = 0;
  }

  function place(h) {
    var t = h.x.toFixed(1) + 'px ' + h.y.toFixed(1) + 'px';
    if (t !== h.placed) {
      h.ship.style.translate = t;
      h.placed = t;
    }
  }

  /* The existing camera flight owns `transform`; individual
     `translate` is deliberately used here so the two motions compose
     rather than overwrite each other. The same is true of the sea's
     own swell animations. */
  function cameraPlates(h) {
    var screen = h.site.node.closest('.screen');
    if (!screen) return [];
    h.cameraScreen = screen;
    h.cameraWaiting = screen.hasAttribute('data-reef') && !screen.querySelector('.reef-water');
    var list = [screen.querySelector('.cam')];
    Array.prototype.forEach.call(
      screen.querySelectorAll('.s3-bg, .sea__deep, .sea__swell, .reef-water'),
      function (el) { list.push(el); }
    );
    return list.filter(function (el, i) { return el && list.indexOf(el) === i; });
  }

  function paintCamera(h) {
    var t = h.cameraX.toFixed(1) + 'px ' + h.cameraY.toFixed(1) + 'px';
    if (t === h.cameraAt) return;
    h.cameraPlates.forEach(function (el) { el.style.translate = t; });
    h.cameraAt = t;
  }

  function stepCamera(h, dt, snap) {
    if (!h.cameraPlates.length) h.cameraPlates = cameraPlates(h);
    /* The live-water pass is mounted after its images decode. A fast
       debug jump can hand over the helm first; adopt that late canvas
       on the first frame it exists. */
    if (h.cameraWaiting) {
      var water = h.cameraScreen && h.cameraScreen.querySelector('.reef-water');
      if (water) {
        h.cameraPlates.push(water);
        water.style.translate = h.cameraX.toFixed(1) + 'px ' + h.cameraY.toFixed(1) + 'px';
        h.cameraWaiting = false;
      }
    }
    var g = h.geo || measure(h);
    var tx = reduced() ? 0 : clamp(-g.W * CAMERA_LIMIT, -h.x * CAMERA_FOLLOW, g.W * CAMERA_LIMIT);
    var ty = reduced() ? 0 : clamp(-g.H * CAMERA_LIMIT, -h.y * CAMERA_FOLLOW, g.H * CAMERA_LIMIT);
    var k = snap ? 1 : 1 - Math.exp(-CAMERA_RESPONSE * dt);
    h.cameraX += (tx - h.cameraX) * k;
    h.cameraY += (ty - h.cameraY) * k;
    if (Math.abs(h.cameraX) < 0.02) h.cameraX = 0;
    if (Math.abs(h.cameraY) < 0.02) h.cameraY = 0;
    paintCamera(h);
  }

  function resetCamera(h) {
    h.cameraPlates = cameraPlates(h);
    h.cameraPlates.forEach(function (el) { el.style.removeProperty('translate'); });
    h.cameraX = h.cameraY = 0;
    h.cameraAt = null;
  }

  function setFlying(h, on) {
    if (on === h.flying) return;
    h.flying = on;
    h.ship.classList.toggle('is-flying', on);
  }

  /* Returns whether there is anything left to animate. */
  function frame(h, dt, now) {
    var g = h.geo || measure(h);
    var S = g.S;

    if (h.arrival) return arriveFrame(h, dt);
    if (h.auto) return autoFrame(h, dt);

    /* --- the jets: each pushes once its nozzle is out and its fire
       has caught, as hard as its share of the push --- */
    paint(h);
    var ax = 0, ay = 0, any = false, s;
    for (s in h.want) {
      any = true;
      var nz = h.noz[s];
      if (nz.out && now >= nz.ready + IGNITE_MS) {
        ax += PUSH[s][0] * nz.pow;
        ay += PUSH[s][1] * nz.pow;
      }
    }

    /* the keys move the knob too, so the stick shows what is flying
       the craft whichever hand it is */
    if (!h.grab) {
      var kv = input(h);
      knobTo(h, kv[0] * (h.throwPx || 0), kv[1] * (h.throwPx || 0));
    }

    /* a diagonal is two jets, not a faster craft */
    var n = Math.hypot(ax, ay);
    if (n > 1) { ax /= n; ay /= n; }

    h.vx += ax * THRUST * S * dt;
    h.vy += ay * THRUST * S * dt;

    var k = Math.exp(-DRAG * dt);
    h.vx *= k;
    h.vy *= k;

    var sp = Math.hypot(h.vx, h.vy);
    if (!ax && !ay) {
      var grip = GRIP * S * dt;
      if (sp <= grip) { h.vx = 0; h.vy = 0; sp = 0; }
      else { h.vx -= h.vx / sp * grip; h.vy -= h.vy / sp * grip; sp -= grip; }
    }
    if (sp > TOP * S) {
      h.vx *= TOP * S / sp;
      h.vy *= TOP * S / sp;
    }

    h.x += h.vx * dt;
    h.y += h.vy * dt;

    /* --- the frame's edge: stop dead against it, with a little give --- */
    if (h.x < g.minX) { h.x = g.minX; if (h.vx < 0) h.vx *= -0.2; }
    if (h.x > g.maxX) { h.x = g.maxX; if (h.vx > 0) h.vx *= -0.2; }
    if (h.y < g.minY) { h.y = g.minY; if (h.vy < 0) h.vy *= -0.2; }
    if (h.y > g.maxY) { h.y = g.maxY; if (h.vy > 0) h.vy *= -0.2; }

    place(h);
    stepCamera(h, dt, false);

    /* --- what it is over, and whether GO is up: the stick let go,
       the craft settled, and covering enough of it. Once up, it
       stays until the craft is a little short of COVER, so a craft
       that settles right on the line does not flicker it. --- */
    var rec = recUnder(h);
    var pad = rec ? rec.pad : null;
    setUnder(h, pad);

    var held = holding(h);
    if (h.go) {
      if (held || pad !== h.go || cover(h, rec) < COVER - 0.05) hideGo(h);
    } else if (h.armed && pad && !held && !any &&
               Math.hypot(h.vx, h.vy) < SETTLE * S && cover(h, rec) >= COVER) {
      showGo(h, pad);
    }

    /* --- the hand: the wait starts over on anything held, burning
       or moving, a finger resting on GO included --- */
    if (!h.armed || held || h.grab || any || h.vx || h.vy) h.idleFrom = now;
    nudge(h, now - h.idleFrom < NUDGE_MS ? null : (h.go ? 'go' : 'fly'));


    /* keep going while anything can still change: the controls are
       live, a jet is lit, or the craft is still moving */
    return h.armed || any || Math.hypot(h.vx, h.vy) > 0;
  }


  /* ============================================================
     THE WAY IN

     The craft does not pop up at its hover point: it comes in from
     far off, out past the frame's edge on a bearing picked at random
     -- any side, any corner, never nearly the one it came in on last
     time -- on the same nozzles the player flies it with. The jets
     behind it burn while it runs in; then the ones ahead of it are
     run out and lit, and brake it onto its station. Off a diagonal
     that is two of each, each as hard as its share of the push. It
     starts a little bigger, higher up and nearer the lens, its
     shadow wide and pale on the water, and both draw in as it comes
     down to hover height. The wash on the water waits until it is
     there.

     The speed is steady while it runs in and eases off to nothing
     under the braking burn (arrivePath), with no jump where the one
     hands over to the other. A longer run in (across the wide side
     of the frame) takes a little longer, so the speed holds. The
     clock is the loop's own capped one, so a hidden tab holds the
     flight where it is.
     ============================================================ */

  /* how far along the way in, 0..1, at u of the clock */
  function arrivePath(u) {
    var v0 = 3 / (1 + 2 * CRUISE);
    if (u <= CRUISE) return v0 * u;
    var s = (u - CRUISE) / (1 - CRUISE);
    return v0 * CRUISE + v0 * (1 - CRUISE) * (1 - Math.pow(1 - s, 3)) / 3;
  }

  /* k: how high it still is, 1 at the start and 0 on station */
  function altitude(h, k) {
    var a = h.arrival;
    if (a.craft) a.craft.style.scale = (1 + ALTITUDE * k).toFixed(4);
    if (a.cast) {
      a.cast.style.scale = (1 + 0.5 * k).toFixed(4);
      a.cast.style.opacity = (1 - 0.6 * k).toFixed(3);
    }
  }

  function arriveFrame(h, dt) {
    var a = h.arrival;
    a.t += dt * 1000;
    var u = clamp(0, a.t / a.ms, 1);
    var p = arrivePath(u);

    h.x = a.sx * (1 - p);
    h.y = a.sy * (1 - p);
    place(h);
    altitude(h, 1 - p);

    /* the jets behind it while it runs in; the ones ahead of it
       called for DEPLOY_MS before the hand-over, so they are out and
       lit as the push turns round; and all cut just short of the stop */
    a.want = u < CRUISE - DEPLOY_MS / a.ms ? a.run : (u < 0.93 ? a.brake : {});
    paint(h);

    if (u < 1) return true;

    var done = a.done;
    endArrival(h);
    done();
    return false;
  }

  /* off the craft, whether it got there or was called away */
  function endArrival(h) {
    var a = h.arrival;
    if (!a) return;
    h.arrival = null;
    h.ship.classList.remove('is-arriving');
    if (a.craft) a.craft.style.removeProperty('scale');
    if (a.cast) {
      ['scale', 'opacity', 'transition'].forEach(function (p) {
        a.cast.style.removeProperty(p);
      });
    }
    paint(h);
  }

  function cancelArrival(h) {
    if (!h.arrival) return;
    var done = h.arrival.done;
    endArrival(h);
    done();
  }

  /* a bearing to come in on, in radians, screen-wise (y down): at
     random, but at least TURN away from the last one */
  function bearing(h) {
    var b = Math.random() * Math.PI * 2;
    for (var i = 0; i < 12 && h.bearing != null; i++) {
      var off = Math.abs(b - h.bearing) % (Math.PI * 2);
      if (Math.min(off, Math.PI * 2 - off) >= TURN * Math.PI / 180) break;
      b = Math.random() * Math.PI * 2;
    }
    h.bearing = b;
    return b;
  }

  /* Brings the craft in onto its hover point. Resolves once it is
     there, which is when the flow can go on. */
  function arrive(site) {
    var h = site.helm;
    if (!h) return Promise.resolve();

    cancelArrival(h);
    sleep(h);
    h.x = h.y = h.vx = h.vy = 0;
    place(h);
    if (reduced()) return wait(300);

    var g = measure(h);
    var b = bearing(h);
    var ux = Math.cos(b), uy = Math.sin(b);       /* out from the station */

    /* out along it to the frame's edge, then the whole craft at its
       starting size past that, and FAR again */
    var tx = ux > 1e-6 ? (g.W - g.hx) / ux : (ux < -1e-6 ? g.hx / -ux : Infinity);
    var ty = uy > 1e-6 ? (g.H - g.hy) / uy : (uy < -1e-6 ? g.hy / -uy : Infinity);
    var dist = Math.min(tx, ty) + g.reach * (1 + ALTITUDE) + g.S * FAR;

    /* which nozzles push it in along the way it travels (-u), which
       brake it, and how hard: each its share of the push, and never
       so little that it stops reading as fire */
    var run = {}, brake = {}, pow = {};
    for (var s in h.noz) {
      var share = -(PUSH[s][0] * ux + PUSH[s][1] * uy);
      if (share > 0.25) run[s] = true;
      else if (share < -0.25) brake[s] = true;
      else continue;
      pow[s] = Math.round(Math.max(0.55, Math.abs(share)) * 20) / 20;
    }

    var cast = h.ship.querySelector('.ship__cast');
    if (cast) cast.style.transition = 'none';

    return new Promise(function (resolve) {
      h.arrival = {
        t: 0,
        ms: clamp(2200, ARRIVE_MS * (0.6 + 0.5 * dist / g.S), 3200),
        sx: ux * dist,
        sy: uy * dist,
        run: run, brake: brake, pow: pow,
        want: {},
        craft: h.ship.querySelector('.ship__craft'),
        cast: cast,
        done: resolve
      };
      h.ship.classList.add('is-arriving');
      h.x = h.arrival.sx;
      h.y = h.arrival.sy;
      place(h);
      altitude(h, 1);
      wake(h);
    });
  }


  /* ============================================================
     THE AUTOPILOT

     With the hearts gone, the craft is flown to the island that
     fits. Burn, coast, burn back: the jets behind it are lit for the
     first half of the trip and the ones ahead of it for the second,
     so it arrives on its own thrust rather than sliding to a stop
     like a counter on a board. The path is eased to match (a
     constant push each way is ease-in-out-quad), and the clock is
     the loop's own capped one, so a hidden tab holds the flight
     where it was instead of finishing it unseen.

     The same nozzle order as the player's: the craft holds still
     while its first nozzles run out and catch (`lead`), and the
     braking ones are called for DEPLOY_MS before the half-way, so
     they are out and lit as the push turns round.
     ============================================================ */

  function easeInOutQuad(u) {
    return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
  }

  function autoFrame(h, dt) {
    var a = h.auto;
    a.t += dt * 1000;
    var lead = DEPLOY_MS + IGNITE_MS;
    var u = clamp(0, (a.t - lead) / a.ms, 1);
    var e = easeInOutQuad(u);

    h.x = a.sx + a.dx * e;
    h.y = a.sy + a.dy * e;
    place(h);
    stepCamera(h, dt, u >= 1);
    setUnder(h, padUnder(h));

    var want = {};
    if (u < 0.94) {
      var braking = u >= 0.5 - DEPLOY_MS / a.ms;
      a.dirs.forEach(function (dir) {
        want[JET[braking ? BACK[dir] : dir]] = true;
      });
    }
    a.want = want;
    paint(h);

    if (u < 1) return true;

    var done = a.done;
    h.auto = null;
    h.vx = 0;
    h.vy = 0;
    a.want = {};
    paint(h);
    done();
    return false;
  }

  function flyTo(site, pad) {
    var h = site.helm;
    if (!h || !pad) return Promise.resolve();

    disarm(site);
    var g = measure(h);
    var rec = null;
    g.pads.forEach(function (p) { if (p.pad === pad) rec = p; });
    if (!rec) return Promise.resolve();

    var tx = clamp(g.minX, rec.cx - g.hx, g.maxX);
    var ty = clamp(g.minY, rec.cy - g.hy, g.maxY);
    var dx = tx - h.x;
    var dy = ty - h.y;
    var dist = Math.hypot(dx, dy);

    h.stick.classList.add('is-auto');

    if (reduced() || dist < 1) {
      h.x = tx;
      h.y = ty;
      place(h);
      setUnder(h, padUnder(h));
      return wait(reduced() ? 300 : 0);
    }

    /* only the axes it actually travels along get a jet */
    var dirs = [];
    if (Math.abs(dx) > g.S * 0.02) dirs.push(dx < 0 ? 'left' : 'right');
    if (Math.abs(dy) > g.S * 0.02) dirs.push(dy < 0 ? 'up' : 'down');

    return new Promise(function (resolve) {
      h.auto = {
        t: 0,
        ms: clamp(1100, 900 + dist / g.S * 1400, 2600),
        sx: h.x, sy: h.y, dx: dx, dy: dy,
        dirs: dirs, want: {},
        done: resolve
      };
      wake(h);
    }).then(function () {
      /* a breath of hover over the island before it commits */
      return wait(260);
    });
  }


  /* ============================================================
     THE HEARTS
     ============================================================ */

  function sayLives(h) {
    if (!h.lives) return;
    h.lives.setAttribute('aria-label', h.hearts + ' of 3 hearts left');
  }

  /* Takes one, from the right, and says how many are left. The pill
     shakes with it, and the last one left beats. */
  function loseLife(site) {
    var h = site.helm;
    if (!h || h.hearts <= 0) return 0;

    h.hearts--;
    if (h.lives) {
      var all = h.lives.querySelectorAll('.life');
      if (all[h.hearts]) all[h.hearts].classList.add('is-lost');
      h.lives.classList.remove('is-hit');
      void h.lives.offsetWidth;            /* replay the shake */
      h.lives.classList.add('is-hit');
      h.lives.classList.toggle('is-last', h.hearts === 1);
      sayLives(h);
    }
    return h.hearts;
  }

  function lives(site) {
    return site.helm ? site.helm.hearts : Infinity;
  }


  /* ============================================================
     HANDING THE HELM OVER, AND TAKING IT BACK
     ============================================================ */

  /* The controls are live and the craft is the player's. `onLand`
     is called once, with the island GO was pressed over. */
  function arm(site, onLand) {
    var h = site.helm;
    if (!h) return;
    if (live && live !== h) disarm(live.site);

    measure(h);
    h.cameraPlates = cameraPlates(h);
    h.onLand = onLand;
    h.armed = true;
    h.idleFrom = clock();
    live = h;

    h.stick.classList.add('is-on', 'is-live');
    h.stick.classList.remove('is-auto');
    wake(h);
  }

  /* The controls go dead -- the craft is landing, or the autopilot
     has it -- and every lit jet is cut. GO goes, and the knob comes
     home; the stick stays on screen. */
  function disarm(site) {
    var h = site.helm;
    if (!h) return;
    h.armed = false;
    h.onLand = null;
    if (live === h) live = null;
    releaseAll(h);
    hideGo(h);
    nudge(h, null);
    unlock(h);
    setUnder(h, null);
    knobTo(h, 0, 0);
    h.stick.classList.remove('is-live');
  }

  /* and away altogether, once the craft is down for good */
  function stow(site) {
    var h = site.helm;
    if (!h) return;
    disarm(site);
    h.stick.classList.remove('is-on', 'is-auto');
  }

  /* back to the hover point, at rest -- where the craft comes back
     in after a miss */
  function home(site) {
    var h = site.helm;
    if (!h) return;
    cancelArrival(h);
    sleep(h);
    h.x = h.y = h.vx = h.vy = 0;
    h.placed = null;
    h.geo = null;
    place(h);
    setFlying(h, false);
    resetCamera(h);
  }

  function show(site) {
    var h = site.helm;
    if (h && h.lives) h.lives.classList.add('is-on');
  }

  /* Everything back to the opening state: three hearts, the craft at
     the hover point, the stick away. Called from the screen's reset. */
  function reset(site) {
    var h = site.helm;
    if (!h) return;

    disarm(site);
    if (h.auto) {
      var done = h.auto.done;
      h.auto = null;
      done();
    }
    cancelArrival(h);
    /* every nozzle straight back in, with no stow to wait out */
    for (var s in h.noz) {
      h.noz[s] = freshNozzle();
      h.jets[s].style.removeProperty('--pow');
    }
    clearTimeout(h.nozTimer);
    h.nozTimer = 0;
    h.nozDue = Infinity;
    h.litKey = h.outKey = null;
    paint(h);
    if (h.knob) h.knob.style.removeProperty('translate');
    h.knobAt = null;
    home(site);
    h.ship.style.removeProperty('translate');
    h.placed = null;

    h.hearts = 3;
    h.told = false;
    if (h.lives) {
      h.lives.classList.remove('is-on', 'is-hit', 'is-last');
      Array.prototype.forEach.call(h.lives.querySelectorAll('.life'), function (l) {
        l.classList.remove('is-lost');
      });
      sayLives(h);
    }
    h.stick.classList.remove('is-on', 'is-live', 'is-auto', 'is-go', 'is-held');
    h.site.el.all.forEach(function (pad) {
      pad.classList.remove('is-under', 'is-locking');
    });
  }


  /* ============================================================
     WIRING — once, at build
     ============================================================ */

  function attach(site) {
    var e = site.el;
    if (!e.ship || !e.stick || site.helm) return site.helm || null;

    var stick = e.stick;
    var h = {
      site: site,
      ship: e.ship,
      stick: stick,
      knob: stick.querySelector('.stick__knob'),
      goBtn: stick.querySelector('.stick__go'),
      lives: e.lives,
      jets: {},
      noz: {},                /* per nozzle: out, ready (lit from), stow (in at),
                                 on / until / pow (asked for, burn to, how hard) */
      nozTimer: 0, nozDue: Infinity,
      x: 0, y: 0, vx: 0, vy: 0,
      aim: [0, 0],            /* the stick's push, -1..1 each way     */
      keys: {},               /* the directions held on the keyboard  */
      grab: null,             /* the finger on the stick              */
      want: {},
      throwPx: 0,
      armed: false,
      auto: null,
      arrival: null, bearing: null,
      raf: 0, last: 0,
      geo: null,
      cameraPlates: [], cameraScreen: null, cameraWaiting: false,
      cameraX: 0, cameraY: 0, cameraAt: null,
      under: null, lockPad: null, go: null,
      idleFrom: 0, nudging: null,   /* THE HAND: untouched since, and what it shows */
      onLand: null,
      hearts: 3,
      told: false,
      litKey: null, outKey: null, placed: null, knobAt: null,
      flying: false
    };
    site.helm = h;

    ['t', 'r', 'b', 'l'].forEach(function (s) {
      var jet = e.ship.querySelector('.thruster--' + s);
      if (jet) {
        h.jets[s] = jet;
        h.noz[s] = freshNozzle();
      }
    });

    /* The whole stick is the grip, not just the knob: a finger put
       down anywhere on it takes the knob there at once, the way a
       thumb lands on a game pad. One finger at a time flies it; the
       stick keeps the pointer, so a thumb that slides off the ring
       is still flying. Put down on GO it is a tap on GO, unless it
       wanders off it -- then it is the stick again. */
    stick.addEventListener('pointerdown', function (ev) {
      if (!h.armed || h.grab) return;
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      ev.preventDefault();
      try { stick.setPointerCapture(ev.pointerId); } catch (err) { /* not capturable */ }

      var r = stick.getBoundingClientRect();
      h.grab = {
        id: ev.pointerId,
        cx: r.left + r.width / 2,
        cy: r.top + r.height / 2,
        max: THROW * r.width,
        k: (stick.offsetWidth || r.width) / (r.width || 1),
        x0: ev.clientX,
        y0: ev.clientY,
        slop: GO_SLOP * r.width,
        onGo: !!(h.go && h.goBtn && h.goBtn.contains(ev.target))
      };

      if (h.grab.onGo) {
        h.goBtn.classList.add('is-down');
        return;
      }
      stick.classList.add('is-held');
      aimAt(h, ev.clientX, ev.clientY);
    });

    stick.addEventListener('pointermove', function (ev) {
      var g = h.grab;
      if (!g || ev.pointerId !== g.id || !h.armed) return;
      if (g.onGo) {
        if (Math.hypot(ev.clientX - g.x0, ev.clientY - g.y0) < g.slop) return;
        g.onGo = false;
        h.goBtn.classList.remove('is-down');
        stick.classList.add('is-held');
      }
      aimAt(h, ev.clientX, ev.clientY);
    });

    stick.addEventListener('pointerup', function (ev) {
      var g = h.grab;
      if (!g || ev.pointerId !== g.id) return;
      var tapped = g.onGo && h.go;
      letGoStick(h);
      if (tapped) go(h);
    });

    ['pointercancel', 'lostpointercapture'].forEach(function (type) {
      stick.addEventListener(type, function (ev) {
        if (h.grab && ev.pointerId === h.grab.id) letGoStick(h);
      });
    });

    /* Enter / Space on a focused GO: a click with no pointer behind
       it (detail 0). A pointer's press was read off the stick above. */
    if (h.goBtn) {
      h.goBtn.addEventListener('click', function (ev) {
        if (ev.detail === 0) go(h);
      });
    }

    /* a long press is a push, never a context menu or a selection */
    stick.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });

    return h;
  }

  function freshNozzle() {
    return { out: false, ready: 0, stow: 0, on: false, until: 0, pow: 0, shown: null };
  }

  /* the keys fly whichever helm is live, and Enter or Space is GO
     while it is up -- unless another control has the focus, whose
     own Enter that is */
  doc.addEventListener('keydown', function (ev) {
    if (!live || !live.armed) return;
    if (ev.altKey || ev.ctrlKey || ev.metaKey) return;

    if ((ev.key === 'Enter' || ev.key === ' ') && live.go) {
      var f = doc.activeElement;
      if (f === live.goBtn) return;          /* its own click does it */
      if (f && f !== doc.body && f.closest && f.closest('button, a[href], input, select, textarea')) return;
      ev.preventDefault();
      if (!ev.repeat) go(live);
      return;
    }

    var dir = KEYS[ev.key];
    if (!dir) return;
    ev.preventDefault();
    if (ev.repeat) return;
    press(live, dir);
  });

  doc.addEventListener('keyup', function (ev) {
    var dir = KEYS[ev.key];
    if (!dir || !live) return;
    release(live, dir);
  });

  /* A control held down while the tab goes away, or the window loses
     focus, never sees its release: let go of everything rather than
     leave a jet burning against the frame's edge. */
  function letGo() { if (live) releaseAll(live); }
  doc.addEventListener('visibilitychange', function () { if (doc.hidden) letGo(); });
  global.addEventListener('blur', letGo);

  /* the frame changed size: measure again, and bring the craft back
     inside it if it is now past an edge */
  global.addEventListener('resize', function () {
    if (!live) return;
    var g = measure(live);
    live.x = clamp(g.minX, live.x, g.maxX);
    live.y = clamp(g.minY, live.y, g.maxY);
    place(live);
    stepCamera(live, 0, true);
  });


  global.GeoPilot = {
    attach: attach,
    arm: arm,
    disarm: disarm,
    stow: stow,
    home: home,
    show: show,
    reset: reset,
    arrive: arrive,
    flyTo: flyTo,
    loseLife: loseLife,
    lives: lives
  };
})(window);
