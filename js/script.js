/* ============================================================
   Geo Drone — mission flow

   Screen 1 · cockpit
     briefing (3 lines, readout waveform live)
     → LAUNCH button rises out of the console
     → prompt to press it
     → press: launch SFX, drone climbs out through the canopy
     → cross-fade to the drone feed

   Screen 2 · drone feed
     black (ocean hidden) + "it is too dark"
     → "start the scanner"
     → green line sweeps left/right/left/right
     → ocean fades up 0 → 1
     → five landing zones breach the surface with splashes
     → "the scanner found several landing zones"

   Screen 2 · shape hunt (continues on the same feed)
     narration bar drops in, typed in step with the voice
     → "look at the shapes of the landing zones"
     → the spaceship chip parks in the corner
     → "the spaceship is a triangle — select all the triangular
        landing zones"
     → the five zones become selectable; three triangles to find
       · right shape → tick stamped on, zone locks in
       · wrong shape → shake, buzzer, "try again"
     → all three found: the square and the trapezium sink back
       under the water, one after the other, each with a splash
     → "correct! these landing zones have the same shape as the
        spaceship", and the feed cuts straight to screen 3

   Screen 3 · the landing
     the craft rises with its base and height called out
     → "next, we need to find how much space the spaceship needs"
     → three pads surface, each with its area printed on it
     → "calculate the area of spaceship, and select the land with
        required area"
     → the player picks; the craft flies down and the geometry
       decides what happens (see SCREEN 3 below)
     → it fits: confetti falls over the whole frame, "landing
       successful", and a NEXT button arrives under the footer lines
       to carry the mission on to the screen after this one

   The "<" / ">" nav can cut in at any point, so each screen is
   described as a list of steps run under a generation id. Jumping
   bumps that id, which makes the abandoned chain unwind at its next
   step instead of firing captions and voice lines over the screen
   the player just moved to.
   ============================================================ */

