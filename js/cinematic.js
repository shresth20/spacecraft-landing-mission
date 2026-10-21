/* ============================================================
   Geo Drone — THE CLOSE-UP: the square's landing, as a cut-scene

   The square's landing (screen 3) is flown from straight overhead,
   which is the right view to choose an island from and the wrong one
   to watch a landing in: from above, a craft coming down is only a
   square getting bigger. So once GO is pressed the screen cuts away,
   letterboxed like a film, to the same moment seen from the side and
   a little above -- the island the player chose standing in the sea,
   the craft coming down onto it on its jets -- and cuts back once the
   landing has played out:

     fit    the island is exactly the craft's size: it settles on it
            edge for edge, the smoke clears, and the seam lights up
     tight  the island is too small: the craft hangs over it on every
            side and its jets wash the sea, it rocks on the edges,
            tips off and goes down into the water
     loose  the island is too big: it comes down in a cloud of dust
            with nothing under its edges to lock on to, skids, rocks,
            goes over and is wrecked on the rock

   ── THE ART ───────────────────────────────────────────────────
   Only the supplied new4 sheets, which tools/build_cinematic.py cuts
   into js/cinematic-assets.js: each landing's frames in one atlas,
   and an island re-projected into that sheet's own camera, sized by
   the side ratio of its area to the craft's, so the exact fit is
   exact and the other two visibly are not. The frames are flipped
   through on a canvas, cross-faded so a dozen drawings read as
   motion, and the craft's flight (where it is, how it rocks) is
   scripted here on top of them. Smoke, spray, debris, sparks and
   bubbles are CSS particles (css/cinematic.css).

   ── THE CONTRACT ──────────────────────────────────────────────
   play(site, kind, hooks) returns a Promise that settles once the
   cut is back on the sea. js/script.js keeps everything the landing
   MEANS -- the hearts, the voice, the autopilot, NEXT -- and hears
   about the shot through `hooks`:

     alive()        false once the screen has been left: stop dead
     onTouchdown()  the craft is down (fit)
     onSettle()     the verdict can start (all three)
     onImpact(kind) the water or the rock is hit ('water' / 'land')
     onReturn()     the cut is fading back to the sea

   ── THE TIMELINE ──────────────────────────────────────────────
   One clock runs a shot: `run.t`, which stops with the rest of the
   mission while the tab is away. Everything hangs off it --

     0      the cut (WARP, 0.5s): the overhead view dives at the craft,
            and the close-up resolves out of a radial zoom blur with
            its colours split, prism streaks and a burst of energy
     500    the descent (1.1s): red jets, exhaust, the engine shaking
            the hull, slowing all the way down; sharp before it lands
     1600   the touchdown and its impact (0.4s), then the verdict

   The tweened effects are an anime.js timeline (js/vendor), never
   played: it is SEEKED to run.t every frame, so it cannot drift from
   the shot. The one-off cues -- every sound (js/cinematic-sfx.js),
   every burst of particles, the hooks -- fire off the same t. Without
   anime.js the shot still plays, with a plain fade for the cut.

   Coordinates: the scene is a 1600x900 STAGE, scaled to fit the
   letterboxed frame. Positions are stage px; the art's own geometry
   is frame px of its sheet, times the shot's `k`.
   ============================================================ */

