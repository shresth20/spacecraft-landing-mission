/* ============================================================
   Geo Drone — mission flow

   Screen 1 · cockpit
     briefing (3 lines, readout waveform live)
     → LAUNCH button rises out of the console
     → prompt to press it
     → press: launch SFX, drone climbs out through the canopy
     → cross-fade to the drone feed

   Screen 2 · the survey — one continuous shot over one sea
     black (ocean hidden) + "it is too dark"
     → "start the scanner"
     → green line sweeps left/right/left/right
     → the scan clears the dark to the drone's SURVEY HEIGHT: open
        water corner to corner, three frames of it, with nothing in it
     → the archipelago breaks the surface: twenty-odd small islands
        of every shape in the mission, and among them the two sites
        the lens will come down on
     → the lens brackets site A and descends — see THE CAMERA in
        js/animation.js
     → "the scanner found several landing zones"
     → "look at the shapes of the landing zones"
     → "the spaceship is a triangle — select all the triangular
        landing zones"
     → site A's five islands become selectable; three triangles to
       find, two other shapes to leave
       · right shape → green coast, zone locks in
       · wrong shape → red coast, buzzer, "try again"
     → all three found: the lens climbs back to survey height while
       the two wrong shapes sink and "correct! these landing zones
       have the same shape as the spaceship" plays, crosses the
       water with the whole archipelago under it, brackets site B
       and comes down onto it
     → the craft flies in over site B's row of three triangles (30,
       12 and 20 square units) -- nothing else is on the water there
     → "next, we need to find how much space the spaceship needs",
        and its base and height are called out
     → the three triangles get their areas printed on them
     → "calculate the area of spaceship, and select the land with
        required area" · "choose the landing zone with the exact area"
     → the player picks; the craft flies down and the geometry
       decides what happens (see THE LANDING below)
     → it fits: confetti falls over the whole frame, "landing
       successful", and a NEXT button arrives under the footer lines
       to carry the mission on to the first round

   (There is no screen 3 any more. The landing used to have a
   screen of its own; it is site B of the survey now, so the two
   halves of the lesson are asked over one sea by one camera.)

   Screens 4 to 8 · a round per shape
     the same shot, for a new shape and a new area formula each
     time, opening straight onto the water at survey height: the
     archipelago breaks the surface, the lens comes down on site A
     for "select all the square landing zones", climbs and crosses
     and comes down on site B, where the square-hulled craft lands
     on the island whose area it needs. See runRound().

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
      'droneHud', 'cam',
      'altHud', 'altNum', 'altState',
      'topbar', 'topbarText',
      'ship', 'shipCraft', 'shipDims',
      'confetti', 'advanceBtn',
      'landHud', 'landCaption', 'landTally',
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
     THE SURVEY AND THE ROUNDS — screens 2 and 4 to 8

     One driver for all six. Every playing screen is one continuous
     shot over one sea, and the lens comes down on it twice:

       survey height       the whole archipelago breaks the surface
                           under the lens -- sixteen islets of every
                           shape, and among them the two sites
       down on SITE A      three islands of the round's shape, three
                           sizes, and two other shapes. The line
                           names the shape; wrong shape shakes, right
                           shape takes a green coast
       up, across, down    the two that never matched sink and the
                           payoff line plays from the air; the lens
                           crosses the water at height and comes
                           down on SITE B
       down on SITE B      three islands of the round's shape in the
                           row, carrying the round's three areas, and
                           nothing else. The craft arrives, its
                           callouts are drawn on, the areas print
       select the match    the craft flies down and the geometry
                           decides, exactly as it always has
       land                planted, confetti, NEXT

     The survey (screen 2) is this with the drone's dark-and-scan
     opening in front of it (`round.intro`) and a recorded clip for
     the line that names its shape; a round opens straight onto the
     water. What differs between the six otherwise is entirely data
     -- the artwork, the measurements, the numbers on the islands,
     the formula -- and all of it lives in js/pages.js. Nothing below
     names a shape.

     ── the two sites ──

     Both sites are shaped like a round (js/pages.js) and share the
     screen's chrome, and the task helpers further down play a SITE:
     `R` is the site whose question is live. State hangs off the
     round and its sites rather than off this module, because
     resetRound() has to be able to put a screen the player has
     already left back to its opening state while another plays.

     ── coordinates ──

     Everything in the camera plate is in WORLD coordinates -- per
     cent of one frame. Site A's frame is (0..100, 0..100), site B's
     a frame to the right and 45% down. SITES holds their centres,
     and it MUST agree with .site--b in css/style.css: a site's
     centre is its offset plus (50, 50). WORLD is the point between
     them the lens holds at survey height.

     ── the lens ──

     Three states, and the flights between them (THE CAMERA in
     js/animation.js): wide over WORLD, down on A, down on B. The
     first descent is one leg; the crossing is one animation with a
     climb, a slow drift at altitude and a descent in it, so the lens
     never stops between the two sites. The altimeter follows the
     lens itself (altFollow), whatever it is doing.
     ============================================================ */

  var SITES = { a: { x: 50, y: 50 }, b: { x: 150, y: 95 } };
  var WORLD = { x: 100, y: 72.5 };

  /* how long each move takes. Long -- the move is the beat, not an
     animation played under one. The crossing is climb, drift and
     descent in one: see the offsets in the flight itself. */
  var DESCENT_MS = 3400;
  var TRANSIT_MS = 6400;

  var R = null;               /* the SITE whose question is live */

  /* whether the lens FLIES between its states or cuts: false under
     reduced motion, where every move is a cut and the altimeter and
     the bracket stay away */
  var airborne = false;

  /* screen 2's round, from GeoPages.buildSurvey() at boot */
  var survey = null;

  /* the lens down on a site: scale 1, the site's centre under the
     middle of the frame -- which is that site laid out exactly as a
     screen of its own would lay it out */
  function siteState(key) {
    return { s: 1, x: SITES[key].x, y: SITES[key].y };
  }

  /* and at survey height, over the middle of the sea */
  function wideState(round, dx, dy) {
    return {
      s: M.camWide(round.node),
      x: WORLD.x + (dx || 0),
      y: WORLD.y + (dy || 0)
    };
  }

  function resetRound(round) {
    var e = round.el;
    var a = round.sites.a;
    var b = round.sites.b;
    var P = global.GeoPages;

    /* the lens first: back to the ground state before anything is
       measured, so the layout below is read off the layout itself */
    M.camReset(round.node);
    altReset(round);

    /* the survey's opening: the dark, the bezel and the scanner */
    if (round.intro) {
      e.bg.classList.remove('is-lit');
      e.bezel.classList.remove('is-retired');
      e.blackout.classList.remove('is-clear');
      e.scanner.classList.remove('is-on');
      var bar = e.scanner.querySelector('.scanner__bar');
      if (bar && bar.getAnimations) {
        bar.getAnimations().forEach(function (an) { an.cancel(); });
      }
    }

    /* both sites back to their opening state, then a fresh draw on
       each: site A with a fresh pair of decoys, strewn across the
       five stations; site B's three dealt across the row, so the fit
       is never twice in the same place */
    clearRound(a);
    clearRound(b);

    P.arrangeSite(a, P.drawPair(round.decoyPool), ['pad--far1', 'pad--far2']);
    P.arrangeSite(b, [], []);
    P.dealRow(a);
    P.scatter(a);
    P.dealRow(b);

    /* the rest of the archipelago, strewn again */
    round.islets.forEach(function (isl) { isl.classList.remove('is-up'); });
    P.strewIslets(e.cam, round.islets);

    /* And the lens: PARKED at survey height over the middle of the
       sea, before the screen is shown. Reset runs under the veil (see
       goTo), so the screen fades up already high rather than snapping
       up to height on its first frame.

       Parked, not set loitering -- the drift starts in runRound(),
       once the screen is on. A reset runs on hidden screens (every
       screen at boot, and the one the player has just left), and an
       animation that FINISHES on a hidden screen and is then
       cancelled leaves its last frame behind in Chromium: the
       element reports no animations and an inline transform, and
       renders the finished keyframe anyway, immovably, until the
       page is reloaded. A loiter that only ever runs on a screen the
       player is looking at is cancelled long before it can finish. */
    airborne = !M.reduced();
    M.camSet(round.node, wideState(round));
  }

  function runRound(round) {
    W.stop();

    var e = round.el;
    var a = round.sites.a;
    var b = round.sites.b;

    /* site A's question is the live one until the craft arrives */
    R = a;

    /* The lens starts its loiter now that the screen is on -- see the
       note at the end of resetRound(). Long enough that nothing on
       any screen can outwait it: the first descent comes within
       twenty seconds of it starting, and it is that descent that
       interrupts it, so it never gets to finish and never leaves a
       filled frame behind. The amplitude is scaled to match, so the
       drift the player sees is the same slow one it always was. */
    if (airborne) M.camLoiter(round.node, wideState(round), { dx: 5.8, dy: 3.2, ms: 45000 });

    var steps = [];

    if (round.intro) {
      /* ── the survey's opening: the dark, and the scan ── */
      steps.push(
        /* the bar drops in empty and then carries every line on this
           screen -- it has to be up before the first voice clip */
        function () {
          e.topbar.classList.add('is-on');
          A.duckAmbience(0.18, 900);
          return M.wait(720);
        },
        function () { return narrate(e.topbarText, 'tooDark'); },
        function () { return M.wait(220); },
        function () { return narrate(e.topbarText, 'startScan'); },
        function () { return M.sweep(e.scanner, { legs: 2, legMs: 1150 }); },

        /* --- lights up: ocean 0 → 1, and the camera bezel steps aside ---
           And it lights up HIGH. What the scan clears the dark to is
           the drone's survey height -- three frames of open water
           with nothing in it -- which is why the lens is parked
           before this step rather than after it: the first thing the
           player sees of the sea has to already be the wide shot.

           The bar goes with the bezel. The last thing it said was
           "start the scanner", which has now been done, and an
           instruction left standing over a camera move reads as a
           game waiting for the player. It comes back for the payoff. */
        function () {
          e.bg.classList.add('is-lit');
          e.blackout.classList.add('is-clear');
          e.bezel.classList.add('is-retired');
          altTo(round, 'SURVEY');
          e.topbar.classList.remove('is-on');
          return M.wait(1500);
        },

        /* a beat of nothing but sea, held long enough to read as
           empty: an island that is already there when the lights
           come up has always been there, and one that breaks a
           surface the player has had time to see is EMPTY has just
           arrived */
        function () {
          T.clear(e.topbarText);
          return M.wait(airborne ? 900 : 300);
        }
      );
    } else {
      /* ── a round opens on the water, at height ── */
      steps.push(function () {
        A.duckAmbience(0.16, 900);
        altTo(round, 'SURVEY');
        return M.wait(airborne ? 900 : 300);
      });
    }

    steps.push(
      /* --- the archipelago breaks the surface --- */
      function () {
        altTo(round, 'CONTACT');
        return emerge(round);
      },
      function () { return M.wait(420); },

      /* --- and the lens comes down on site A ---
         Nothing is said over it: the first line is the first thing
         spoken from the new altitude. The bracket is released a
         little under halfway down, well before the islands are big
         enough for it to be a box drawn round the answer. */
      function (id) {
        altTo(round, 'DESCEND');
        A.duckAmbience(0.26, 1400);
        M.wait(DESCENT_MS * 0.42).then(function () {
          if (live(id)) M.camUnfix(round.node, 620);
        });
        return fly(round, [siteState('a')], DESCENT_MS);
      },

      /* --- the lens settles, the instrument bows out, and the bar
             comes up --- */
      function () {
        altTo(round, 'HOLD');
        e.topbar.classList.add('is-on');
        return Promise.all([altOut(round), M.wait(780)]);
      }
    );

    if (round.intro) {
      steps.push(
        function () { return narrate(e.topbarText, 'foundZones'); },
        function () { return M.wait(300); }
      );
    }

    steps.push(
      /* ═══════════════ the shape question, on site A ═══════════════
         The craft is NOT on screen for this half. The line names its
         shape and the player has to carry that to the water
         themselves, which is a different question from "which of
         these looks like that" -- and a harder one. */
      function () { return narrate(e.topbarText, 'lookShapes'); },

      /* a beat to look at the water before the line names the shape */
      function () { return M.wait(560); },

      /* the survey's line has a clip; a round's names a shape no clip
         was recorded for, and is typed at reading rate (see narrate) */
      function () { return narrate(e.topbarText, round.sayKey || round.shape, round.say); },

      /* --- over to the player, until all three are found --- */
      function (id) { return startRoundPicking(a, id); },

      /* --- up, across, and down onto site B ---

         The two shapes that never matched go back under and the
         payoff line plays, and the lens does not wait for either: it
         is already climbing as the water closes over them, and the
         line is spoken from the air. The crossing is one flight --
         climb, a slow drift at survey height with the whole
         archipelago under it, descent -- so the lens never comes to
         rest between the two sites. Site B is bracketed at the top
         and the bracket is released on the way down.

         `is-cleared` takes the green off site A's three as the lens
         leaves them: they answered the shape question and that
         question is closed.

         Under reduced motion there is no flight to speak over, so
         the three beats run in order and the lens cuts. */
      function () { return M.wait(420); },
      function (id) {
        if (!airborne) {
          return sinkRoundDecoys(a).then(function () {
            if (!live(id)) return;
            a.el.pads.classList.add('is-cleared');
            return narrate(e.topbarText, 'shapeMatch');
          }).then(function () {
            if (!live(id)) return;
            return fly(round, [siteState('b')], 0);
          });
        }

        var said = null;
        sinkRoundDecoys(a);
        M.wait(520).then(function () {
          if (live(id)) a.el.pads.classList.add('is-cleared');
        });
        M.wait(700).then(function () {
          if (live(id)) said = narrate(e.topbarText, 'shapeMatch');
        });

        altTo(round, 'CLIMB');
        A.duckAmbience(0.22, 1400);

        var top = wideState(round);
        M.wait(TRANSIT_MS * 0.40).then(function () {
          if (!live(id)) return;
          altTo(round, 'TRANSIT');
          M.camFix(round.node, siteBox(round, b, top), 560);
        });
        M.wait(TRANSIT_MS * 0.58).then(function () { if (live(id)) altTo(round, 'DESCEND'); });
        M.wait(TRANSIT_MS * 0.80).then(function () {
          if (live(id)) M.camUnfix(round.node, 560);
        });

        return fly(round, [
          { s: top.s, x: top.x - 6, y: top.y - 3, offset: 0.40, easing: 'linear' },
          { s: top.s, x: top.x + 6, y: top.y + 3, offset: 0.56,
            easing: 'cubic-bezier(.5, 0, .18, 1)' },
          siteState('b')
        ], TRANSIT_MS, { easing: 'cubic-bezier(.44, .02, .28, 1)' }).then(function () {
          return said;
        });
      },

      /* --- down on site B --- */
      function () {
        altTo(round, 'HOLD');
        return altOut(round);
      },

      /* ═══════════════ the area question, on site B ═══════════════ */

      /* --- the craft arrives ---
         It comes down the middle of the frame, which is water by
         construction: the row is across the front and there is
         nothing else on this site. Site B's question is the live one
         from here. */
      function () {
        R = b;
        b.el.ship.classList.add('is-in');
        e.hud.classList.add('is-on');
        /* the flight in takes 1.55s (shipArrive, css/rounds.css);
           the line lands as it settles onto its station */
        return M.wait(M.reduced() ? 200 : 1250);
      }
    );

    if (!round.intro) {
      /* a round has already been told once that these match; what
         is new is that the three of them are all that is left */
      steps.push(function () { return narrate(e.topbarText, 'onlyMatching'); });
    }

    steps.push(
      /* --- how much space it needs ---
         the callouts are drawn on as the line lands: they ARE "how
         much space it needs" */
      function () {
        M.wait(680).then(function () {
          if (R === b) b.el.shipDims.classList.add('is-drawn');
        });
        return narrate(e.topbarText, 'spaceNeeded');
      },

      /* --- the three candidates get their areas printed on --- */
      function () { return priceRound(b); },

      function () { return narrate(e.topbarText, round.areaKey); },
      function () { return narrate(e.topbarText, 'chooseExact'); },

      /* --- over to the player, for as many attempts as it takes --- */
      function (id) { return startRoundChoosing(b, id); },

      /* --- planted; plantRound() has already said its piece --- */
      function (id) {
        e.tally.textContent = round.copy.sum;
        e.tally.classList.add('is-shown');
        return handFooterToAdvance(id, e.caption, e.tally, function () {
          showRoundAdvance(b);
        });
      }
    );

    return sequence(steps);
  }

  /* One flight of the lens, with the altimeter following it. Under
     reduced motion the lens CUTS to where the flight would have
     ended, and nothing follows anything. */
  function fly(round, keys, ms, opts) {
    if (!airborne) {
      M.camSet(round.node, keys[keys.length - 1]);
      return M.wait(M.reduced() ? 200 : 0);
    }

    opts = opts || {};
    opts.ms = ms;

    altFollow(round, true);
    return M.camFly(round.node, keys, opts).then(function () {
      altFollow(round, false);
      altSample(round, true);
    });
  }

  /* The archipelago breaks the surface: the islets and both sites'
     islands, back to front across the whole sea as the lens sees
     it, with a little jitter so the two ranks of a site do not
     arrive as two rows. The bracket goes up on site A a little past
     halfway, so the eye has been shown where to look before the lens
     moves.

     Seen from survey height the splashes are quiet and pitched up --
     distance does both -- and only the sites' islands throw a front
     into the water: the islets are scenery, and twenty-odd fronts at
     once would be a storm. */
  function emerge(round) {
    var a = round.sites.a;
    var b = round.sites.b;
    var pads = a.el.padList.concat(b.el.padList);
    var all = round.islets.concat(pads);

    var rows = all.map(function (isl) {
      return { el: isl, y: isl.getBoundingClientRect().top + (Math.random() - 0.5) * 40 };
    }).sort(function (p, q) { return p.y - q.y; }).map(function (o) { return o.el; });

    var gap = M.reduced() ? 60 : 105;

    if (airborne) {
      M.wait(gap * Math.round(rows.length * 0.55)).then(function () {
        if (R === a) {
          M.camFix(round.node, siteBox(round, a, M.camRead(round.node)), 620);
        }
      });
    }

    return M.surfaceZones(rows, function (isl, i) {
      if (pads.indexOf(isl) >= 0) {
        SEA.breach(isl);
        A.sfx('rock', { volume: 0.22, rate: 1.1 + (i % 5) * 0.04 });
      } else if (i % 3 === 0) {
        A.sfx('rock', { volume: 0.13, rate: 1.18 + (i % 4) * 0.05 });
      }
    }, { gap: gap, settle: 900 });
  }

  /* Where a site is being SHOWN, for the bracket: the box round its
     islands in world coordinates -- each island's centre of area,
     read off the station it was dealt or strewn to, plus its own
     half-box -- projected through the lens state `st` to the frame
     the bracket is drawn on. Padded a touch, and asymmetrically:
     per cent of the frame is a different length on each axis. */
  function siteBox(round, site, st) {
    var W = round.node.clientWidth || 1;
    var H = round.node.clientHeight || 1;
    var l = 1e9, r = -1e9, t = 1e9, b = -1e9;

    site.el.padList.forEach(function (pad) {
      var cs = global.getComputedStyle(pad);
      var x = parseFloat(cs.getPropertyValue('--cx'));
      var y = parseFloat(cs.getPropertyValue('--cy'));
      if (!isFinite(x) || !isFinite(y)) return;

      var hw = pad.offsetWidth / 2 / W * 100;
      var hh = pad.offsetWidth / 2 / H * 100;

      l = Math.min(l, site.offset.x + x - hw);
      r = Math.max(r, site.offset.x + x + hw);
      t = Math.min(t, site.offset.y + y - hh);
      b = Math.max(b, site.offset.y + y + hh);
    });

    if (l > r) return null;

    var p1 = M.camProject(round.node, st, l, t);
    var p2 = M.camProject(round.node, st, r, b);
    var padX = 2.4;
    var padY = padX * (W / H);

    return { l: p1.x - padX, r: p2.x + padX, t: p1.y - padY, b: p2.y + padY };
  }


  /* ---------------------------------------------------------- the altimeter

     Four digits and a marker on a scale, and they are the one thing
     on the feed that names what is happening: five shapes getting
     bigger on their own is a different event from a lens coming
     down onto five shapes, and a falling number is what tells the
     player which of the two they are watching.

     It follows the LENS rather than a clock of its own: while a
     flight is running, every frame reads the camera's live zoom
     (M.camRead) and turns it into a height, so the readout climbs,
     holds and descends with the shot -- and shows the truth about
     an interrupted one. The digits are throttled to about 12Hz: an
     instrument that rewrites four figures sixty times a second is
     a blur rather than a reading, and it is the one thing in a
     flight that costs layout. The marker rides every frame; it is
     a needle. */
  var ALT_TOP = 4200;            /* metres at survey height */
  var ALT_LOW = 90;              /* and over the water on the ground */
  var ALT_TICK_MS = 80;

  function altClock() {
    return global.performance && global.performance.now
      ? global.performance.now()
      : Date.now();
  }

  /* Plain digits, not zero-filled: "0683" reads as an error code
     rather than an altitude. The width is held by the cell instead
     -- see .alt__num in css/style.css. */
  function altFace(m) {
    return String(Math.max(0, Math.round(m)));
  }

  function altReset(round) {
    altFollow(round, false);
    var e = round.el;
    if (!e.alt) return;

    e.alt.classList.remove('is-on', 'is-out');
    e.alt.style.setProperty('--alt-p', '0');
    if (e.altNum) e.altNum.textContent = altFace(ALT_TOP);
    if (e.altState) e.altState.textContent = 'STANDBY';
  }

  function altTo(round, state) {
    var e = round.el;
    if (!e.alt || !airborne) return;
    e.alt.classList.add('is-on');
    if (e.altState) e.altState.textContent = state;
  }

  /* one reading off the lens, marker and (if it is time) digits */
  function altSample(round, force) {
    var e = round.el;
    if (!e.alt) return;
    var st = M.camRead(round.node);
    var t = M.camZoom(round.node, st.s);
    var now = altClock();

    e.alt.style.setProperty('--alt-p', t.toFixed(4));
    if (e.altNum && (force || now - (round.altWrote || -1e9) >= ALT_TICK_MS)) {
      round.altWrote = now;
      e.altNum.textContent = altFace(ALT_TOP + (ALT_LOW - ALT_TOP) * t);
    }
  }

  function altFollow(round, on) {
    if (round.altRaf) {
      global.cancelAnimationFrame(round.altRaf);
      round.altRaf = null;
    }
    if (!on || !round.el.alt) return;

    round.altWrote = -1e9;
    (function step() {
      altSample(round, false);
      round.altRaf = global.requestAnimationFrame(step);
    })();
  }

  /* Off again before a task starts: the instrument said what it was
     there to say, and an instrument left on the water is one more
     thing over the shapes the player has to read. */
  function altOut(round) {
    var e = round.el;
    if (!e.alt || !airborne) return M.wait(0);

    altSample(round, true);
    e.alt.classList.add('is-out');
    return M.wait(760).then(function () {
      e.alt.classList.remove('is-on', 'is-out');
    });
  }


  /* ============================================================
     THE LANDING — what the survey's site B and every round share

     The craft is flown down onto the island the player picked and
     the geometry decides what happens (js/failure.js). The two
     pieces below are the halves of that which are the same on all
     six screens: the footer's hand-over to the NEXT button, and the
     fall.
     ============================================================ */

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

     Shared by the survey's landing and the five round screens: the
     footer is built the same way on all six. */
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
    /* Built here, at the top of the attempt, and fired a second and
       a half later on the frame of impact. See prime() in
       js/audio.js for why the clip cannot be made at the moment it
       is wanted: this call is still inside the click that started
       the landing, which is both the head start the decoder needs
       and the user gesture the autoplay policy wants. */
    var bang = A.prime(tight ? 'sink' : 'crash');

    var opts = {
      refPad: ref,
      geo: geo || undefined,
      alive: function () { return live(id); },

      /* No buzzer here. The SHAPE task still uses one — a tap on the
         wrong shape has nothing else to answer it with — but this
         screen does: the craft's own crash or its going under IS
         the answer, and the spoken verdict starts over the top of
         it a beat later. incorrect-answer.ogg runs 3.3s, so laying
         it under a 2s impact clip only muddied the one sound the
         player is meant to hear. */
      onSettle: onSettle,

      /* Fired on the frame something is actually hit, so the sound,
         the burst and SEA's front are one event rather than three
         near-misses. */
      onImpact: function (point, kind) {
        if (kind === 'water') {
          /* The splash is what comes UP out of the water; SEA's
             front is what goes OUT across it, and it is the half
             that tells the player the islands are standing in one
             sea. Fired on the same point, so the two are one
             event. */
          SEA.impact(ship, point, { size: 54 });

          /* 1.92s, against 204ms of plunge and 1700ms of sinking:
             the clip runs the length of the beat and dies away as
             the hull goes under, which is why it starts HERE and
             not at the top of the sink. */
          bang({ volume: 0.75 });
        } else {
          /* Smaller front, and for a different reason: nothing went
             into the sea here, so what reaches the water is the
             shock through the rock rather than the craft itself. */
          SEA.impact(ship, point, { size: 32 });

          /* 2.09s, and the wreck is held for 620ms plus however
             long the verdict line runs — so it is still ringing
             under "this landing zone is too large". */
          bang({ volume: 0.85 });
        }
      }
    };

    return tight ? F.sinkInWater(ship, pad, opts)
                 : F.crashOnLand(ship, pad, opts);
  }

  /* ============================================================
     THE TASKS -- the helpers both questions are played through

     Each takes a SITE (js/pages.js shapes them like rounds), and
     `R === site` is how a helper knows its question is still the
     live one.
     ============================================================ */

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

  /* Everything about a round -- or a survey site -- back to its
     opening state, EXCEPT where its islands stand: that is the
     layout half, and resetRound() does it for both of a screen's
     sites. `e.all` is every island a site carries, hidden ones
     included. */
  function clearRound(round) {
    if (R === round) R = null;

    var e = round.el;

    round.phase = null;         /* 'shape', 'area', or nothing to do */
    round.picked = 0;
    round.scolding = false;
    round.landing = false;
    round.solved = false;

    /* takes every phase class off the craft and empties both effect
       layers, so a wreck and its scorch go with the reset. A site
       without a craft (the survey's site A) skips it. */
    if (e.ship) {
      F.resetSpaceship(e.ship);
      e.ship.classList.remove('is-in');
      e.ship.style.removeProperty('--lean');
    }
    if (e.shipDims) e.shipDims.classList.remove('is-drawn');

    e.pads.classList.remove('is-picking', 'is-cleared', 'is-choosing', 'is-priced');
    (e.all || roundPads(round)).forEach(function (pad) {
      pad.classList.remove('is-up', 'is-picked', 'is-wrong', 'is-sunk',
                           'is-priced', 'is-fit', 'is-loose', 'is-tight',
                           'is-scattered');
      var hit = pad.querySelector('.pad__hit');
      if (hit) hit.tabIndex = -1;
    });

    if (e.confetti) M.confettiClear(e.confetti);

    if (e.advance) {
      e.advance.classList.remove('is-in');
      e.advance.hidden = true;
    }

    if (e.hud) e.hud.classList.remove('is-on');
    if (e.caption) {
      e.caption.classList.remove('is-shown');
      e.caption.textContent = '';
    }
    if (e.tally) {
      e.tally.classList.remove('is-shown');
      e.tally.textContent = '';
    }

    if (e.topbar) {
      e.topbar.classList.remove('is-on');
      T.clear(e.topbarText);
    }

    /* both player-driven steps park a promise only a click can
       settle, so every jump settles it by hand — the step after it
       then sees a stale generation and unwinds like any other */
    var done = round.release;
    round.release = null;
    if (done) done();
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
      if (!live(id)) clearRound(round);      /* jumped while we armed */
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

  /* The wrong shape: a red coast, a buzzer, and one "try again" at
     a time. */
  function refuseShape(round, pad) {
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
  }

  function onRoundShapePick(round, pad) {
    if (pad.classList.contains('is-picked')) return;

    /* --- the wrong shape --- */
    if (pad.dataset.shape !== round.shape) return refuseShape(round, pad);

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
      if (!live(id)) clearRound(round);
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
    { node: function () { return el.screenCockpit; }, reset: resetCockpit, run: runCockpit },
    { node: function () { return el.screenDrone; },   reset: resetSurvey,  run: runSurvey }
  ];

  /* Screen 2 is a round like the others once js/pages.js has built
     its islands (wireSurvey); until then -- or without pages.js at
     all -- it is dark water and a scan that finds nothing, which is
     the most the screen can honestly play. */
  function resetSurvey() {
    if (survey) return resetRound(survey);
    el.topbar.classList.remove('is-on');
    T.clear(el.topbarText);
  }

  function runSurvey() {
    if (survey) return runRound(survey);
    return sequence([
      function () { el.topbar.classList.add('is-on'); return M.wait(720); },
      function () { return narrate(el.topbarText, 'tooDark'); },
      function () { return narrate(el.topbarText, 'startScan'); }
    ]);
  }

  /* Screens 4 to 8 are built from js/pages.js at boot and appended
     here, so the nav, the veil, the NEXT button and goTo() pick them
     up with no special case: as far as everything below is
     concerned they are five more entries in this list.

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
        console.warn('GeoDrone: js/pages.js did not load — the survey has ' +
                     'no islands and screens 4 to 8 are missing.');
      }
      return;
    }

    global.GeoPages.build(el.stage, el.veil).forEach(function (round) {
      SCREENS.push({
        node:  function () { return round.node; },
        reset: function () { resetRound(round); },
        run:   function () { return runRound(round); }
      });
      wireSites(round);
      round.el.advance.addEventListener('click', onAdvance);
    });
  }

  /* One listener per site rather than five per site; which question
     a tap answers is decided by which site is live. */
  function wireSites(round) {
    var a = round.sites.a;
    var b = round.sites.b;

    a.el.pads.addEventListener('click', function (e) {
      var hit = e.target.closest('.pad__hit');
      if (!hit || R !== a || a.phase !== 'shape') return;
      var pad = hit.closest('.pad');
      if (pad) onRoundShapePick(a, pad);
    });

    b.el.pads.addEventListener('click', function (e) {
      var hit = e.target.closest('.pad__hit');
      if (!hit || R !== b || b.phase !== 'area') return;
      var pad = hit.closest('.pad');
      if (pad) onRoundAreaPick(b, pad);
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

  /* ---------------------------------------------------------- the tap

     One listener, for every control in the game: Start, LAUNCH, the
     islands on both questions, the nav arrows, NEXT — and anything
     js/pages.js builds after this runs, since the listener sits on
     the document rather than on the buttons.

     Delegated rather than wired per button because the alternative
     is remembering the line at every new one, and a control that
     answers a tap in silence is the sort of thing that is only
     noticed after it ships.

     On the way DOWN, so the tick is already playing before the
     handler that owns the button decides what the tap MEANT: a pick
     that ends in a crash should still sound like it was pressed.

     What is pressable is left entirely to the CSS, which already
     says it precisely — every hit target sits at
     `pointer-events: none` until its own question arms, the START
     button is `hidden` until the assets are in, and the arrows go
     `disabled` for the length of a swap. A tap on dead artwork or a
     spent control therefore never reaches this handler, and there
     is no second copy of those rules here to fall out of step with
     them. */
  var TAPPABLE = 'button, [role="button"], a[href], summary, input, select';

  function onTap(e) {
    var node = e.target;
    if (!node || !node.closest) return;         /* text/document target */

    var hit = node.closest(TAPPABLE);
    if (!hit || hit.disabled) return;
    if (hit.getAttribute('aria-disabled') === 'true') return;

    /* `keep` so goTo()'s audio cut does not eat the click of the
       very button that asked for the jump — see fireShot() */
    A.sfx('click', { volume: 0.4, keep: true });
  }

  /* Screen 2's islands, built into its markup and wired like a
     round's. Before SEA.init(), so every island gets its shoreline
     with the rest, and before runGate(), so its artwork is counted
     by the loading bar. */
  function wireSurvey() {
    if (!global.GeoPages || !global.GeoPages.buildSurvey) return;
    survey = global.GeoPages.buildSurvey(el.screenDrone);
    if (survey) wireSites(survey);
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
    wireSurvey();

    /* and after both, because every island on every screen needs a
       shoreline built from its own silhouette */
    SEA.init(el.stage);

    /* every playing screen in its opening state from the off -- after
       the water is in, because the lens parks the sea's own sheets */
    SCREENS.forEach(function (screen, i) { if (i > 0) screen.reset(); });

    runGate();

    /* first, and in the capture phase, so every control below is
       audible without knowing anything about this */
    document.addEventListener('click', onTap, true);

    el.gateBtn.addEventListener('click', begin, { once: true });
    el.launchBtn.addEventListener('click', onLaunch);

    el.navPrev.addEventListener('click', function () { goTo(current - 1); });
    el.navNext.addEventListener('click', function () { goTo(current + 1); });

    /* The reward button takes the same road as the ">" arrow, which
       is what makes it carry straight on from the survey's landing
       into the first round. Screens 4-8 wire the same handler, in
       addRoundScreens(). */
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
