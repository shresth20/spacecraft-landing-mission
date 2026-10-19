/* ============================================================
   Geo Drone — THE CLOSE-UP'S SOUND: synthesised, so nothing to fetch

   The cut-scene (js/cinematic.js) calls these on the frames its
   timeline reaches them, so every sound lands on the event it belongs
   to. They are built from oscillators and one buffer of noise on the
   AudioContext js/audio.js already owns; there are no files, so there
   is nothing to load late. The noise buffer is made the moment the
   first shot starts (a GO press, so the context may run), before its
   first cue.

     warp()        the cut: a rising whoosh and an energy charge
     engine(v)     the descent's hum, at v (0..1); 0 lets it die away
     pulse(v)      one thruster pulse over the hum
     clank(v)      metal set down on rock: a touchdown at weight v
     sparkle()     the bright little arpeggio over the success burst
     sputter()     jets choking: short, ragged bursts
     splash()      a hull hitting the water
     crash(v)      metal smashed on rock
     bass()        the low impact under the crash

   Everything passes through one bus, so mute(true) silences all of it,
   and the bus is faded down while the tab is away (js/lifecycle.js).
   Over file:// there is no context (see CAN_ANALYSE in js/audio.js),
   and every call is quietly nothing.
   ============================================================ */

(function (global) {
  'use strict';

  var LEVEL = 0.9;

  var c = null;                 /* the AudioContext, once there is one */
  var bus = null;
  var noise = null;
  var hum = null;               /* the engine, while it runs */
  var muted = false;
  var away = false;

  function rand(lo, hi) { return lo + Math.random() * (hi - lo); }

  function ctx() {
    if (c) return c;
    var A = global.GeoAudio;
    var made = A && A.context ? A.context() : null;
    if (!made) return null;
    try {
      bus = made.createGain();
      bus.gain.value = muted || away ? 0 : LEVEL;
      /* a gentle glue over the layered hits, and a guard against
         them clipping when they pile up on the crash clips */
      var glue = made.createDynamicsCompressor();
      glue.threshold.value = -16;
      glue.knee.value = 12;
      glue.ratio.value = 4;
      glue.attack.value = 0.004;
      glue.release.value = 0.2;
      bus.connect(glue);
      glue.connect(made.destination);

      var len = Math.floor(made.sampleRate * 2);
      noise = made.createBuffer(1, len, made.sampleRate);
      var d = noise.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      c = made;
    } catch (e) {
      c = null;
    }
    return c;
  }

  /* The context, awake, or null. Called once a shot starts, so the
     first cue never waits on the buffer being built. */
  function prepare() {
    var x = ctx();
    if (x && x.state === 'suspended') x.resume();
    return x;
  }

  function level() {
    if (!bus) return;
    var g = bus.gain;
    g.cancelScheduledValues(c.currentTime);
    g.setTargetAtTime(muted || away ? 0 : LEVEL, c.currentTime, 0.05);
  }

  function mute(on) {
    muted = !!on;
    level();
    return muted;
  }

  /* -------------------------------------------------------- the parts */

  function gain(v, to) {
    var g = c.createGain();
    g.gain.value = v;
    g.connect(to || bus);
    return g;
  }

  /* a struck envelope: up to `peak` in `a` seconds, down over `d` */
  function strike(g, t0, peak, a, d) {
    var p = g.gain;
    p.setValueAtTime(0.0001, t0);
    p.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + a);
    p.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  }

  function filter(type, f, q, to) {
    var b = c.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q == null ? 0.7 : q;
    b.connect(to);
    return b;
  }

  function hiss(t0, dur, to) {
    var s = c.createBufferSource();
    s.buffer = noise;
    s.connect(to);
    s.start(t0, rand(0, 1), dur + 0.05);
    return s;
  }

  function tone(type, f, t0, dur, to) {
    var o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t0);
    o.connect(to);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
    return o;
  }

  /* -------------------------------------------------------- the sounds */

  /* The cut, 0.5s: air rushing past as the lens dives (noise through a
     band sweeping up), a charge winding up under it (a saw and a sine
     climbing, the sine throbbing faster as it goes), and the release
     as the energy bursts */
  function warp() {
    if (!prepare()) return;
    var t = c.currentTime + 0.01;

    var wg = gain(0);
    strike(wg, t, 0.5, 0.36, 0.3);
    var band = filter('bandpass', 300, 1.1, wg);
    band.frequency.setValueAtTime(260, t);
    band.frequency.exponentialRampToValueAtTime(5200, t + 0.46);
    hiss(t, 0.7, band);

    var cg = gain(0);
    strike(cg, t, 0.09, 0.4, 0.18);
    var low = filter('lowpass', 1600, 2, cg);
    tone('sawtooth', 110, t, 0.6, low).frequency.exponentialRampToValueAtTime(880, t + 0.44);

    var sg = gain(0);
    strike(sg, t, 0.12, 0.42, 0.14);
    /* the throb: a 0.5 gain swung +-0.5 by an LFO speeding up */
    var trem = gain(0.5, sg);
    var depth = gain(0.5, trem.gain);
    tone('sine', 180, t, 0.6, trem).frequency.exponentialRampToValueAtTime(1440, t + 0.44);
    tone('sine', 16, t, 0.6, depth).frequency.linearRampToValueAtTime(42, t + 0.44);

    /* the burst */
    var b = t + 0.43;
    var bg = gain(0);
    strike(bg, b, 0.3, 0.006, 0.28);
    hiss(b, 0.3, filter('highpass', 1800, 0.7, bg));
    var zg = gain(0);
    strike(zg, b, 0.14, 0.004, 0.22);
    tone('sine', 1300, b, 0.26, zg).frequency.exponentialRampToValueAtTime(260, b + 0.22);
  }

  /* The hum: two saws a hair apart, low and filtered, with a sine for
     body. Kept running and re-levelled while it is wanted. */
  function engine(v) {
    v = Math.max(0, Math.min(1, v || 0));
    if (!v && !hum) return;
    if (!prepare()) return;
    var now = c.currentTime;

    if (v && !hum) {
      var out = gain(0);
      var low = filter('lowpass', 240, 3.5, out);
      hum = {
        out: out,
        low: low,
        oscs: [tone('sawtooth', 47, now, 3600, low),
               tone('sawtooth', 47.6, now, 3600, low),
               tone('sine', 94, now, 3600, low)]
      };
    }
    var h = hum;
    h.out.gain.cancelScheduledValues(now);
    h.out.gain.setTargetAtTime(v * 0.26, now, v ? 0.06 : 0.12);
    h.low.frequency.setTargetAtTime(160 + 220 * v, now, 0.08);
    if (!v) {
      hum = null;
      h.oscs.forEach(function (o) { try { o.stop(now + 0.6); } catch (e) {} });
    }
  }

  /* One pulse: a breathy chuff from the jets, and a swell on the hum */
  function pulse(v) {
    if (!prepare()) return;
    v = v == null ? 1 : v;
    var t = c.currentTime;
    var g = gain(0);
    strike(g, t, 0.16 * v, 0.008, 0.11);
    hiss(t, 0.14, filter('bandpass', rand(620, 820), 1.6, g));
    if (hum) {
      var p = hum.out.gain;
      p.cancelScheduledValues(t);
      p.setValueAtTime(p.value, t);
      p.linearRampToValueAtTime(p.value * 1.35 + 0.02, t + 0.02);
      p.setTargetAtTime(0.26 * v, t + 0.02, 0.06);
    }
  }

  /* Metal set down on rock. The partials of a struck plate (ratios of
     a free bar), ringing briefly over a thump and a click. */
  var PLATE = [1, 2.76, 5.4, 8.93];

  function clank(v, base) {
    if (!prepare()) return;
    v = v == null ? 1 : v;
    base = base || 320;
    var t = c.currentTime;
    PLATE.forEach(function (r, i) {
      var g = gain(0);
      strike(g, t, (0.11 - i * 0.022) * v, 0.003, 0.7 - i * 0.14);
      tone('sine', base * r * rand(0.99, 1.01), t, 0.8, g);
    });
    var th = gain(0);
    strike(th, t, 0.5 * v, 0.004, 0.24);
    tone('sine', 110, t, 0.3, th).frequency.exponentialRampToValueAtTime(42, t + 0.18);
    var ck = gain(0);
    strike(ck, t, 0.2 * v, 0.002, 0.05);
    hiss(t, 0.08, filter('highpass', 2600, 0.7, ck));
  }

  /* bright, quick and quiet: it sits on top of the success clip */
  function sparkle() {
    if (!prepare()) return;
    var t = c.currentTime;
    [1318.5, 1661.2, 1975.5, 2637].forEach(function (f, i) {
      var g = gain(0);
      strike(g, t + i * 0.065, 0.05, 0.004, 0.5);
      tone('sine', f, t + i * 0.065, 0.56, g);
      var o = gain(0);
      strike(o, t + i * 0.065, 0.016, 0.004, 0.3);
      tone('triangle', f * 2, t + i * 0.065, 0.36, o);
    });
  }

  /* Jets choking as they are lit to save it: ragged bursts with gaps,
     each with a burble of the engine under it */
  function sputter() {
    if (!prepare()) return;
    var t = c.currentTime;
    for (var i = 0; i < 8; i++) {
      var g = gain(0);
      strike(g, t, rand(0.14, 0.3), 0.006, rand(0.04, 0.09));
      hiss(t, 0.12, filter('bandpass', rand(420, 900), 1.4, g));
      var b = gain(0);
      strike(b, t, 0.08, 0.005, 0.07);
      tone('sawtooth', rand(55, 80), t, 0.1, filter('lowpass', 300, 1, b));
      t += rand(0.05, 0.14);
    }
  }

  /* The hull into the water: a crash of white water (noise through a
     band falling away), a hollow plunge under it, and the slap back */
  function splash() {
    if (!prepare()) return;
    var t = c.currentTime;
    [[0, 0.5, 2600, 0.9], [0.13, 0.22, 1700, 0.6]].forEach(function (s) {
      var g = gain(0);
      strike(g, t + s[0], s[1], 0.01, s[3]);
      var band = filter('bandpass', s[2], 0.8, g);
      band.frequency.setValueAtTime(s[2], t + s[0]);
      band.frequency.exponentialRampToValueAtTime(420, t + s[0] + s[3]);
      hiss(t + s[0], s[3] + 0.1, band);
    });
    var pg = gain(0);
    strike(pg, t, 0.36, 0.01, 0.4);
    tone('sine', 190, t, 0.45, pg).frequency.exponentialRampToValueAtTime(52, t + 0.36);
  }

  /* Metal smashed on rock: the plate rung hard and a little out of
     tune, under a crunch of driven noise */
  function crash(v) {
    if (!prepare()) return;
    v = v == null ? 1 : v;
    var t = c.currentTime;
    clank(0.9 * v, 190);
    clank(0.6 * v, 257);
    var g = gain(0);
    strike(g, t, 0.55 * v, 0.005, 0.5);
    var shape = c.createWaveShaper();
    var curve = new Float32Array(256);
    for (var i = 0; i < 256; i++) {
      var x = i / 128 - 1;
      curve[i] = Math.tanh(3.2 * x);
    }
    shape.curve = curve;
    shape.connect(filter('lowpass', 3200, 0.7, g));
    hiss(t, 0.55, shape);
  }

  /* The weight of it, felt: a sine falling from 72 to 26Hz, and a sub
     under it */
  function bass() {
    if (!prepare()) return;
    var t = c.currentTime;
    var g = gain(0);
    strike(g, t, 0.85, 0.008, 1.0);
    tone('sine', 72, t, 1.1, g).frequency.exponentialRampToValueAtTime(26, t + 0.9);
    var s = gain(0);
    strike(s, t, 0.4, 0.01, 0.7);
    tone('triangle', 38, t, 0.8, s);
  }

  /* -------------------------------------------------------- the tab */
  if (global.GeoLife) {
    global.GeoLife.on('suspend', function () { away = true; level(); });
    global.GeoLife.on('resume', function () { away = false; level(); });
  }

  global.GeoCinemaSFX = {
    prepare: prepare,
    mute: mute,
    isMuted: function () { return muted; },
    warp: warp,
    engine: engine,
    pulse: pulse,
    clank: clank,
    sparkle: sparkle,
    sputter: sputter,
    splash: splash,
    crash: crash,
    bass: bass
  };
})(window);