(function (global) {
  'use strict';

  var A = global.GeoAudio;
  var M = global.GeoMotion;
  var W = global.GeoWave;
  var T = global.GeoType;

  /* js/failure.js — the landing and its two failures, shared by
     screen 3 and all five round screens. Every one of the three
     outcomes below goes through it. */
  var F = global.GeoFail;

  /* js/water.js, or a stand-in that does nothing. The water is the
     scene's finish rather than its plumbing: with the module
     missing the islands keep their hard edges and every beat below
     still plays, which is the same bargain addRoundScreens() makes
     with js/pages.js. */
  var SEA = global.GeoWater || (function () {
    function noop() {}
    return {
      init: noop, breach: noop, close: noop,
      approve: noop, reject: noop, settle: noop, impact: noop
    };
  })();

  var el = {};
  var launched = false;

  /* shape hunt */
  var TARGET_SHAPE = 'triangle';
  var picked = 0;                 // triangles found so far
  var needed = 0;                 // how many there are to find
  var picking = false;            // clicks are being accepted
  var releasePick = null;         // resolves the "wait for all of them" step
  var scolding = false;           // a "try again" is already playing

  /* the five zones back to front, as GeoPages.strewZones() left
     them; null until the feed has been reset at least once */
  var surfaceOrder = null;

  var runId = 0;            // bumped on every jump
  var current = 0;          // index into SCREENS
  var busy = false;         // a swap is in flight
  var ABORT = { abort: true };

  /* ---------------------------------------------------------- captions
     Short on-screen echoes of the narration. */
  var LINE = {
    welcome:    'Welcome, Space Commander! We have a new landing mission.',
    safePlace:  'We need to find a safe place for it to land.',
    sendDrone:  'Let’s send the survey drone to check the area.',
    clickLaunch:'Click the LAUNCH button to launch the drone.',
    tooDark:    'It is too dark to see the landing zones.',
    startScan:  'Start the scanner to search the area.',
    foundZones: 'Great! The scanner found several landing zones.',
    lookShapes: 'Look at the shapes of the landing zones.',
    pickTriangles: 'The spaceship is a triangle. Select all the triangular landing zones.',
    shapeMatch: 'Correct! These landing zones have the same shape as the spaceship.',
    tryAgain: 'Try again.',
    spaceNeeded: 'Next, we need to find how much space the spaceship needs.',
    calcArea: 'Calculate the area of spaceship, and select the land with required area.',
    chooseExact: 'Choose the landing zone with the exact area.',
    tooSmall: 'This landing zone is too small. The spaceship cannot fit safely.',
    tooLarge: 'This landing zone is too large. Try to find the exact match.',
    perfectFit: 'Perfect match! The spaceship fits exactly.',
    landed: 'Landing successful! Great work, Space Commander.',

    /* the two lines screens 4-8 add: the hand-off from the shape
       task to the area task, and a second way of asking for the
       area so five rounds do not all open with the same sentence */
    onlyMatching: 'Now we only need to check these matching landing zones.',
    findArea: 'Find the area of spaceship, and select the suitable land.'
  };

  function grab() {
    [
      'stage', 'screenCockpit', 'screenDrone', 'starfield',
      'flyDrone', 'flyTrail', 'dash', 'waveCanvas', 'cockpitCaption',
      'launchSlot', 'launchBtn', 'oceanBg', 'blackout', 'scanner',
      'zones',
      'topbar', 'topbarText',
      'screenLanding', 'ship', 'shipCraft', 'shipDims', 'pads',
      'confetti', 'advanceBtn',
      'landHud', 'landCaption', 'landTally', 'landTopbar', 'landTopbarText',
      'veil', 'gate', 'gateBtn', 'gateLoad', 'gateFill',
      'gateStatus', 'gatePct', 'nav', 'navPrev', 'navNext'
    ].forEach(function (id) { el[id] = document.getElementById(id); });
  }

  /* ---------------------------------------------------------- sequencing
     Runs `steps` in order, dropping out the moment the generation it
     started under is no longer the live one. */
  function sequence(steps) {
    var id = ++runId;
    var chain = Promise.resolve();

    steps.forEach(function (step) {
      chain = chain.then(function () {
        if (id !== runId) throw ABORT;
        return step(id);
      });
    });

    return chain.catch(function (e) {
      if (e !== ABORT) throw e;
    });
  }

  function live(id) { return id === runId; }

  /* ---------------------------------------------------------- caption + voice */
  function speak(target, key, keep) {
    if (target) {
      target.textContent = LINE[key] || '';
      target.classList.add('is-shown');
    }
    return A.say(key).then(function () {
      return M.wait(240);
    }).then(function () {
      /* `keep` lets a step that has already moved on (the player
         pressed LAUNCH mid-prompt) hold on to its own caption */
      if (target && (!keep || keep())) target.classList.remove('is-shown');
      return M.wait(180);
    });
  }

  function notLaunched() { return !launched; }

  /* ---------------------------------------------------------- narration bar
     Same contract as speak(), but the line is TYPED into the header
     bar instead of cross-fading in, and the typing is clocked off
     the voice clip itself rather than off a chars/second guess —
     GeoAudio hands the <audio> element over through `onPlay`, and
     GeoType reads currentTime off it. See js/typewriter.js. */
  function narrate(bar, key, text) {
    if (text == null) text = LINE[key] || '';

    /* A line with no clip recorded for it yet. Screens 4-8 each name
       their own shape ("the spaceship is a rhombus"), and there is no
       audio for any of the five, so the typing is clocked off the
       typewriter's own reading rate and the flow waits for the text
       rather than for a voice. Drop the mp3s in and register them in
       VOICE (js/audio.js) and this branch stops being taken — every
       one of those lines starts speaking, with no change here. */
    if (!A.hasVoice(key)) {
      if (M.reduced()) {
        T.set(bar, text);
        return M.wait(1400);
      }
      return T.type(bar, text, { hold: 900 }).then(function () {
        return M.wait(400);
      });
    }

    if (M.reduced()) {
      T.set(bar, text);
      return A.say(key).then(function () { return M.wait(260); });
    }

    return A.say(key, {
      onPlay: function (audio) {
        T.type(bar, text, { audio: audio, hold: 260 });
      }
    }).then(function () {
      return M.wait(300);
    });
  }

  /* ============================================================
     SCREEN 1 — COCKPIT
     ============================================================ */
  function resetCockpit() {
    launched = false;

    el.cockpitCaption.classList.remove('is-shown');
    el.cockpitCaption.textContent = '';

    el.launchSlot.classList.remove('is-armed', 'is-spent');
    el.launchBtn.classList.remove('is-shown', 'is-pressed');

    /* the climb is a Web Animation with fill:forwards — cancel it or
       the drone stays parked wherever it was left */
    [el.flyDrone, el.flyTrail].forEach(function (node) {
      if (node && node.getAnimations) {
        node.getAnimations().forEach(function (a) { a.cancel(); });
      }
    });

    el.dash.classList.add('is-live');
  }

  function runCockpit() {
    W.start();

    return sequence([
      function () { return M.wait(700); },
      function () { return speak(el.cockpitCaption, 'welcome'); },
      function () { return speak(el.cockpitCaption, 'safePlace'); },
      function () { return speak(el.cockpitCaption, 'sendDrone'); },
      function () { return M.wait(280); },
      function () {
        el.launchBtn.classList.add('is-shown');
        el.launchSlot.classList.add('is-armed');
        return M.wait(420);
      },
      /* the prompt plays over the button appearing — the player can
         press as soon as it is there, they do not have to wait */
      function () { return speak(el.cockpitCaption, 'clickLaunch', notLaunched); },
      function () {
        if (launched) return;
        el.cockpitCaption.textContent = 'Press LAUNCH when you are ready, Commander.';
        el.cockpitCaption.classList.add('is-shown');
      }
    ]);
  }

  /* ---------------------------------------------------------- launch */
  function onLaunch() {
    if (launched) return;
    launched = true;

    var id = runId;                       // the briefing's generation

    el.launchSlot.classList.remove('is-armed');
    el.launchBtn.classList.add('is-pressed');
    A.stopVoice();
    el.cockpitCaption.textContent = 'Launching survey drone…';
    el.cockpitCaption.classList.add('is-shown');

    A.duckAmbience(0.11, 700);
    A.sfx('launch', { volume: 0.9 });

    /* hold the plate down for a beat, then let it fade — it has done
       its job and should not sit there competing for attention */
    M.wait(420).then(function () {
      if (live(id)) el.launchSlot.classList.add('is-spent');
    });

    /* drone climbs out; the swap starts while it is still shrinking,
       so the two motions read as one continuous shot */
    M.flyDrone(el.flyDrone, el.flyTrail);

    M.wait(M.reduced() ? 500 : 2350).then(function () {
      if (!live(id)) return;              // player navigated away mid-flight
      el.cockpitCaption.classList.remove('is-shown');
      A.sfx('glitch', { volume: 0.34 });
      return goTo(1, { silent: true });
    });
  }

  /* ============================================================
     SCREEN 2 — DRONE FEED
     ============================================================ */
  function resetDroneFeed() {
    el.oceanBg.classList.remove('is-lit');
    el.blackout.classList.remove('is-clear');
    el.scanner.classList.remove('is-on');

    var bar = el.scanner.querySelector('.scanner__bar');
    if (bar && bar.getAnimations) {
      bar.getAnimations().forEach(function (a) { a.cancel(); });
    }

    zoneList().forEach(function (z) {
      z.classList.remove('is-up', 'is-picked', 'is-wrong', 'is-sunk');
    });

    /* Strewn again on every entry, on the same five stations every
       screen after this one uses, and shuffled — see the scatter in
       js/pages.js for why it has to be shuffled and not just laid
       out. `order` is the archipelago back to front, which is the
       order it should breach in; without it (a frame too cramped for
       any draw of five) the zones keep the fallback positions in
       css/style.css and breach in document order. */
    surfaceOrder = null;
    if (global.GeoPages) {
      surfaceOrder = global.GeoPages.strewZones(el.screenDrone, zoneList());
    }

    endPicking();
    picked = 0;

    el.topbar.classList.remove('is-on');
    T.clear(el.topbarText);
  }

  function runDroneFeed() {
    W.stop();

    return sequence([
      /* the bar drops in empty and then carries every line on this
         screen — there is no caption over the water any more, so it
         has to be up before the first voice clip, not partway in */
      function () {
        el.topbar.classList.add('is-on');
        A.duckAmbience(0.18, 900);
        return M.wait(720);
      },

      /* --- the dark --- */
      function () { return narrate(el.topbarText, 'tooDark'); },
      function () { return M.wait(220); },

      /* --- call for the scanner --- */
      function () { return narrate(el.topbarText, 'startScan'); },

      /* --- red line sweeps the feed: out and back, once --- */
      function () {
        return M.sweep(el.scanner, { legs: 2, legMs: 1150 });
      },

      /* --- lights up: ocean 0 → 1 --- */
      function () {
        el.oceanBg.classList.add('is-lit');
        el.blackout.classList.add('is-clear');
        return M.wait(1700);
      },

      /* --- shapes breach the water --- */
      function () { return surface(); },
      function () { return M.wait(420); },

      /* --- payoff line --- */
      function () { return narrate(el.topbarText, 'foundZones'); },
      function () { return M.wait(420); },

      /* ═══════════════ shape hunt ═══════════════ */

      function () { return narrate(el.topbarText, 'lookShapes'); },

      /* a beat to look at the water before the line names the shape */
      function () { return M.wait(560); },

      function () { return narrate(el.topbarText, 'pickTriangles'); },

      /* --- over to the player --- */
      function (id) { return startPicking(id); },

      /* --- the odd shapes go back under --- */
      function () { return M.wait(420); },
      function () { return sinkOthers(); },
      function () { return M.wait(360); },

      /* --- payoff --- */
      function () { return narrate(el.topbarText, 'shapeMatch'); },

      /* --- and straight on to the landing ---
         The task is done and the line that closes it has finished, so
         there is nothing left for the player to do on this screen.
         The hand-off is the same one the LAUNCH button makes: a beat
         to let the last word land, the feed-cut sting, then the swap.

         Two steps rather than one, deliberately. sequence() checks the
         generation between them, so a player who reaches for "<"
         during that beat is not yanked forward by a jump that was
         queued before they moved.

         `silent` stops goTo cutting the sting it is transitioning
         under, and firing without awaiting is safe: goTo bumps the
         generation itself, stranding this sequence, and there are no
         steps after this one left to unwind. */
      function () { return M.wait(900); },
      function (id) {
        if (!live(id)) return;
        A.sfx('glitch', { volume: 0.34 });
        return goTo(2, { silent: true });
      }
    ]);
  }

  function surface() {
    var list = surfaceOrder || zoneList();

    return M.surfaceZones(list, function (zone, i) {
      /* a little pitch variation so five splashes do not sound
         like the same sample five times */
      A.sfx('rock', {
        volume: 0.55,
        rate: [1, 0.92, 1.08, 0.96, 1.12][i % 5]
      });

      /* the sea's half of the same event: the water this island has
         just pushed aside, thrown out as a front that reaches the
         ones already standing in the order it would really reach
         them */
      SEA.breach(zone);
    }, { gap: 620 });
  }

  /* ============================================================
     SHAPE HUNT
     ============================================================ */

  function zoneList() {
    return Array.prototype.slice.call(el.zones.querySelectorAll('.zone'));
  }

  /* Hands the feed over to the player and resolves once every
     triangle has been found.

     The abort story: this step parks a promise that only the
     player can settle, so `sequence` cannot check the generation
     id while it is waiting. endPicking() is therefore called from
     resetDroneFeed() — which every jump runs — and it settles the
     promise by hand. The step after this one then sees a stale id
     and unwinds, exactly like every other step. */
  function startPicking(id) {
    var zones = zoneList();

    needed = zones.filter(function (z) {
      return z.dataset.shape === TARGET_SHAPE;
    }).length;
    picked = 0;

    picking = true;
    el.zones.classList.add('is-picking');
    zones.forEach(function (z) {
      var hit = z.querySelector('.zone__hit');
      if (hit) hit.tabIndex = 0;
    });

    return new Promise(function (resolve) {
      releasePick = resolve;
      if (!live(id)) endPicking();      // jumped while we were arming
    });
  }

  function endPicking() {
    picking = false;
    scolding = false;

    if (el.zones) {
      el.zones.classList.remove('is-picking');
      zoneList().forEach(function (z) {
        var hit = z.querySelector('.zone__hit');
        if (hit) hit.tabIndex = -1;
      });
    }

    var done = releasePick;
    releasePick = null;
    if (done) done();
  }

  function onZonePick(zone) {
    if (!picking || zone.classList.contains('is-picked')) return;

    /* --- the wrong shape --- */
    if (zone.dataset.shape !== TARGET_SHAPE) {
      A.sfx('wrong', { volume: 0.5 });

      zone.classList.remove('is-wrong');
      /* force a reflow so a second wrong tap on the same shape
         replays the shock instead of doing nothing */
      void zone.offsetWidth;
      zone.classList.add('is-wrong');
      /* and the water hears it: a short red front off that island,
         which is the half the shake was missing */
      SEA.reject(zone);
      M.wait(620).then(function () { zone.classList.remove('is-wrong'); });

      /* one nudge at a time — tapping four wrong shapes in a row
         must not stack four voice lines on top of each other */
      if (!scolding) {
        scolding = true;
        A.say('tryAgain').then(function () { scolding = false; });
      }
      return;
    }

    /* --- a match --- */
    zone.classList.add('is-picked');
    picked++;
    A.sfx('correct', { volume: 0.55 });
    /* The island itself goes green off `.is-picked` (css/water.css);
       this is the water's half of the answer — a cyan front leaving
       its shore. Together they are what replaced the tick badge. */
    SEA.approve(zone);

    if (picked >= needed) {
      /* let the last tick land before the flow moves on */
      M.wait(760).then(endPicking);
    }
  }

  /* The square and the trapezium go back where they came from. */
  function sinkOthers() {
    var others = zoneList().filter(function (z) {
      return z.dataset.shape !== TARGET_SHAPE;
    });

    /* nearest (largest) first, so the surface closes front to back */
    others.sort(function (a, b) {
      return b.getBoundingClientRect().width - a.getBoundingClientRect().width;
    });

    return M.sinkZones(others, function (zone, i) {
      /* pitched down a little from the surfacing splashes — the
         same sample, but going the other way */
      A.sfx('rock', {
        volume: 0.6,
        rate: [0.88, 0.95][i % 2]
      });

      /* and the surface closing over it */
      SEA.close(zone);
    }, { gap: 620 });
  }


  /* ============================================================
     SCREEN 3 — THE LANDING

     The ship is a triangle with a base of 8 units and a height of
     5 units, so it needs 1/2 x 8 x 5 = 20 square units of land.
     Three pads are offered: 30, 12 and 20.

     The answer is never checked with a message. It is checked by
     flying the craft down and letting the geometry speak:

       12  the craft is wider than the land, hangs over both edges,
           judders, slides off it and goes into the water
       30  the craft is on far more land than it needs with nothing
           holding it, rocks until it overbalances, and goes over
           ON the island — there is no edge within reach to fall
           off, so it wrecks on the rock instead of sinking
       20  it comes down, squares up and plants itself

     The craft is drawn at its TRUE size on every attempt (see
     plan() in js/failure.js), so all three outcomes are the honest
     consequence of the numbers, not three canned cutscenes.
     ============================================================ */

  var SHIP_AREA = 20;            /* 1/2 x 8 x 5 */
  var choosing = false;
  var landing = false;           /* an attempt is playing out */
  var releaseLand = null;        /* resolves the "wait for the fit" step */
  var solved = false;

  function padList() {
    return Array.prototype.slice.call(el.pads.querySelectorAll('.pad'));
  }

  /* The landing's three stations. Dealt out on every entry so the
     20-unit island — the answer — is never twice in the same place;
     the positions themselves are in css/style.css and do not move.
     See deal() in js/pages.js for why this is a class and not an
     inline property. */
  var LAND_SLOTS = ['pad--s1', 'pad--s2', 'pad--s3'];

  function correctPad() {
    return el.pads.querySelector('.pad[data-area="' + SHIP_AREA + '"]');
  }

  function resetLanding() {
    choosing = false;
    landing = false;
    solved = false;

    if (global.GeoPages) global.GeoPages.deal(padList(), LAND_SLOTS);

    /* GeoFail.resetSpaceship takes every phase class off the craft
       and empties both effect layers, so the wreck, the scorch and
       any spray still in the air go with it */
    F.resetSpaceship(el.ship);
    el.ship.classList.remove('is-in');
    el.shipDims.classList.remove('is-drawn');

    el.pads.classList.remove('is-choosing');
    padList().forEach(function (pad) {
      pad.classList.remove('is-up', 'is-fit', 'is-loose', 'is-tight');
      var hit = pad.querySelector('.pad__hit');
      if (hit) hit.tabIndex = -1;
    });

    M.confettiClear(el.confetti);
    hideAdvance();

    el.landHud.classList.remove('is-on');
    el.landCaption.classList.remove('is-shown');
    el.landCaption.textContent = '';
    el.landTally.classList.remove('is-shown');
    el.landTally.textContent = '';

    el.landTopbar.classList.remove('is-on');
    T.clear(el.landTopbarText);

    var done = releaseLand;
    releaseLand = null;
    if (done) done();
  }

  function runLanding() {
    W.stop();

    return sequence([
      function () {
        el.landHud.classList.add('is-on');
        A.duckAmbience(0.16, 900);
        return M.wait(520);
      },

      function () {
        el.landTopbar.classList.add('is-on');
        return M.wait(680);
      },

      /* the craft comes up while the line plays, and its
         measurements are drawn on as the line lands — the callouts
         ARE "how much space it needs" */
      function () {
        el.ship.classList.add('is-in');
        M.wait(900).then(function () { el.shipDims.classList.add('is-drawn'); });
        return narrate(el.landTopbarText, 'spaceNeeded');
      },

      /* the three candidates surface with their areas printed on */
      function () { return offerPads(); },

      function () { return narrate(el.landTopbarText, 'calcArea'); },
      function () { return narrate(el.landTopbarText, 'chooseExact'); },

      /* --- over to the player, for as many attempts as it takes --- */
      function (id) { return startChoosing(id); },

      /* --- planted; plant() has already said its piece --- */
      function (id) {
        el.landTally.textContent = 'AREA = ½ × 8 × 5 = 20';
        el.landTally.classList.add('is-shown');
        return handFooterToAdvance(id, el.landCaption, el.landTally, showAdvance);
      }
    ]);
  }

  function offerPads() {
    /* left to right on the WATER, not in document order: the three
       have just been dealt to random stations, and an archipelago
       that surfaces middle-left-right reads as three separate events
       rather than one sweep */
    var pads = padList().sort(function (a, b) {
      return a.offsetLeft - b.offsetLeft;
    });

    pads.forEach(function (pad, i) {
      M.wait(i * 320).then(function () {
        pad.classList.add('is-up');
        A.sfx('rock', { volume: 0.42, rate: [1.04, 0.96, 1.1][i % 3] });
        SEA.breach(pad);
      });
    });
    return M.wait((pads.length - 1) * 320 + 1250);
  }

  /* Same abort contract as the shape hunt: the step parks a promise
     only the player can settle, and resetLanding() — which every
     jump runs — settles it by hand so the next step unwinds on a
     stale generation id. */
  function startChoosing(id) {
    armChoice();
    standingHint();

    return new Promise(function (resolve) {
      releaseLand = resolve;
      if (!live(id)) resetLanding();
    });
  }

  /* The HUD line under the pads is deliberately NOT a repeat of the
     spoken line in the bar above — it carries the arithmetic the
     player is being asked to do, and stays put while the narration
     comes and goes. */
  function standingHint() {
    el.landCaption.textContent = 'AREA = ½ × BASE × HEIGHT';
    el.landCaption.classList.add('is-shown');
    el.landTally.textContent = 'BASE 8 · HEIGHT 5';
    el.landTally.classList.add('is-shown');
  }

  function armChoice() {
    choosing = true;
    el.pads.classList.add('is-choosing');
    padList().forEach(function (pad) {
      var hit = pad.querySelector('.pad__hit');
      if (hit) hit.tabIndex = 0;
    });
  }

  function disarmChoice() {
    choosing = false;
    el.pads.classList.remove('is-choosing');
    padList().forEach(function (pad) {
      var hit = pad.querySelector('.pad__hit');
      if (hit) hit.tabIndex = -1;
    });
  }

  /* The whole question, answered in one branch.

       exact       it comes down and plants
       too large   it lands, finds nothing holding it, tips and
                   wrecks ON the island
       too small   it cannot fit, slides off the edge and sinks

     `landing` and GeoFail's own busy flag both guard the click, so
     a second island cannot be picked while an attempt is playing
     out — the first one is the game's state, the second is the
     animation's, and neither is allowed to be the only one. */
  function onPadPick(pad) {
    if (!choosing || landing || F.isAnimating(el.ship)) return;

    var area = +pad.dataset.area;
    var ref = correctPad();
    if (!ref) return;

    /* An attempt runs on its own promise chain, outside the screen's
       sequence, so it has to carry the generation itself — otherwise
       a jump mid-crash would come back and re-arm a screen the
       player has already left. */
    var id = runId;

    landing = true;
    disarmChoice();
    A.sfx('click', { volume: 0.4 });

    /* the callouts come off: the craft is flying now, and a
       measurement drawing riding along through a crash would read
       as part of the wreck */
    el.ship.classList.add('is-committed');

    if (area === SHIP_AREA) return plant(pad, ref, id);
    return fail(pad, ref, area < SHIP_AREA, id);
  }

  /* ---------------------------------------------------------- the reward
     The shower is fired and NOT awaited: it runs for a few seconds
     on the compositor while the narration carries on underneath,
     and clears itself up afterwards. The popper sound goes with it
     rather than with the later line, so the bang lands on the frame
     the first pieces appear. */
  function celebrate() {
    A.sfx('cheer', { volume: 0.5 });
    M.confetti(el.confetti);
  }

  /* The footer is one strip, and the formula, the tally and the NEXT
     button are all centred on it. So the two lines are taken away
     BEFORE the button arrives: the footer says one thing at a time,
     and NEXT lands in the space the text leaves instead of being
     stacked under it.

     The sum is the answer to the whole screen, so it gets its read
     before the hand-over. And when there is nowhere for the button
     to go — canAdvance() is false on the last screen — the two
     lines STAY, because clearing the footer for a button that never
     arrives would just empty it.

     Shared by screen 3 and the five round screens: the footer is
     built the same way on all six. */
  function handFooterToAdvance(id, caption, tally, reveal) {
    if (!canAdvance()) return;

    return M.wait(2400).then(function () {
      if (!live(id)) return;
      if (caption) caption.classList.remove('is-shown');
      if (tally) tally.classList.remove('is-shown');
      /* the lines' own fade — .45s in css/style.css */
      return M.wait(520);
    }).then(function () {
      if (live(id)) reveal();
    });
  }

  /* The NEXT button is the one control on this screen that is not
     part of the question, so it is only ever shown once the craft is
     planted and the footer has been cleared for it — and it is taken
     away again by resetLanding(), which every jump runs. */
  function showAdvance() {
    if (!el.advanceBtn || !canAdvance()) return;
    el.advanceBtn.hidden = false;
    /* reflow, so there is an un-hidden starting frame to animate
       away from instead of snapping straight to the end */
    void el.advanceBtn.offsetWidth;
    el.advanceBtn.classList.add('is-in');
  }

  function hideAdvance() {
    if (!el.advanceBtn) return;
    el.advanceBtn.classList.remove('is-in');
    el.advanceBtn.hidden = true;
  }

  /* ---------------------------------------------------------- it fits
     Approach, touchdown, and then nothing else happens — which is
     the point. The verdict outline, the chime and the confetti are
     all hung off the touchdown, so they land on the frame the craft
     actually settles rather than a beat after it. */
  function plant(pad, ref, id) {
    solved = true;

    return F.successfulLanding(el.ship, pad, {
      refPad: ref,
      alive: function () { return live(id); },

      onTouchdown: function () {
        pad.classList.add('is-fit');
        /* the craft's weight coming onto the island, read off its
           shore. settle(), not approve(): the green is the SHAPE
           task's answer, and this island already wears the fit
           outline. */
        SEA.settle(pad);

        el.landCaption.textContent = 'PERFECT FIT · 20 SQ UNITS';
        el.landCaption.classList.add('is-shown');
        el.landTally.textContent = 'AREA = ½ × 8 × 5 = 20';

        A.sfx('correct', { volume: 0.6 });

        /* a beat after the chime, so the two sounds read as one cue */
        M.wait(220).then(function () { if (live(id)) celebrate(); });
      }
    }).then(function () {
      if (!live(id)) return;
      return sayPlanted(id);
    });
  }

  function sayPlanted(id) {
    return narrate(el.landTopbarText, 'perfectFit')
      .then(function () {
        if (!live(id)) return;
        return narrate(el.landTopbarText, 'landed');
      })
      .then(function () {
        landing = false;
        var done = releaseLand;
        releaseLand = null;
        if (done) done();
      });
  }

  /* ---------------------------------------------------------- it does not
     `tight` true  → the island was too small, the craft overhangs it
     `tight` false → the island was too big, nothing holds the craft

     The two failures end in different places, because the geometry
     ends them in different places:

       TOO SMALL   the craft is wider than the land it came down on,
                   so the edge is right under it. It judders, slides
                   off, and the next thing under it is water.

       TOO BIG     the land runs a long way past the craft on every
                   side. Nothing is holding it, so it still goes
                   over — but there is no edge within reach to go
                   over, so it comes down on the rock and stays
                   there as a wreck. It never reaches the sea.

     Which way it falls follows from that: away from the middle of
     the row when it is going into the water (`plan.dir`, so it
     never drops across a neighbour), towards the middle of the
     island when it is going onto the land (`plan.into`, so the
     wreck ends up on the rock and not hanging off the shore).

     The verdict is SPOKEN over the struggle rather than after it:
     the line starts as the craft begins to lose its footing and is
     still going while it goes over. The chain waits for the line at
     the end, so a slow connection delays the retry prompt instead
     of talking over it — which is what `said` is holding.

     The MOTION is all js/failure.js; what is left here is the
     lesson: which island wears which verdict, what the HUD says,
     and what is spoken over the top of it. */
  function fail(pad, ref, tight, id) {
    pad.classList.add(tight ? 'is-tight' : 'is-loose');

    el.landCaption.textContent =
      pad.dataset.area + ' SQ UNITS — THE CRAFT NEEDS 20';
    el.landCaption.classList.add('is-shown');

    var said = null;

    return failFlight(el.ship, pad, ref, tight, null, id, function () {
      said = narrate(el.landTopbarText, tight ? 'tooSmall' : 'tooLarge');
    })
      .then(function () { return said; })
      .then(function () {
        if (!live(id)) return;
        /* put it back on the rail, callouts and all */
        pad.classList.remove('is-tight', 'is-loose');
        F.resetSpaceship(el.ship);
        el.shipDims.classList.add('is-drawn');
        return M.wait(760);
      })
      .then(function () {
        if (!live(id)) return;
        landing = false;
        if (!solved) armChoice();
        standingHint();
        return narrate(el.landTopbarText, 'chooseExact');
      });
  }

  /* ---------------------------------------------------------- the fall
     The half of a failed landing that is the same on all six
     screens: one call into js/failure.js, with the sounds and the
     water's own answer hung off its two callbacks.

     `tight` true  → the island was too small: it slides off the
                     edge, hits the water and sinks
     `tight` false → the island was too big: it goes over ON the
                     rock and stays there

     `onSettle` is fired the moment the craft begins to lose its
     footing, which is where the spoken verdict starts. `onImpact`
     is fired on the frame something is actually hit, and carries
     the point it was hit at — the craft goes over wherever it went
     over, never at a fixed spot. */
  function failFlight(ship, pad, ref, tight, geo, id, onSettle) {
    var opts = {
      refPad: ref,
      geo: geo || undefined,
      alive: function () { return live(id); },

      onTouchdown: function () { A.sfx('wrong', { volume: 0.45 }); },
      onSettle: onSettle,

      onImpact: function (point, kind) {
        if (kind === 'water') {
          /* The splash is what comes UP out of the water; SEA's
             front is what goes OUT across it, and it is the half
             that tells the player the islands are standing in one
             sea. Fired on the same point, so the two are one
             event. */
          SEA.impact(ship, point, { size: 54 });
          A.sfx('rock', { volume: 0.72, rate: 0.9 });
        } else {
          /* Smaller, and for a different reason: nothing went into
             the sea here, so what reaches the water is the shock
             through the rock rather than the craft itself. */
          SEA.impact(ship, point, { size: 32 });
          A.sfx('rock', { volume: 0.8, rate: 0.78 });
        }
      }
    };

    return tight ? F.sinkInWater(ship, pad, opts)
                 : F.crashOnLand(ship, pad, opts);
  }

  /* ============================================================
     SCREENS 4 TO 8 — A ROUND PER SHAPE

     One driver for all five. Screens 2 and 3 teach the two halves of
     the mission separately — the survey feed asks which zones are
     the same SHAPE as the craft, the landing asks which one is the
     same AREA — and from here on each screen asks both, about a new
     shape and a new area formula:

       identify the shape      the craft comes up WITHOUT its
                               callouts, and the line names its shape
       filter the zones        five islands, three of that shape and
                               two that are not; wrong shape shakes,
                               right shape takes a tick, and the two
                               that never matched sink back under
       calculate the area      the callouts are drawn on, and the
                               formula goes up in the HUD
       compare the areas       the three survivors have their areas
                               printed on them
       select the exact match  the craft flies down and the geometry
                               decides, exactly as on screen 3
       land                    planted, confetti, NEXT

     What differs between the five screens is entirely data — the
     artwork, the measurements, the numbers on the islands, the
     formula — and all of it lives in js/pages.js. Nothing below
     names a shape.

     Round state hangs off the round object rather than off this
     module, because resetRound() has to be able to put a screen the
     player has already left back to its opening state while another
     one is playing.
     ============================================================ */

  var R = null;                 /* the round on screen, while it plays */

  function roundPads(round) { return round.el.padList; }

  function roundMatches(round) {
    return roundPads(round).filter(function (pad) {
      return pad.dataset.shape === round.shape;
    });
  }

  /* the island the craft actually fits: the scale every attempt is
     drawn at, whichever one is being flown to */
  function roundRef(round) {
    return round.el.pads.querySelector('.pad[data-area="' + round.area + '"]');
  }

  function resetRound(round) {
    if (R === round) R = null;

    var e = round.el;

    round.phase = null;         /* 'shape', 'area', or nothing to do */
    round.picked = 0;
    round.scolding = false;
    round.landing = false;
    round.solved = false;

    /* takes every phase class off the craft and empties both effect
       layers, so a wreck and its scorch go with the reset */
    F.resetSpaceship(e.ship);
    e.ship.classList.remove('is-in');
    e.ship.style.removeProperty('--lean');
    e.shipDims.classList.remove('is-drawn');

    e.pads.classList.remove('is-picking', 'is-cleared', 'is-choosing', 'is-priced');
    roundPads(round).forEach(function (pad) {
      pad.classList.remove('is-up', 'is-picked', 'is-wrong', 'is-sunk',
                           'is-priced', 'is-fit', 'is-loose', 'is-tight',
                           'is-scattered');
      var hit = pad.querySelector('.pad__hit');
      if (hit) hit.tabIndex = -1;
    });

    M.confettiClear(e.confetti);

    e.advance.classList.remove('is-in');
    e.advance.hidden = true;

    e.hud.classList.remove('is-on');
    e.caption.classList.remove('is-shown');
    e.caption.textContent = '';
    e.tally.classList.remove('is-shown');
    e.tally.textContent = '';

    e.topbar.classList.remove('is-on');
    T.clear(e.topbarText);

    /* A fresh shuffle of the five stations every time the screen is
       entered, so the shape task cannot be won on position. Drawn
       here rather than in runRound() because a jump has to leave the
       screen in a state it could be shown from. */
    if (global.GeoPages) {
      /* the shape task's scatter, and the area task's row: the three
         that will survive are dealt to the three row stations now,
         so `regroup()` glides them home to a different arrangement
         every time */
      global.GeoPages.dealRow(round);
      global.GeoPages.scatter(round);
    }

    /* both player-driven steps park a promise only a click can
       settle, so every jump settles it by hand — the step after it
       then sees a stale generation and unwinds like any other */
    var done = round.release;
    round.release = null;
    if (done) done();
  }

  function runRound(round) {
    W.stop();
    R = round;

    var e = round.el;

    return sequence([
      function () {
        e.hud.classList.add('is-on');
        A.duckAmbience(0.16, 900);
        return M.wait(520);
      },

      function () {
        e.topbar.classList.add('is-on');
        return M.wait(680);
      },

      /* ── identify the shape ──
         The craft is NOT on screen for this half of the round. The
         line names its shape and the player has to carry that to
         the water themselves, which is a different question from
         "which of these looks like that" — and a harder one. */
      function () { return narrate(e.topbarText, 'lookShapes'); },

      /* ── the landing zones surface ── */
      function () { return offerRound(round); },
      function () { return M.wait(300); },

      /* the one line on these screens with no clip behind it: it
         names the shape, and it says something different on each of
         the five (see narrate()) */
      function () { return narrate(e.topbarText, round.shape, round.say); },

      /* ── filter: over to the player, until all three are found ── */
      function (id) { return startRoundPicking(round, id); },

      /* ── the two that never matched go back under ──
         Before the payoff line, not after it, which is the order the
         survey feed uses: the water closing over the wrong shapes IS
         the confirmation, and the line then has something to point
         at. */
      function () { return M.wait(420); },
      function () { return sinkRoundDecoys(round); },

      /* ── picked goes back to plain ──
         Before anything moves. The three islands answered the shape
         question and that question is closed, so they line up for
         the next one looking like three ordinary candidates rather
         than three answers already given. */
      function () {
        e.pads.classList.add('is-cleared');
        return M.wait(M.reduced() ? 120 : 520);
      },

      /* ── and the three that matched line up to be compared ──
         Fired, then given the length of the glide. The wait also
         matters mechanically: `left` and `top` are what move, so
         an island's box is mid-glide until it lands, and the
         landing's plan() must not measure anything until then. */
      function () {
        if (global.GeoPages) global.GeoPages.regroup(round);
        return M.wait(M.reduced() ? 200 : 1120);
      },

      /* ── and here it is ──
         The craft arrives on the answer, not before it: "these
         landing zones have the same shape as the spaceship" is a
         claim, and it is only worth anything if the player can hold
         it up against the craft, so the line plays over it settling.

         It comes AFTER the row has formed, and that ordering is not
         only for the reading of it — the craft flies in down the
         middle of the frame and rests there, which is water a
         scattered island can perfectly well be sitting in. Once the
         three have gone home to the row, the column the craft comes
         down is clear by construction.

         Still no callouts: the area is the next question. */
      function () {
        e.ship.classList.add('is-in');
        /* the flight in takes 1.55s (shipArrive, css/rounds.css);
           the line lands as it settles onto its station */
        return M.wait(M.reduced() ? 200 : 1250);
      },
      function () { return narrate(e.topbarText, 'shapeMatch'); },
      function () { return narrate(e.topbarText, 'onlyMatching'); },

      /* ── calculate the area the craft needs ──
         the callouts are drawn on as the line lands: they ARE "how
         much space it needs", the same beat screen 3 makes */
      function () {
        M.wait(680).then(function () {
          if (R === round) e.shipDims.classList.add('is-drawn');
        });
        return narrate(e.topbarText, 'spaceNeeded');
      },

      /* ── compare the areas on offer ── */
      function () { return priceRound(round); },
      function () { return narrate(e.topbarText, round.areaKey); },
      function () { return narrate(e.topbarText, 'chooseExact'); },

      /* ── select the exact match, for as many goes as it takes ── */
      function (id) { return startRoundChoosing(round, id); },

      /* ── planted; plantRound() has already said its piece ── */
      function (id) {
        e.tally.textContent = round.copy.sum;
        e.tally.classList.add('is-shown');
        return handFooterToAdvance(id, e.caption, e.tally, function () {
          showRoundAdvance(round);
        });
      }
    ]);
  }

  /* Five islands breaching, near and far alternating (the order is
     set in js/pages.js) so the archipelago arrives scattered rather
     than as two batches of one rank each. */
  function offerRound(round) {
    var list = round.el.reveal;
    var gap = M.reduced() ? 130 : 380;

    list.forEach(function (pad, i) {
      M.wait(i * gap).then(function () {
        pad.classList.add('is-up');
        /* a little pitch variation, so five splashes do not sound
           like the same sample five times */
        A.sfx('rock', { volume: 0.5, rate: [1, 0.92, 1.08, 0.96, 1.12][i % 5] });
        SEA.breach(pad);
      });
    });

    return M.wait((list.length - 1) * gap + (M.reduced() ? 400 : 1300));
  }


  /* ---------------------------------------------------------- the shape task */

  function startRoundPicking(round, id) {
    round.phase = 'shape';
    round.picked = 0;

    round.el.pads.classList.add('is-picking');
    roundPads(round).forEach(function (pad) {
      var hit = pad.querySelector('.pad__hit');
      if (hit) hit.tabIndex = 0;
    });

    return new Promise(function (resolve) {
      round.release = resolve;
      if (!live(id)) resetRound(round);      /* jumped while we armed */
    });
  }

  function endRoundPicking(round) {
    round.phase = null;
    round.scolding = false;

    round.el.pads.classList.remove('is-picking');
    roundPads(round).forEach(function (pad) {
      var hit = pad.querySelector('.pad__hit');
      if (hit) hit.tabIndex = -1;
    });

    var done = round.release;
    round.release = null;
    if (done) done();
  }

  function onRoundShapePick(round, pad) {
    if (pad.classList.contains('is-picked')) return;

    /* --- the wrong shape --- */
    if (pad.dataset.shape !== round.shape) {
      A.sfx('wrong', { volume: 0.5 });

      pad.classList.remove('is-wrong');
      /* force a reflow so a second wrong tap on the same island
         replays the shock instead of doing nothing */
      void pad.offsetWidth;
      pad.classList.add('is-wrong');
      SEA.reject(pad);
      M.wait(620).then(function () { pad.classList.remove('is-wrong'); });

      /* one nudge at a time — tapping both decoys must not stack two
         voice lines on top of each other */
      if (!round.scolding) {
        round.scolding = true;
        A.say('tryAgain').then(function () { round.scolding = false; });
      }
      return;
    }

    /* --- a match --- */
    pad.classList.add('is-picked');
    round.picked++;
    A.sfx('correct', { volume: 0.55 });
    SEA.approve(pad);

    if (round.picked >= roundMatches(round).length) {
      /* let the last tick land before the flow moves on */
      M.wait(760).then(function () {
        if (R === round) endRoundPicking(round);
      });
    }
  }

  /* The shapes that are not the craft's go back where they came
     from, nearest (largest) first so the surface closes front to
     back — the survey feed's own manners. */
  function sinkRoundDecoys(round) {
    var others = roundPads(round).filter(function (pad) {
      return pad.dataset.shape !== round.shape;
    });

    others.sort(function (a, b) {
      return b.getBoundingClientRect().width - a.getBoundingClientRect().width;
    });

    return M.sinkZones(others, function (pad, i) {
      A.sfx('rock', { volume: 0.6, rate: [0.88, 0.95][i % 2] });
      SEA.close(pad);
    }, { gap: 620 });
  }


  /* ---------------------------------------------------------- the area task

     The second question opens: the ticks fade off the three islands
     that matched (three green ticks over three different areas would
     read as three right answers) and their areas are printed on them
     instead. */
  function priceRound(round) {
    var matches = roundMatches(round);
    round.el.pads.classList.add('is-priced');

    matches.forEach(function (pad, i) {
      M.wait(i * 260).then(function () {
        if (R !== round) return;
        pad.classList.add('is-priced');
        A.sfx('click', { volume: 0.3, rate: [1.06, 1, 1.12][i % 3] });

        /* the label carried the shape while the shape was the
           question; now it carries the number too */
        var hit = pad.querySelector('.pad__hit');
        if (hit) {
          hit.setAttribute('aria-label',
            pad.dataset.name + ' landing zone of ' +
            pad.dataset.area + ' square units');
        }
      });
    });

    return M.wait((matches.length - 1) * 260 + 950);
  }

  function startRoundChoosing(round, id) {
    round.phase = 'area';
    armRound(round);
    standingRoundHint(round);

    return new Promise(function (resolve) {
      round.release = resolve;
      if (!live(id)) resetRound(round);
    });
  }

  function armRound(round) {
    round.el.pads.classList.add('is-choosing');
    /* only the three that survived the filter: the other two are
       under the water */
    roundMatches(round).forEach(function (pad) {
      var hit = pad.querySelector('.pad__hit');
      if (hit) hit.tabIndex = 0;
    });
  }

  function disarmRound(round) {
    round.el.pads.classList.remove('is-choosing');
    roundPads(round).forEach(function (pad) {
      var hit = pad.querySelector('.pad__hit');
      if (hit) hit.tabIndex = -1;
    });
  }

  /* As on screen 3, the HUD lines are deliberately NOT a repeat of
     the spoken line above: they carry the arithmetic the player is
     being asked to do, and stay put while the narration comes and
     goes. */
  function standingRoundHint(round) {
    var e = round.el;
    e.caption.textContent = round.copy.formula;
    e.caption.classList.add('is-shown');
    e.tally.textContent = round.copy.tally;
    e.tally.classList.add('is-shown');
  }

  function onRoundAreaPick(round, pad) {
    if (round.landing || pad.dataset.area == null) return;
    if (F.isAnimating(round.el.ship)) return;

    var ref = roundRef(round);
    if (!ref) return;

    var area = +pad.dataset.area;
    var e = round.el;

    /* An attempt runs on its own chain, outside the screen's
       sequence, so it carries the generation itself — otherwise a
       jump mid-crash would come back and re-arm a screen the player
       has already left. */
    var id = runId;

    round.landing = true;
    disarmRound(round);
    A.sfx('click', { volume: 0.4 });

    /* the callouts come off: the craft is flying now, and a
       measurement drawing riding through a crash would read as part
       of the wreck */
    e.ship.classList.add('is-committed');

    return area === round.area
      ? plantRound(round, pad, ref, id)
      : failRound(round, pad, ref, area < round.area, id);
  }

  /* ---------------------------------------------------------- it fits */
  function plantRound(round, pad, ref, id) {
    var e = round.el;

    round.solved = true;

    return F.successfulLanding(e.ship, pad, {
      refPad: ref,
      geo: round.geo,
      alive: function () { return live(id); },

      /* everything is hung off the touchdown, so the verdict
         outline, the chime and the confetti land on the frame the
         craft settles rather than a beat after it */
      onTouchdown: function () {
        pad.classList.add('is-fit');
        SEA.settle(pad);

        e.caption.textContent = 'PERFECT FIT · ' + round.area + ' SQ UNITS';
        e.caption.classList.add('is-shown');
        e.tally.textContent = round.copy.sum;

        A.sfx('correct', { volume: 0.6 });

        /* a beat after the chime, so the two sounds read as one
           cue. The shower is fired and not awaited: it runs on the
           compositor while the narration carries on underneath. */
        M.wait(220).then(function () {
          if (!live(id)) return;
          A.sfx('cheer', { volume: 0.5 });
          M.confetti(e.confetti);
        });
      }
    }).then(function () {
      if (!live(id)) return;
      return sayRoundPlanted(round, id);
    });
  }

  function sayRoundPlanted(round, id) {
    var e = round.el;

    return narrate(e.topbarText, 'perfectFit')
      .then(function () {
        if (!live(id)) return;
        return narrate(e.topbarText, 'landed');
      })
      .then(function () {
        round.landing = false;
        var done = round.release;
        round.release = null;
        if (done) done();
      });
  }

  /* ---------------------------------------------------------- it does not
     Same two failures as screen 3, and for the same reasons — the
     craft is drawn at its TRUE size on every attempt, so both are
     the honest consequence of the numbers:

       too small  the craft is wider than the land it came down on,
                  so the edge is right under it: it judders, slides
                  off, and the next thing under it is water
       too big    the land runs a long way past the craft on every
                  side, nothing is holding it, and there is no edge
                  within reach to go over — so it wrecks ON the rock
                  and never reaches the sea                         */
  function failRound(round, pad, ref, tight, id) {
    var e = round.el;

    pad.classList.add(tight ? 'is-tight' : 'is-loose');

    e.caption.textContent =
      pad.dataset.area + ' SQ UNITS — THE CRAFT NEEDS ' + round.area;
    e.caption.classList.add('is-shown');

    /* the verdict is SPOKEN OVER the struggle rather than after it,
       and awaited at the end, so a slow connection delays the retry
       prompt instead of talking over it */
    var said = null;

    return failFlight(e.ship, pad, ref, tight, round.geo, id, function () {
      said = narrate(e.topbarText, tight ? 'tooSmall' : 'tooLarge');
    })
      .then(function () { return said; })
      .then(function () {
        if (!live(id)) return;
        /* put it back on the rail, callouts and all */
        pad.classList.remove('is-tight', 'is-loose');
        F.resetSpaceship(e.ship);
        e.shipDims.classList.add('is-drawn');
        return M.wait(760);
      })
      .then(function () {
        if (!live(id)) return;
        round.landing = false;
        if (!round.solved) armRound(round);
        standingRoundHint(round);
        return narrate(e.topbarText, 'chooseExact');
      });
  }

  /* The reward for the right answer, and the way on. Withheld when
     canAdvance() says there is nowhere for it to go. */
  function showRoundAdvance(round) {
    var btn = round.el.advance;
    if (!btn || !canAdvance()) return;

    btn.hidden = false;
    /* reflow, so there is an un-hidden starting frame to animate away
       from instead of snapping straight to the end */
    void btn.offsetWidth;
    btn.classList.add('is-in');
  }


  /* ============================================================
     SCREENS + NAV
     ============================================================ */
  var SCREENS = [
    { node: function () { return el.screenCockpit; }, reset: resetCockpit,   run: runCockpit },
    { node: function () { return el.screenDrone; },   reset: resetDroneFeed, run: runDroneFeed },
    { node: function () { return el.screenLanding; }, reset: resetLanding,   run: runLanding }
  ];

  /* Screens 4 to 8 are built from js/pages.js at boot and appended
     here, so the nav, the veil, the NEXT button and goTo() pick them
     up with no special case: as far as everything below is
     concerned they are three more entries in this list.

     Built rather than written out in index.html because the five are
     one screen five times over — the same markup with a different
     shape's artwork and measurements in it. Five copies in the
     document would be five copies to keep in step, and none of them
     could own an id. */
  function addRoundScreens() {
    /* Loudly, because the mission still runs without it: screens 1-3
       play as normal and then simply stop, which looks like a broken
       NEXT button rather than a missing file. */
    if (!global.GeoPages) {
      if (global.console) {
        console.warn('GeoDrone: js/pages.js did not load — screens 4 to 8 ' +
                     'are missing and the mission ends on the landing.');
      }
      return;
    }

    global.GeoPages.build(el.stage, el.veil).forEach(function (round) {
      resetRound(round);                   /* opening state from the off */

      SCREENS.push({
        node:  function () { return round.node; },
        reset: function () { resetRound(round); },
        run:   function () { return runRound(round); }
      });

      /* one listener on the container rather than five on the
         islands, and the phase decides which question the tap is an
         answer to */
      round.el.pads.addEventListener('click', function (e) {
        var hit = e.target.closest('.pad__hit');
        if (!hit || R !== round) return;

        var pad = hit.closest('.pad');
        if (!pad) return;

        if (round.phase === 'shape') onRoundShapePick(round, pad);
        else if (round.phase === 'area') onRoundAreaPick(round, pad);
      });

      round.el.advance.addEventListener('click', onAdvance);
    });
  }

  function syncNav() {
    el.navPrev.disabled = busy || current === 0;
    el.navNext.disabled = busy || current === SCREENS.length - 1;
  }

  /* Is there a screen after this one? Asked by every NEXT button
     before it shows itself, and it is the SAME question the ">"
     arrow answers by going disabled — a screen must never offer a
     button the nav has already given up on.

     This matters most when js/pages.js has not arrived: screens 4-8
     are built from it at boot, so without it the landing IS the
     last screen, and a NEXT there would appear and then refuse to
     go anywhere. That is a stale cache or a bad deploy rather than
     a state the flow can fix, so the button simply stays away. */
  function canAdvance() {
    return current < SCREENS.length - 1;
  }

  /* Every NEXT button, on every screen, goes through here. */
  function onAdvance() {
    A.sfx('click', { volume: 0.4 });
    return goTo(current + 1);
  }

  /* Jump to a screen: abandon whatever was running, put the target
     back to its opening state, swap, then play its sequence.
     `silent` skips the audio cut, for the scripted launch hand-off
     that is already mid-cue and should not be clipped. */
  function goTo(index, opts) {
    opts = opts || {};
    if (busy || index === current || index < 0 || index >= SCREENS.length) {
      return Promise.resolve();
    }

    var from = SCREENS[current];
    var to = SCREENS[index];

    busy = true;
    syncNav();

    runId++;                               // strand the running sequence
    if (!opts.silent) A.stopAll();

    to.reset();

    return M.swapScreens(from.node(), to.node(), el.veil, 1300).then(function () {
      current = index;
      busy = false;
      syncNav();

      /* the screen left behind goes back to its opening state too, so
         stepping back into it starts from the top rather than from
         wherever it was abandoned */
      from.reset();

      return to.run();
    });
  }

  /* ============================================================
     START GATE

     The mission opens on a black cockpit and a voice line, so it
     cannot start until the artwork and the narration are actually
     in the browser — a half-loaded start means the commander talks
     over an empty screen. The gate therefore holds the mission
     until every asset has settled, and shows how far along it is
     rather than a spinner that says nothing.
     ============================================================ */

  /* Read off the document rather than kept in a second list here:
     the <link rel=preload> tags already name the backgrounds and
     the zone/ship artwork is in the markup as <img>, so this cannot
     drift out of step with the page. */
  function imageUrls() {
    var seen = {};
    var out = [];

    function add(u) {
      if (!u || seen[u]) return;
      seen[u] = true;
      out.push(u);
    }

    Array.prototype.forEach.call(
      document.querySelectorAll('link[rel="preload"][as="image"]'),
      function (l) { add(l.href); }
    );
    Array.prototype.forEach.call(
      document.images,
      function (i) { add(i.currentSrc || i.src); }
    );

    return out;
  }

  /* A texture that 404s still counts: the bar must reach the end
     even on a broken deploy, and a missing rock is survivable. */
  function loadImages(list, onEach) {
    return Promise.all(list.map(function (src) {
      return new Promise(function (resolve) {
        var img = new Image();
        var fired = false;

        function fire() {
          if (fired) return;
          fired = true;
          onEach();
          resolve();
        }

        img.onload = fire;
        img.onerror = fire;
        img.src = src;
        if (img.complete) fire();
      });
    }));
  }

  /* what the readout says, by how far along the load is */
  var STATUS = [
    [0.00, 'Booting mission systems'],
    [0.20, 'Charting the survey area'],
    [0.48, 'Loading terrain scans'],
    [0.76, 'Syncing commander briefing'],
    [1.00, 'All systems ready']
  ];

  function statusFor(p) {
    var label = STATUS[0][1];
    for (var i = 0; i < STATUS.length; i++) {
      if (p >= STATUS[i][0]) label = STATUS[i][1];
    }
    return label;
  }

  /* Two things are being waited on and they are not the same size,
     so progress is counted in assets rather than in halves. */
  var GATE_MIN_MS = 1150;       // a warm cache must still read as a load

  function runGate() {
    var imgs  = imageUrls();
    var total = imgs.length + A.assetCount();
    var done  = 0;
    var shown = 0;              // where the bar actually is
    var raf   = 0;
    var t0    = performance.now();
    var slow  = !M.reduced();

    function draw(p) {
      var pct = Math.round(p * 100);
      el.gateFill.style.transform = 'scaleX(' + p.toFixed(4) + ')';
      el.gatePct.textContent = pct + '%';

      var label = statusFor(p);
      if (el.gateStatus.textContent !== label) el.gateStatus.textContent = label;
    }

    /* Eased rather than stepped: on a warm cache thirty files settle
       in the same frame, and a bar that teleports to 100% reads as a
       glitch. The easing also keeps the readout moving while a slow
       file is still in flight. */
    function tick() {
      var target = done / total;
      shown += (target - shown) * 0.10;
      if (target - shown < 0.0015) shown = target;
      draw(shown);
      raf = requestAnimationFrame(tick);
    }

    function count() { done++; if (!slow) draw(done / total); }

    if (slow) raf = requestAnimationFrame(tick);
    draw(0);

    return Promise.all([
      loadImages(imgs, count),
      A.preload(count)
    ]).then(function () {
      /* let the easing run the last stretch out before handing over */
      var rest = slow ? Math.max(0, GATE_MIN_MS - (performance.now() - t0)) + 520
                      : Math.max(0, 300 - (performance.now() - t0));
      return M.wait(rest);
    }).then(function () {
      if (raf) cancelAnimationFrame(raf);
      draw(1);
      return M.wait(slow ? 260 : 0);
    }).then(revealStart);
  }

  function revealStart() {
    el.gateLoad.classList.add('is-done');

    return M.wait(M.reduced() ? 0 : 360).then(function () {
      el.gateLoad.hidden = true;

      el.gateBtn.hidden = false;
      /* reflow, so the browser has an un-hidden starting frame to
         transition away from instead of snapping straight to the end */
      void el.gateBtn.offsetWidth;

      el.gateBtn.classList.add('is-in');

      try { el.gateBtn.focus({ preventScroll: true }); } catch (e) { /* older browsers */ }
    });
  }


  /* ============================================================
     BOOT
     ============================================================ */
  function begin() {
    el.gate.classList.add('is-gone');
    el.nav.classList.add('is-on');

    A.unlock();
    A.startAmbience(0.24);

    resetCockpit();
    syncNav();
    runCockpit();
  }

  function boot() {
    grab();

    /* first, so every timer armed below is already pausable */
    if (global.GeoLife) global.GeoLife.init();

    if (M.reduced()) document.body.classList.add('is-reduced');

    M.starfield(el.starfield, 150);
    W.init(el.waveCanvas);

    /* before runGate(), so the islands and craft on screens 4-8 are
       already in document.images when the loading bar works out how
       many assets there are to wait for */
    addRoundScreens();

    /* and after it, because every island on those screens needs a
       shoreline built from its own silhouette */
    SEA.init(el.stage);

    runGate();

    el.gateBtn.addEventListener('click', begin, { once: true });
    el.launchBtn.addEventListener('click', onLaunch);

    /* one listener on the container rather than five on the shapes,
       so the zones stay plain markup */
    el.zones.addEventListener('click', function (e) {
      var hit = e.target.closest('.zone__hit');
      if (!hit) return;
      var zone = hit.closest('.zone');
      if (zone) onZonePick(zone);
    });

    el.pads.addEventListener('click', function (e) {
      var hit = e.target.closest('.pad__hit');
      if (!hit) return;
      var pad = hit.closest('.pad');
      if (pad) onPadPick(pad);
    });

    el.navPrev.addEventListener('click', function () { goTo(current - 1); });
    el.navNext.addEventListener('click', function () { goTo(current + 1); });

    /* The reward button takes the same road as the ">" arrow, which
       is what makes it carry straight on into screen 4. Screens 4-8
       wire the same handler, in addRoundScreens(). */
    el.advanceBtn.addEventListener('click', onAdvance);
    syncNav();

    document.body.classList.add('is-ready');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