(function (global) {
  'use strict';

  var doc = document;
  var ART = global.GeoCinemaAssets;

  var STAGE_W = 1600;
  var STAGE_H = 900;
  /* the part of the stage the action keeps to: it is fitted inside the
     letterboxed frame, and the sea runs on under the rest */
  var SAFE_W = 1320;
  var SAFE_H = 700;
  var BAR = 0.085;              /* each letterbox bar, a share of the height */
  var ZOOM_MAX = 1.1;           /* the camera's closest, for the canvas's px */
  /* The sun is up and to the left of the camera, as it is in the art:
     a shadow falls down and to the right of the craft, further the
     higher it is -- frame px of offset per frame px of altitude. */
  var LIGHT = [.12, .06];

  /* The cut, then the drop: every shot lands at DOWN */
  var WARP = 500;
  var DOWN = 1600;
  /* the overhead view's dive at the craft, before the close-up is
     over it: how far it zooms, and how soft it goes */
  var DIVE = .5;
  var DIVE_BLUR = 4;

  var states = new Map();       /* screen -> its overlay */

  function clamp(lo, v, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function seg(t, a, b) { return clamp(0, (t - a) / (b - a), 1); }
  function mix(a, b, u) { return a + (b - a) * u; }
  function rand(lo, hi) { return lo + Math.random() * (hi - lo); }
  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

  var ease = {
    out: function (u) { return 1 - Math.pow(1 - u, 3); },
    in: function (u) { return u * u; },
    inOut: function (u) { return u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; },
    /* a powered descent: quick at first, then braking all the way down
       and feathered onto the ground */
    down: function (u) { return 1 - Math.pow(1 - u, DROP_POW); }
  };
  var DROP_POW = 2.4;

  /* the burner's roar (js/audio.js), by how many jets are lit */
  function sound(jets) {
    var A = global.GeoAudio;
    if (A && A.thrust) A.thrust(jets);
  }

  /* one of the synthesised effects (js/cinematic-sfx.js) */
  function sfx(name, v) {
    var S = global.GeoCinemaSFX;
    if (S && S[name]) S[name](v);
  }

  function node(tag, cls, parent) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (parent) parent.appendChild(n);
    return n;
  }

  function image(src, cls, parent) {
    var img = node('img', cls, parent);
    img.alt = '';
    img.draggable = false;
    img.decoding = 'async';
    img.src = src;
    return img;
  }

  function px(n) { return n.toFixed(1) + 'px'; }


  /* ============================================================
     THE SHOTS

     `k` stage px per frame px, `at` where the island's top face is
     centred on the stage, `hi` the altitude the craft is first seen at
     (frame px), `out` when the cut starts back and `ms` when it is
     over. `anchors` are the frame anchors the shot places frames by,
     which is what the craft's canvas is sized round.
     ============================================================ */

  var SHOTS = {
    fit:   { k: 1.86, at: [800, 600], hi: 210, out: 3300, ms: 3860,
             anchors: ['foot'], script: fitShot },
    tight: { k: 2.1, at: [1010, 520], hi: 190, out: 5800, ms: 6360,
             anchors: ['foot', 'dome', 'pool'], script: tightShot,
             /* the camera pushes in between the island and the splash */
             focus: [770, 470],
             /* where it goes into the sea: off the island's left-hand
                side, frame px from its centre */
             splash: [-236, 40] },
    loose: { k: 2.35, at: [800, 600], hi: 170, out: 6000, ms: 6560,
             anchors: ['foot'], script: looseShot }
  };


  /* ============================================================
     THE OVERLAY — built once per screen marked data-cinema, at boot
     and before the start gate counts document.images, so every frame
     of it is fetched with the rest of the mission.
     ============================================================ */

  function dress(screen) {
    if (states.has(screen) || !ART) return;

    var root = node('div', 'cine');
    root.setAttribute('aria-hidden', 'true');

    var cam = node('div', 'cine__cam', root);
    var seaArt = image(ART.sea.src, 'cine__sea', cam);

    var stage = node('div', 'cine__stage', cam);
    /* back to front: the sea round the island (the shadow and the jets'
       light on the water, then what happens on it), the island, its top
       face (the same two, clipped to it), then the craft between the
       two particle layers */
    var under = node('div', 'cine__under', stage);
    var sea = node('div', 'cine__fx cine__fx--sea', stage);
    var lands = node('div', 'cine__lands', stage);
    var top = node('div', 'cine__top', stage);
    /* the landing guide: the footprint, and a bracket on each corner */
    var guide = svgOf(stage, 'cine__guide', 'polygon', 1);
    for (var b = 0; b < 4; b++) {
      guide.appendChild(doc.createElementNS('http://www.w3.org/2000/svg', 'polyline'));
    }
    /* the light of the jets, behind the hull and out from under it */
    var thrust = node('i', 'cine__thrust', stage);
    var back = node('div', 'cine__fx cine__fx--back', stage);
    var canvas = node('canvas', 'cine__craft', stage);
    var front = node('div', 'cine__fx cine__fx--front', stage);
    var seam = svgOf(stage, 'cine__seam', 'polyline', 2);
    /* once it is down, the craft's footprint and the island's top face
       outlined over everything: one outline edge for edge, or two that
       plainly are not the same size */
    var match = svgOf(stage, 'cine__match', 'polygon', 2);
    for (var m = 0; m < 5; m++) {
      match.appendChild(doc.createElementNS('http://www.w3.org/2000/svg', 'polyline'));
    }
    ['m-foot', 'm-face', 'm-corner', 'm-corner', 'm-corner', 'm-corner', 'm-far'].forEach(function (cls, i) {
      match.children[i].setAttribute('class', cls);
    });

    /* the cut: a canvas over the close-up, drawn only while it is
       resolving out of the dive */
    var warpCv = node('canvas', 'cine__warp', root);
    warpCv.hidden = true;
    /* the descent's motion blur: straight down only, in three strengths */
    var blurs = svgDefs(root, [2, 4, 7]);

    var flash = node('i', 'cine__flash', root);
    node('i', 'cine__bar cine__bar--top', root);
    node('i', 'cine__bar cine__bar--bottom', root);

    /* every landing's pieces, each one shown only while its shot plays */
    var art = node('div', 'cine__art', root);
    art.hidden = true;
    var cast = {};
    ['fit', 'tight', 'loose'].forEach(function (key) {
      var a = ART[key];
      if (!a) return;
      cast[key] = {
        atlas: image(a.atlas, '', art),
        land: image(a.land, 'cine__land', lands),
        shade: [image(a.shadow, 'cine__shade', under), image(a.shadow, 'cine__shade', top)],
        glow: [node('i', 'cine__glow', under), node('i', 'cine__glow', top)]
      };
    });

    screen.appendChild(root);

    var st = {
      screen: screen, root: root, cam: cam, sea: seaArt, stage: stage, top: top,
      canvas: canvas, ctx: canvas.getContext('2d'), flash: flash, seam: seam, guide: guide,
      thrust: thrust, match: match, warp: warpCv, blurs: blurs,
      fx: { sea: sea, back: back, front: front },
      cast: cast, run: null, scale: 1, ox: 0, oy: 0
    };
    states.set(screen, st);

    new ResizeObserver(function () {
      if (!st.run) return;
      fitStage(st);
      sizeCanvas(st, st.run);
      st.run.drawn = null;
    }).observe(root);
  }

  /* A stage-sized SVG holding `n` shapes: the seam's two edges, the
     landing guide's footprint */
  function svgOf(parent, cls, shape, n) {
    var NS = 'http://www.w3.org/2000/svg';
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

  /* Vertical-only gaussian blurs, as filter: url(#id) values */
  var defsMade = 0;

  function svgDefs(parent, strengths) {
    var NS = 'http://www.w3.org/2000/svg';
    var svg = doc.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'cine__defs');
    svg.setAttribute('aria-hidden', 'true');
    var out = [''];
    defsMade++;
    strengths.forEach(function (sd, i) {
      var id = 'cineMb' + defsMade + '_' + i;
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

  /* The stage, scaled to keep SAFE inside the letterboxed frame and
     centred on it. */
  function fitStage(st) {
    var W = st.root.clientWidth || 1;
    var H = st.root.clientHeight || 1;
    var bar = Math.round(H * BAR);
    var s = Math.min(W / SAFE_W, (H - 2 * bar) / SAFE_H);
    st.scale = s;
    st.ox = (W - STAGE_W * s) / 2;
    st.oy = (H - STAGE_H * s) / 2;
    st.stage.style.transform = 'translate(' + px(st.ox) + ',' + px(st.oy) + ') scale(' + s.toFixed(5) + ')';
    st.root.style.setProperty('--cine-bar', bar + 'px');
  }


  /* ============================================================
     SETTING A SHOT UP
     ============================================================ */

  /* The craft's canvas: a box round the anchor big enough for every
     frame the shot places, in frame px. Rotation is the canvas
     element's own transform, so it never needs room of its own. */
  function boxOf(data, anchors) {
    var l = 0, r = 0, t = 0, b = 0;
    data.frames.forEach(function (fr) {
      anchors.forEach(function (k) {
        var a = fr[k];
        if (!a) return;
        l = Math.max(l, a[0]);
        t = Math.max(t, a[1]);
        r = Math.max(r, fr.rect[2] - a[0]);
        b = Math.max(b, fr.rect[3] - a[1]);
      });
    });
    var m = 4;
    return { ax: l + m, ay: t + m, w: l + r + 2 * m, h: t + b + 2 * m };
  }

  function sizeCanvas(st, run) {
    var dpr = Math.min(2, global.devicePixelRatio || 1);
    var k = run.shot.k;
    /* canvas px per frame px: as sharp as the screen can show it at the
       camera's closest, and never more than four to one */
    run.res = Math.min(k * st.scale * dpr * ZOOM_MAX, 4);
    st.canvas.width = Math.ceil(run.box.w * run.res);
    st.canvas.height = Math.ceil(run.box.h * run.res);
    st.canvas.style.width = px(run.box.w * k);
    st.canvas.style.height = px(run.box.h * k);
  }

  function place(el, x, y, w) {
    el.style.left = px(x);
    el.style.top = px(y);
    if (w != null) el.style.width = px(w);
  }

  function stagePt(run, p) {
    return [run.shot.at[0] + p[0] * run.shot.k, run.shot.at[1] + p[1] * run.shot.k];
  }

  function setup(st, run) {
    var shot = run.shot, c = run.data, k = shot.k, cast = st.cast[run.kind];

    fitStage(st);
    run.box = boxOf(c, shot.anchors);
    sizeCanvas(st, run);
    run.atlas = cast.atlas;
    st.ctx.imageSmoothingEnabled = true;
    st.ctx.imageSmoothingQuality = 'high';

    Object.keys(st.cast).forEach(function (key) {
      var on = key === run.kind;
      var p = st.cast[key];
      p.land.hidden = !on;
      p.shade.forEach(function (el) { el.hidden = !on; });
      p.glow.forEach(function (el) { el.hidden = !on; });
    });

    /* the island, where its top face is centred on `at` */
    var lw = c.landSize[0] / c.landRes * k;
    place(cast.land, shot.at[0] + c.landAt[0] * k, shot.at[1] + c.landAt[1] * k, lw);

    /* its top face, which the shadow and the light on it are clipped to */
    st.top.style.clipPath = 'polygon(' + ['l', 'b', 'r', 'f'].map(function (key) {
      var p = stagePt(run, c.top[key]);
      return px(p[0]) + ' ' + px(p[1]);
    }).join(',') + ')';

    /* how far the sea is below the top face: the wall at the front */
    run.sink = (c.base.f[1] - c.top.f[1]) * k;

    /* the shadow and the jets' light, sized off the footprint */
    var fw = (c.foot.r[0] - c.foot.l[0]) * k;
    var fh = (c.foot.f[1] - c.foot.b[1]) * k;
    cast.shade.forEach(function (el) { el.style.width = px(c.shadowSize[0] * k); });
    cast.glow.forEach(function (el) {
      el.style.width = px(fw * 1.25);
      el.style.height = px(fh * 1.25);
    });

    /* every frame's hull, from its foot -- its own where the sheet gives
       one, the reference frame's otherwise -- pushed out a hair so its
       dark rim and its anti-aliased edge are inside it */
    var ref = ['lt', 'b', 'rt', 'rb', 'f', 'lb'].map(function (key) { return c.hull[key]; });
    run.hulls = c.frames.map(function (fr) { return grow(fr.hull || ref, 3); });

    /* the landing guide: the craft's own footprint, projected on the
       ground where it is coming down -- edge for edge on the island
       that fits, hanging off one too small, lost inside one too big */
    var quad = ['l', 'b', 'r', 'f'].map(function (key) { return stagePt(run, c.foot[key]); });
    var pts = function (list) {
      return list.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ');
    };
    var shapes = st.guide.children;
    shapes[0].setAttribute('points', pts(quad));
    quad.forEach(function (p, i) {
      var prev = quad[(i + 3) % 4], next = quad[(i + 1) % 4];
      shapes[i + 1].setAttribute('points', pts([
        [mix(p[0], prev[0], .2), mix(p[1], prev[1], .2)], p,
        [mix(p[0], next[0], .2), mix(p[1], next[1], .2)]
      ]));
    });
    st.guide.classList.remove('is-ok', 'is-bad');
    st.guide.style.opacity = '0';

    /* the match: the footprint where it comes to rest, the island's
       top face, a bracket on each of the footprint's corners -- all
       four, the far one too, seen through the hull -- and its two far
       edges, the ones the hull hides (the near two are the seam's) */
    var face = ['l', 'b', 'r', 'f'].map(function (key) { return stagePt(run, c.top[key]); });
    var mk = st.match.children;
    mk[0].setAttribute('points', pts(quad));
    mk[1].setAttribute('points', pts(face));
    mk[6].setAttribute('points', pts([quad[0], quad[1], quad[2]]));
    quad.forEach(function (p, i) {
      var prev = quad[(i + 3) % 4], next = quad[(i + 1) % 4];
      mk[i + 2].setAttribute('points', pts([
        [mix(p[0], prev[0], .24), mix(p[1], prev[1], .24)], p,
        [mix(p[0], next[0], .24), mix(p[1], next[1], .24)]
      ]));
    });
    st.match.classList.toggle('is-ok', run.kind === 'fit');
    st.match.classList.toggle('is-bad', run.kind !== 'fit');
    st.match.style.opacity = '0';
    Array.prototype.forEach.call(mk, function (el) { el.style.cssText = ''; });
    run.quad = quad;

    st.thrust.style.opacity = '0';

    st.seam.classList.remove('is-lit');
    st.flash.style.opacity = '0';
    st.canvas.style.filter = '';
    st.canvas.style.opacity = '1';
    run.dark = '';
  }

  /* The guide over the drop: in as the cut opens, while the craft is
     still high enough to see the ground under it; its verdict given
     half way down; gone as the hull comes down over it. */
  function guideFor(run, s, alt, good) {
    s.guide = seg(run.t, WARP - 120, WARP + 200) * clamp(0, (alt - 16) / 34, 1);
    if (alt < 120 && once(run, 'verdict')) run.st.guide.classList.add(good ? 'is-ok' : 'is-bad');
  }


  /* ============================================================
     PLAYING
     ============================================================ */

  function screenOf(site) {
    var n = site && (site.node || site);
    return n && n.closest ? n.closest('.screen') : null;
  }

  /* Does this site's screen play its landings as the cut-scene? Only
     if its art is all in: a shot over a missing sea or island would be
     worse than the top-down landing it stands in for. */
  function has(site) {
    var st = states.get(screenOf(site));
    if (!st) return false;
    var imgs = Array.prototype.slice.call(st.root.querySelectorAll('img'));
    return imgs.every(function (img) { return img.complete && img.naturalWidth > 0; });
  }

  /* The landing's art decoded before the first frame is drawn, so the
     cut never opens on a half-painted island. In memory already (the
     start gate fetched it), so this is a matter of milliseconds -- and
     never more than a moment: a decode that does not answer is not
     waited on. */
  function ready(st, kind) {
    var cast = st.cast[kind];
    var imgs = [st.sea, cast.atlas, cast.land].concat(cast.shade);
    var all = Promise.all(imgs.map(function (img) {
      return img.decode ? img.decode().catch(function () {}) : Promise.resolve();
    }));
    var cap = new Promise(function (r) { setTimeout(r, 900); });
    return Promise.race([all, cap]);
  }

  function play(site, kind, hooks) {
    var screen = screenOf(site);
    var st = states.get(screen);
    var shot = SHOTS[kind];
    var data = ART && ART[kind];
    if (!st || !shot || !data) return Promise.resolve(false);

    if (st.run) finish(st, st.run, true);
    hooks = hooks || {};

    var run = {
      kind: kind, shot: shot, data: data, hooks: hooks,
      t: 0, last: 0, raf: 0, fired: {}, next: {}, drawn: null,
      shake: null, punch: null, done: null,
      fx: calm(), tl: null, warp: null, dive: null, hum: 0, pulseT: -1e4, pulseAt: 0, mb: ''
    };
    st.run = run;
    /* the sound's buffers built now, inside the GO press */
    var S = global.GeoCinemaSFX;
    if (S) S.prepare();

    return new Promise(function (resolve) {
      run.done = resolve;
      ready(st, kind).then(function () {
        if (st.run !== run) return;
        if (hooks.alive && !hooks.alive()) return finish(st, run, true);
        setup(st, run);
        run.tl = timeline(st, run);
        st.root.classList.remove('is-leaving', 'is-cut');
        if (run.tl) {
          /* the cut is the timeline's: it fades the close-up in itself */
          st.root.classList.add('is-warping');
          st.root.style.opacity = '0';
          dive(st, run);
        }
        void st.root.offsetWidth;
        st.root.classList.add('is-on');
        screen.classList.add('is-cinema');
        /* the first frame drawn, then caught for the cut to resolve */
        frame(st, run);
        if (run.tl) snapshot(st, run);
        sfx('warp');
        tick(st, run);
      });
    });
  }

  function tick(st, run) {
    run.raf = global.requestAnimationFrame(function step(now) {
      if (st.run !== run) return;
      if (run.hooks.alive && !run.hooks.alive()) return finish(st, run, true);

      /* capped, so a stall or a hidden tab holds the shot where it was
         rather than jumping it on; and frozen with the rest of the
         mission while the tab is away (js/lifecycle.js) */
      var dt = run.last ? Math.min(50, now - run.last) : 0;
      run.last = now;
      if (!(global.GeoLife && global.GeoLife.isPaused())) run.t += dt;

      frame(st, run);
      if (run.t >= run.shot.ms) return finish(st, run, false);
      run.raf = global.requestAnimationFrame(step);
    });
  }

  /* One frame of the shot: the script says where everything is, this
     puts it there. */
  function frame(st, run) {
    var t = run.t;
    var s = {
      f: 1, g: null, m: 0, anchor: 'foot', fClip: false, gClip: false, flame: 1,
      x: run.shot.at[0], y: run.shot.at[1], rot: 0, pivot: [0, 0],
      alpha: 1, dark: 0, ground: null, alt: 0, glow: 0, shade: 0, guide: 0,
      thrust: 0, mb: 0
    };
    run.st = st;
    /* the timeline's tweens, to this moment of the shot */
    if (run.tl) run.tl.seek(t);
    run.shot.script(t, s, run);

    if (t >= run.shot.out && once(run, 'out')) {
      st.root.classList.add('is-leaving');
      call(run, 'onReturn');
    }

    camera(st, run, t);
    draw(st, run, s);

    /* the engine shaking the hull while the jets are lit: the craft
       only, so its shadow and the ground stay still under it */
    var vx = 0, vy = 0;
    if (s.thrust > 0) {
      vx = s.thrust * 1.5 * (Math.sin(t * .071) + .5 * Math.sin(t * .193 + 1.7));
      vy = s.thrust * 1.1 * (Math.cos(t * .083) + .5 * Math.sin(t * .157 + .6));
    }

    var k = run.shot.k;
    var c = st.canvas.style;
    run.craftAt = [s.x + vx - run.box.ax * k, s.y + vy - run.box.ay * k];
    c.transformOrigin = px(run.box.ax * k + s.pivot[0] * k) + ' ' + px(run.box.ay * k + s.pivot[1] * k);
    c.transform = 'translate(' + px(run.craftAt[0]) + ',' + px(run.craftAt[1]) + ')' +
                  (s.rot ? ' rotate(' + s.rot.toFixed(2) + 'deg)' : '');
    c.opacity = s.alpha.toFixed(3);
    var dark = s.dark ? 'brightness(' + (1 - .45 * s.dark).toFixed(3) + ') saturate(' + (1 - .5 * s.dark).toFixed(3) + ') contrast(' + (1 + .12 * s.dark).toFixed(3) + ')' : '';
    var mb = st.blurs[Math.min(st.blurs.length - 1, Math.ceil(s.mb * (st.blurs.length - 1) - .15))] || '';
    if (dark !== run.dark || mb !== run.mb) {
      c.filter = [mb, dark].join(' ').trim();
      run.dark = dark;
      run.mb = mb;
    }
    st.guide.style.opacity = s.guide.toFixed(3);

    ground(st, run, s);
    thrusters(st, run, s, vx, vy);
    warp(st, run, t);
  }

  /* The craft's shadow and the light its jets throw, straight below
     it: on the island's top face (clipped to it) and on the sea round
     it (under the island, a wall's height further down). */
  function ground(st, run, s) {
    var cast = st.cast[run.kind];
    var k = run.shot.k;
    var g = s.ground || [s.x, run.shot.at[1]];
    var up = clamp(0, s.alt / run.shot.hi, 1);
    var c = run.data;
    var sx = g[0] + (c.shadowAt[0] + LIGHT[0] * s.alt) * k;
    var sy = g[1] + (c.shadowAt[1] + LIGHT[1] * s.alt) * k;
    var spread = 1 + .32 * up;
    var o = s.shade * (1 - .62 * up);
    run.gnd = { x: sx, y: sy, spread: spread, o: o };
    cast.shade.forEach(function (el, i) {
      el.style.transform = 'translate(' + px(sx) + ',' + px(sy + (i ? 0 : run.sink)) + ') scale(' + spread.toFixed(3) + ')';
      el.style.opacity = o.toFixed(3);
    });
    var gw = parseFloat(cast.glow[0].style.width) || 0;
    var gh = parseFloat(cast.glow[0].style.height) || 0;
    cast.glow.forEach(function (el, i) {
      el.style.transform = 'translate(' + px(g[0] - gw / 2) + ',' + px(g[1] - gh / 2 + (i ? 0 : run.sink)) + ')';
      el.style.opacity = s.glow.toFixed(3);
    });
  }

  /* The camera: diving in through the cut (the timeline's zoom, and
     the craft carried from where it was on the overhead view to where
     it is in this one), then a slow push in on the island over the
     rest of the shot, and a shake when something is hit. */
  function camera(st, run, t) {
    var fx = run.fx;
    var z = (1 + .06 * ease.inOut(seg(t, WARP + 400, run.shot.out))) * fx.zoom;
    var p = run.punch;
    if (p && t < p.t0 + p.ms) z += p.amt * Math.pow(1 - (t - p.t0) / p.ms, 2);
    var dx = 0, dy = 0;
    var q = run.shake;
    if (q && t < q.t0 + q.ms) {
      var u = 1 - (t - q.t0) / q.ms;
      var a = q.amp * u * u;
      dx = a * (Math.sin(t * .113) + .6 * Math.sin(t * .271 + 1.3));
      dy = a * (Math.cos(t * .097) + .6 * Math.sin(t * .233 + .4));
    }
    var focus = run.shot.focus || [run.shot.at[0], run.shot.at[1] - 60];
    var F = [st.ox + focus[0] * st.scale, st.oy + focus[1] * st.scale];
    var off = [dx * st.scale, dy * st.scale];
    if (run.warp && fx.shift) {
      off[0] += run.warp.off[0] * fx.shift;
      off[1] += run.warp.off[1] * fx.shift;
    }
    /* kept for the cut, which draws the same camera on its canvas */
    run.cam = { z: z, F: F, off: off };
    st.cam.style.transformOrigin = px(F[0]) + ' ' + px(F[1]);
    st.cam.style.transform = 'translate(' + px(off[0]) + ',' + px(off[1]) + ') scale(' + z.toFixed(4) + ')';
  }

  function shake(run, amp, ms) {
    run.shake = { amp: amp, ms: ms, t0: run.t };
  }

  /* the lens jolted in on a hit, and easing back out */
  function punch(run, amt, ms) {
    run.punch = { amt: amt, ms: ms, t0: run.t };
  }

  /* A burst of light on the lens, centred on a stage point: white at
     the middle, `tint` round it. */
  function flash(st, at, peak, ms, tint) {
    var f = st.flash;
    var W = st.root.clientWidth || 1, H = st.root.clientHeight || 1;
    var x = (st.ox + at[0] * st.scale) / W * 100;
    var y = (st.oy + at[1] * st.scale) / H * 100;
    f.style.background = 'radial-gradient(circle at ' + x.toFixed(1) + '% ' + y.toFixed(1) + '%, #fff, ' +
                         tint + ' 36%, transparent 74%)';
    if (!f.animate) return;
    f.animate([{ opacity: peak }, { opacity: 0 }], { duration: ms, easing: 'cubic-bezier(.2,.7,.3,1)' });
  }

  function call(run, name, arg) {
    var fn = run.hooks[name];
    if (!fn) return;
    try { fn(arg); } catch (e) {
      if (global.console) global.console.warn('GeoCinema: ' + name + ' threw —', e);
    }
  }

  function once(run, name) {
    if (run.fired[name]) return false;
    run.fired[name] = true;
    return true;
  }

  /* `fn(at)` every `gap` ms from `from` to `to` -- more than once in a
     frame that ran long, so a burst never thins out on a slow device */
  function every(run, name, t, from, to, gap, fn) {
    if (t < from) return;
    var next = run.next[name] == null ? from : run.next[name];
    while (next <= t && next <= to) { fn(next); next += gap; }
    run.next[name] = next;
  }

  /* Frames by a value that only runs one way. `stops` are [value,
     frame] pairs in the order the value passes them. Between two stops
     the two frames are cross-faded over the last `soft` of the way
     (all of it by default). Frames the sheet draws in register -- the
     descents -- melt into each other; frames it does not (a craft
     tipping over, going under) would only double up, so those are
     shown with the briefest of fades instead. */
  function ladder(s, stops, v, soft) {
    var dir = stops[stops.length - 1][0] > stops[0][0] ? 1 : -1;
    soft = soft == null ? 1 : soft;
    s.g = null;
    s.m = 0;
    if ((v - stops[0][0]) * dir <= 0) { s.f = stops[0][1]; return; }
    for (var i = 1; i < stops.length; i++) {
      if ((v - stops[i][0]) * dir < 0) {
        var a = stops[i - 1], b = stops[i];
        var u = (v - a[0]) / (b[0] - a[0]);
        s.f = a[1];
        s.g = b[1];
        s.m = soft > 0 ? clamp(0, (u - (1 - soft)) / soft, 1) : 0;
        return;
      }
    }
    s.f = stops[stops.length - 1][1];
  }

  function finish(st, run, cut) {
    if (st.run !== run) return;
    global.cancelAnimationFrame(run.raf);
    st.run = null;
    sound(0);
    sfx('engine', 0);

    /* the cut's leftovers, if it was cut off inside it */
    undive(run);
    unwarp(st, run);
    run.tl = null;
    st.root.style.opacity = '';
    st.thrust.style.opacity = '0';
    st.match.style.opacity = '0';

    if (cut) st.root.classList.add('is-cut');
    st.root.classList.remove('is-on', 'is-leaving', 'is-warping');
    st.screen.classList.remove('is-cinema');
    ['sea', 'back', 'front'].forEach(function (k) { st.fx[k].textContent = ''; });
    st.seam.classList.remove('is-lit');
    st.ctx.setTransform(1, 0, 0, 1, 0, 0);
    st.ctx.clearRect(0, 0, st.canvas.width, st.canvas.height);

    if (run.done) run.done(!cut);
  }

  /* Cut it off where it stands: the screen is being left or reset. */
  function stop(site) {
    var st = states.get(screenOf(site));
    if (st && st.run) finish(st, st.run, true);
  }


  /* ============================================================
     THE CUT — from the overhead view to the close-up, in WARP ms

     The overhead view dives at the craft, zooming and going soft
     under the close-up as that fades in over it. The close-up comes
     out of the same dive: first on the cut's canvas, from a snapshot
     of its opening frame, smeared out radially from the craft with its
     red, green and blue pulled apart; then sharp, and handing over to
     the live scene under it, which wears the very same camera, so the
     hand-over has no seam. Prism streaks and a burst of energy fly out
     from the craft over the top. The canvas is only drawn while the cut
     runs, and freed after it; nothing is blurred for the rest of the
     shot.
     ============================================================ */

  /* the effects at rest: what a shot without the cut plays with */
  function calm() {
    return { veil: 1, dive: 0, zoom: 1, shift: 0, blur: 0, split: 0, snap: 0,
             streak: 0, burst: 0, ring: 0 };
  }

  /* The shot's timeline: the cut's tweens, then the landing's own
     (outcome()). Never played -- frame() seeks it to run.t. */
  function timeline(st, run) {
    var A = global.anime;
    if (!A || !A.timeline) return null;
    run.st = st;
    var fx = run.fx;
    fx.veil = 0;
    fx.zoom = 1.32;
    fx.shift = 1;
    fx.blur = 1;
    fx.split = 1;
    fx.snap = 1;

    var tl = A.timeline({ autoplay: false, easing: 'linear' });
    tl.add({ targets: fx, dive: [0, 1], duration: 340, easing: 'easeInCubic' }, 0)
      .add({ targets: fx, veil: [0, 1], duration: 190, easing: 'easeOutQuad' }, 70)
      /* the offset goes with the zoom, step for step: the bound dive()
         puts on it then holds all the way in, not just at the start */
      .add({ targets: fx, zoom: [1.32, 1], duration: 560, easing: 'easeOutCubic' }, 0)
      .add({ targets: fx, shift: [1, 0], duration: 560, easing: 'easeOutCubic' }, 0)
      .add({ targets: fx, blur: [1, 0], duration: 360, easing: 'easeOutQuad' }, 130)
      .add({ targets: fx, split: [1, 0], duration: 340, easing: 'easeOutSine' }, 110)
      .add({ targets: fx, snap: [1, 0], duration: 200 }, 300)
      .add({ targets: fx, streak: [{ value: 1, duration: 150, easing: 'easeOutQuad' },
                                   { value: 0, duration: 330, easing: 'easeInQuad' }] }, 0)
      .add({ targets: fx, burst: [{ value: 1, duration: 90, easing: 'easeOutQuad' },
                                  { value: 0, duration: 300, easing: 'easeInSine' }] }, 150)
      .add({ targets: fx, ring: [0, 1], duration: 420, easing: 'easeOutCubic' }, 160);
    outcome(st, run, tl);
    return tl;
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

    /* the close-up's craft at its first frame: the middle of its hull,
       over a foot `hi` up */
    var c = run.data, k = run.shot.k, shot = run.shot;
    var mid = (c.hull.b[1] + c.hull.f[1]) / 2;
    var C = [st.ox + shot.at[0] * st.scale, st.oy + (shot.at[1] + (mid - shot.hi) * k) * st.scale];
    var focus = shot.focus || [shot.at[0], shot.at[1] - 60];
    var F = [st.ox + focus[0] * st.scale, st.oy + focus[1] * st.scale];
    /* kept to what the sea (6% past every edge) can cover at the cut's
       closest, so no edge of it is ever carried into the frame */
    var z = run.fx.zoom;
    var room = function (f, L) {
      /* less the colour split's own sideways throw */
      var m = .06 * L - 12;
      return [L - f - (L + m - f) * z, -f + (m + f) * z];
    };
    var rx = room(F[0], W), ry = room(F[1], H);
    run.warp = {
      C: C,
      off: [clamp(rx[0], P[0] - F[0] - (C[0] - F[0]) * z, rx[1]),
            clamp(ry[0], P[1] - F[1] - (C[1] - F[1]) * z, ry[1])]
    };

    /* the plates the overhead view is drawn on, each zoomed about the
       craft by the individual `scale`/`translate` properties, which
       leave the camera's own `transform` on them alone */
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

  /* the overhead view as it was: it is under the close-up by now */
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

  /* The close-up's opening frame, drawn once, as the scene lays it out
     with the camera at rest: the sea, the shadow on it, the island, the
     shadow on its top face, the craft. It takes in the sea's bleed past
     the frame (M, 6% a side) as well, for the dive to swing across. Then
     the same split into its red, green and blue, which the cut draws
     apart and adds back together. */
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
    var cast = st.cast[run.kind], c = run.data, k = run.shot.k, g = run.gnd;

    try {
      x.setTransform(q, 0, 0, q, q * M[0], q * M[1]);
      var sea = st.sea, nw = sea.naturalWidth, nh = sea.naturalHeight;
      var bw = W * 1.12, bh = H * 1.12, f = Math.max(bw / nw, bh / nh);
      x.drawImage(sea, -W * .06 + (bw - nw * f) / 2, -H * .06 + (bh - nh * f) / 2, nw * f, nh * f);

      x.translate(st.ox, st.oy);
      x.scale(st.scale, st.scale);
      var shade = function (dy) {
        if (!g) return;
        var img = cast.shade[0];
        var sw = c.shadowSize[0] * k, sh = sw * img.naturalHeight / img.naturalWidth;
        x.globalAlpha = g.o;
        x.drawImage(img, g.x + sw / 2 * (1 - g.spread), g.y + dy + sh / 2 * (1 - g.spread),
                    sw * g.spread, sh * g.spread);
        x.globalAlpha = 1;
      };
      shade(run.sink);
      var land = cast.land, lw = parseFloat(land.style.width);
      x.drawImage(land, parseFloat(land.style.left), parseFloat(land.style.top),
                  lw, lw * land.naturalHeight / land.naturalWidth);
      x.save();
      path(x, ['l', 'b', 'r', 'f'].map(function (key) { return stagePt(run, c.top[key]); }));
      x.clip();
      shade(0);
      x.restore();
      x.drawImage(st.canvas, run.craftAt[0], run.craftAt[1], run.box.w * k, run.box.h * k);
    } catch (e) {
      return;     /* nothing to resolve from: the cut is a plain fade */
    }

    w.chans = ['#f00', '#0f0', '#00f'].map(function (col) {
      var cv = canvasOf(sw, sh), y = cv.getContext('2d');
      y.drawImage(shot, 0, 0);
      y.globalCompositeOperation = 'multiply';
      y.fillStyle = col;
      y.fillRect(0, 0, sw, sh);
      return cv;
    });
    w.shot = shot;
    w.buf = canvasOf(cw, ch);
    w.q = q;
    w.M = M;
    w.D = Math.hypot(W, H);
    w.streaks = prism();
    st.warp.width = cw;
    st.warp.height = ch;
    st.warp.hidden = false;
    w.ctx = st.warp.getContext('2d');
  }

  /* The streaks: all the way round, each its own colour of the
     spectrum by the way it points, so together they are a prism */
  function prism() {
    var out = [], n = 56;
    for (var i = 0; i < n; i++) {
      var a = (i + Math.random() * .8) / n * Math.PI * 2;
      out.push({
        a: a,
        hue: Math.round((a / (Math.PI * 2) * 360 + rand(-18, 18) + 360) % 360),
        r0: rand(.03, .26), v: rand(.5, 1.1), len: rand(.12, .34), w: rand(1.5, 5), o: rand(.45, 1)
      });
    }
    return out;
  }

  /* One frame of the cut. The close-up fades in over the dive; once it
     is over it, the dive is put back, and the cut's canvas draws the
     snapshot (through the live camera, so the two agree) and the light
     over it, until there is nothing left to draw. */
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
    if (fx.snap < .004 && fx.streak < .004 && fx.burst < .004) {
      if (t > WARP / 2) unwarp(st, run);
      return;
    }

    var g = w.ctx, q = w.q, cam = run.cam;
    var z = cam.z, F = cam.F, off = cam.off;
    /* the craft, where the camera shows it: what everything flies from */
    var O = [F[0] + (w.C[0] - F[0]) * z + off[0], F[1] + (w.C[1] - F[1]) * z + off[1]];
    /* the camera, then a further `k2` about the craft, in canvas px
       (the snapshot's own origin is M up and left of the frame's) */
    var M = w.M;
    var lens = function (b, k2, lat) {
      var s = z * k2;
      b.setTransform(s, 0, 0, s,
        q * (O[0] * (1 - k2) + k2 * (F[0] * (1 - z) + off[0]) + lat - s * M[0]),
        q * (O[1] * (1 - k2) + k2 * (F[1] * (1 - z) + off[1]) - s * M[1]));
    };

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.clearRect(0, 0, st.warp.width, st.warp.height);

    if (fx.snap > .004) {
      if (fx.blur > .01 || fx.split > .01) {
        /* the radial zoom blur, a channel at a time, each a little
           bigger or smaller than the next: copies scaled out from the
           craft, each a fifth, added up */
        var b = w.buf.getContext('2d'), N = 5;
        b.setTransform(1, 0, 0, 1, 0, 0);
        b.globalCompositeOperation = 'source-over';
        b.globalAlpha = 1;
        b.fillStyle = '#000';
        b.fillRect(0, 0, w.buf.width, w.buf.height);
        b.globalCompositeOperation = 'lighter';
        b.globalAlpha = 1 / N;
        for (var ch = 0; ch < 3; ch++) {
          var cs = 1 + (1 - ch) * .022 * fx.split;
          var lat = (1 - ch) * 7 * fx.split;
          for (var i = 0; i < N; i++) {
            lens(b, cs * (1 + .16 * fx.blur * i / (N - 1)), lat);
            b.drawImage(w.chans[ch], 0, 0);
          }
        }
        g.globalAlpha = fx.snap;
        g.drawImage(w.buf, 0, 0);
      } else {
        g.globalAlpha = fx.snap;
        lens(g, 1, 0);
        g.drawImage(w.shot, 0, 0);
        g.setTransform(1, 0, 0, 1, 0, 0);
      }
    }

    g.setTransform(q, 0, 0, q, 0, 0);
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 1;
    var D = w.D;

    if (fx.streak > .004) {
      var u = t / WARP;
      w.streaks.forEach(function (sk) {
        var r1 = (sk.r0 + u * sk.v * .5) * D;
        var r2 = r1 + sk.len * D * (.35 + .65 * fx.streak);
        var cx = Math.cos(sk.a), cy = Math.sin(sk.a);
        var x1 = O[0] + cx * r1, y1 = O[1] + cy * r1;
        var x2 = O[0] + cx * r2, y2 = O[1] + cy * r2;
        var hw = sk.w * (1 + 1.5 * u) / 2;
        var grad = g.createLinearGradient(x1, y1, x2, y2);
        grad.addColorStop(0, 'hsla(' + sk.hue + ',100%,60%,0)');
        grad.addColorStop(.55, 'hsla(' + sk.hue + ',100%,55%,' + (fx.streak * sk.o).toFixed(3) + ')');
        grad.addColorStop(1, 'hsla(' + ((sk.hue + 40) % 360) + ',100%,75%,0)');
        g.fillStyle = grad;
        g.beginPath();
        g.moveTo(x1, y1);
        g.lineTo(x2 - cy * hw, y2 + cx * hw);
        g.lineTo(x2 + cy * hw, y2 - cx * hw);
        g.closePath();
        g.fill();
      });
    }

    if (fx.burst > .004) {
      var R = D * (.04 + .3 * fx.ring), a = fx.burst;
      var rg = g.createRadialGradient(O[0], O[1], 0, O[0], O[1], R);
      rg.addColorStop(0, 'rgba(255,255,255,' + (.95 * a).toFixed(3) + ')');
      rg.addColorStop(.22, 'rgba(170,240,255,' + (.7 * a).toFixed(3) + ')');
      rg.addColorStop(.5, 'rgba(210,130,255,' + (.32 * a).toFixed(3) + ')');
      rg.addColorStop(1, 'rgba(255,120,200,0)');
      g.fillStyle = rg;
      g.fillRect(O[0] - R, O[1] - R, R * 2, R * 2);
    }

    /* the burst's shock ring, its edge split like light through glass */
    if (fx.ring > 0 && fx.ring < 1) {
      var rr = D * .55 * fx.ring;
      g.lineWidth = 14 * (1 - fx.ring);
      ['rgba(255,80,120,', 'rgba(120,255,170,', 'rgba(110,170,255,'].forEach(function (col, i) {
        g.strokeStyle = col + (.5 * (1 - fx.ring)).toFixed(3) + ')';
        g.beginPath();
        g.arc(O[0], O[1], rr * (1 + (i - 1) * .025), 0, Math.PI * 2);
        g.stroke();
      });
    }
  }

  /* the cut is over: its canvas emptied, and its buffers let go */
  function unwarp(st, run) {
    var w = run.warp;
    if (!w) return;
    run.warp = null;
    st.warp.hidden = true;
    st.warp.width = st.warp.height = 1;
    [w.shot, w.buf].concat(w.chans || []).forEach(function (cv) {
      if (cv) cv.width = cv.height = 0;
    });
  }


  /* ============================================================
     THE JETS — while they burn: their light, out from under the hull
     and pulsing; exhaust thrown down off the bottom of it; and a pulse
     heard on the hum each time one is seen. The craft's own shake is
     frame()'s (it moves the hull, not this).
     ============================================================ */

  function thrusters(st, run, s, vx, vy) {
    var t = run.t, k = run.shot.k, el = st.thrust.style;

    var lvl = Math.round(s.thrust * 20) / 20;
    if (lvl !== run.hum) {
      sfx('engine', lvl);
      run.hum = lvl;
    }

    if (s.thrust < .02 || s.anchor !== 'foot' || s.rot) {
      if (el.opacity !== '0') el.opacity = '0';
      return;
    }

    if (t >= run.pulseAt && t >= WARP - 120) {
      run.pulseT = t;
      run.pulseAt = t + rand(150, 210);
      sfx('pulse', s.thrust);
    }
    var p = Math.exp(-(t - run.pulseT) / 70);

    var c = run.data;
    var fw = (c.foot.r[0] - c.foot.l[0]) * k;
    var x = s.x + vx, y = s.y + vy;
    /* the jets reach for the ground, shorter the nearer it is */
    var reach = clamp(60, s.alt * k * .9 + 40, 300);
    var w = fw * (1.05 + .1 * p), h = reach * (1 + .12 * p);
    el.transform = 'translate(' + px(x - w / 2) + ',' + px(y - h * .25) + ') scale(' +
                   (w / 100).toFixed(3) + ',' + (h / 100).toFixed(3) + ')';
    el.opacity = (s.thrust * (.72 + .28 * p)).toFixed(3);

    /* exhaust: off random points of the hull's underside, down the jet,
       and out sideways once the ground is close enough to flatten it */
    if (t < (run.exhaustAt || 0)) return;
    run.exhaustAt = t + 40;
    var near = 1 - clamp(0, s.alt / 40, 1);
    for (var i = 0; i < 3; i++) {
      var u = Math.random(), v = Math.random();
      var a = [mix(c.foot.l[0], c.foot.b[0], u), mix(c.foot.l[1], c.foot.b[1], u)];
      var b = [mix(c.foot.f[0], c.foot.r[0], u), mix(c.foot.f[1], c.foot.r[1], u)];
      var fp = [mix(a[0], b[0], v), mix(a[1], b[1], v)];
      var side = fp[0] * k * rand(.2, .5) * (1 + 3 * near);
      emit(run, 'back', 'cine-exhaust', x + fp[0] * k, y + fp[1] * k, {
        '--sz': px(rand(9, 15) * k),
        '--dx': px(side),
        '--dy': px(reach * rand(.45, .95) * (1 - .7 * near)),
        '--dur': ms(rand(240, 380)),
        '--peak': (.55 + .45 * s.thrust).toFixed(2)
      });
    }
  }


  /* ============================================================
     THE VERDICT, SEEN — the landing's own tweens on the timeline

       fit    the impact: a ring of light out over the rock from under
              the hull. Then the match: the footprint drawn round, all
              four edges and corners, one outline -- and sparks of light
              up off it all the way round.
       miss   the mismatch: the island's top face and the craft's
              footprint outlined together while it sits there, before
              anything else happens -- two shapes, plainly not the same
     ============================================================ */

  var WIN = ['#8dffc0', '#c6ffe0', '#ffe27a', '#7ff6ff'];

  function outcome(st, run, tl) {
    var A = global.anime, c = run.data, k = run.shot.k;
    var mk = st.match.children;
    var fw = (c.foot.r[0] - c.foot.l[0]) * k;
    var mid = stagePt(run, [0, 0]);

    if (run.kind !== 'fit') {
      var hold = run.kind === 'tight' ? 520 : 660;
      tl.add({ targets: st.match, opacity: [{ value: 1, duration: 160, easing: 'easeOutQuad' },
                                            { value: 1, duration: hold },
                                            { value: 0, duration: 260, easing: 'easeInQuad' }] }, DOWN + 120);
      return;
    }

    var ring = emit(run, 'back', 'cine-shock', mid[0], mid[1], { '--sz': px(fw * 1.4) }, true);
    tl.add({ targets: ring, scale: [.3, 1.9], duration: 620, easing: 'easeOutCubic' }, DOWN)
      .add({ targets: ring, opacity: [{ value: 1, duration: 50 },
                                      { value: 0, duration: 560, easing: 'easeInQuad' }] }, DOWN);

    tl.add({ targets: st.match, opacity: [{ value: 1, duration: 140 },
                                          { value: 1, duration: 950 },
                                          { value: 0, duration: 420, easing: 'easeInQuad' }] }, DOWN + 380)
      .add({ targets: mk[6], opacity: [0, .75], duration: 360, easing: 'easeOutQuad' }, DOWN + 460)
      .add({ targets: Array.prototype.slice.call(mk, 2, 6), opacity: [0, 1], duration: 200,
             delay: A.stagger(70), easing: 'easeOutQuad' }, DOWN + 560);

    var bits = [];
    for (var i = 0; i < 26; i++) {
      var e = i % 4, a = run.quad[e], b = run.quad[(e + 1) % 4], u = Math.random();
      bits.push(emit(run, 'front', 'cine-win', mix(a[0], b[0], u), mix(a[1], b[1], u),
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
    }, DOWN + 400);
  }


  /* ============================================================
     THE CRAFT, DRAWN

     Two frames at most, cross-faded: the first at 1 - m, the second at
     m, added together ('lighter'), which keeps the craft solid through
     the fade instead of letting the sea show through it half way.
     `fClip`/`gClip` draw a frame inside its hull only (the jets and the
     painted dust left out), and `flame` is how much of what lies
     outside the hull -- the jets -- is drawn at all.
     ============================================================ */

  function draw(st, run, s) {
    var key = [s.f, s.g, Math.round(s.m * 32), s.anchor, s.fClip, s.gClip,
               Math.round(s.flame * 32)].join('|');
    if (key === run.drawn) return;
    run.drawn = key;

    var ctx = st.ctx;
    var R = run.res;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, st.canvas.width, st.canvas.height);
    ctx.setTransform(R, 0, 0, R, run.box.ax * R, run.box.ay * R);

    var two = s.g != null && s.m > 0;
    layer(ctx, run, s.f, s.anchor, two ? 1 - s.m : 1, s.fClip, s.flame, 'source-over');
    if (two) layer(ctx, run, s.g, s.anchor, s.m, s.gClip, s.flame, 'lighter');
  }

  function layer(ctx, run, i, anchor, alpha, clip, flame, op) {
    var fr = run.data.frames[i - 1];
    if (!fr || alpha <= 0) return;
    var a = fr[anchor] || fr.foot || fr.dome || fr.pool;
    var r = fr.rect;
    var hull = (clip || flame < 1) && fr.foot ? hullAt(run, i, a) : null;

    ctx.save();
    ctx.globalCompositeOperation = op;
    ctx.globalAlpha = alpha;
    if (hull) {
      ctx.save();
      path(ctx, hull);
      ctx.clip();
      blit(ctx, run, r, a);
      ctx.restore();
      if (!clip && flame > 0) {
        /* and what is outside it, the jets, at `flame` */
        ctx.beginPath();
        ctx.rect(-a[0] - 4, -a[1] - 4, r[2] + 8, r[3] + 8);
        path(ctx, hull, true);
        ctx.clip('evenodd');
        ctx.globalAlpha = alpha * flame;
        blit(ctx, run, r, a);
      }
    } else {
      blit(ctx, run, r, a);
    }
    ctx.restore();
  }

  function blit(ctx, run, r, a) {
    try {
      ctx.drawImage(run.atlas, r[0], r[1], r[2], r[3], -a[0], -a[1], r[2], r[3]);
    } catch (e) { /* the atlas never arrived: the shot plays without the craft */ }
  }

  /* frame i's hull, from its foot, expressed from the anchor it is
     being drawn by */
  function hullAt(run, i, a) {
    var foot = run.data.frames[i - 1].foot;
    return run.hulls[i - 1].map(function (p) {
      return [foot[0] + p[0] - a[0], foot[1] + p[1] - a[1]];
    });
  }

  /* a polygon pushed out from its middle by `d` */
  function grow(poly, d) {
    var cx = 0, cy = 0;
    poly.forEach(function (p) { cx += p[0] / poly.length; cy += p[1] / poly.length; });
    return poly.map(function (p) {
      var dx = p[0] - cx, dy = p[1] - cy, n = Math.hypot(dx, dy) || 1;
      return [p[0] + dx / n * d, p[1] + dy / n * d];
    });
  }

  function path(ctx, pts, keep) {
    if (!keep) ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
  }


  /* ============================================================
     PARTICLES — each one an <i>, parked by left/top and moved only by
     its CSS animation (css/cinematic.css), with its size, path, timing
     and tint as custom properties. Gone when its animation ends.
     ============================================================ */

  /* `keep`: one that burns on to the end of the shot (its animation
     never ends; the layer is emptied when the shot is over) */
  function emit(run, layer, cls, x, y, vars, keep) {
    var p = doc.createElement('i');
    p.className = 'cine-p ' + cls;
    p.style.left = px(x);
    p.style.top = px(y);
    for (var key in vars) p.style.setProperty(key, vars[key]);
    if (!keep) p.addEventListener('animationend', function () { p.remove(); });
    run.st.fx[layer].appendChild(p);
    return p;
  }

  function ms(n) { return Math.round(n) + 'ms'; }

  /* Billows: smoke, steam, dust. `rise` lifts them as they go, `flat`
     squashes them onto the ground they spread over. */
  function puffs(run, layer, x, y, n, o) {
    for (var i = 0; i < n; i++) {
      var a = o.arc ? rand(o.arc[0], o.arc[1]) : rand(0, Math.PI * 2);
      var reach = rand(o.reach[0], o.reach[1]);
      var size = rand(o.size[0], o.size[1]);
      emit(run, layer, 'cine-puff', x + (o.jitter ? rand(-o.jitter, o.jitter) : 0), y, {
        '--sz': px(size),
        '--dx': px(Math.cos(a) * reach),
        '--dy': px(Math.sin(a) * reach * (o.flat || .45) - rand(o.rise[0], o.rise[1])),
        '--dur': ms(rand(o.dur[0], o.dur[1])),
        '--delay': ms(o.delay ? rand(0, o.delay) : 0),
        '--tint': pick(o.tint),
        '--peak': (o.peak || .9).toFixed(2),
        '--grow': (o.grow || 1).toFixed(2)
      });
    }
  }

  /* Drops thrown up out of the sea: up and out, and back down */
  function drops(run, layer, x, y, n, o) {
    for (var i = 0; i < n; i++) {
      var a = o.arc ? rand(o.arc[0], o.arc[1]) : rand(0, Math.PI * 2);
      var reach = rand(o.reach[0], o.reach[1]);
      emit(run, layer, 'cine-drop', x + rand(-o.spread, o.spread), y + rand(-o.spread, o.spread) * .4, {
        '--sz': px(rand(o.size[0], o.size[1])),
        '--dx': px(Math.cos(a) * reach),
        '--up': px(-rand(o.up[0], o.up[1])),
        '--dy': px(Math.sin(a) * reach * .42 + rand(4, 18)),
        '--dur': ms(rand(o.dur[0], o.dur[1])),
        '--delay': ms(o.delay ? rand(0, o.delay) : 0)
      });
    }
  }

  /* A ring spreading out over the water, as flat as the sea is seen */
  function ripple(run, x, y, size, o) {
    o = o || {};
    emit(run, o.layer || 'sea', 'cine-ripple', x, y, {
      '--sz': px(size),
      '--dur': ms(o.dur || 1200),
      '--delay': ms(o.delay || 0),
      '--peak': (o.peak || .8).toFixed(2),
      '--from': (o.from || .2).toFixed(2)
    });
  }

  function bubbles(run, x, y, n, o) {
    for (var i = 0; i < n; i++) {
      emit(run, 'front', 'cine-bubble', x + rand(-o.spread, o.spread), y + rand(-o.spread, o.spread) * .35, {
        '--sz': px(rand(o.size[0], o.size[1])),
        '--dx': px(rand(-16, 16)),
        '--dy': px(-rand(o.rise[0], o.rise[1])),
        '--dur': ms(rand(o.dur[0], o.dur[1])),
        '--delay': ms(o.delay ? rand(0, o.delay) : 0)
      });
    }
  }

  /* Bits thrown off a hit: rock off the island, metal off the hull */
  var ROCK = ['#e8752a', '#c75a1c', '#f08a3a', '#a9481a'];
  var METAL = ['#d8dbe6', '#9da3b4', '#6f7688'];

  function chips(run, layer, x, y, n, o) {
    for (var i = 0; i < n; i++) {
      var a = o.arc ? rand(o.arc[0], o.arc[1]) : rand(0, Math.PI * 2);
      var reach = rand(o.reach[0], o.reach[1]);
      emit(run, layer, 'cine-chip', x + rand(-o.spread, o.spread), y + rand(-o.spread, o.spread) * .4, {
        '--sz': px(rand(o.size[0], o.size[1])),
        '--dx': px(Math.cos(a) * reach),
        '--up': px(-rand(o.up[0], o.up[1])),
        '--dy': px(Math.sin(a) * reach * .42 + rand(o.fall[0], o.fall[1])),
        '--rot': Math.round(rand(-540, 540)) + 'deg',
        '--dur': ms(rand(o.dur[0], o.dur[1])),
        '--delay': ms(o.delay ? rand(0, o.delay) : 0),
        '--tint': pick(o.tint)
      });
    }
  }

  function sparks(run, x, y, n, o) {
    for (var i = 0; i < n; i++) {
      var a = rand(o.arc[0], o.arc[1]);
      var reach = rand(o.reach[0], o.reach[1]);
      emit(run, 'front', 'cine-spark', x + rand(-o.spread, o.spread), y + rand(-o.spread, o.spread) * .4, {
        '--len': px(rand(o.len[0], o.len[1])),
        '--ang': (a * 180 / Math.PI).toFixed(1) + 'deg',
        '--dx': px(Math.cos(a) * reach),
        '--dy': px(Math.sin(a) * reach + rand(20, 60)),
        '--dur': ms(rand(o.dur[0], o.dur[1])),
        '--delay': ms(o.delay ? rand(0, o.delay) : 0)
      });
    }
  }

  function embers(run, x, y, n, o) {
    for (var i = 0; i < n; i++) {
      emit(run, 'front', 'cine-ember', x + rand(-o.spread, o.spread), y + rand(-o.spread, o.spread) * .4, {
        '--sz': px(rand(3, 7)),
        '--dx': px(rand(-40, 40)),
        '--dy': px(-rand(60, 160)),
        '--dur': ms(rand(900, 1600)),
        '--delay': ms(rand(0, 200))
      });
    }
  }

  var STEAM = ['rgba(255,255,255,.95)', 'rgba(236,248,255,.92)', 'rgba(214,240,255,.88)'];
  var SMOKE = ['rgba(255,255,255,.96)', 'rgba(242,238,232,.94)', 'rgba(228,224,220,.9)'];
  var DUST = ['rgba(246,214,170,.92)', 'rgba(226,186,140,.9)', 'rgba(204,160,116,.86)'];
  var SOOT = ['rgba(70,72,80,.9)', 'rgba(52,54,62,.88)', 'rgba(92,92,98,.84)'];


  /* The drop, from the end of the cut down to `down`: how high it is,
     and how fast it is still falling -- a smear straight down while
     that is fast, gone before half way, so the touchdown is sharp. */
  function descent(run, s, t, down) {
    var u = seg(t, WARP, down);
    var alt = run.shot.hi * (1 - ease.down(u));
    s.alt = alt;
    s.mb = u > 0 ? Math.pow(1 - u, DROP_POW - 1) * (1 - seg(u, .25, .45)) : 0;
    return alt;
  }

  /* the jets, by height: full in the air, throttled back over the last
     of the drop, cut as it touches */
  function burn(alt) {
    return clamp(0, alt / 8, 1) * (.55 + .45 * clamp(0, alt / 60, 1));
  }


  /* ============================================================
     FIT — down onto an island its own size, and nothing else happens

       0      the cut; in the air, jets long
       500    the drop, braking all the way
       1600   down: the jets are cut, a ring of light out over the
              rock, the smoke spreads and clears
       2000   the seam where hull meets rock lights up, the footprint
              is outlined edge for edge, and the sparks fly
     ============================================================ */

  var FIT_DOWN = DOWN;

  function fitShot(t, s, run) {
    var shot = run.shot, k = shot.k, c = run.data;
    var alt = descent(run, s, t, FIT_DOWN);

    s.y = shot.at[1] - alt * k;
    /* the landing gear takes the weight, and gives it back */
    s.y += 2.4 * Math.sin(Math.PI * seg(t, FIT_DOWN, FIT_DOWN + 300));

    /* on the way down, the frame whose jets reach the ground from this
       high; once down, the smoke clearing */
    if (t < FIT_DOWN) {
      ladder(s, [[153, 1], [108, 2], [80, 3], [55, 4], [40, 5], [26, 6], [12, 7], [0, 8]], alt);
    } else {
      ladder(s, [[FIT_DOWN, 8], [FIT_DOWN + 240, 9], [FIT_DOWN + 480, 10],
                 [FIT_DOWN + 720, 11], [FIT_DOWN + 1000, 12]], t);
    }

    s.glow = t < FIT_DOWN ? clamp(0, (200 - alt) / 150, 1) * .9 : .9 * (1 - seg(t, FIT_DOWN, FIT_DOWN + 650));
    s.shade = 1;
    s.thrust = t < FIT_DOWN ? burn(alt) : 0;
    guideFor(run, s, alt, true);

    if (once(run, 'burn')) sound(4);
    if (alt < 70 && once(run, 'throttle')) sound(2);

    /* the jets' wash on the rock, spreading out from under it as it
       comes in over the last of the drop */
    var foot = stagePt(run, [0, 0]);
    every(run, 'wash', t, FIT_DOWN - 450, FIT_DOWN + 250, 90, function () {
      puffs(run, 'back', foot[0], foot[1] - 10, 2, {
        size: [70, 130], reach: [180, 300], rise: [10, 40], flat: .42,
        dur: [1100, 1700], tint: SMOKE, peak: .75, jitter: 60
      });
    });

    if (t >= FIT_DOWN && once(run, 'touchdown')) {
      sound(0);
      sfx('clank', 1);
      shake(run, 2.2, 320);
      punch(run, .016, 320);
      /* the last of the jets' smoke squeezed out from under the hull as
         the weight comes on, rolling out flat along the rock */
      skirt(run, c, 7, SMOKE, .6);
      call(run, 'onTouchdown');
    }

    if (t >= FIT_DOWN + 400 && once(run, 'seam')) {
      lightSeam(run, c);
      sfx('sparkle');
    }
    if (t >= FIT_DOWN + 400 && once(run, 'settle')) call(run, 'onSettle');
  }

  /* Billows out from under the craft along the two front edges of its
     base, each pushed away from the hull, on the ground. */
  function skirt(run, c, n, tint, peak) {
    var k = run.shot.k;
    var mid = stagePt(run, [0, 0]);
    [['lb', 'f'], ['f', 'rb']].forEach(function (e) {
      var a = c.hull[e[0]], b = c.hull[e[1]];
      for (var i = 0; i < n; i++) {
        var w = (i + .5) / n;
        var p = stagePt(run, [mix(a[0], b[0], w), mix(a[1], b[1], w)]);
        var out = Math.atan2(p[1] - mid[1], p[0] - mid[0]);
        puffs(run, 'front', p[0], p[1] + 4 * k, 1, {
          size: [60, 100], reach: [70, 150], rise: [0, 16], flat: .45,
          dur: [900, 1400], tint: tint, peak: peak, arc: [out - .35, out + .35]
        });
      }
    });
  }

  /* The base of the hull, where it meets the rock: drawn out from the
     front corner to the left and right ones, so the eye runs along the
     two edges that match. */
  function lightSeam(run, c) {
    var st = run.st;
    var f = stagePt(run, c.hull.f), l = stagePt(run, c.hull.lb), r = stagePt(run, c.hull.rb);
    var lines = st.seam.querySelectorAll('polyline');
    lines[0].setAttribute('points', f.join(',') + ' ' + l.join(','));
    lines[1].setAttribute('points', f.join(',') + ' ' + r.join(','));
    st.seam.classList.remove('is-lit');
    void st.seam.getBoundingClientRect();
    st.seam.classList.add('is-lit');
    [l, f, r].forEach(function (p, i) {
      emit(run, 'front', 'cine-glint', p[0], p[1], { '--delay': ms(260 + i * 120) });
    });
  }


  /* ============================================================
     TIGHT — too small: off the edge and into the sea

       0      the cut; then coming down over an island smaller than its
              own base, its jets reaching past the rock onto the water
       1600   down on it, overhanging all round, jets cut; the island
              and the footprint outlined, plainly not the same
       1600   it rocks on the island's edges, harder each time, and the
              edges crumble
       2600   it tips off the left-hand side, its jets sputtering
       3300   into the sea
       5180   gone under; the water closes
     ============================================================ */

  var TIGHT_DOWN = DOWN;
  var TIGHT_TIP = 2600;
  var TIGHT_HIT = 3300;
  var TIGHT_GONE = TIGHT_HIT + 1880;

  function tightShot(t, s, run) {
    var shot = run.shot, k = shot.k, c = run.data;
    var P = shot.at;
    var I = stagePt(run, shot.splash);
    var fr1 = c.frames[0], fr7 = c.frames[6];

    if (t < TIGHT_TIP) {
      var alt = descent(run, s, t, TIGHT_DOWN);
      s.anchor = 'foot';
      s.y = P[1] - alt * k + 2 * Math.sin(Math.PI * seg(t, TIGHT_DOWN, TIGHT_DOWN + 260));
      /* both level frames, in turn: the jets flicker */
      s.f = 1 + (Math.floor(t / 95) % 2);
      /* throttled back over the last of the drop, and cut once down */
      s.flame = clamp(0, (alt - 12) / 50, 1);
      s.thrust = s.flame;
      s.glow = clamp(0, (200 - alt) / 150, 1) * s.flame * .85;
      s.shade = 1;
      guideFor(run, s, alt, false);

      /* rocking on the edges of a footing too small for it: about the
         left-hand corner of the island when it dips left, the right-hand
         one when it dips right, harder each time */
      if (t >= TIGHT_DOWN) {
        var u = (t - TIGHT_DOWN) / 1000;
        var amp = mix(.9, 5.2, seg(t, TIGHT_DOWN + 120, TIGHT_TIP));
        s.rot = amp * Math.sin(Math.PI * 2 * 2.3 * u) * seg(t, TIGHT_DOWN, TIGHT_DOWN + 150);
        s.pivot = s.rot < 0 ? c.top.l : c.top.r;
      }
    } else if (t < TIGHT_HIT) {
      /* tipping off: the sheet's own tipping frames, carried over the
         left-hand edge. It rotates over the edge, so its middle stays at
         much the same height while the low side swings down into the sea;
         and it goes faster as it goes. */
      var v = seg(t, TIGHT_TIP, TIGHT_HIT);
      s.anchor = 'dome';
      ladder(s, [[0, 3], [.28, 4], [.56, 5], [.84, 6]], v, .25);
      var d0 = [P[0] + (fr1.dome[0] - fr1.foot[0]) * k, P[1] + (fr1.dome[1] - fr1.foot[1]) * k];
      var d1 = [I[0] + (fr7.dome[0] - fr7.pool[0]) * k, I[1] + (fr7.dome[1] - fr7.pool[1]) * k];
      var go = .3 * v + .7 * v * v;
      s.x = mix(d0[0], d1[0], go);
      s.y = mix(d0[1], d1[1], go) + 26 * Math.sin(Math.PI * v);
      s.rot = -5 * ease.inOut(v);
      s.shade = 1 - v;
      s.alt = 30 + 50 * v;
      s.ground = [s.x, P[1]];
    } else {
      /* in: the sheet's splash and sinking frames, held on the point it
         went in at */
      s.anchor = 'pool';
      s.x = I[0];
      s.y = I[1];
      var H = TIGHT_HIT;
      ladder(s, [[H, 7], [H + 150, 8], [H + 300, 9], [H + 460, 10], [H + 620, 11], [H + 780, 12],
                 [H + 960, 13], [H + 1140, 14], [H + 1320, 15], [H + 1500, 16], [H + 1660, 17],
                 [H + 1800, 18]], t, .3);
      s.alpha = 1 - seg(t, TIGHT_GONE, TIGHT_GONE + 480);
    }

    if (once(run, 'burn')) sound(4);
    if (t >= TIGHT_DOWN - 500 && once(run, 'throttle')) sound(2);

    /* the jets on the sea past the rock, from the three corners that
       hang out over it */
    var corners = ['l', 'f', 'r'].map(function (key) {
      var p = stagePt(run, c.foot[key]);
      return [p[0], p[1] + run.sink];
    });
    every(run, 'spray', t, WARP + 160, TIGHT_DOWN - 120, 110, function () {
      corners.forEach(function (p) {
        puffs(run, 'sea', p[0], p[1], 1, {
          size: [44, 84], reach: [40, 110], rise: [20, 60], flat: .45,
          dur: [700, 1100], tint: STEAM, peak: .8, jitter: 14
        });
        drops(run, 'sea', p[0], p[1], 2, {
          size: [4, 9], reach: [30, 90], up: [30, 80], dur: [480, 760], spread: 12
        });
      });
    });
    every(run, 'rings', t, WARP + 300, TIGHT_DOWN, 300, function () {
      corners.forEach(function (p) { ripple(run, p[0], p[1], 120, { dur: 900, peak: .7 }); });
    });

    if (t >= TIGHT_DOWN && once(run, 'touchdown')) {
      sound(0);
      sfx('clank', .7);
      shake(run, 2, 260);
      skirt(run, c, 5, STEAM, .55);
    }
    if (t >= TIGHT_DOWN + 300 && once(run, 'settle')) call(run, 'onSettle');

    /* the edges it is rocking on giving way: grit off the top of the
       walls, down into the sea */
    every(run, 'crumble', t, TIGHT_DOWN + 300, TIGHT_TIP + 200, 170, function () {
      var e = pick([['l', 'f'], ['f', 'r'], ['l', 'f']]);
      var a = c.top[e[0]], b = c.top[e[1]], w = rand(.1, .9);
      var p = stagePt(run, [mix(a[0], b[0], w), mix(a[1], b[1], w)]);
      chips(run, 'front', p[0], p[1], 2, {
        size: [5, 10], reach: [4, 24], up: [2, 10], fall: [run.sink + 8, run.sink + 22],
        dur: [520, 760], spread: 6, tint: ROCK, arc: [Math.PI * .3, Math.PI * .7]
      });
      ripple(run, p[0], p[1] + run.sink + 14, 46, { delay: 420, dur: 700, peak: .6 });
    });

    if (t >= TIGHT_TIP && once(run, 'tip')) {
      sound(3);
      sfx('sputter');
    }

    if (t >= TIGHT_HIT && once(run, 'hit')) {
      sound(0);
      sfx('crash', .45);
      sfx('splash');
      shake(run, 10, 760);
      flash(run.st, I, .38, 460, 'rgba(200, 245, 255, .55)');
      /* the crown: thrown high and wide, more of it in front... */
      drops(run, 'front', I[0], I[1] - 30, 36, {
        size: [8, 18], reach: [100, 330], up: [150, 360], dur: [750, 1250], spread: 80, arc: [0, Math.PI]
      });
      drops(run, 'back', I[0], I[1] - 40, 22, {
        size: [7, 15], reach: [70, 260], up: [170, 380], dur: [800, 1300], spread: 80, arc: [Math.PI, Math.PI * 2]
      });
      /* ...a column straight up out of the middle... */
      drops(run, 'front', I[0], I[1] - 40, 14, {
        size: [9, 20], reach: [0, 50], up: [260, 460], dur: [950, 1350], spread: 36,
        arc: [Math.PI * 1.35, Math.PI * 1.65]
      });
      /* ...white water, and the sea thrown open round it */
      puffs(run, 'front', I[0], I[1] - 20, 12, {
        size: [110, 200], reach: [80, 240], rise: [60, 160], flat: .45,
        dur: [1000, 1600], tint: STEAM, peak: .85
      });
      emit(run, 'sea', 'cine-foam', I[0], I[1] + 24, { '--sz': px(640), '--dur': ms(1700), '--delay': '0ms' });
      for (var i = 0; i < 4; i++) {
        ripple(run, I[0], I[1] + 30, 560 + i * 150, { delay: 120 + i * 220, dur: 1500 + i * 220, peak: .85 - i * .15 });
      }
      call(run, 'onImpact', 'water');
    }

    /* going under: air coming up through the water, and the rings */
    every(run, 'bubbles', t, TIGHT_HIT + 260, TIGHT_GONE + 500, 120, function () {
      bubbles(run, I[0], I[1] + 10, 2, { size: [9, 24], rise: [70, 170], dur: [900, 1500], spread: 100 });
    });
    every(run, 'calm', t, TIGHT_HIT + 1100, TIGHT_GONE + 400, 520, function () {
      ripple(run, I[0], I[1] + 30, 440, { dur: 1500, peak: .45 });
    });
  }


  /* ============================================================
     LOOSE — too big: nothing to lock on to, and wrecked on the rock

       0      the cut; then in the air over far more island than it needs
       1600   down in a cloud of dust, the edges of the island nowhere
              near its own: the island and the footprint outlined
       2700   it slides, and rocks, harder each time
       3500   one side lifts...
       4020   ...and it comes down hard: wrecked, and smoking
     ============================================================ */

  var LOOSE_DOWN = DOWN;
  var LOOSE_BARE = 2700;
  var LOOSE_LIFT = 3500;
  var LOOSE_DROP = 3880;
  var LOOSE_HIT = 4020;

  function looseShot(t, s, run) {
    var shot = run.shot, k = shot.k, c = run.data;
    var P = shot.at;
    var alt = descent(run, s, t, LOOSE_DOWN);
    /* the hull it is rocked and wrecked as: the last frame's, lt b rt
       rb f lb, from its foot */
    var hull = c.frames[7].hull;
    var LB = hull[5], RB = hull[3];

    s.y = P[1] - alt * k + 3 * Math.sin(Math.PI * seg(t, LOOSE_DOWN, LOOSE_DOWN + 240));
    s.shade = 1;
    s.thrust = t < LOOSE_DOWN ? burn(alt) : 0;

    if (t < LOOSE_DOWN) {
      ladder(s, [[108, 1], [86, 2], [46, 3], [22, 4], [0, 5]], alt);
    } else if (t < LOOSE_BARE - 120) {
      ladder(s, [[LOOSE_DOWN, 5], [LOOSE_DOWN + 220, 6], [LOOSE_DOWN + 440, 7]], t, .5);
    } else {
      /* the painted dust gives way to the craft alone, which can then be
         rocked without its cloud rocking with it -- under a cloud of the
         shot's own, so the swap is never seen */
      s.f = 7;
      s.g = 8;
      s.gClip = true;
      s.m = seg(t, LOOSE_BARE - 120, LOOSE_BARE);
      if (s.m >= 1) { s.f = 8; s.g = null; s.fClip = true; }
    }
    s.glow = t < LOOSE_DOWN ? clamp(0, (200 - alt) / 150, 1) * .85 : .85 * (1 - seg(t, LOOSE_DOWN, LOOSE_DOWN + 500));
    guideFor(run, s, alt, false);

    /* nothing holding it: it slides along the rock, and rocks on it,
       about whichever edge of the hull is down */
    var slide = 36 * ease.out(seg(t, LOOSE_BARE, LOOSE_LIFT));
    var dir = [(c.top.r[0] - c.top.l[0]), (c.top.r[1] - c.top.l[1])];
    var dl = Math.hypot(dir[0], dir[1]) || 1;
    s.x += slide * dir[0] / dl;
    s.y += slide * dir[1] / dl;

    if (t >= LOOSE_BARE && t < LOOSE_LIFT) {
      var amp = mix(1.2, 5.6, seg(t, LOOSE_BARE, LOOSE_LIFT));
      s.rot = amp * Math.sin(Math.PI * 2 * 2.6 * (t - LOOSE_BARE) / 1000) * seg(t, LOOSE_BARE, LOOSE_BARE + 160);
      s.pivot = s.rot < 0 ? LB : RB;
    } else if (t >= LOOSE_LIFT && t < LOOSE_DROP) {
      /* one side heaves up, on the other edge... */
      s.rot = 17 * ease.out(seg(t, LOOSE_LIFT, LOOSE_DROP));
      s.pivot = RB;
    } else if (t >= LOOSE_DROP && t < LOOSE_HIT) {
      /* ...and drops */
      s.rot = 17 * (1 - ease.in(seg(t, LOOSE_DROP, LOOSE_HIT)));
      s.pivot = RB;
    } else if (t >= LOOSE_HIT) {
      /* the bounce off the rock, and down onto the corner it smashed */
      var b = seg(t, LOOSE_HIT, LOOSE_HIT + 360);
      s.rot = -3.6 * Math.sin(Math.PI * Math.min(1, b * 1.6)) * (1 - b) - 2.4 * ease.out(b);
      s.pivot = LB;
      s.dark = seg(t, LOOSE_HIT, LOOSE_HIT + 500);
    }

    if (once(run, 'burn')) sound(4);
    if (alt < 60 && once(run, 'throttle')) sound(2);

    var foot = [s.x, P[1]];
    if (t >= LOOSE_DOWN - 250 && once(run, 'touchdown')) {
      sound(0);
      shake(run, 3.2, 360);
      /* the big island, swept by the jets: dust out over all of it */
      puffs(run, 'back', foot[0], foot[1], 10, {
        size: [80, 150], reach: [220, 380], rise: [10, 60], flat: .42,
        dur: [1300, 2000], tint: DUST, peak: .82, jitter: 50
      });
      puffs(run, 'front', foot[0], foot[1] + 50, 8, {
        size: [70, 130], reach: [200, 340], rise: [0, 40], flat: .4,
        dur: [1200, 1800], tint: DUST, peak: .78, arc: [-.2, Math.PI + .2]
      });
      chips(run, 'front', foot[0], foot[1] + 20, 10, {
        size: [6, 13], reach: [80, 240], up: [40, 140], fall: [10, 40], dur: [700, 1100],
        spread: 40, tint: ROCK
      });
    }
    if (t >= LOOSE_DOWN && once(run, 'clank')) sfx('clank', .85);
    if (t >= LOOSE_DOWN + 650 && once(run, 'settle')) call(run, 'onSettle');

    /* the dust it left, hanging round the hull while the painted cloud
       gives way to it */
    if (t >= LOOSE_BARE - 300 && once(run, 'haze')) {
      skirt(run, c, 6, DUST, .9);
      puffs(run, 'front', foot[0], foot[1] + 20, 10, {
        size: [110, 190], reach: [60, 220], rise: [20, 80], flat: .45,
        dur: [1300, 2000], tint: DUST, peak: .9
      });
    }

    /* scraping as it slides and rocks: sparks off the low edge */
    every(run, 'scrape', t, LOOSE_BARE + 150, LOOSE_LIFT + 200, 120, function () {
      /* off the corner that is down, thrown out past it and up */
      var left = s.rot < 0;
      var edge = left ? LB : RB;
      var p = [s.x + (edge[0] + rand(-8, 8)) * k, s.y + edge[1] * k];
      sparks(run, p[0], p[1], 4, {
        arc: left ? [Math.PI * .95, Math.PI * 1.3] : [-Math.PI * .3, Math.PI * .05],
        reach: [40, 110], len: [10, 22], dur: [260, 480], spread: 6
      });
    });

    if (t >= LOOSE_HIT && once(run, 'hit')) {
      var hit = [s.x + LB[0] * k * .7, s.y + LB[1] * k];
      var mid = [s.x, s.y + hull[4][1] * k * .4];
      sfx('crash', 1);
      sfx('bass');
      shake(run, 14, 900);
      punch(run, .045, 520);
      flash(run.st, hit, .62, 440, 'rgba(255, 226, 170, .65)');
      /* the shock through the rock, and the rock thrown up */
      ripple(run, mid[0], mid[1], 620, { layer: 'back', dur: 620, peak: .75, from: .12 });
      sparks(run, hit[0], hit[1], 30, {
        arc: [Math.PI * .85, Math.PI * 2.15], reach: [90, 300], len: [16, 40], dur: [380, 760], spread: 40
      });
      chips(run, 'front', hit[0], hit[1], 18, {
        size: [8, 18], reach: [100, 340], up: [70, 260], fall: [20, 80], dur: [850, 1300],
        spread: 60, tint: ROCK
      });
      /* and bits of the craft */
      chips(run, 'front', hit[0], hit[1] - 24, 12, {
        size: [7, 15], reach: [70, 280], up: [90, 280], fall: [10, 60], dur: [750, 1200],
        spread: 50, tint: METAL
      });
      puffs(run, 'front', hit[0], hit[1], 14, {
        size: [120, 220], reach: [120, 340], rise: [40, 140], flat: .45,
        dur: [1400, 2200], tint: DUST, peak: .88
      });
      puffs(run, 'back', mid[0], mid[1], 10, {
        size: [110, 190], reach: [260, 420], rise: [10, 50], flat: .36,
        dur: [1500, 2200], tint: DUST, peak: .8
      });
      /* the corner that took it, burning: tongues of fire up its left-hand
         edge and along the foot of the wall, on a glow of their own */
      var LT = hull[0], F = hull[4];
      [[LT, LB, .55, 19, 0], [LT, LB, .9, 14, 90], [LB, F, .18, 16, 40], [LB, F, .4, 11, 140]].forEach(function (f) {
        var x = s.x + mix(f[0][0], f[1][0], f[2]) * k, y = s.y + mix(f[0][1], f[1][1], f[2]) * k;
        if (f[4] === 0) emit(run, 'front', 'cine-fireglow', x, y, { '--sz': px(70 * k) }, true);
        emit(run, 'front', 'cine-fire', x, y, {
          '--sz': px(f[3] * k), '--delay': ms(f[4]), '--flick': ms(150 + f[4] / 2)
        }, true);
      });
      call(run, 'onImpact', 'land');
    }

    /* wrecked: smoke off it, embers in the smoke */
    var top = [s.x + (hull[0][0] + hull[2][0]) / 2 * k, s.y + (hull[0][1] + hull[2][1]) / 2 * k];
    every(run, 'smoke', t, LOOSE_HIT + 60, run.shot.ms, 110, function () {
      puffs(run, 'front', top[0] + rand(-60, 30) , top[1] + rand(-10, 20), 1, {
        size: [80, 140], reach: [0, 50], rise: [200, 330], flat: .3,
        dur: [1600, 2400], tint: SOOT, peak: .85, grow: 1.7
      });
    });
    every(run, 'embers', t, LOOSE_HIT + 100, run.shot.ms, 200, function () {
      embers(run, top[0] - 30, top[1] + 20, 3, { spread: 60 });
    });
  }


  /* ============================================================ */

  /* The sheets are the SQUARE's, so only its screen is dressed: there
     they are the fallback when its two-picture shots cannot play
     (js/square-landing.js). Every other round's cut-scene is those
     shots alone, from its own pictures, or the landing from overhead. */
  function init(stage) {
    if (!ART) return;
    (stage || doc).querySelectorAll('.screen[data-cinema][data-shape="square"]').forEach(dress);
  }

  global.GeoCinema = {
    init: init,
    has: has,
    play: play,
    stop: stop,
    /* silence the shot's synthesised effects (js/cinematic-sfx.js) */
    mute: function (on) {
      var S = global.GeoCinemaSFX;
      return S ? S.mute(on) : false;
    }
  };
})(window);
