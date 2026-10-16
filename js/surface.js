/* ============================================================
   Geo Drone — THE SURFACE: moving water over the reef

   The reef (js/reef.js) gave the flown landing a deeper sea with
   rocks under it. This is what the top of that water is doing:
   light and wind on it, and the water answering what stands in it.
   A screen opts in the same way it opts into the reef, with
   `data-reef`; css/surface.css styles everything this builds.

   ── the four pieces ───────────────────────────────────────────

     .surface__net   the caustic net: thin cyan-white lines of
                     focused sunlight, joined up into cells. One
                     tile, drawn ONCE into a canvas at boot (Worley
                     F2 - F1, domain-warped so no edge is straight),
                     and laid as a repeating background on two
                     sheets that drift across each other.
     .curl           a few thin, tapered, curling wave crests on the
                     open water. Each fades in, drifts a little and
                     fades out, and is moved somewhere new and given
                     a new shape while it is invisible.
     .contour        wobbly glowing outlines round each island: two
                     hugging the coast and trading places, and three
                     running out from it and fading.
     .eddy           broken rings round each rock under the water,
                     opening out and turning a little, as the water
                     goes round them.

   ── what follows what ─────────────────────────────────────────

   The contours are built INTO each island (as js/water.js builds
   its ripples), in per cent of its box, so they go wherever the
   island goes and grow with it. The eddies copy each rock's own
   placement (--x, --y, --w, --r, --f) off its style whenever that
   changes, through a MutationObserver, so a rock strewn somewhere
   new takes its eddy with it. The curls are strewn on the screen's
   reset, clear of the islands, the craft and the controls, and each
   one is re-strewn against where things are NOW every time it
   fades out. Everything is in per cent of the frame or in vmin, so
   a resize keeps all of it in place.

   ── what it costs ─────────────────────────────────────────────

   No loop. Every moving thing is a CSS transform or opacity
   animation on its own element, which the compositor runs; the
   only JS after boot is a handful of attribute writes when a curl
   finishes a cycle (one every few seconds across the screen). No
   blur filter anywhere: glow is a wide, faint stroke under a thin,
   bright one, and the net's softness is baked into its tile.

   ── load order ────────────────────────────────────────────────

   After js/pages.js (the islands' outlines), js/water.js (which
   sets the island variables this centres on) and js/reef.js (the
   rocks). init() from boot() in js/script.js after the reef's,
   strew() from the round's reset after the reef's. Without this
   file the reef plays exactly as it did.
   ============================================================ */

