/* ============================================================
   Geo Drone — audio engine

   · one AudioContext, one shared AnalyserNode
   · narration is routed THROUGH the analyser, so the cockpit
     readout is driven by the actual voice line that is playing
   · ambience/SFX go straight to the speakers so they do not
     pollute the readout
   · say() resolves when the line finishes, which is what the
     flow in script.js is sequenced on
   · every line comes in over mission control's radio
     (js/sound.js): the channel's tone is heard first, so a line
     that opens it is held that long before it plays
   · if the analyser comes back silent (file:// pages taint the
     media element in most browsers) we transparently fall back
     to a procedural, speech-shaped envelope keyed to playback
     time — the readout still starts, moves and stops with the
     voice
   · everything playing is paused when the tab is hidden and
     picked up again on return (see js/lifecycle.js)
   · every clip is Ogg Opus (Chrome, Edge, Firefox, and Safari 17+).
     The start gate fetches them all up front (js/preload.js) and
     hands each one in as a blob: URL through adopt(), so the first
     play() of any line reads from memory; a clip whose blob fails
     falls back to its file URL once and carries on
   ============================================================ */

(function (global) {
  'use strict';

  var DIR = 'assets/audio/';

  /* file:// taints media-element sources: the analyser reads zeroes
     AND the element's sound disappears into the graph. Only wire the
     analyser up when we are actually served over http(s).           */
  var CAN_ANALYSE =
    global.location.protocol === 'http:' ||
    global.location.protocol === 'https:';

  var VOICE = {
    welcome:  'Welcome, Space Commander! We have a new landing mission.ogg',
    safePlace:'We need to find a safe place for it to land.ogg',
    sendDrone:'Let’s send the survey drone to check the area.ogg',
    clickLaunch:'Click the launch button to launch the drone.ogg',
    tooDark:  'It is too dark to see the landing zones.ogg',
    startScan:'Start the scanner to search the area.ogg',
    foundZones:'Great! The scanner found several landing zones..ogg',
    lookShapes:'Look at the shapes of the landing zones.ogg',
    shapeMatch:'Correct! These landing zones have the same shape as the spaceship.ogg',
    tryAgain: 'Try again.ogg',
    spaceNeeded:'Next, we need to find how much space the spaceship needs.ogg',
    calcArea: 'Calculate the area of spaceship, And select the land with required area.ogg',
    chooseExact:'Choose the landing zone with the exact area.ogg',
    tooSmall: 'This landing zone is too small. The spaceship cannot fit safely.ogg',
    tooLarge: 'This landing zone is too large. Try to find the exact match.ogg',
    perfectFit:'Perfect match! The spaceship fits exactly.ogg',
    landed:   'Landing successful! Great work, Space Commander.ogg',

    /* screens 4-8 (js/pages.js) run the survey feed's shape task and
       the landing's area task back to back on one screen, so they
       need one line the earlier screens never had: the hand-off from
       the first task to the second. These two were recorded with the
       rest and had nowhere to go until now.

       The line that NAMES the shape is deliberately not here. It
       says something different on each of the five screens ("the
       spaceship is a square", "... a rhombus") and there is no clip
       for any of them, so narrate() types it at the typewriter's own
       reading rate instead. Record them, add them here under the
       keys pages.js asks for, and they start speaking with no other
       change — see narrate() in js/script.js. */
    onlyMatching:'Now we only need to check these matching landing zones.ogg',
    findArea: 'Find the area of spaceship, And select the suitable land.ogg'
  };

  var SFX = {
    launch:  'drone-launch.ogg',
    rock:    'rock in water.ogg',

    /* The two failed landings, one clip each. Both run about two
       seconds, which is what decides where they are fired from:

         crash  2.09s  the hull coming down on the rock. Fired on
                       the frame of impact, so it is still ringing
                       while the wreck settles and the verdict line
                       starts over the top of it.
         sink   1.92s  going into the water and under it. Fired at
                       the moment of entry, where it runs almost
                       exactly the length of the plunge and the sink
                       together (204ms + 1700ms) and dies away as
                       the hull disappears.

       Both are primed rather than built at the moment they are
       needed — see prime() below. */
    crash:   'crash-sound.ogg',
    sink:    'sinking-sound.ogg',
    glitch:  'screen-glitch.ogg',
    correct: 'correct-answer.ogg',
    wrong:   'incorrect-answer.ogg',
    click:   'button-click.ogg',
    cheer:   'confetti-sound.ogg'
  };

  var AMBIENCE = 'theme-music.ogg';

  /* ---------------------------------------------------------- state */
  var ctx = null;
  var analyser = null;
  var voiceBus = null;          // gain node all narration passes through
  var freqBytes = null;

  var voices = {};              // key -> HTMLAudioElement
  var wired = {};               // key -> true once MediaElementSource exists
  var ambience = null;

  var active = null;            // element currently narrating
  var analyserAlive = null;     // null = untested, true/false once probed
  var probeUntil = 0;

  var oneShots = [];            // SFX still in flight
  var held = [];                // what we paused when the tab went away

  /* ---------------------------------------------------------- helpers */
  var local = {};               // file -> blob: URL, from the start gate

  function remote(file) { return encodeURI(DIR + file); }
  function url(file) { return local[file] || remote(file); }

  /* One-time fallback for an element playing from a blob: URL. If
     the blob fails — revoked, refused, out of memory — the element
     goes back to its file URL, once, and picks up where it was. The
     flag tells say()/fireShot() to sit through that one error rather
     than declare the line finished while it is still going to play.

     Registered at construction so it runs BEFORE their own error
     listeners (listeners fire in the order they were added). */
  function guard(el, file) {
    el.addEventListener('error', function onErr() {
      el.removeEventListener('error', onErr);
      if (!local[file] || el.src !== local[file]) return;   /* not the blob's fault */

      var playing = !el.paused && !el.ended;
      var at = el.currentTime;
      delete local[file];                 /* nobody else adopts a dead blob */

      el._geoRecover = true;              /* for the error listeners after this one */
      el._geoFellBack = true;             /* for the play() promise that is about to reject */
      el.src = remote(file);
      el.load();
      if (playing) {
        try { el.currentTime = at; } catch (e) { /* not seekable yet */ }
        var p = el.play();
        /* the file would not start either: say so the ordinary way,
           so whoever is waiting on this element is released */
        if (p && p.catch) p.catch(function () { el.dispatchEvent(new Event('error')); });
      }
    });
  }

  /* did guard() just take this error? Answered once, then cleared. */
  function recovering(el) {
    if (!el._geoRecover) return false;
    el._geoRecover = false;
    return true;
  }

  /* HTMLMediaElement.volume throws outside [0,1], and a ramp can
     land a hair past either end on the last frame */
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  /* Safety timers must not burn down while the tab is hidden, or a
     line paused mid-sentence would be declared dead and the flow
     would walk over it on return. */
  function later(ms) {
    return global.GeoLife
      ? global.GeoLife.wait(ms)
      : new Promise(function (r) { setTimeout(r, ms); });
  }

  /* Skip bins 0-1 (DC and rumble — always dead) and stop at 40% of
     the range: a voice track carries no energy above that, and
     mapping bands onto empty bins flattens the trace into a line. */
  var BIN_FIRST = 2;
  var BIN_TOP = 0.40;

  function binEdge(k, usable) {
    return BIN_FIRST + Math.floor(Math.pow(k, 1.45) * (usable - BIN_FIRST - 1));
  }

  /* a fixed per-band roughness table, so the procedural trace has
     the uneven silhouette of real speech instead of a tidy comb */
  var ROUGH = [];
  for (var r = 0; r < 128; r++) {
    ROUGH.push(0.30 + ((Math.sin(r * 12.9898) * 43758.5453) % 1 + 1) % 1 * 0.70);
  }

  function makeVoice(file) {
    var el = new Audio();
    /* none: the start gate has already fetched the file and, on
       http(s), handed it in as a blob — a second, speculative
       download here would only race the loading bar */
    el.preload = 'none';
    guard(el, file);
    el.src = url(file);
    el.volume = 1;
    return el;
  }

  /* ---------------------------------------------------------- graph */
  function ensureContext() {
    if (!CAN_ANALYSE) { analyserAlive = false; return null; }
    if (ctx) return ctx;
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.72;
      analyser.minDecibels = -92;
      analyser.maxDecibels = -18;
      freqBytes = new Uint8Array(analyser.frequencyBinCount);

      voiceBus = ctx.createGain();
      voiceBus.gain.value = 1;
      voiceBus.connect(analyser);
      analyser.connect(ctx.destination);
    } catch (e) {
      ctx = null;
      analyser = null;
    }
    return ctx;
  }

  function routeThroughAnalyser(key, el) {
    if (!ctx || !voiceBus || wired[key]) return;
    try {
      var src = ctx.createMediaElementSource(el);
      src.connect(voiceBus);
      wired[key] = true;
    } catch (e) {
      /* already wired elsewhere, or blocked — the fallback covers it */
      wired[key] = true;
    }
  }

  /* ---------------------------------------------------------- unlock */
  function unlock() {
    ensureContext();
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  /* ---------------------------------------------------------- narration */
  /* Is there a clip for this line? narrate() asks before it decides
     whether to clock the typing off a voice or off the reading
     rate. */
  function hasVoice(key) { return !!VOICE[key]; }

  function say(key, opts) {
    opts = opts || {};
    var file = VOICE[key];
    if (!file) return Promise.resolve();

    unlock();

    var el = voices[key] || (voices[key] = makeVoice(file));
    routeThroughAnalyser(key, el);

    try { el.currentTime = 0; } catch (e) {}
    el.volume = opts.volume == null ? 1 : opts.volume;

    active = el;

    /* Mission control's channel (js/sound.js), opened for the line.
       `lead` is how long to hold the voice so the tone the channel
       opens on is heard first: 0 when it is already open from the
       line before. `radio: false` is a line said off the air. */
    var S = opts.radio === false ? null : global.GeoSound;
    var lead = S ? S.radioOn() : 0;

    return new Promise(function (resolve) {
      var done = false;

      function finish() {
        if (done) return;
        done = true;
        el._geoHeld = false;
        el.removeEventListener('ended', finish);
        el.removeEventListener('error', onError);
        el.removeEventListener('loadedmetadata', tighten);
        if (active === el) active = null;
        if (S) S.radioOff();
        resolve();
      }

      /* a blob that failed and was swapped for the file is not the
         end of the line — see guard() */
      function onError() { if (!recovering(el)) finish(); }

      /* Watchdog: the clip's own length plus a few seconds' grace,
         re-armed for every line, so a clip that never fires `ended`
         (a stalled decoder, a muted tab that swallowed the event)
         holds the flow for seconds rather than for the hard net
         below. Armed once the duration is known. */
      function tighten() {
        if (isFinite(el.duration) && el.duration > 0) {
          later(el.duration * 1000 + 4000).then(finish);
        }
      }

      el.addEventListener('ended', finish);
      el.addEventListener('error', onError);
      if (el.readyState >= 1) tighten();
      else el.addEventListener('loadedmetadata', tighten);

      function start() {
        el._geoHeld = false;
        if (done) return;                 /* stopped inside the hold */
        if (analyserAlive === null) probeUntil = performance.now() + 700;

        /* Hand the element over before playback starts, so a caption
           can clock itself off currentTime instead of guessing at a
           typing speed. play() clears `paused` synchronously, so the
           typewriter's first frame already sees a live clock -- which
           is why this waits out the hold with the play() rather than
           going before it: a caption handed a parked clock would read
           it as a line cut short. */
        if (opts.onPlay) {
          try { opts.onPlay(el); } catch (e) { /* caption only — never stall the line */ }
        }

        el._geoFellBack = false;
        var p = el.play();
        if (p && p.catch) {
          p.catch(function () {
            /* the blob was refused and guard() has already restarted
               the line from its file: `ended` (or the watchdog) will
               see it out, so this is not the end of the line */
            if (el._geoFellBack) { el._geoFellBack = false; return; }
            /* blocked or missing — do not stall the flow, give the
               readout a beat of life then move on */
            later(900).then(finish);
          });
        }
      }

      /* held for the channel's tone; stopVoice() and stopAll() settle
         a held line as well as a playing one (`_geoHeld`) */
      if (lead) {
        el._geoHeld = true;
        later(lead).then(start);
      } else {
        start();
      }

      /* hard safety net so a broken file can never freeze the mission */
      later(30000).then(finish);
    });
  }

  function isSpeaking() {
    return !!(active && !active.paused && !active.ended);
  }

  function stopVoice() {
    Object.keys(voices).forEach(function (k) {
      var el = voices[k];
      if (!el.paused || el._geoHeld) {
        el._geoHeld = false;
        el.pause();
        /* say() resolves on 'ended'; pausing never fires it, so
           settle the promise by hand instead of leaving the flow
           waiting on the safety timeout */
        el.dispatchEvent(new Event('ended'));
      }
    });
    active = null;
  }

  /* Silence everything at once — used when the player jumps to
     another screen and the sequence that owned these clips is
     abandoned. `held` is cleared too, so a later tab-return cannot
     revive a line that no longer belongs anywhere. */
  function stopAll() {
    Object.keys(voices).forEach(function (k) {
      var el = voices[k];
      if (!el.paused || el._geoHeld) {
        el._geoHeld = false;
        el.pause();
        el.dispatchEvent(new Event('ended'));
      }
    });

    oneShots.slice().forEach(function (el) {
      try {
        el.pause();
        el.dispatchEvent(new Event('ended'));
      } catch (e) { /* already gone */ }
    });

    active = null;
    held = [];
    thrust(0);
    /* and mission control's radio with it (js/sound.js) */
    if (global.GeoSound) global.GeoSound.hush();
  }

  /* ---------------------------------------------------------- one-shots */
  /* Play an element that has already been built, and see it off the
     oneShots list however it ends — played out, failed, or still
     going a quarter of a minute later. Shared by sfx() and by the
     primed shots below, so a clip is retired the same way whichever
     of the two fired it. */
  function fireShot(el, opts) {
    opts = opts || {};

    el.volume = opts.volume == null ? 0.7 : opts.volume;
    if (opts.rate) el.playbackRate = opts.rate;

    /* `keep` holds a clip back from the oneShots list, which is the
       list stopAll() empties when the player leaves a screen.

       The UI tick is the one thing that asks for it: it belongs to
       the tap, not to the screen the tap is walking away from, and
       NEXT would otherwise silence its own click a line later —
       onAdvance() goes straight into goTo(), which calls stopAll()
       while the tick is 20ms old. Everything else stays on the list,
       so a jump still takes its sound with it. */
    if (!opts.keep) oneShots.push(el);

    return new Promise(function (resolve) {
      var done = false;
      function finish() {
        if (done) return;
        done = true;
        var i = oneShots.indexOf(el);
        if (i >= 0) oneShots.splice(i, 1);
        resolve();
      }
      el.addEventListener('ended', finish);
      el.addEventListener('error', function () { if (!recovering(el)) finish(); });
      el._geoFellBack = false;
      var p = el.play();
      if (p && p.catch) {
        p.catch(function () {
          if (el._geoFellBack) { el._geoFellBack = false; return; }   /* see say() */
          finish();
        });
      }
      later(15000).then(finish);
    });
  }

  function sfx(key, opts) {
    var file = SFX[key];
    if (!file) return Promise.resolve();

    unlock();
    var el = new Audio();
    guard(el, file);
    el.src = url(file);
    return fireShot(el, opts);
  }

  /* ---------------------------------------------------------- primed shots

     Build the clip NOW, play it on some later frame.

     A crash has to be HEARD on the frame the hull hits the rock. An
     <audio> created at that instant still has to be constructed,
     read out of the HTTP cache and handed to the decoder, and the
     bang lands after the dust — a slip that is small in
     milliseconds and very audible against a 540ms beat.

     prime() is called at the top of an attempt, from inside the
     click that started it, which is both a whole second and a half
     of head start AND the user gesture the autoplay policy wants.
     It warms the decoder by playing the clip muted and parking it
     back at zero, so the play() that matters is immediate.

     It hands back a fire function. Call it once; call it again and
     it falls through to an ordinary sfx(), so nothing goes silent
     if a caller fires twice. */
  function prime(key) {
    var file = SFX[key];
    if (!file) return function () { return Promise.resolve(); };

    unlock();

    var el = new Audio();
    guard(el, file);
    el.src = url(file);
    el.preload = 'auto';

    var spent = false;

    /* A browser will not decode a clip it has never been asked to
       play, so preload alone can still stall on the first play().
       This asks, silently, and then rewinds. */
    try {
      el.muted = true;
      el.load();
      var warm = el.play();
      if (warm && warm.then) {
        warm.then(function () {
          if (spent) return;              /* the real shot beat us to it */
          el.pause();
          try { el.currentTime = 0; } catch (e) {}
          el.muted = false;
        }, function () { el.muted = false; });
      } else {
        el.muted = false;
      }
    } catch (e) {
      el.muted = false;
    }

    return function (opts) {
      if (spent) return sfx(key, opts);
      spent = true;

      /* whatever state the warm-up left it in, start from the top
         and at full voice */
      el.muted = false;
      try { el.pause(); el.currentTime = 0; } catch (e) {}

      return fireShot(el, opts);
    };
  }

  /* ---------------------------------------------------------- ambience */
  function startAmbience(volume) {
    if (ambience) return;
    ambience = new Audio();
    guard(ambience, AMBIENCE);
    ambience.src = url(AMBIENCE);
    ambience.loop = true;
    ambience.volume = 0;
    var target = volume == null ? 0.24 : volume;
    var p = ambience.play();
    if (p && p.catch) p.catch(function () {});

    /* gentle fade-in so it slips under the briefing */
    var t0 = performance.now();
    (function ramp(now) {
      var k = Math.min(1, (now - t0) / 2600);
      ambience.volume = clamp01(target * k);
      if (k < 1) requestAnimationFrame(ramp);
    })(t0);
  }

  function duckAmbience(to, ms) {
    if (!ambience) return;
    var from = ambience.volume;
    var t0 = performance.now();
    (function ramp(now) {
      var k = Math.min(1, (now - t0) / (ms || 600));
      ambience.volume = clamp01(from + (to - from) * k);
      if (k < 1) requestAnimationFrame(ramp);
    })(t0);
  }

  /* ---------------------------------------------------------- spectrum
     Fills `out` (Float32Array, 0..1) with the current voice
     spectrum. Real analyser data when we have it, a procedural
     speech envelope when we do not.                            */
  function fillSpectrum(out) {
    var n = out.length;
    var speaking = isSpeaking();

    if (analyser && analyserAlive !== false) {
      analyser.getByteFrequencyData(freqBytes);

      if (analyserAlive === null && speaking) {
        var peak = 0;
        for (var p = 0; p < freqBytes.length; p++) {
          if (freqBytes[p] > peak) peak = freqBytes[p];
        }
        if (peak > 6) {
          analyserAlive = true;
        } else if (performance.now() > probeUntil) {
          analyserAlive = false;    // silent graph → go procedural
        }
      }

      if (analyserAlive === true) {
        if (!speaking) {
          proceduralFill(out, performance.now() / 1000, true);
          return false;
        }

        /* Voice energy lives low in the spectrum, so read a
           log-ish slice of the bins rather than the whole range. */
        var bins = freqBytes.length;
        var usable = Math.floor(bins * BIN_TOP);

        for (var i = 0; i < n; i++) {
          var lo = binEdge(i / (n - 1), usable);
          var hi = binEdge((i + 1) / (n - 1), usable);
          if (hi <= lo) hi = lo + 1;
          var max = 0;
          for (var b = lo; b < hi && b < bins; b++) {
            if (freqBytes[b] > max) max = freqBytes[b];
          }
          /* a small floor keeps the tail alive instead of ruler-flat */
          out[i] = Math.max(speaking ? 0.05 : 0.02,
                            Math.min(1, (max / 255) * 1.4));
        }
        return speaking;
      }
    }

    proceduralFill(out, active ? active.currentTime : performance.now() / 1000, !speaking);
    return speaking;
  }

  /* Speech-shaped envelope, used two ways: as the whole signal when
     the analyser is unavailable, and as the idle breath between
     lines so the readout never sits as a dead flat line.          */
  function proceduralFill(out, t, idle) {
    var n = out.length;

    /* syllable gate: opens and closes the way speech does */
    var syl = Math.abs(Math.sin(t * 8.7) * Math.sin(t * 2.9 + 1.1)) * 0.7 +
              Math.abs(Math.sin(t * 4.3 + 0.4)) * 0.3;
    var amp = idle ? 0.07 : (0.22 + 0.78 * syl);

    for (var j = 0; j < n; j++) {
      var g = j / (n - 1);
      var tilt = Math.pow(1 - g, 0.6) * 0.72 + 0.28;
      var rough = ROUGH[j % ROUGH.length];
      /* two detuned wobbles per band keep neighbours from marching
         in step, which is what made the comb look mechanical */
      var wob =
        0.5 + 0.34 * Math.sin(j * 2.31 + t * (7.1 + rough * 6.4)) +
              0.16 * Math.sin(j * 0.77 - t * (13.7 - rough * 4.1));
      /* 0.82 keeps the loud bands off the clamp, which is what
         was flattening the peaks into a even comb */
      out[j] = Math.max(0.015, Math.min(1, 0.82 * amp * tilt * rough * (0.34 + 0.9 * wob)));
    }
  }

  /* ---------------------------------------------------------- the burner

     The roar of the flown landing's thrusters (js/pilot.js). There is
     no clip for it: a jet is held for as long as the player holds the
     control, so what it needs is a sound with no length — a loop of
     brown noise, a rumble rather than a hiss, through a low-pass, and
     a gain that rides up as a jet lights and falls away when the last
     one is cut. Built on first use and never stopped, only silenced:
     a fresh source per burn would click at the start of every one.

     `jets` is how many are lit. Each one opens the filter a little,
     so two at once (a diagonal) are louder and brighter than one.
     Over the rumble rides the fire's crackle, on the same gain, and
     the whole burn is placed across the stereo field by `pan` (-1
     left .. 1 right): where the lit nozzles are, which js/pilot.js
     works out. A caller that does not say is heard dead centre.

     Needs the AudioContext, which this module only builds over
     http(s) (see CAN_ANALYSE), so a file:// run flies in silence. */
  var burner = null;

  /* a loop of sparse, very short ticks: the crackle of the burn */
  function sparks(c) {
    var len = Math.floor(c.sampleRate * 2);
    var buf = c.createBuffer(1, len, c.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) {
      if (Math.random() >= 0.0012) continue;
      var amp = 0.3 + Math.random() * 0.7;
      for (var k = 0; k < 60 && i + k < len; k++) {
        d[i + k] += amp * Math.exp(-k / 9) * (Math.random() * 2 - 1);
      }
    }
    return buf;
  }

  function burnerOf(c) {
    if (burner !== null) return burner;
    try {
      var len = Math.floor(c.sampleRate * 2);
      var buf = c.createBuffer(1, len, c.sampleRate);
      var d = buf.getChannelData(0);
      var last = 0;
      for (var i = 0; i < len; i++) {
        last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
        d[i] = last * 3.5;
      }
      var src = c.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      var tone = c.createBiquadFilter();
      tone.type = 'lowpass';
      tone.frequency.value = 500;
      tone.Q.value = 0.8;
      var gain = c.createGain();
      gain.gain.value = 0;
      src.connect(tone);
      tone.connect(gain);

      var crackle = c.createBufferSource();
      crackle.buffer = sparks(c);
      crackle.loop = true;
      var bite = c.createBiquadFilter();
      bite.type = 'bandpass';
      bite.frequency.value = 2600;
      bite.Q.value = 0.8;
      var grit = c.createGain();
      grit.gain.value = 0.35;
      crackle.connect(bite);
      bite.connect(grit);
      grit.connect(gain);

      var pan = c.createStereoPanner ? c.createStereoPanner() : null;
      if (pan) {
        gain.connect(pan);
        pan.connect(c.destination);
      } else {
        gain.connect(c.destination);
      }
      src.start();
      crackle.start();
      burner = { tone: tone, gain: gain, pan: pan, jets: 0 };
    } catch (e) {
      burner = false;
    }
    return burner;
  }

  function thrust(jets, pan) {
    jets = Math.max(0, jets | 0);
    var c = ensureContext();
    if (!c) return;
    if (!jets && !burner) return;          /* nothing to silence yet */
    if (c.state === 'suspended') c.resume();

    var b = burnerOf(c);
    if (!b) return;

    var now = c.currentTime;
    var level = jets ? Math.min(0.42, 0.26 + 0.08 * (jets - 1)) : 0;
    var g = b.gain.gain;

    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    if (jets > b.jets) {
      /* ignition: a short swell over the burn's own level */
      g.linearRampToValueAtTime(level * 1.5, now + 0.04);
      g.setTargetAtTime(level, now + 0.04, 0.08);
    } else {
      g.setTargetAtTime(level, now, jets ? 0.06 : 0.1);
    }
    b.tone.frequency.setTargetAtTime(jets ? 900 + 300 * jets : 400, now, 0.07);
    if (b.pan && jets) b.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan || 0)), now, 0.08);
    b.jets = jets;
  }

  /* ---------------------------------------------------------- lifecycle
     Pause every player that is actually making sound and remember
     which ones they were, so returning to the tab picks each of
     them up exactly where it stopped. */
  function suspendAll() {
    if (held.length) return;

    var all = Object.keys(voices).map(function (k) { return voices[k]; })
      .concat(oneShots);
    if (ambience) all.push(ambience);

    all.forEach(function (a) {
      if (a && !a.paused && !a.ended) {
        a.pause();
        held.push(a);
      }
    });
  }

  function resumeAll() {
    var list = held;
    held = [];
    list.forEach(function (a) {
      var p = a.play();
      if (p && p.catch) p.catch(function () { /* gone — let it go */ });
    });
  }

  /* ---------------------------------------------------------- the gate's hand-in

     The start gate (js/script.js) fetches every clip through
     js/preload.js and hands each one in here as a blob: URL. From
     then on url() serves the blob, so every Audio built above —
     voices, one-shots, the primed shots, the ambience — starts from
     memory. A voice element that already exists is re-pointed too,
     unless it is mid-line. */
  function files() {
    var seen = {};
    var out = [];
    function add(file) {
      if (seen[file]) return;
      seen[file] = true;
      out.push({ file: file, url: remote(file) });
    }
    Object.keys(VOICE).forEach(function (k) { add(VOICE[k]); });
    Object.keys(SFX).forEach(function (k) { add(SFX[k]); });
    add(AMBIENCE);
    return out;
  }

  function adopt(file, blobUrl) {
    if (!file || !blobUrl) return;
    local[file] = blobUrl;
    Object.keys(voices).forEach(function (k) {
      var el = voices[k];
      if (VOICE[k] === file && el.paused && active !== el) el.src = blobUrl;
    });
  }

  if (global.GeoLife) {
    global.GeoLife.on('suspend', suspendAll);
    global.GeoLife.on('resume', resumeAll);
  }

  global.GeoAudio = {
    files: files,
    adopt: adopt,
    unlock: unlock,
    say: say,
    hasVoice: hasVoice,
    sfx: sfx,
    prime: prime,
    thrust: thrust,
    /* the shared AudioContext (null over file://), for the cut-scene's
       synthesised effects in js/cinematic-sfx.js */
    context: ensureContext,
    stopVoice: stopVoice,
    stopAll: stopAll,
    startAmbience: startAmbience,
    duckAmbience: duckAmbience,
    fillSpectrum: fillSpectrum
  };
})(window);
