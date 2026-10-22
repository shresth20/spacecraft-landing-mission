/* ============================================================
   Geo Drone — THE REST OF THE SOUND: synthesised, so nothing to fetch

   js/audio.js plays the recorded clips (the voice, the music, the
   chimes, the crashes) and the burner's roar; js/cinematic-sfx.js is
   the close-up's own. This is everything in between: the radio the
   voice comes in over, the controls' answers, the warnings, the craft
   coming in and the weight of its touchdown. All of it is oscillators
   and a buffer of noise on the AudioContext js/audio.js owns, so there
   is nothing for the start gate to load. Nothing here is held under a
   screen: every sound is a one-off, over within a few seconds.

   ── THE CRAFT ───────────────────────────────────────────────────
     flyby(ms, x)  the craft coming in from off the frame, from side x
     spoolDown()   the engines let go once it is down

   ── THE RADIO ── the narrator is mission control ────────────────
     radioOn()     a line is about to be spoken. If the channel was
                   shut: the squelch and the Quindar tone, and how many
                   ms to hold the voice so the tone is heard first
     radioOff()    the line is over. The channel shuts RADIO_GAP_MS
                   later with the outro tone, unless another line keeps
                   it open -- back-to-back lines are one transmission

   ── THE CONTROLS ── tick (mouse over), boot, arm, latch, advance,
     swish, hint, readout, grab, release, under, lockOn, lockOff,
     engage, edge, zoom
   ── THE WARNINGS ── hit, caution, autopilot
   ── THE WEIGHT ─── touchdown, hydraulics
   ── THE SURVEY ─── scan, lightsUp, altitude (the altimeter's chirp),
     bracket; and fanfare at the end

   Everything passes through one bus, faded down while the tab is away
   (js/lifecycle.js), and hush() shuts the radio when the player jumps.
   Over file:// there is no context (see CAN_ANALYSE in js/audio.js)
   and every call is quietly nothing.
   ============================================================ */