(function (global) {
  'use strict';

  var doc = document;
  var TAU = Math.PI * 2;

  /* ---------------------------------------------------------- tuning */

  /* The net's tile. GRID x GRID cells to a tile, each with one
     jittered point; the line widths are in tile units. */
  var NET = {
    grid: 5,
    jitter: [0.08, 0.92],
    warp: 0.036,
    core: 0.0072,
    glow: 0.036,
    seed: 7
  };

  /* how many crests are on the water at once */
  var CURLS = 7;

  /* the contours, in box units (1 = 1% of an island's box) outside
     the coast: where each one is drawn before it moves */
  var HUG = [2.6, 3.4];
  var RUN = [4.2, 4.6, 5.0];

  var TRIES = 50;

  var ready = false;
  var netURL = null;


  /* ---------------------------------------------------------- helpers */

  function rnd(lo, hi) { return lo + Math.random() * (hi - lo); }
  function r2(n) { return Math.round(n * 100) / 100; }
  function r1(n) { return Math.round(n * 10) / 10; }

  /* a small seeded generator, so the net is the same tile every boot */
  function seeded(s) {
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function leanDevice() {
    var cores = global.navigator && global.navigator.hardwareConcurrency;
    return typeof cores === 'number' && cores > 0 && cores <= 4;
  }

  /* An outline's vertices in box units, off the shape's own clip
     polygon in js/pages.js -- the same string the shore and the tap
     target are built from. */
  function vertices(land) {
    var n = land.clip.match(/-?[\d.]+(?=%)/g).map(Number);
    var pts = [], i;
    for (i = 0; i < n.length; i += 2) pts.push([n[i], n[i + 1]]);
    return pts;
  }

  /* A closed, smooth path through `pts` (Catmull-Rom as cubics). */
  function smoothClosed(pts) {
    var n = pts.length, d = 'M' + r2(pts[0][0]) + ' ' + r2(pts[0][1]), i;
    for (i = 0; i < n; i++) {
      var p0 = pts[(i - 1 + n) % n], p1 = pts[i];
      var p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      d += 'C' + r2(p1[0] + (p2[0] - p0[0]) / 6) + ' ' + r2(p1[1] + (p2[1] - p0[1]) / 6) +
           ' ' + r2(p2[0] - (p3[0] - p1[0]) / 6) + ' ' + r2(p2[1] - (p3[1] - p1[1]) / 6) +
           ' ' + r2(p2[0]) + ' ' + r2(p2[1]);
    }
    return d + 'Z';
  }

  /* An open, smooth path through `pts`. */
  function smoothOpen(pts) {
    var n = pts.length, d = 'M' + r2(pts[0][0]) + ' ' + r2(pts[0][1]), i;
    for (i = 0; i < n - 1; i++) {
      var p0 = pts[Math.max(i - 1, 0)], p1 = pts[i];
      var p2 = pts[i + 1], p3 = pts[Math.min(i + 2, n - 1)];
      d += 'C' + r2(p1[0] + (p2[0] - p0[0]) / 6) + ' ' + r2(p1[1] + (p2[1] - p0[1]) / 6) +
           ' ' + r2(p2[0] - (p3[0] - p1[0]) / 6) + ' ' + r2(p2[1] - (p3[1] - p1[1]) / 6) +
           ' ' + r2(p2[0]) + ' ' + r2(p2[1]);
    }
    return d;
  }

  /* A wobble round a closed curve: the sum of two waves whose counts
     are whole numbers, so it meets itself where it started. */
  function wobbler(amp) {
    var k1 = 3 + Math.floor(Math.random() * 3);
    var k2 = 7 + Math.floor(Math.random() * 4);
    var p1 = Math.random() * TAU, p2 = Math.random() * TAU;
    return function (u) {
      return amp * (Math.sin(TAU * k1 * u + p1) * 0.7 + Math.sin(TAU * k2 * u + p2) * 0.3);
    };
  }

  /* A broken stroke, as a dash pattern over a path of length 100:
     two to four long runs with short gaps, summing to exactly 100 so
     the pattern closes on itself. */
  function breaks(runs, gap) {
    var n = runs[0] + Math.floor(Math.random() * (runs[1] - runs[0] + 1));
    var gaps = [], lens = [], total = 0, i;
    for (i = 0; i < n; i++) {
      gaps.push(rnd(gap[0], gap[1]));
      lens.push(rnd(0.6, 1.4));
    }
    var room = 100 - gaps.reduce(function (a, b) { return a + b; }, 0);
    var sum = lens.reduce(function (a, b) { return a + b; }, 0);
    var out = [];
    for (i = 0; i < n; i++) {
      var dash = i === n - 1 ? 100 - total - gaps[i] : r1(lens[i] / sum * room);
      out.push(r1(dash), r1(gaps[i]));
      total += r1(dash) + r1(gaps[i]);
    }
    return out.join(' ');
  }


  /* ============================================================
     THE NET — one tile, drawn once
     ============================================================ */

  /* Worley noise on a torus: GRID x GRID jittered points, and for
     each pixel the gap between its nearest point and its second
     nearest. That gap is zero on the boundary between two cells, so
     a falloff on it draws the cell walls -- which is what a caustic
     net is. The pixel is pushed about by a few periodic waves first,
     so the walls bend. Every wave has a whole number of periods
     across the tile, and the points wrap, so the tile repeats with no
     seam. */
  function drawNet(size) {
    var rand = seeded(NET.seed);
    var G = NET.grid;
    var px = [], py = [], i, j;
    for (j = 0; j < G; j++) {
      for (i = 0; i < G; i++) {
        px.push((i + NET.jitter[0] + rand() * (NET.jitter[1] - NET.jitter[0])) / G);
        py.push((j + NET.jitter[0] + rand() * (NET.jitter[1] - NET.jitter[0])) / G);
      }
    }
    var ph = [rand(), rand(), rand(), rand(), rand(), rand()].map(function (v) { return v * TAU; });

    var canvas = doc.createElement('canvas');
    canvas.width = canvas.height = size;
    var ctx = canvas.getContext('2d');
    if (!ctx) return null;
    var img = ctx.createImageData(size, size);
    var data = img.data;
    var W = NET.warp, core = NET.core, glow = NET.glow;

    for (var y = 0; y < size; y++) {
      var v = (y + 0.5) / size;
      for (var x = 0; x < size; x++) {
        var u = (x + 0.5) / size;

        var qx = u + W * (Math.sin(TAU * (2 * v) + ph[0]) + 0.5 * Math.sin(TAU * (3 * u + 2 * v) + ph[1]));
        var qy = v + W * (Math.sin(TAU * (2 * u) + ph[2]) + 0.5 * Math.sin(TAU * (2 * u - 3 * v) + ph[3]));
        qx -= Math.floor(qx);
        qy -= Math.floor(qy);

        var ci = Math.floor(qx * G), cj = Math.floor(qy * G);
        var f1 = 9, f2 = 9;
        for (var dj = -1; dj <= 1; dj++) {
          var jj = (cj + dj + G) % G;
          for (var di = -1; di <= 1; di++) {
            var ii = (ci + di + G) % G;
            var k = jj * G + ii;
            var dx = qx - px[k], dy = qy - py[k];
            dx -= Math.round(dx);
            dy -= Math.round(dy);
            var d = dx * dx + dy * dy;
            if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
          }
        }
        var e = Math.sqrt(f2) - Math.sqrt(f1);

        /* the thin line and the light round it */
        var c = Math.max(0, 1 - e / core);
        c = c * c * (3 - 2 * c);
        var g = Math.exp(-e / glow * 2.4);

        /* The light gathers in some places and all but goes in
           others, so the net is patches of light on the water and
           not a mesh over all of it. */
        var f = (0.5 + 0.5 * Math.sin(TAU * (u + 2 * v) + ph[4])) *
                (0.5 + 0.5 * Math.sin(TAU * (2 * u - v) + ph[5]));
        var m = 0.14 + 0.86 * Math.pow(f, 0.8);

        var a = Math.min(1, (c * 0.9 + g * 0.34) * m);
        var o = (y * size + x) * 4;
        /* cyan in the glow, near-white on the line */
        data[o]     = 150 + 90 * c;
        data[o + 1] = 232 + 22 * c;
        data[o + 2] = 255;
        data[o + 3] = a * 255;
      }
    }

    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  /* After boot, off the critical path: the net is needed two screens
     later. Handed to every reef screen as a custom property, so the
     sheets light up the moment it exists. */
  function buildNet(screens, lean) {
    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    /* the first sheet's tile is 60vmin (css/surface.css) */
    var tile = Math.min(global.innerWidth, global.innerHeight) * 0.6 * (lean ? 1 : dpr);
    var size = Math.max(256, Math.min(704, Math.round(tile / 32) * 32));

    var canvas = drawNet(size);
    if (!canvas) return;

    function hand(url) {
      netURL = url;
      screens.forEach(function (s) {
        s.style.setProperty('--surface-net', 'url("' + url + '")');
        s.classList.add('is-netted');
      });
    }

    if (canvas.toBlob && global.URL && URL.createObjectURL) {
      canvas.toBlob(function (blob) {
        if (blob) hand(URL.createObjectURL(blob));
      }, 'image/png');
    } else {
      hand(canvas.toDataURL('image/png'));
    }
  }


  /* ============================================================
     THE CONTOURS — round each island
     ============================================================ */

  /* The coast pushed out by `off` box units, as a smooth closed
     curve with a wobble on it. Along each edge the curve is the edge
     moved straight out; round each corner it is an arc -- the shape
     a constant distance from a polygon -- so a square's contour is a
     square with soft corners, and the wobble makes it water. */
  function contourPath(pts, off, amp, samples) {
    var n = pts.length, segs = [], total = 0, i;
    var cx = 0, cy = 0;
    pts.forEach(function (p) { cx += p[0] / n; cy += p[1] / n; });

    /* each edge's outward normal (every outline here is convex) */
    for (i = 0; i < n; i++) {
      var a = pts[i], b = pts[(i + 1) % n];
      var len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      var nx = (b[1] - a[1]) / len, ny = -(b[0] - a[0]) / len;
      var mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      if ((mx + nx - cx) * (mx + nx - cx) + (my + ny - cy) * (my + ny - cy) <
          (mx - cx) * (mx - cx) + (my - cy) * (my - cy)) { nx = -nx; ny = -ny; }
      segs.push({ a: a, b: b, len: len, nx: nx, ny: ny });
    }

    /* the offset curve's own parts: an edge, then the arc round the
       corner at its far end */
    var parts = [];
    for (i = 0; i < n; i++) {
      var s = segs[i], t = segs[(i + 1) % n];
      parts.push({ kind: 'edge', s: s, len: s.len });
      var a0 = Math.atan2(s.ny, s.nx), a1 = Math.atan2(t.ny, t.nx);
      var sweep = a1 - a0;
      while (sweep <= -Math.PI) sweep += TAU;
      while (sweep > Math.PI) sweep -= TAU;
      parts.push({ kind: 'arc', at: s.b, a0: a0, sweep: sweep, len: Math.abs(sweep) * off });
    }
    parts.forEach(function (p) { total += p.len; });

    var wob = wobbler(amp);
    var out = [], walked = 0, pi = 0;
    for (i = 0; i < samples; i++) {
      var d = total * i / samples;
      while (pi < parts.length - 1 && d > walked + parts[pi].len) { walked += parts[pi].len; pi++; }
      var p = parts[pi];
      var f = p.len ? (d - walked) / p.len : 0;
      var x, y, ox, oy;
      if (p.kind === 'edge') {
        x = p.s.a[0] + (p.s.b[0] - p.s.a[0]) * f;
        y = p.s.a[1] + (p.s.b[1] - p.s.a[1]) * f;
        ox = p.s.nx; oy = p.s.ny;
      } else {
        var ang = p.a0 + p.sweep * f;
        x = p.at[0]; y = p.at[1];
        ox = Math.cos(ang); oy = Math.sin(ang);
      }
      var o = off + wob(i / samples);
      out.push([x + ox * o, y + oy * o]);
    }
    return smoothClosed(out);
  }

  function contourSVG(cls, d, box, dash) {
    return '<svg class="contour ' + cls + '" viewBox="' + box + '" ' +
                'preserveAspectRatio="none" aria-hidden="true" focusable="false">' +
      '<path class="contour__glow" d="' + d + '" pathLength="100" stroke-dasharray="' + dash + '" />' +
      '<path class="contour__line" d="' + d + '" pathLength="100" stroke-dasharray="' + dash + '" />' +
    '</svg>';
  }

  /* One island's contours. Idempotent, like js/water.js's attach(). */
  function attach(pad) {
    if (pad.dataset.surf) return;
    var land = global.GeoPages && global.GeoPages.land[pad.dataset.shape];
    var img = pad.querySelector('.pad__img');
    if (!land || !img) return;

    var pts = vertices(land);
    var cx = land.cx * 100, cy = land.cy * 100;
    var reach = pts.reduce(function (m, p) { return Math.max(m, Math.hypot(p[0] - cx, p[1] - cy)); }, 0);
    /* room for the furthest contour, its wobble and its glow */
    var R = reach + 11;
    var box = [r2(cx - R), r2(cy - R), r2(R * 2), r2(R * 2)].join(' ');

    pad.style.setProperty('--sw', r2(R * 2) + '%');

    var html = '';
    HUG.forEach(function (off, i) {
      html += contourSVG('contour--hug contour--h' + i,
                         contourPath(pts, off, 1.7, 72), box, breaks([3, 4], [3, 8]));
    });
    RUN.forEach(function (off, i) {
      html += contourSVG('contour--run contour--r' + i,
                         contourPath(pts, off, 2.6, 72), box, breaks([2, 3], [8, 18]));
    });

    /* under the land, over the shore and the old ripples */
    img.insertAdjacentHTML('beforebegin', html);
    pad.dataset.surf = '1';
  }


  /* ============================================================
     THE EDDIES — round each rock
     ============================================================ */

  /* A broken, wobbly ellipse round a rock's body, in a viewBox the
     shape of its sprite (100 wide). */
  function eddyPath(aspect, k, amp) {
    var H = 100 * aspect, wob = wobbler(amp), pts = [], i, n = 40;
    for (i = 0; i < n; i++) {
      var t = i / n, a = t * TAU;
      var w = 1 + wob(t) / 50;
      pts.push([50 + Math.cos(a) * 50 * k * w, H / 2 + Math.sin(a) * H / 2 * k * w]);
    }
    return smoothClosed(pts);
  }

  function eddyHTML(rock) {
    var w = rock.naturalWidth || +rock.getAttribute('width') || 100;
    var h = rock.naturalHeight || +rock.getAttribute('height') || 100;
    var aspect = h / w;
    /* a little room past the sprite for the glow */
    var box = '-8 ' + r2(-8 * aspect) + ' 116 ' + r2(116 * aspect);

    function ring(cls, k) {
      var d = eddyPath(aspect, k, 2.4);
      var dash = breaks([2, 3], [10, 22]);
      return '<svg class="eddy__ring ' + cls + '" viewBox="' + box + '" ' +
                  'preserveAspectRatio="none" aria-hidden="true" focusable="false">' +
        '<path class="eddy__glow" d="' + d + '" pathLength="100" stroke-dasharray="' + dash + '" />' +
        '<path class="eddy__line" d="' + d + '" pathLength="100" stroke-dasharray="' + dash + '" />' +
      '</svg>';
    }

    return '<span class="eddy" style="--ea:' + r2(aspect) + '" hidden>' +
             ring('eddy__ring--a', 0.86) + ring('eddy__ring--b', 0.94) +
           '</span>';
  }

  var PLACE = ['--x', '--y', '--w', '--r', '--f'];

  /* Each rock's eddy, put where the rock is. */
  function follow(screen) {
    var rocks = screen.querySelectorAll('.reef-deep__rock');
    var eddies = screen.querySelectorAll('.eddy');
    Array.prototype.forEach.call(rocks, function (rock, i) {
      var e = eddies[i];
      if (!e) return;
      PLACE.forEach(function (name) {
        var v = rock.style.getPropertyValue(name);
        if (v) e.style.setProperty(name, v); else e.style.removeProperty(name);
      });
      /* the line in user units for this rock's size, so a pebble's
         ring and a cluster's are the same weight on screen (--w is
         in vmin, and so is everything the rings are drawn at) */
      var w = parseFloat(rock.style.getPropertyValue('--w'));
      if (w > 0) e.style.setProperty('--ew', r2(15 / w));
      e.hidden = rock.hidden;
    });
  }


  /* ============================================================
     THE CURLS — crests on the open water
     ============================================================ */

  /* A crest as a filled, tapered stroke: a centreline walked as a
     turtle -- a gentle bend along its length, then a curl that
     tightens at one end -- with a width that swells in the middle
     and thins to nothing at both ends. In a 100-wide box, so the
     element's width sets its size. */
  function curlShape() {
    var steps = 46, len = 100, ds = len / steps;
    var bend = rnd(-0.006, 0.006), wav = rnd(0.016, 0.028), ph = rnd(0, TAU);
    var curlAt = rnd(0.6, 0.7), curlK = rnd(0.15, 0.22) * (Math.random() < 0.5 ? -1 : 1);
    var x = 0, y = 0, th = 0, mid = [], i;
    for (i = 0; i <= steps; i++) {
      var t = i / steps;
      mid.push([x, y, th]);
      var k = bend + wav * Math.sin(TAU * t * 1.2 + ph);
      if (t > curlAt) k += curlK * Math.pow((t - curlAt) / (1 - curlAt), 1.6);
      th += k * ds;
      x += Math.cos(th) * ds;
      y += Math.sin(th) * ds;
    }

    /* the bounding box, to centre it in a 100-wide viewBox */
    var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    mid.forEach(function (p) {
      minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
      minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
    });
    var s = 92 / Math.max(maxX - minX, 1);
    var wMax = rnd(1.5, 2.1);
    var left = [], right = [], line = [];
    mid.forEach(function (p, j) {
      var t = j / steps;
      var w = wMax * Math.pow(Math.sin(Math.PI * t), 0.75) * (1 - 0.35 * t);
      var nx = -Math.sin(p[2]), ny = Math.cos(p[2]);
      var X = (p[0] - minX) * s + 4, Y = (p[1] - minY) * s + 4;
      line.push([X, Y]);
      left.push([X + nx * w, Y + ny * w]);
      right.push([X - nx * w, Y - ny * w]);
    });
    var h = (maxY - minY) * s + 8;

    var fill = smoothOpen(left) + 'L' + smoothOpen(right.reverse()).slice(1) + 'Z';
    return {
      box: '0 0 100 ' + r2(h),
      aspect: h / 100,
      fill: fill,
      glow: smoothOpen(line)
    };
  }

  /* a crest lies along the water: one that came out taller than it
     is long is drawn again */
  function paintCurl(el) {
    var c = curlShape(), n = 0;
    while (c.aspect > 0.5 && n++ < 8) c = curlShape();
    el.setAttribute('viewBox', c.box);
    el.style.setProperty('--qh', r2(c.aspect));
    el.firstChild.setAttribute('d', c.glow);
    el.lastChild.setAttribute('d', c.fill);
  }

  function curlHTML() {
    return '<svg class="curl" preserveAspectRatio="none" aria-hidden="true" focusable="false">' +
             '<path class="curl__glow" />' +
             '<path class="curl__line" />' +
           '</svg>';
  }

  /* `el`'s layout box inside `host`, off the offset chain, so no
     transform enters it -- the same reading js/reef.js makes. */
  function boxIn(el, host) {
    var x = 0, y = 0, n = el;
    while (n && n !== host) {
      x += n.offsetLeft;
      y += n.offsetTop;
      n = n.offsetParent;
    }
    return { l: x, t: y, r: x + el.offsetWidth, b: y + el.offsetHeight };
  }

  function grow(b, by) { return { l: b.l - by, t: b.t - by, r: b.r + by, b: b.b + by }; }

  function overlaps(a, b) { return a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t; }

  /* Where a crest must not be, in the frame's px: every island in
     play with water round it, the craft where it is now, the hearts,
     the controller, the nav, and the band the narration drops into. */
  function keepOuts(round) {
    var screen = round.node, site = round.sites && round.sites.b;
    var S = Math.min(screen.clientWidth, screen.clientHeight);
    var keep = [];
    if (site && site.el) {
      site.el.padList.forEach(function (pad) {
        if (!pad.hidden && pad.offsetWidth) keep.push(grow(boxIn(pad, site.node), S * 0.02));
      });
      if (site.el.ship && site.el.ship.offsetWidth) {
        var b = boxIn(site.el.ship, site.node), w = b.r - b.l;
        keep.push({ l: b.l - w * 0.4, t: b.t - w * 0.2, r: b.r + w * 0.2, b: b.t + w * 1.4 });
      }
    }
    [round.el.stick, round.el.lives].forEach(function (el) {
      if (el && el.offsetWidth) keep.push(grow(boxIn(el, screen), 14));
    });
    var nav = doc.getElementById('nav');
    if (nav && nav.offsetWidth && screen.parentNode) keep.push(grow(boxIn(nav, screen.parentNode), 14));
    keep.push({ l: 0, t: 0, r: screen.clientWidth, b: screen.clientHeight * 0.15 });
    return keep;
  }

  /* One crest, somewhere it is clear to be, with a fresh shape. */
  function placeCurl(el, round, others) {
    var screen = round.node;
    var W = screen.clientWidth, H = screen.clientHeight;
    if (!W || !H) return false;
    var S = Math.min(W, H);
    var vmin = Math.min(global.innerWidth, global.innerHeight) || S;
    var keep = keepOuts(round);

    paintCurl(el);
    var aspect = parseFloat(el.style.getPropertyValue('--qh')) || 0.3;

    for (var t = 0; t < TRIES; t++) {
      var w = S * rnd(0.09, 0.15);
      var h = w * aspect;
      /* the crest's box, with room for the way it drifts */
      var x = rnd(W * 0.04, W * 0.96 - w);
      var y = rnd(H * 0.06, H * 0.94 - h);
      var b = grow({ l: x, t: y, r: x + w, b: y + h }, S * 0.03);
      if (keep.some(function (k) { return overlaps(b, k); })) continue;
      if (others.some(function (o) { return o !== el && o.box && overlaps(b, grow(o.box, S * 0.05)); })) continue;

      el.box = { l: x, t: y, r: x + w, b: y + h };
      el.style.setProperty('--qx', r2(x / W * 100) + '%');
      el.style.setProperty('--qy', r2(y / H * 100) + '%');
      el.style.setProperty('--qw', r2(w / vmin * 100) + 'vmin');
      /* most crests lie with the swell, which runs left to right a
         little downhill; a few are turned against it */
      el.style.setProperty('--qa', Math.round(rnd(-18, 22) + (Math.random() < 0.25 ? 180 : 0)) + 'deg');
      el.style.setProperty('--qf', Math.random() < 0.5 ? '-1' : '1');
      el.hidden = false;
      return true;
    }
    el.box = null;
    el.hidden = true;
    return false;
  }


  /* ============================================================
     BUILDING — once, at boot
     ============================================================ */

  function dress(screen) {
    if (screen.dataset.surfaced) return;
    var cam = screen.querySelector('.cam');
    if (!cam) return;

    var html = '<div class="surface" aria-hidden="true">' +
                 '<span class="surface__net surface__net--a"></span>' +
                 '<span class="surface__net surface__net--b"></span>';
    Array.prototype.forEach.call(screen.querySelectorAll('.reef-deep__rock'), function (rock) {
      html += eddyHTML(rock);
    });
    for (var i = 0; i < CURLS; i++) html += curlHTML();
    html += '</div>';

    /* after the sea sheets and the rocks, before the islands: on the
       water, under the land */
    cam.insertAdjacentHTML('beforebegin', html);

    Array.prototype.forEach.call(screen.querySelectorAll('.cam .pad'), attach);

    /* the eddies follow their rocks wherever js/reef.js puts them */
    var deep = screen.querySelector('.reef-deep');
    if (deep && global.MutationObserver) {
      var queued = false;
      new MutationObserver(function () {
        if (queued) return;
        queued = true;
        Promise.resolve().then(function () { queued = false; follow(screen); });
      }).observe(deep, { subtree: true, attributes: true, attributeFilter: ['style', 'hidden'] });
    }
    follow(screen);

    screen.dataset.surfaced = '1';
  }

  function init(stage) {
    if (ready || !global.GeoPages || !global.GeoPages.land) return;
    stage = stage || doc.getElementById('stage');
    if (!stage) return;

    var screens = Array.prototype.slice.call(stage.querySelectorAll('.screen[data-reef]'));
    if (!screens.length) return;
    screens.forEach(dress);
    ready = true;

    var lean = leanDevice();
    var later = global.requestIdleCallback || function (fn) { return setTimeout(fn, 60); };
    later(function () { buildNet(screens, lean); }, { timeout: 1500 });
  }


  /* ============================================================
     THE STREW — once per visit, then a crest at a time
     ============================================================ */

  function strew(round) {
    var screen = round && round.node;
    if (!screen || !screen.dataset.surfaced) return;

    follow(screen);

    var curls = Array.prototype.slice.call(screen.querySelectorAll('.curl'));
    curls.forEach(function (c) { c.box = null; c.hidden = true; });
    curls.forEach(function (c, i) {
      placeCurl(c, round, curls);
      /* each on its own phase, so they never all fade together */
      c.style.setProperty('--qd', r2(-i * 13 / curls.length - rnd(0, 1.2)) + 's');
      c.style.setProperty('--qt', r2(rnd(11, 15)) + 's');
    });

    /* a crest is moved, and reshaped, every time it has faded out */
    if (!screen.dataset.curled) {
      screen.dataset.curled = '1';
      curls.forEach(function (c) {
        c.addEventListener('animationiteration', function () {
          if (screen.classList.contains('is-active')) placeCurl(c, round, curls);
        });
      });
    }
  }


  global.GeoSurface = {
    init: init,
    strew: strew,
    attach: attach
  };
})(window);
