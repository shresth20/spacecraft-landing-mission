/* ============================================================
   Geo Drone — the cockpit under way

   Faint dust drifting past the canopy, so screen 1 reads as a ship
   flying rather than a picture of one. A sparse field of motes in
   perspective: each is born far ahead, near the middle of the
   canopy, and comes slowly toward the glass, spreading out and
   brightening as it nears, until it slips past the frame and a new
   one is born far ahead in its place.

   Kept faint and slow on purpose: it is the sense of travel, not
   something to look at. The slow bank of the whole view outside
   (space, stars and this canvas together) is CSS, css/style.css
   "cruise"; the cockpit and everything on it never move.

   Drawn only while the cockpit is on screen: the loop ends by
   itself once the screen has gone, and start() picks it up again.
   ============================================================ */

(function (global) {
  'use strict';

  var COUNT = 60;
  var SPEED = 0.055;          // depth covered per second, of the whole 0..1 field
  var NEAR = 0.12;            // nearer than this a mote has passed the glass
  var SPREAD = 0.1;           // how wide the far field is, as a share of the width
  var TAIL = 0.1;             // seconds of travel each mote trails behind it
  var FOCUS_X = 0.5;          // where the motes come from: the canopy's centre,
  var FOCUS_Y = 0.33;         // measured off s1-cockpit.webp

  var canvas, ctx, screen, dpr = 1;
  var w = 0, h = 0;
  var motes = [];
  var running = false;
  var last = 0;

  function reduced() {
    return global.matchMedia &&
           global.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /* `anywhere` scatters it through the whole depth (the field the
     cockpit opens on); otherwise it is born at the far end */
  function spawn(m, anywhere) {
    var a = Math.random() * Math.PI * 2;
    /* never dead on the axis, where a mote would sit still the
       whole way in and only grow */
    var r = 0.12 + Math.random() * 0.88;
    m.x = Math.cos(a) * r;
    m.y = Math.sin(a) * r * 0.7;
    m.z = anywhere ? NEAR + Math.random() * (1 - NEAR) : 1 - Math.random() * 0.04;
    m.size = 0.45 + Math.random() * 0.75;
    m.glow = 0.3 + Math.random() * 0.4;
    return m;
  }

  /* ---------------------------------------------------------- sizing */
  function resize() {
    if (!canvas) return;
    dpr = Math.min(global.devicePixelRatio || 1, 2);
    /* the layout size, not getBoundingClientRect(): the canvas rides
       the sway, and a rotated box measures larger than it is */
    w = Math.max(1, canvas.clientWidth);
    h = Math.max(1, canvas.clientHeight);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ---------------------------------------------------------- drawing */
  function shown() {
    return screen.classList.contains('is-active') ||
           screen.classList.contains('is-leaving');
  }

  function frame(now) {
    if (!running) return;
    if (!shown()) {
      running = false;
      ctx.clearRect(0, 0, w, h);
      return;
    }

    /* a frame after a hidden tab comes back must not jump the field */
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    var fx = w * FOCUS_X;
    var fy = h * FOCUS_Y;
    var k = w * SPREAD;

    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = '#d6e8ff';
    ctx.lineCap = 'round';

    for (var i = 0; i < motes.length; i++) {
      var m = motes[i];
      m.z -= SPEED * dt;

      var x = fx + m.x * k / m.z;
      var y = fy + m.y * k / m.z;

      if (m.z <= NEAR || x < -20 || x > w + 20 || y < -20 || y > h + 20) {
        spawn(m, false);
        continue;
      }

      var tz = Math.min(1, m.z + SPEED * TAIL);
      var near = 1 - m.z;

      ctx.globalAlpha = m.glow *
        Math.min(1, near / 0.25) *                 // up out of the distance
        Math.min(1, (m.z - NEAR) / 0.08) *         // and out again at the glass
        (0.45 + 0.55 * near);
      ctx.lineWidth = m.size * (0.5 + 1.6 * near);

      ctx.beginPath();
      ctx.moveTo(fx + m.x * k / tz, fy + m.y * k / tz);
      ctx.lineTo(x, y);
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
    requestAnimationFrame(frame);
  }

  /* ---------------------------------------------------------- api */
  function init(el, host) {
    canvas = el;
    screen = host;
    if (!canvas || !screen) return;
    ctx = canvas.getContext('2d');

    for (var i = 0; i < COUNT; i++) motes.push(spawn({}, true));

    resize();
    global.addEventListener('resize', resize, { passive: true });
    if (global.ResizeObserver) {
      new ResizeObserver(resize).observe(canvas);
    }
  }

  function start() {
    if (running || !ctx || reduced()) return;
    running = true;
    last = performance.now();
    requestAnimationFrame(frame);
  }

  global.GeoCruise = { init: init, start: start };
})(window);