(function (global) {
  'use strict';

  var LEVEL = 0.9;

  var c = null;                  /* the AudioContext, once there is one */
  var bus = null;
  var white = null;
  var away = false;

  function rand(lo, hi) { return lo + Math.random() * (hi - lo); }

  function later(ms) {
    return global.GeoLife
      ? global.GeoLife.wait(ms)
      : new Promise(function (r) { setTimeout(r, ms); });
  }

  function ctx() {
    if (c) return c;
    var A = global.GeoAudio;
    var made = A && A.context ? A.context() : null;
    if (!made) return null;
    try {
      bus = made.createGain();
      bus.gain.value = away ? 0 : LEVEL;
      /* a guard against the alerts and the touchdown clipping when
         they land on a crash clip */
      var glue = made.createDynamicsCompressor();
      glue.threshold.value = -14;
      glue.knee.value = 10;
      glue.ratio.value = 3.5;
      glue.attack.value = 0.003;
      glue.release.value = 0.18;
      bus.connect(glue);
      glue.connect(made.destination);

      var len = Math.floor(made.sampleRate * 2);
      white = made.createBuffer(1, len, made.sampleRate);
      var w = white.getChannelData(0);
      for (var i = 0; i < len; i++) w[i] = Math.random() * 2 - 1;

      c = made;
    } catch (e) {
      c = null;
    }
    return c;
  }

  /* The context, awake, or null. */
  function prepare() {
    var x = ctx();
    if (x && x.state === 'suspended') x.resume();
    return x;
  }

  function level() {
    if (!bus) return;
    var g = bus.gain;
    g.cancelScheduledValues(c.currentTime);
    g.setTargetAtTime(away ? 0 : LEVEL, c.currentTime, 0.05);
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

  /* left (-1) to right (1); a plain pass-through where the browser
     has no panner */
  function panner(x, to) {
    if (!c.createStereoPanner) return gain(1, to);
    var p = c.createStereoPanner();
    p.pan.value = x;
    p.connect(to);
    return p;
  }

  /* looped, so a sweep longer than the buffer's two seconds (the
     craft's way in can run past three) does not stop short */
  function hiss(t0, dur, to, buf) {
    var s = c.createBufferSource();
    s.buffer = buf || white;
    s.loop = true;
    s.connect(to);
    s.start(t0, rand(0, 1));
    s.stop(t0 + dur + 0.05);
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

  /* one short note, struck */
  function beep(f, t0, dur, peak, type, to) {
    var g = gain(0, to);
    strike(g, t0, peak, Math.min(0.006, dur / 3), dur);
    return tone(type || 'sine', f, t0, dur + 0.02, g);
  }

  /* a held note with a flat top, for the radio's tones and the alerts:
     a struck one decays, and these must read as a signal */
  function hold(f, t0, dur, peak, type, to) {
    var g = gain(0, to);
    var p = g.gain;
    p.setValueAtTime(0, t0);
    p.linearRampToValueAtTime(peak, t0 + 0.008);
    p.setValueAtTime(peak, t0 + dur - 0.012);
    p.linearRampToValueAtTime(0, t0 + dur);
    return tone(type || 'sine', f, t0, dur, g);
  }

  /* now, if the context can be woken; null if there is none */
  function now() {
    return prepare() ? c.currentTime + 0.01 : null;
  }


  /* ============================================================
     THE CRAFT
     ============================================================ */

  /* The craft in from off the frame, `x` being the side it comes from
     (-1 left .. 1 right): air torn past it, rising as it nears and
     falling away as it brakes onto its station, and the engine's
     note dropping as it passes -- moving across from where it came in
     to the middle. */
  function flyby(ms, x) {
    var t = now();
    if (t == null) return;
    var d = Math.max(0.6, (ms || 2400) / 1000);
    var p = panner(x || 0, bus);
    if (p.pan) {
      p.pan.setValueAtTime(x || 0, t);
      p.pan.linearRampToValueAtTime(0, t + d * 0.8);
    }

    var g = gain(0, p);
    strike(g, t, 0.16, d * 0.55, d * 0.5);
    var band = filter('bandpass', 300, 1.4, g);
    band.frequency.setValueAtTime(300, t);
    band.frequency.exponentialRampToValueAtTime(1500, t + d * 0.55);
    band.frequency.exponentialRampToValueAtTime(520, t + d);
    hiss(t, d + 0.1, band);

    var e = gain(0, p);
    strike(e, t, 0.05, d * 0.5, d * 0.55);
    tone('sawtooth', 165, t, d + 0.1, filter('lowpass', 560, 0.8, e))
      .frequency.exponentialRampToValueAtTime(96, t + d);
  }

  /* Down, and the engines let go: a turbine winding down through its
     whole range, a low tail under it, and the relay that cuts them. */
  function spoolDown() {
    var t = now();
    if (t == null) return;
    var g = gain(0);
    strike(g, t, 0.06, 0.03, 1.8);
    var low = filter('lowpass', 1500, 0.9, g);
    low.frequency.setValueAtTime(1500, t);
    low.frequency.exponentialRampToValueAtTime(220, t + 1.8);
    tone('sawtooth', 380, t, 1.9, low).frequency.exponentialRampToValueAtTime(52, t + 1.85);

    var s = gain(0);
    strike(s, t, 0.08, 0.02, 1.4);
    tone('sine', 190, t, 1.5, s).frequency.exponentialRampToValueAtTime(30, t + 1.4);

    var r = gain(0);
    strike(r, t + 1.55, 0.05, 0.002, 0.03);
    hiss(t + 1.55, 0.05, filter('highpass', 3800, 0.7, r));
  }


  /* ============================================================
     THE RADIO

     Every line the narrator speaks is mission control talking to the
     commander, so it comes in over a channel: a breath of squelch and
     the Quindar tone as it opens -- the beep that keyed the Apollo
     transmitters -- and the lower outro tone as it shuts. The tone
     has to be heard BEFORE the voice, so radioOn() says how long to
     hold the line; js/audio.js waits that long before play().

     Lines that follow each other within RADIO_GAP_MS share one
     transmission: the channel only shuts when the talking stops, so
     the briefing is not a string of beeps.
     ============================================================ */

  var QUINDAR_IN = 2525;
  var QUINDAR_OUT = 2475;
  var RADIO_GAP_MS = 750;
  var RADIO_LEAD_MS = 240;

  /* `lines` is how many are being spoken: two can overlap (a landing
     made while the last prompt is still being said), and the channel
     must not shut under the second when the first one ends */
  var radio = { on: false, lines: 0, ticket: 0 };

  function squelch(t0, peak, d) {
    var g = gain(0);
    strike(g, t0, peak, 0.004, d);
    hiss(t0, d + 0.02, filter('bandpass', 2200, 0.6, g));
  }

  function radioOn() {
    if (!prepare() || c.state !== 'running') return 0;
    radio.lines++;
    radio.ticket++;                       /* a pending shut is called off */
    if (radio.on) return 0;
    radio.on = true;
    var t = c.currentTime + 0.01;
    squelch(t, 0.05, 0.06);
    hold(QUINDAR_IN, t + 0.04, 0.17, 0.045);
    return RADIO_LEAD_MS;
  }

  function radioOff() {
    radio.lines = Math.max(0, radio.lines - 1);
    if (!c || !radio.on || radio.lines) return;
    var mine = ++radio.ticket;
    later(RADIO_GAP_MS).then(function () {
      if (mine !== radio.ticket || !radio.on) return;
      radio.on = false;
      var t = c.currentTime + 0.01;
      hold(QUINDAR_OUT, t, 0.17, 0.04);
      squelch(t + 0.18, 0.05, 0.11);
    });
  }

  /* the player has jumped: the channel shuts without its tone */
  function hush() {
    radio.ticket++;
    radio.on = false;
    radio.lines = 0;
  }


  /* ============================================================
     THE CONTROLS
     ============================================================ */

  /* the mouse over a control: barely there */
  function tick() {
    var t = now();
    if (t == null) return;
    beep(2900, t, 0.025, 0.018);
  }

  /* START: the mission's systems coming up -- a thump, a sweep up
     through the range with a fifth over it, and a ping as it lands */
  function boot() {
    var t = now();
    if (t == null) return;
    var th = gain(0);
    strike(th, t, 0.2, 0.005, 0.32);
    tone('sine', 92, t, 0.4, th).frequency.exponentialRampToValueAtTime(40, t + 0.3);

    [[1, 0.06], [1.5, 0.025]].forEach(function (v) {
      var g = gain(0);
      strike(g, t, v[1], 0.55, 0.3);
      tone('sine', 160 * v[0], t, 0.9, g).frequency.exponentialRampToValueAtTime(1320 * v[0], t + 0.8);
    });

    var pw = gain(0);
    strike(pw, t, 0.05, 0.6, 0.3);
    var open = filter('lowpass', 400, 0.8, pw);
    open.frequency.setValueAtTime(400, t);
    open.frequency.exponentialRampToValueAtTime(5200, t + 0.8);
    hiss(t, 0.95, open);

    beep(1760, t + 0.82, 0.7, 0.07);
    beep(2640, t + 0.82, 0.45, 0.022);
  }

  /* LAUNCH rising out of the console: a servo, then the panel armed */
  function arm() {
    var t = now();
    if (t == null) return;
    var g = gain(0);
    strike(g, t, 0.05, 0.05, 0.28);
    tone('sawtooth', 220, t, 0.34, filter('bandpass', 900, 2, g))
      .frequency.exponentialRampToValueAtTime(440, t + 0.28);
    beep(1320, t + 0.34, 0.09, 0.06, 'triangle');
    beep(1760, t + 0.47, 0.14, 0.06, 'triangle');
  }

  /* LAUNCH pressed home: a heavy latch, felt more than heard */
  function latch() {
    var t = now();
    if (t == null) return;
    var g = gain(0);
    strike(g, t, 0.26, 0.004, 0.24);
    tone('sine', 120, t, 0.3, g).frequency.exponentialRampToValueAtTime(48, t + 0.22);
    var k = gain(0);
    strike(k, t, 0.18, 0.002, 0.05);
    hiss(t, 0.07, filter('bandpass', 1800, 1, k));
    [1, 2.76].forEach(function (r, i) {
      beep(420 * r, t, 0.25 - i * 0.08, 0.04 - i * 0.015);
    });
  }

  /* a NEXT or RESTART arriving: two notes up, to say the way on is
     open */
  function advance() {
    var t = now();
    if (t == null) return;
    [[784, 0], [1175, 0.11]].forEach(function (n) {
      beep(n[0], t + n[1], 0.6, 0.06);
      beep(n[0] * 2, t + n[1], 0.3, 0.014, 'triangle');
    });
  }

  /* the screens dissolving: soft air drawn across, left to right */
  function swish() {
    var t = now();
    if (t == null) return;
    var p = panner(-0.5, bus);
    if (p.pan) p.pan.linearRampToValueAtTime(0.5, t + 1.1);
    var g = gain(0, p);
    strike(g, t, 0.1, 0.45, 0.65);
    var low = filter('lowpass', 300, 0.7, g);
    low.frequency.setValueAtTime(300, t);
    low.frequency.exponentialRampToValueAtTime(2200, t + 0.45);
    low.frequency.exponentialRampToValueAtTime(420, t + 1.1);
    hiss(t, 1.15, low);
  }

  /* the helping hand turning up: a glint */
  function hint() {
    var t = now();
    if (t == null) return;
    beep(2093, t, 0.5, 0.03);
    beep(3136, t + 0.06, 0.4, 0.015);
  }

  /* an area printed onto an island: a little run of data, a step up
     for each island so the three read as a count */
  function readout(i) {
    var t = now();
    if (t == null) return;
    var k = Math.pow(2, (i || 0) * 2 / 12);
    var lp = filter('lowpass', 2400, 0.7, bus);
    [880, 1320, 1760].forEach(function (f, j) {
      beep(f * k, t + j * 0.035, 0.028, 0.022, 'square', lp);
    });
  }

  /* the stick taken, and let go: a servo clicking in, and out */
  function grab() {
    var t = now();
    if (t == null) return;
    var g = gain(0);
    strike(g, t, 0.05, 0.002, 0.02);
    hiss(t, 0.03, filter('highpass', 3000, 0.7, g));
    beep(180, t, 0.05, 0.045);
  }

  function release() {
    var t = now();
    if (t == null) return;
    var g = gain(0);
    strike(g, t, 0.035, 0.002, 0.02);
    hiss(t, 0.03, filter('highpass', 2600, 0.7, g));
    beep(140, t, 0.05, 0.045);
  }

  /* the craft has come over an island: a soft ping off it, and the
     echo */
  function under() {
    var t = now();
    if (t == null) return;
    beep(1250, t, 0.35, 0.04);
    beep(1250, t + 0.12, 0.25, 0.012);
  }

  /* GO up: locked on -- two quick notes up and a ring under them */
  function lockOn() {
    var t = now();
    if (t == null) return;
    var lp = filter('lowpass', 3000, 0.7, bus);
    beep(1400, t, 0.06, 0.045, 'square', lp);
    beep(1870, t + 0.08, 0.09, 0.045, 'square', lp);
    beep(935, t + 0.08, 0.4, 0.02);
  }

  /* and GO taken back without being pressed: a blip falling away */
  function lockOff() {
    var t = now();
    if (t == null) return;
    var g = gain(0);
    strike(g, t, 0.025, 0.005, 0.12);
    tone('sine', 1100, t, 0.14, g).frequency.exponentialRampToValueAtTime(700, t + 0.12);
  }

  /* GO pressed: committed -- a low fifth struck under the click, and
     a note rising out of it */
  function engage() {
    var t = now();
    if (t == null) return;
    beep(196, t, 0.45, 0.12);
    beep(294, t, 0.4, 0.06);
    var k = gain(0);
    strike(k, t, 0.05, 0.002, 0.03);
    hiss(t, 0.04, filter('bandpass', 2400, 1, k));
    var s = gain(0);
    strike(s, t, 0.03, 0.05, 0.2);
    tone('sine', 392, t, 0.27, s).frequency.exponentialRampToValueAtTime(784, t + 0.22);
  }

  /* the craft stopped dead against the frame's edge, at weight v */
  function edge(v) {
    var t = now();
    if (t == null) return;
    v = Math.max(0, Math.min(1, v == null ? 1 : v));
    var g = gain(0);
    strike(g, t, 0.12 * v, 0.004, 0.12);
    tone('sine', 82, t, 0.16, g).frequency.exponentialRampToValueAtTime(50, t + 0.12);
    var n = gain(0);
    strike(n, t, 0.05 * v, 0.003, 0.1);
    hiss(t, 0.12, filter('lowpass', 600, 0.7, n));
  }

  /* the lens servo, driving in onto the island (`inward`) or back out */
  function zoom(inward) {
    var t = now();
    if (t == null) return;
    var a = inward ? 300 : 900;
    var b = inward ? 900 : 300;
    var g = gain(0);
    strike(g, t, 0.04, 0.3, 0.6);
    tone('sawtooth', a, t, 0.95, filter('bandpass', 1200, 2.2, g))
      .frequency.exponentialRampToValueAtTime(b, t + 0.9);
    var air = gain(0);
    strike(air, t, 0.07, 0.4, 0.5);
    hiss(t, 0.95, filter('lowpass', 1400, 0.7, air));
  }


  /* ============================================================
     THE WARNINGS
     ============================================================ */

  /* a heart gone: two tones down over a knock */
  function hit() {
    var t = now();
    if (t == null) return;
    var lp = filter('lowpass', 2200, 0.7, bus);
    hold(880, t, 0.14, 0.05, 'square', lp);
    hold(587, t + 0.16, 0.24, 0.05, 'square', lp);
    var g = gain(0);
    strike(g, t, 0.1, 0.004, 0.25);
    tone('sine', 72, t, 0.3, g);
  }

  /* one heart left: the caution chime, three times */
  function caution() {
    var t = now();
    if (t == null) return;
    var lp = filter('lowpass', 2600, 0.7, bus);
    for (var i = 0; i < 3; i++) {
      var at = t + i * 0.3;
      hold(740, at, 0.18, 0.03, 'triangle', lp);
      hold(988, at, 0.18, 0.025, 'triangle', lp);
    }
  }

  /* the hearts are gone and the autopilot has it: three steps up and
     the chord held on them */
  function autopilot() {
    var t = now();
    if (t == null) return;
    [660, 880, 1320].forEach(function (f, i) {
      hold(f, t + i * 0.14, 0.1, 0.04, 'triangle');
    });
    var g = gain(0);
    strike(g, t + 0.42, 0.03, 0.06, 0.7);
    tone('sine', 660, t + 0.42, 0.8, g);
    tone('sine', 990, t + 0.42, 0.8, g);
  }


  /* ============================================================
     THE WEIGHT
     ============================================================ */

  /* Down on the rock, at weight v: the mass of it landing (a sub
     falling away), the two struts taking it one after the other, and
     a servo settling the frame. The metal ring and the gas, where the
     close-up has them, are js/cinematic-sfx.js's. */
  function touchdown(v) {
    var t = now();
    if (t == null) return;
    v = v == null ? 1 : v;
    var s = gain(0);
    strike(s, t, 0.45 * v, 0.006, 0.45);
    tone('sine', 78, t, 0.5, s).frequency.exponentialRampToValueAtTime(30, t + 0.42);

    var b = gain(0);
    strike(b, t, 0.14 * v, 0.004, 0.3);
    tone('triangle', 110, t, 0.34, b).frequency.exponentialRampToValueAtTime(68, t + 0.3);

    [[0, 700, 0.2], [0.07, 1100, 0.11]].forEach(function (k) {
      var g = gain(0);
      strike(g, t + k[0], k[2] * v, 0.002, 0.08);
      hiss(t + k[0], 0.1, filter('bandpass', k[1], 1.2, g));
    });

    var sv = gain(0);
    strike(sv, t + 0.25, 0.015 * v, 0.05, 0.25);
    tone('sawtooth', 520, t + 0.25, 0.32, filter('bandpass', 900, 2, sv))
      .frequency.exponentialRampToValueAtTime(420, t + 0.55);
  }

  /* the legs' hydraulics letting go once the weight is on them */
  function hydraulics(v) {
    var t = now();
    if (t == null) return;
    v = v == null ? 1 : v;
    var g = gain(0);
    strike(g, t + 0.12, 0.08 * v, 0.03, 1.1);
    var band = filter('bandpass', 6000, 0.9, g);
    band.frequency.setValueAtTime(6000, t + 0.12);
    band.frequency.exponentialRampToValueAtTime(2500, t + 1.25);
    hiss(t + 0.12, 1.2, filter('highpass', 2200, 0.7, band));
  }


  /* ============================================================
     THE SURVEY
     ============================================================ */

  /* The scanner's sweep: a warbling note carried across the stereo
     field with the line, out and back, and a sonar ping where each leg
     turns. `legMs` is the sweep's own (M.sweep in js/animation.js). */
  function scan(legs, legMs) {
    var t = now();
    if (t == null) return;
    var d = (legMs || 1150) / 1000;
    var lp = filter('lowpass', 2400, 0.7, bus);
    beep(1200, t, 0.04, 0.03, 'square', lp);

    for (var n = 0; n < (legs || 2); n++) {
      var at = t + n * d;
      var from = n % 2 ? 0.8 : -0.8;
      var p = panner(from, bus);
      if (p.pan) {
        p.pan.setValueAtTime(from, at);
        p.pan.linearRampToValueAtTime(-from, at + d);
      }
      var g = gain(0, p);
      var gp = g.gain;
      gp.setValueAtTime(0, at);
      gp.linearRampToValueAtTime(0.05, at + 0.08);
      gp.setValueAtTime(0.05, at + d - 0.12);
      gp.linearRampToValueAtTime(0, at + d);
      var trem = gain(0.5, g);
      tone('sine', 18, at, d, gain(0.5, trem.gain));
      tone('triangle', 460, at, d, trem).frequency.linearRampToValueAtTime(540, at + d);

      var q = panner(-from, bus);
      beep(1480, at + d - 0.02, 0.45, 0.045, 'sine', q);
    }
  }

  /* the dark clearing to the open sea: a deep swell of power, an open
     fifth coming up under it, and light rising off the top */
  function lightsUp() {
    var t = now();
    if (t == null) return;
    var s = gain(0);
    strike(s, t, 0.16, 0.25, 1.4);
    tone('sine', 55, t, 1.7, s);
    tone('sine', 110, t, 1.7, gain(0.4, s));

    var pad = gain(0);
    strike(pad, t, 0.02, 0.45, 1.5);
    tone('sine', 220, t, 2, pad);
    tone('sine', 330, t, 2, pad);

    var sh = gain(0);
    strike(sh, t, 0.03, 0.5, 1);
    var hp = filter('highpass', 2000, 0.7, sh);
    hp.frequency.setValueAtTime(2000, t);
    hp.frequency.exponentialRampToValueAtTime(6500, t + 1.4);
    hiss(t, 1.6, hp);
  }

  /* the altimeter's new state: the instrument chirps once for each new
     reading -- up for a climb, down for a descent */
  function altitude(state) {
    var t = now();
    if (t == null) return;
    var up = state === 'CLIMB' ? 1.26 : state === 'DESCEND' ? 0.8 : 1;
    var chirp = filter('lowpass', 2600, 0.7, bus);
    beep(1480, t, 0.03, 0.022, 'square', chirp);
    beep(1480 * up, t + 0.05, 0.04, 0.02, 'square', chirp);
  }

  /* the bracket closing on a site: two soft chirps */
  function bracket() {
    var t = now();
    if (t == null) return;
    beep(1600, t, 0.04, 0.025);
    beep(2000, t + 0.07, 0.05, 0.025);
  }

  /* Mission complete: an arpeggio up into a held chord, brassy and
     opening out, over a drum. The caller ducks the music under it. */
  function fanfare() {
    var t = now();
    if (t == null) return;
    var lead = filter('lowpass', 2200, 0.8, bus);
    [523.3, 659.3, 784, 1046.5].forEach(function (f, i) {
      beep(f, t + i * 0.09, 0.4, 0.045, 'sawtooth', lead);
    });

    var at = t + 0.38;
    var g = gain(0);
    strike(g, at, 0.03, 0.06, 1.6);
    var brass = filter('lowpass', 800, 1, g);
    brass.frequency.setValueAtTime(800, at);
    brass.frequency.exponentialRampToValueAtTime(2400, at + 0.15);
    brass.frequency.exponentialRampToValueAtTime(1100, at + 1.6);
    [261.6, 329.6, 392, 523.3].forEach(function (f) {
      tone('sawtooth', f, at, 1.7, brass);
      tone('sawtooth', f * 1.004, at, 1.7, brass);
    });

    var dr = gain(0);
    strike(dr, at, 0.3, 0.005, 0.6);
    tone('sine', 98, at, 0.7, dr).frequency.exponentialRampToValueAtTime(78, at + 0.5);

    [2093, 2637, 3136].forEach(function (f, i) {
      beep(f, at + 0.12 + i * 0.07, 0.45, 0.014, 'triangle');
    });
  }


  /* -------------------------------------------------------- the tab */
  if (global.GeoLife) {
    global.GeoLife.on('suspend', function () { away = true; level(); });
    global.GeoLife.on('resume', function () { away = false; level(); });
  }

  /* Every call goes through here. A context that is running plays at
     once. One that is not is asked to wake, and the sound plays if it
     does so straight away -- the START press, which is the gesture
     that wakes it, is heard -- but is dropped rather than saved up if
     it takes longer: a context woken by some later tap would
     otherwise play every sound asked of it until then, all at once. */
  var WAKE_MS = 400;

  function awake(fn) {
    return function (a, b) {
      var x = ctx();
      if (!x) return;
      if (x.state === 'running') return fn(a, b);
      var asked = Date.now();
      var p = x.resume();
      if (p && p.then) {
        p.then(function () {
          if (x.state === 'running' && Date.now() - asked < WAKE_MS) fn(a, b);
        }, function () { /* not allowed yet */ });
      }
    };
  }

  global.GeoSound = {
    altitude: awake(altitude),
    flyby: awake(flyby),
    spoolDown: awake(spoolDown),
    radioOn: awake(radioOn),
    radioOff: awake(radioOff),
    hush: hush,
    tick: awake(tick),
    boot: awake(boot),
    arm: awake(arm),
    latch: awake(latch),
    advance: awake(advance),
    swish: awake(swish),
    hint: awake(hint),
    readout: awake(readout),
    grab: awake(grab),
    release: awake(release),
    under: awake(under),
    lockOn: awake(lockOn),
    lockOff: awake(lockOff),
    engage: awake(engage),
    edge: awake(edge),
    zoom: awake(zoom),
    hit: awake(hit),
    caution: awake(caution),
    autopilot: awake(autopilot),
    touchdown: awake(touchdown),
    hydraulics: awake(hydraulics),
    scan: awake(scan),
    lightsUp: awake(lightsUp),
    bracket: awake(bracket),
    fanfare: awake(fanfare)
  };
})(window);
