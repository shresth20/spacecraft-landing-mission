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
        of every shape in the mission, and among them site A
     → the lens brackets site A and descends — see THE CAMERA in
        js/animation.js
     → "the scanner found several landing zones"
     → the round's craft flies in and hovers over open water:
       "here comes our first spaceship! look at its shape. select
        all the landing zones where it can land"
     → site A's five islands become selectable; three squares to
       find, two other shapes to leave
       · right shape → green coast, zone locks in
       · wrong shape → red coast, buzzer, "try again"
     → all three found: the two wrong shapes sink, "correct! these
       landing zones have the same shape as the spaceship", and the
       lens climbs away with the craft and goes straight on

   Screen 3 · the rectangle's shapes
     the next site's screen dissolves in at survey height, and the
     same shape question is asked there of the rectangle's craft;
     once its three are found it says "we have found the landing
     zones. but which one is the right zone to land on perfectly?"
     and NEXT arrives

   Screens 4 and 5 · the square's landing, then the rectangle's
     each back on its own screen, with the lens already down on the
     landing site: three islands of the shape break the surface, the
     craft flies in and hovers, its sides are called out, the areas
     are printed on -- and the joystick comes up.
     The player flies the craft over an island, lets go, and presses
     GO (js/pilot.js); it comes down and the geometry decides what
     happens (see THE LANDING below). A miss costs one of three
     hearts and the craft comes back to the middle; with all three
     gone the autopilot lands it on the one that fits. It fits:
     confetti, "landing successful", and NEXT. The narration bar
     stays up while each sentence is spoken and steps aside once it
     is finished, so the screen is left clear. Screens 2 to 5 are
     two visits each to the square's and the rectangle's screens
     (`split`, js/pages.js).

   Screens 6 to 8 · a round per shape
     the whole lesson on one screen, for a new shape and a new area
     formula each time, opening straight onto the water at survey
     height: the archipelago breaks the surface, the lens comes down
     on site A for the shape question, climbs and crosses and comes
     down on site B, where the player flies the craft onto the
     island whose area it needs, exactly as on screens 4 and 5 --
     hearts, autopilot and all. Parallelogram, rhombus, trapezium.
     See runRound().

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
  /* js/cruise.js -- dust drifting past the cockpit's canopy */
  var C = global.GeoCruise;

  /* js/failure.js — the landing and its two failures, shared by
     screens 3 to 8. Every one of the three outcomes below goes
     through it. */
  var F = global.GeoFail;

  /* js/pilot.js -- every landing, flown by hand. Without it the
     landings are made by tapping an island instead: see `flown()`
     below. */
  var PILOT = global.GeoPilot || null;

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

  /* js/reef.js -- the flown landing's sea. Scenery, on the same
     bargain as the water: without it that screen plays on the
     round screens' own sea. */
  var REEF = global.GeoReef || { init: function () {}, strew: function () {}, prepare: function () { return Promise.resolve(); } };

  /* js/cinematic.js -- the square's landing from its sprite sheets:
     the fallback cut-scene on that one screen, when the shots below
     cannot play. A screen with neither lands the way it always has:
     from straight overhead. */
  var CINEMA = global.GeoCinema || null;

  /* js/square-landing.js (+ js/square-crash.js) -- every landing's
     cut-scenes, close up: the shape's own craft and island, every jet
     and puff of smoke drawn live, on every screen whose two pictures
     are in (js/landing-assets.js). */
  var SQUARE = global.GeoSquareLanding || null;

  /* js/close-up.js -- the overhead lens down onto the island before
     the cut-scene, and back up to where it was once it has finished */
  var CLOSE = global.GeoCloseUp || null;

  /* js/sound.js -- the synthesised half of the mix: the controls'
     answers, the warnings, the weight of a touchdown. Called by name,
     so without the module every cue is simply silence. */
  function cue(name, a, b) {
    var S = global.GeoSound;
    if (S && S[name]) S[name](a, b);
  }

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
    shapeMatch: 'Correct! These landing zones have the same shape as the spaceship.',
    spaceNeeded: 'Next, we need to find how much space the spaceship needs.',
    calcArea: 'Calculate the area of spaceship, and select the land with required area.',
    chooseExact: 'Choose the landing zone with the exact area.',
    tooSmall: 'This landing zone is too small. The spaceship cannot fit safely.',
    tooLarge: 'This landing zone is too large. Try to find the exact match.',
    perfectFit: 'Perfect match! The spaceship fits exactly.',
    landed: 'Landing successful! Great work, Space Commander.',

    /* a second way of asking for the area, so five rounds do not
       all ask with the same sentence */
    findArea: 'Find the area of spaceship, and select the suitable land.',
    /* each round's own lines -- the craft's arrival, the formula, the
       closing lines -- are in js/pages.js */

    /* the flown landing (js/pilot.js): how to fly, and what happens
       when the hearts run out. No clips for either -- typed at
       reading rate, as the shape lines are (see voice()) */
    pilotHow: 'Drag the joystick to fly the spaceship. Stop over a landing zone and press GO.',
    autoPilot: 'Out of hearts! Autopilot will land on the zone that fits.',

    /* the last screen (runEnd); no clip, shown for a reading's length */
    complete:  'All five spaceships have landed safely. Great work, Space Commander!'
  };

  function grab() {
    [
      'stage', 'screenCockpit', 'starfield', 'cruiseCanvas',
      'flyDrone', 'flyTrail', 'dash', 'waveCanvas', 'cockpitCaption',
      'launchSlot', 'launchBtn',
      'screenEnd', 'endStars', 'endFleet', 'endTitle', 'endCaption', 'endConfetti', 'restartBtn',
      'gate', 'gateBtn', 'gateLoad', 'gateFill',
      'gateStatus', 'gatePct', 'nav', 'navPrev', 'navNext',
      'navDebug', 'navDebugMenu'
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
     GeoType reads currentTime off it. See js/typewriter.js.

     A bar marked `data-step-aside` (the square's landing screen)
     comes up for each line, stays while the whole sentence is typed
     and spoken, and steps aside as soon as it is finished, so it is
     not left standing over the craft while the player flies. The
     attribute's value is only a grace: a line that follows within
     it keeps the bar up, so back-to-back lines do not slide it out
     and straight back in. Every line takes a fresh ticket, which is
     what stops a hide armed by an earlier line from taking down the
     bar under a later one. And a sentence is shown
     only the first time the visit speaks it: said again (the retry
     prompt after a miss, a second "too small") it is heard alone,
     with the bar kept away -- see hear(). */
  var barTicket = 0;

  /* the grace a full round's bar is given once its landing is flown
     -- the same the landing screen's markup carries (js/pages.js) */
  var STEP_ASIDE_MS = '400';

  function narrate(bar, key, text) {
    var top = bar && bar.closest('.topbar');
    var grace = top ? top.getAttribute('data-step-aside') : null;
    if (grace == null) return voice(bar, key, text);
    grace = +grace || 0;

    /* each sentence is printed the first time this visit speaks it;
       after that it is only heard (`data-said`, emptied by
       clearRound) */
    var said = top.dataset.said ? top.dataset.said.split(' ') : [];
    if (said.indexOf(key) >= 0) return hear(top, bar, key);
    said.push(key);
    top.dataset.said = said.join(' ');

    var up = top.classList.contains('is-on');
    top.dataset.line = String(++barTicket);
    if (!up) T.clear(bar);
    top.classList.add('is-on');

    /* a bar that was away gets most of its slide in before the
       typing starts */
    return M.wait(up ? 0 : (M.reduced() ? 0 : 450)).then(function () {
      return voice(bar, key, text);
    }).then(function () {
      /* the sentence is finished: away, unless another line takes
         the bar within the grace */
      var mine = top.dataset.line = String(++barTicket);
      M.wait(grace).then(function () {
        if (top.dataset.line !== mine) return;
        top.classList.remove('is-on');
        /* emptied once it is out of sight, so the next line types
           into a clean bar instead of sliding in with this one */
        return M.wait(650).then(function () {
          if (top.dataset.line === mine) T.clear(bar);
        });
      });
    });
  }

  /* A repeated line on an auto-hiding bar: the bar is taken down if
     it is still up, so it never shows one sentence under another,
     and the clip plays on its own. A line with no clip is skipped --
     it has already been read once. */
  function hear(top, bar, key) {
    var mine = top.dataset.line = String(++barTicket);
    if (top.classList.contains('is-on')) {
      top.classList.remove('is-on');
      M.wait(650).then(function () {
        if (top.dataset.line === mine) T.clear(bar);
      });
    }
    if (!A.hasVoice(key)) return M.wait(0);
    return A.say(key).then(function () { return M.wait(300); });
  }

  function voice(bar, key, text) {
    if (text == null) text = LINE[key] || '';

    /* A line with no clip recorded for it yet. Screens 4-8 each name
       their own shape ("the spaceship is a rhombus"), and there is no
       audio for any of the five, so the typing is clocked off the
       typewriter's own reading rate and the flow waits for the text
       rather than for a voice. Drop the mp3s in and register them in
       VOICE (js/audio.js) and this branch stops being taken — every
       one of those lines starts speaking, with no change here.

       Typed one sentence at a time, each in place of the last, so
       the bar never carries more than one -- a long line ("here
       comes our first spaceship! look at its shape. select ...")
       would otherwise wrap and stand there as a paragraph. A jump
       away between two sentences ends it there. */
    if (!A.hasVoice(key)) {
      var gen = runId;
      return sentences(text).reduce(function (chain, s) {
        return chain.then(function () {
          if (gen !== runId) return;
          if (M.reduced()) {
            T.set(bar, s);
            return M.wait(1400);
          }
          return T.type(bar, s, { hold: 900 }).then(function () {
            return M.wait(400);
          });
        });
      }, Promise.resolve());
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

  /* a line's sentences, in order */
  function sentences(text) {
    return (String(text).match(/[^.!?]+(?:[.!?]+|$)/g) || [])
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
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
    if (C) C.start();

    return sequence([
      function () { return M.wait(700); },
      function () { return speak(el.cockpitCaption, 'welcome'); },
      function () { return speak(el.cockpitCaption, 'safePlace'); },
      function () { return speak(el.cockpitCaption, 'sendDrone'); },
      function () { return M.wait(280); },
      function () {
        el.launchBtn.classList.add('is-shown');
        el.launchSlot.classList.add('is-armed');
        cue('arm');
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
    cue('latch');
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
     MISSION COMPLETE — the last screen

     After the last round's NEXT: the five crafts landed, each with
     its area rule (the fleet, js/pages.js), the title, one line,
     confetti, and RESTART, which takes the mission from the top.
     Shaped like the cockpit: reset puts every piece back while the
     screen is still hidden, run brings them in one after another
     under the generation check, so a jump away mid-sequence strands
     it the way it strands everything else.
     ============================================================ */
  function resetEnd() {
    if (!el.screenEnd) return;
    el.endFleet.classList.remove('is-in');
    el.endTitle.classList.remove('is-in');
    el.endCaption.classList.remove('is-shown');
    el.endCaption.textContent = '';
    M.confettiClear(el.endConfetti);
    el.restartBtn.classList.remove('is-in');
    el.restartBtn.hidden = true;
  }

  /* speak() clears its caption unless told it may not: this line stays */
  function holdCaption() { return false; }

  function runEnd() {
    return sequence([
      function () { return M.wait(500); },
      /* the five come down onto their islands one after another
         (css/style.css staggers them) */
      function () {
        el.endFleet.classList.add('is-in');
        return M.wait(M.reduced() ? 300 : 1500);
      },
      /* the title comes in on the fanfare, with the music drawn back
         under it for its length and brought up again after */
      function (id) {
        el.endTitle.classList.add('is-in');
        A.duckAmbience(0.1, 300);
        cue('fanfare');
        M.wait(2400).then(function () {
          if (live(id)) A.duckAmbience(0.22, 1600);
        });
        return M.wait(500);
      },
      function () {
        M.confetti(el.endConfetti);
        A.sfx('cheer', { volume: 0.5 });
        return speak(el.endCaption, 'complete', holdCaption);
      },
      /* the line has no clip, so it is given a reading's length */
      function () { return M.wait(1600); },
      function () {
        el.restartBtn.hidden = false;
        /* reflow, as showRoundAdvance(): a starting frame to rise from */
        void el.restartBtn.offsetWidth;
        el.restartBtn.classList.add('is-in');
        cue('advance');
      }
    ]);
  }

  function onRestart() {
    return goTo(0);
  }

  /* ============================================================
     THE SURVEY AND THE ROUNDS — screens 2 to 8

     One driver for all seven. Every playing screen is one continuous
     shot over one sea, and a full round brings the lens down on it
     twice:

       survey height       the whole archipelago breaks the surface
                           under the lens -- sixteen islets of every
                           shape, and among them the two sites
       down on SITE A      three islands of the round's shape, three
                           sizes, and two other shapes, and the craft
                           flies in and hovers over them. The line
                           points at its shape; wrong shape shakes,
                           right shape takes a green coast
       up, across, down    the two that never matched sink and the
                           payoff line plays from the air; the craft
                           heads off for site B, and the lens crosses
                           the water at height and comes down there
       down on SITE B      three islands of the round's shape in the
                           row, carrying the round's three areas, and
                           nothing else. The craft arrives, its
                           callouts are drawn on, the areas print
       select the match    the craft flies down and the geometry
                           decides, exactly as it always has
       land                planted, confetti, NEXT

     The first two rounds are split (`round.split`): each screen is
     visited twice, for its shape question alone ('hunt') and for its
     landing alone ('land'), and both shape questions come first. The
     first visit of all is the drone's dark-and-scan opening
     (`round.intro`), where the scan finds the land; every visit after
     it opens high over land already up, the last visit having zoomed
     out to that height (leaveTo), and comes down on the site it
     plays -- A for a shape question, B for a landing. The later
     rounds play both sites in one visit. What differs between them otherwise is
     entirely data -- the artwork, the measurements, the numbers on
     the islands, the formula -- and all of it lives in
     js/pages.js. Nothing below names a shape.

     ── the two sites ──

     Both sites are shaped like a round (js/pages.js) and share the
     screen's chrome, and the task helpers further down play a SITE:
     `R` is the site whose question is live. State hangs off the
     round and its sites rather than off this module, because
     resetRound() has to be able to put a screen the player has
     already left back to its opening state while another plays.

     ── coordinates ──

     Everything in the camera plate is in WORLD coordinates -- per
     cent of one frame. On a round's own sea site A's frame is
     (0..100, 0..100) and site B's a frame to the right and 45% down;
     where rounds share one sea each pair has its own place on it
     (SITE_AT, js/pages.js). A site's centre is its offset plus
     (50, 50); the lens holds the middle of every site on the sea at
     survey height (`round.mid`, or WORLD on a sea of one round).

     ── the lens ──

     The states, and the flights between them (THE CAMERA in
     js/animation.js): wide over the middle, and down on each site.
     The first descent is one leg; a crossing is one animation with a
     climb, a slow drift at altitude and a descent in it, so the lens
     never stops between two sites. The altimeter follows the lens
     itself (altFollow), whatever it is doing.
     ============================================================ */

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

  /* the lens down on a site: scale 1, the site's centre under the
     middle of the frame -- which is that site laid out exactly as a
     screen of its own would lay it out. Wherever on the sea the site
     stands (its offset, js/pages.js). */
  function siteState(site) {
    return { s: 1, x: site.offset.x + 50, y: site.offset.y + 50 };
  }

  /* and at survey height, over the middle of the view `site` is in --
     a round's two sites, or on a shared sea its shape questions or its
     landings (`site.mid`, js/pages.js) */
  function wideState(round, site) {
    var mid = (site && site.mid) || WORLD;
    return { s: M.camWide(round.node), x: mid.x, y: mid.y };
  }

  /* the site a visit to `round` comes down on */
  function targetOf(round) {
    return landing(round) ? round.sites.b : round.sites.a;
  }

  /* Which visit to a round's screen is being played: the whole round
     ('full'), or -- on a `split` round, js/pages.js -- its shape
     question alone ('hunt') or its landing alone ('land'). SCREENS
     lists each visit as a screen of its own. */
  function landing(round) {
    return round.landingOnly || round.visit === 'land';
  }

  /* The whole screen back to its opening state for `visit` of `round`
     -- and, where rounds share the screen's sea (`together`,
     js/pages.js), every one of them: all their sites, the islets, the
     reef, each craft's spot over its site A. */
  function resetRound(round, visit) {
    var e = round.el;
    var P = global.GeoPages;
    var rounds = round.together || [round];

    rounds.forEach(function (r) { r.visit = null; });
    round.visit = visit || 'full';

    /* the lens first: back to the ground state before anything is
       measured, so the layout below is read off the layout itself */
    M.camReset(round.node);
    altReset(round);

    /* the screen's opening: the dark, the bezel and the scanner -- in
       the dark only for the visit that opens with the scan. Any other
       visit to that screen is in daylight from the off: lit with the
       fades held, so the dissolve onto it does not bring the sea up
       out of the dark (`is-cut`, css/style.css). */
    if (e.blackout) {
      var lit = !(round.intro && !landing(round));
      round.node.classList.add('is-cut');
      e.bg.classList.toggle('is-lit', lit);
      e.bezel.classList.toggle('is-retired', lit);
      e.blackout.classList.toggle('is-clear', lit);
      e.scanner.classList.remove('is-on');
      var bar = e.scanner.querySelector('.scanner__bar');
      if (bar && bar.getAnimations) {
        bar.getAnimations().forEach(function (an) { an.cancel(); });
      }
      void round.node.offsetWidth;
      round.node.classList.remove('is-cut');
    }

    /* every site back to its opening state, then a fresh draw on
       each: a site A with a fresh pair of decoys, strewn across the
       five stations; a site B's three dealt across the row, so the
       fit is never twice in the same place */
    rounds.forEach(function (r) {
      clearRound(r.sites.a);
      clearRound(r.sites.b);
    });

    /* a full round's bar only steps aside once its landing is flown
       (landingSteps); the landing screen's is marked so in its markup */
    if (!round.landingOnly && e.topbar) e.topbar.removeAttribute('data-step-aside');

    rounds.forEach(function (r) {
      var a = r.sites.a;
      var b = r.sites.b;
      P.arrangeSite(a, P.drawPair(r.decoyPool), ['pad--far1', 'pad--far2']);
      P.arrangeSite(b, [], []);
      P.dealRow(a);
      P.scatter(a);
      /* a flown landing strews its three round the hovering craft
         instead of lining them up under it */
      if (flown(b)) P.strewPilot(r);
      else P.dealRow(b);
    });

    /* the rest of the archipelago, strewn again -- clear of every site
       on the sea (`keepOut`), or of the sites this screen plays */
    round.islets.forEach(function (isl) { isl.classList.remove('is-up'); });
    P.strewIslets(e.cam, round.islets, round.keepOut || round.plays, round.world);

    rounds.forEach(function (r) {
      /* and the reef's rock, above the water and under it, clear of
         where all of that now is, on the screen that has one */
      REEF.strew(r);

      /* the craft over site A, on open water clear of all of that --
         or, on a frame with none to spare, not at all, and the shape
         question names the shape instead (hoverSpot in js/pages.js).
         Found for every round on the sea, since a visit after this
         one plays its shape question without another reset. */
      r.sites.a.hovers = !r.landingOnly && !!r.arrive && P.hoverSpot(r);
    });

    /* and the land itself: up already on every visit but the first,
       which is the one whose scan finds it (emerge) */
    if (!round.intro || landing(round)) surfaced(round);

    /* And the lens: PARKED at survey height over the middle of the
       sea, before the screen is shown. Reset runs while the screen is
       still hidden (see goTo), so it dissolves in already high rather than snapping
       up to height on its first frame.

       Parked, not set loitering -- the drift starts in runRound(),
       once the screen is on. A reset runs on hidden screens (every
       screen at boot, and the one the player has just left), and an
       animation that FINISHES on a hidden screen and is then
       cancelled leaves its last frame behind in Chromium: the
       element reports no animations and an inline transform, and
       renders the finished keyframe anyway, immovably, until the
       page is reloaded. A loiter that only ever runs on a screen the
       player is looking at is cancelled long before it can finish.

       Every visit opens here, a landing visit too: it comes down on
       site B from this height as the others come down on site A. */
    airborne = !M.reduced();
    M.camSet(round.node, wideState(round, targetOf(round)));
  }

  /* `visit`: which visit this is, when it is played without a reset
     ahead of it. `opts.from`: the visit before it, on this same sea
     (continueTo) -- the lens is wherever that one left it, and flies
     on from there instead of opening the screen. */
  function runRound(round, visit, opts) {
    W.stop();
    opts = opts || {};
    if (visit) round.visit = visit;

    var e = round.el;
    var a = round.sites.a;
    var b = round.sites.b;
    var from = opts.from || null;

    /* the site this visit comes down on: B for a landing on its own,
       A for everything else, whose question is the live one until the
       craft arrives on B */
    var land = landing(round);
    var target = land ? b : a;
    var opening = round.intro && !land && !from;
    R = target;

    /* The lens starts its loiter now that the screen is on -- see the
       note at the end of resetRound(). Long enough that nothing on
       any screen can outwait it: the first descent comes within
       twenty seconds of it starting, and it is that descent that
       interrupts it, so it never gets to finish and never leaves a
       filled frame behind. The amplitude is scaled to match, so the
       drift the player sees is the same slow one it always was. */
    if (airborne && !from) M.camLoiter(round.node, wideState(round, target), { dx: 5.8, dy: 3.2, ms: 45000 });

    var steps = [];

    if (from) {
      /* ── on from the last visit, over the same sea ── */
      steps.push(function (id) { return arriveFrom(round, target, from, id); });
    } else if (opening) {
      /* ── the first round's opening: the dark, and the scan ── */
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
        function () {
          /* heard leg for leg: M.sweep's own length for each */
          cue('scan', 2, M.reduced() ? 420 : 1150);
          return M.sweep(e.scanner, { legs: 2, legMs: 1150 });
        },

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
          cue('lightsUp');
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
      /* ── every other visit opens high over the water ──
         The screen before it climbed away to survey height and
         dissolved into this one at that height (leaveTo), so the
         land here is already up (resetRound) and the lens goes
         straight on: brackets the site it is coming down on, and
         comes down. One zoom out, one zoom in. */
      steps.push(
        function () {
          A.duckAmbience(0.16, 900);
          altTo(round, 'SURVEY');
          return M.wait(airborne ? 400 : 200);
        },
        function () {
          altTo(round, 'CONTACT');
          if (!airborne) return M.wait(200);
          M.camFix(round.node, siteBox(round, target, M.camRead(round.node)), 620);
          cue('bracket');
          return M.wait(900);
        }
      );
    }

    if (opening) {
      steps.push(
        /* --- the archipelago breaks the surface --- */
        function () {
          altTo(round, 'CONTACT');
          return emerge(round);
        },
        function () { return M.wait(420); }
      );
    }

    /* --- and the lens comes down on the site ---
       Nothing is said over it: the first line is the first thing
       spoken from the new altitude. The bracket is released a little
       under halfway down, well before the islands are big enough for
       it to be a box drawn round the answer. A visit on from another
       came down at the end of its crossing (arriveFrom). */
    if (!from) {
      steps.push(function (id) {
        altTo(round, 'DESCEND');
        A.duckAmbience(0.26, 1400);
        M.wait(DESCENT_MS * 0.42).then(function () {
          if (live(id)) M.camUnfix(round.node, 620);
        });
        return fly(round, [siteState(target)], DESCENT_MS);
      });
    }

    steps.push(
      /* --- the lens settles, the instrument bows out, and the bar
             comes up -- for a question read on site A; a landing's
             bar comes up with its first line --- */
      function () {
        altTo(round, 'HOLD');
        if (!land) e.topbar.classList.add('is-on');
        return Promise.all([altOut(round), M.wait(land ? 300 : 780)]);
      }
    );

    /* a landing on its own: down on site B, and straight on to the
       area question */
    if (land) return sequence(steps.concat(landingSteps(round)));

    if (opening) {
      steps.push(
        function () { return narrate(e.topbarText, 'foundZones'); },
        function () { return M.wait(300); }
      );
    }

    steps.push(
      /* ═══════════════ the shape question, on site A ═══════════════
         Asked of the craft itself: it flies in and hovers over open
         water (hoverIn), and the line asks for the zones it can land
         on without naming its shape -- the player reads the shape
         off the craft. Its first sentence ("here comes our first
         spaceship!") is typed while the craft flies in, and the rest
         ("look at its shape", "select all ...") once it is on its
         spot, a sentence at a time (see voice()).

         A frame with no open water to spare for it (`a.hovers`
         false) is asked the way it always was: the line names the
         shape, a beat after the player is told to look at the
         water. */
      function () {
        if (a.hovers) {
          return Promise.all([
            hoverIn(round),
            narrate(e.topbarText, round.shape + 'Arrive', sentences(round.arrive)[0])
          ]);
        }
        return narrate(e.topbarText, 'lookShapes').then(function () { return M.wait(560); });
      },

      /* no round's line has a recorded clip, so each is typed at
         reading rate (see narrate); `sayKey` is honoured should one
         be added */
      function () {
        if (!a.hovers) return narrate(e.topbarText, round.sayKey || round.shape, round.say);
        var rest = sentences(round.arrive).slice(1).join(' ');
        if (rest) return narrate(e.topbarText, round.shape + 'Look', rest);
      },

      /* --- over to the player, until all three are found --- */
      function (id) { return startRoundPicking(a, id); }
    );

    if (round.shapeOnly || round.visit === 'hunt') {
      /* the shape question is this visit's whole question. The last
         split round's (`huntOutro`) keeps its craft and its lens
         where they are, says what the landings will need, and offers
         NEXT; one before it goes straight on to the next shape
         question -- over the same sea, the lens climbs off this site,
         crosses at height and comes down on that one, with this
         site's payoff said on the way up (continueTo, arriveFrom). */
      var onward = round.visit === 'hunt' && !round.huntOutro;

      steps.push(
        /* answering it is what earns the way on -- and, as on a
           landing, the watchdog makes sure that way on arrives */
        function (id) {
          a.solved = true;
          armAdvanceWatchdog(a, id);
          return M.wait(420);
        },

        /* --- the two that never matched go back under, and the
               payoff line plays over them --- */
        function (id) {
          if (onward) {
            continueTo(current + 1, { answered: false });
            return;
          }
          var said = M.wait(700).then(function () {
            if (live(id)) return narrate(e.topbarText, 'shapeMatch');
          });
          return Promise.all([sinkRoundDecoys(a), said]);
        },

        function (id) {
          return Promise.resolve(round.huntOutro &&
            M.wait(300).then(function () {
              if (live(id)) return narrate(e.topbarText, round.shape + 'Found', round.huntOutro);
            })
          ).then(function () {
            return M.wait(400);
          }).then(function () {
            if (live(id)) showRoundAdvance(a);
          });
        }
      );

      return sequence(steps);
    }

    steps.push(
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
            hoverOut(round);
            return fly(round, [siteState(b)], 0);
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
        /* and the craft heads off for site B as the lens gets going,
           ahead of it (hoverOut) */
        M.wait(HOVER_OUT_AT).then(function () {
          if (live(id)) hoverOut(round);
        });

        altTo(round, 'CLIMB');
        A.duckAmbience(0.22, 1400);

        var top = wideState(round, b);
        M.wait(TRANSIT_MS * 0.40).then(function () {
          if (!live(id)) return;
          altTo(round, 'TRANSIT');
          M.camFix(round.node, siteBox(round, b, top), 560);
          cue('bracket');
        });
        M.wait(TRANSIT_MS * 0.58).then(function () { if (live(id)) altTo(round, 'DESCEND'); });
        M.wait(TRANSIT_MS * 0.80).then(function () {
          if (live(id)) M.camUnfix(round.node, 560);
        });

        return fly(round, [
          { s: top.s, x: top.x - 6, y: top.y - 3, offset: 0.40, easing: 'linear' },
          { s: top.s, x: top.x + 6, y: top.y + 3, offset: 0.56,
            easing: 'cubic-bezier(.5, 0, .18, 1)' },
          siteState(b)
        ], TRANSIT_MS, { easing: 'cubic-bezier(.44, .02, .28, 1)' }).then(function () {
          return said;
        });
      },

      /* --- down on site B --- */
      function () {
        altTo(round, 'HOLD');
        return altOut(round);
      }
    );

    return sequence(steps.concat(landingSteps(round)));
  }

  /* The zoom out from one screen to the next: the lens climbs off
     whichever site it is down on, back to survey height, and drifts
     there, the way the crossing starts -- and the next screen
     dissolves in at that same height and comes down on its own site
     (runRound). Between two visits on one sea there is no zoom out to
     a dissolve at all: the lens crosses (arriveFrom). */
  var LEAVE_MS = 3000;

  function climbAway(round, site, id, ms) {
    var top = wideState(round, site);
    altTo(round, 'CLIMB');
    A.duckAmbience(0.22, 1400);
    M.wait(ms * 0.6).then(function () {
      if (live(id)) altTo(round, 'TRANSIT');
    });
    return fly(round, [
      { s: top.s, x: top.x - 6, y: top.y - 3, offset: 0.62, easing: 'linear' },
      { s: top.s, x: top.x + 3, y: top.y + 1.5 }
    ], ms, { easing: 'cubic-bezier(.44, .02, .28, 1)' });
  }

  /* On from the last visit to the next site on the same sea, with no
     cut (continueTo). Whatever the last visit leaves behind goes as
     the lens climbs off it: a shape question's two wrong islands and
     its payoff line, where it went straight on without saying it
     (`from.answered` false); the craft still hovering over its site A,
     which heads off for its own landing; the hearts, the bar, the
     confetti. The lens crosses at survey height and comes down on
     `target`. The visit starts with a clean bar -- its lines shown
     again, not only heard (`data-said`), and kept up between lines on
     a shape question -- and a landing with its hearts and stick back
     to three and away (PILOT.reset); a camera that followed the last
     landing's craft is eased back to centre on the way up. */
  function arriveFrom(round, target, from, id) {
    var e = round.el;
    var prev = from.round;
    var said = null;

    if (e.lives) e.lives.classList.remove('is-on');
    if (e.confetti) M.confettiClear(e.confetti);
    if (from.visit === 'land' && PILOT) PILOT.centre(prev.sites.b, 1400);

    if (from.visit === 'hunt' && from.answered === false) {
      var pa = prev.sites.a;
      sinkRoundDecoys(pa);
      M.wait(520).then(function () {
        if (live(id)) pa.el.pads.classList.add('is-cleared');
      });
      said = M.wait(700).then(function () {
        if (live(id)) return narrate(e.topbarText, 'shapeMatch');
      });
    } else {
      e.topbar.classList.remove('is-on');
      if (from.visit === 'hunt') prev.sites.a.el.pads.classList.add('is-cleared');
    }
    M.wait(HOVER_OUT_AT).then(function () {
      if (live(id)) hoverOut(prev);
    });

    delete e.topbar.dataset.said;
    if (target === round.sites.a) e.topbar.removeAttribute('data-step-aside');
    if (target === round.sites.b && flown(target)) PILOT.reset(target);

    var left = from.visit === 'land' ? prev.sites.b : prev.sites.a;
    return Promise.all([crossTo(round, left, target, id), said]);
  }

  /* One crossing, from `left` to `target`, as one flight. Inside one
     view it is the crossing a whole round makes from its site A to
     its site B: a climb, a slow drift at survey height along the way
     it is going, and the descent. From one view to the other (a
     shared sea's shape questions to its landings) it climbs to the
     first view's height, glides along the sea at that height to the
     second's and comes down, TRANSFER_MS in all. The target is
     bracketed at the top and let go on the way down. */
  var TRANSFER_MS = 9000;

  function crossTo(round, left, target, id) {
    if (!airborne) return fly(round, [siteState(target)], 0);
    if (left && left.mid !== target.mid) return transferTo(round, left, target, id);

    var top = wideState(round, target);
    var at = M.camRead(round.node);
    var to = siteState(target);
    var dx = to.x - at.x, dy = to.y - at.y;
    var len = Math.hypot(dx, dy) || 1;
    var ux = dx / len * 6.6, uy = dy / len * 6.6;

    altTo(round, 'CLIMB');
    A.duckAmbience(0.22, 1400);
    M.wait(TRANSIT_MS * 0.40).then(function () {
      if (!live(id)) return;
      altTo(round, 'TRANSIT');
      M.camFix(round.node, siteBox(round, target, top), 560);
      cue('bracket');
    });
    M.wait(TRANSIT_MS * 0.58).then(function () { if (live(id)) altTo(round, 'DESCEND'); });
    M.wait(TRANSIT_MS * 0.80).then(function () {
      if (live(id)) M.camUnfix(round.node, 560);
    });

    return fly(round, [
      { s: top.s, x: top.x - ux, y: top.y - uy, offset: 0.40, easing: 'linear' },
      { s: top.s, x: top.x + ux, y: top.y + uy, offset: 0.56,
        easing: 'cubic-bezier(.5, 0, .18, 1)' },
      to
    ], TRANSIT_MS, { easing: 'cubic-bezier(.44, .02, .28, 1)' });
  }

  function transferTo(round, left, target, id) {
    var from = wideState(round, left);
    var over = wideState(round, target);
    var ms = TRANSFER_MS;

    altTo(round, 'CLIMB');
    A.duckAmbience(0.22, 1400);
    M.wait(ms * 0.28).then(function () { if (live(id)) altTo(round, 'TRANSIT'); });
    M.wait(ms * 0.58).then(function () {
      if (!live(id)) return;
      M.camFix(round.node, siteBox(round, target, over), 560);
      cue('bracket');
    });
    M.wait(ms * 0.68).then(function () { if (live(id)) altTo(round, 'DESCEND'); });
    M.wait(ms * 0.86).then(function () {
      if (live(id)) M.camUnfix(round.node, 560);
    });

    return fly(round, [
      { s: from.s, x: from.x, y: from.y, offset: 0.28,
        easing: 'cubic-bezier(.45, 0, .4, 1)' },
      { s: over.s, x: over.x, y: over.y, offset: 0.64,
        easing: 'cubic-bezier(.5, 0, .18, 1)' },
      siteState(target)
    ], ms, { easing: 'cubic-bezier(.44, .02, .28, 1)' });
  }

  /* A round visit taken leave of through its NEXT (leaveTo): the way
     on goes, and so does what was this visit's -- the bar, the
     hearts, a craft still hovering over site A, which heads off on
     its jets -- and the lens zooms out. A landed craft stays on its
     island. */
  function leaveRound(round, id) {
    var e = round.el;
    e.advance.classList.remove('is-in');
    e.topbar.classList.remove('is-on');
    if (e.lives) e.lives.classList.remove('is-on');
    hoverOut(round);
    return climbAway(round, round.visit === 'hunt' || round.shapeOnly ? round.sites.a : round.sites.b, id, LEAVE_MS);
  }

  /* ═══════════════ the area question, on site B ═══════════════
     Everything from the craft's arrival to NEXT, which a full round
     plays after its crossing and a landing screen plays on its own.

     The lines are Game_Flow_Without_Learning.md's. No lesson has
     taught the area rules, so every landing names its shape and its
     rule (`formula`, js/pages.js) before the player works the area
     out. The first landing (`teach`) leads up to that -- how much
     space does the craft need -- and is the one that says how to
     fly. "Choose the exact area" is kept for after a miss. */
  function landingSteps(round) {
    var e = round.el;
    var b = round.sites.b;

    var steps = [
      /* --- the craft arrives ---
         It comes down the middle of the frame, which is water by
         construction: the row is across the front and there is
         nothing else on this site. Site B's question is the live one
         from here. A flown landing's hearts come up with it. */
      function () {
        R = b;
        b.el.ship.classList.add('is-in');
        if (flown(b)) {
          PILOT.show(b);
          /* and the bar steps aside between lines from here on, as it
             does on the square's landing screen, so the craft is
             flown over clear water. Site A's lines kept it up: that
             is a question read, not flown. */
          if (!e.topbar.hasAttribute('data-step-aside')) {
            e.topbar.setAttribute('data-step-aside', STEP_ASIDE_MS);
          }
          /* from far off, on its own jets (arrive() in js/pilot.js);
             the line lands once it is on its station. A craft that
             was seen leaving site A comes in the way it left. */
          return PILOT.arrive(b, round.sites.a.left ? fromSiteA(round) : null);
        }
        /* the flight in takes 1.55s (shipArrive, css/rounds.css);
           the line lands as it settles onto its station */
        return M.wait(M.reduced() ? 200 : 1250);
      }
    ];

    /* the callouts are drawn on as the line lands: they ARE "how
       much space it needs" */
    function drawDims() {
      M.wait(680).then(function () {
        if (R === b) b.el.shipDims.classList.add('is-drawn');
      });
    }

    if (round.teach) {
      steps.push(
        /* --- how much space it needs --- */
        function () {
          drawDims();
          return narrate(e.topbarText, 'spaceNeeded');
        },
        function () { return narrate(e.topbarText, round.shape + 'Formula', round.formula); }
      );
    } else {
      steps.push(function () {
        drawDims();
        return narrate(e.topbarText, round.shape + 'Formula', round.formula);
      });
    }

    steps.push(
      /* --- the three candidates get their areas printed on --- */
      function () { return priceRound(b); },

      function () { return narrate(e.topbarText, round.areaKey); },

      /* --- over to the player, for as many attempts as it takes ---
         by tapping an island, or on a flown landing by flying there */
      function (id) {
        return flown(b) ? startPiloting(b, id) : startRoundChoosing(b, id);
      },

      /* --- planted; plantRound() has already said its piece, and a
             round with a closing line says it before the way on --- */
      function (id) {
        if (!round.outro) return;
        return M.wait(300).then(function () {
          if (live(id)) return narrate(e.topbarText, round.shape + 'Outro', round.outro);
        });
      },
      function (id) {
        return M.wait(600).then(function () {
          if (live(id)) showRoundAdvance(b);
        });
      }
    );

    return steps;
  }

  /* The bearing the round's site A lies on from its site B's hover
     point, in the frame's own pixels: the way the craft that left
     site A for here comes in (hoverOut, and arrive() in js/pilot.js). */
  function fromSiteA(round) {
    var W = round.node.clientWidth || 1;
    var H = round.node.clientHeight || 1;
    var oa = round.sites.a.offset, ob = round.sites.b.offset;
    return Math.atan2((oa.y - ob.y) / 100 * H, (oa.x - ob.x) / 100 * W);
  }

  /* ---------------------------------------------------------- the craft over site A
     It flies in from past the left edge, swoops low through the
     middle of the frame and comes up onto its spot -- the path
     hoverSpot() drew (js/pages.js), flown here on the element's
     `translate` -- and goes away on the line to site B
     (css/rounds.css). hoverIn() resolves once it is on its spot. */
  var HOVER_IN_MS = 3200;            /* and hoverDrop, css/rounds.css */
  var HOVER_OUT_AT = 1100;           /* into the crossing */

  function hoverIn(round) {
    var a = round.sites.a;
    var ship = a.el.hover;
    ship.classList.remove('is-gone');
    /* reflow, so the come-down plays from its first frame */
    void ship.offsetWidth;
    ship.classList.add('is-in');
    if (M.reduced() || !a.hoverPath || !ship.animate) return M.wait(200);

    if (a.hoverAnim) a.hoverAnim.cancel();
    a.hoverAnim = ship.animate(a.hoverPath.map(function (p) {
      return { translate: p[0] + 'px ' + p[1] + 'px' };
    }), { duration: HOVER_IN_MS, easing: 'cubic-bezier(.45, .12, .3, 1)' });
    hoverJets(round, HOVER_IN_MS);
    cue('flyby', HOVER_IN_MS, -1);
    return M.wait(HOVER_IN_MS);
  }

  function hoverOut(round) {
    var a = round.sites.a;
    var ship = a.el.hover;
    if (!a.hovers || !ship.classList.contains('is-in') || ship.classList.contains('is-gone')) return;
    ship.classList.add('is-gone');
    /* seen going: the landing's craft comes in the way this one went */
    a.left = true;
    if (!M.reduced()) hoverJets(round, HOVER_GONE_MS);
  }

  /* The jets under the craft over site A, lit off its own motion as
     the landing's craft is lit off the stick (js/pilot.js): each
     nozzle burns its share of the push the motion needs -- the way
     the craft is speeding up or slowing down, plus some of the way it
     is going, the air it keeps pushing through -- so it runs in on
     the jets behind it and brakes onto its spot on the ones ahead.
     Read off the element's own `translate` every frame, whichever of
     the two flights is moving it, for `ms`; then the fire dies back
     and the bells are drawn in. */
  var HOVER_GONE_MS = 2400;          /* hoverOut, css/rounds.css */
  var JET_PUSH = { l: [1, 0], r: [-1, 0], t: [0, 1], b: [0, -1] };    /* PUSH, js/pilot.js */
  var JET_DRAG = 1.6;                /* /s: how much of the speed is push */
  var JET_FULL = 0.9;                /* frame widths /s/s: a full burn */
  var JET_EASE = 0.2;                /* how fast the reading follows */

  function hoverJets(round, ms) {
    var a = round.sites.a;
    var ship = a.el.hover;
    var jets = {};
    Object.keys(JET_PUSH).forEach(function (s) {
      jets[s] = ship.querySelector('.thruster--' + s);
    });
    var token = a.jetToken = (a.jetToken || 0) + 1;
    var W = round.node.clientWidth || 1;
    var t0 = 0, last = null, v = [0, 0], acc = [0, 0];

    function at() {
      var t = (global.getComputedStyle(ship).translate || '').split(' ');
      return [parseFloat(t[0]) || 0, parseFloat(t[1]) || 0];
    }

    /* a nozzle runs out past one share and is drawn in under a lower
       one, and the same for its fire, so one sitting at the edge does
       not flutter */
    function burn(push) {
      Object.keys(jets).forEach(function (s) {
        var jet = jets[s];
        if (!jet) return;
        var share = push ? JET_PUSH[s][0] * push[0] + JET_PUSH[s][1] * push[1] : 0;
        var out = jet.classList.contains('is-out');
        var lit = jet.classList.contains('is-lit');
        jet.classList.toggle('is-out', share > (out ? 0.06 : 0.12));
        jet.classList.toggle('is-lit', share > (lit ? 0.14 : 0.2));
        jet.style.setProperty('--pow', Math.min(1, Math.max(0.35, share)).toFixed(2));
      });
    }

    function frame(now) {
      if (a.jetToken !== token) return;
      if (!t0) t0 = now;
      var p = at();
      if (last && now > last.t) {
        var dt = (now - last.t) / 1000;
        var nv = [(p[0] - last.p[0]) / dt, (p[1] - last.p[1]) / dt];
        acc = [acc[0] + ((nv[0] - v[0]) / dt - acc[0]) * JET_EASE,
               acc[1] + ((nv[1] - v[1]) / dt - acc[1]) * JET_EASE];
        v = [v[0] + (nv[0] - v[0]) * JET_EASE, v[1] + (nv[1] - v[1]) * JET_EASE];
        var push = [acc[0] + v[0] * JET_DRAG, acc[1] + v[1] * JET_DRAG];
        var k = Math.hypot(push[0], push[1]) / (W * JET_FULL);
        burn(k > 0.08 ? [push[0] / (W * JET_FULL), push[1] / (W * JET_FULL)] : null);
      }
      last = { t: now, p: p };

      if (now - t0 < ms) return requestAnimationFrame(frame);

      /* there: the fire dies back, and a beat later the bells go in */
      Object.keys(jets).forEach(function (s) { if (jets[s]) jets[s].classList.remove('is-lit'); });
      M.wait(300).then(function () {
        if (a.jetToken !== token) return;
        Object.keys(jets).forEach(function (s) { if (jets[s]) jets[s].classList.remove('is-out'); });
      });
    }

    requestAnimationFrame(frame);
  }

  /* the jets out, wherever they were (clearRound) */
  function stopJets(site) {
    site.jetToken = (site.jetToken || 0) + 1;
    if (!site.el.hover) return;
    Array.prototype.forEach.call(site.el.hover.querySelectorAll('.thruster'), function (jet) {
      jet.classList.remove('is-out', 'is-lit');
      jet.style.removeProperty('--pow');
    });
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
     once would be a storm. Played once, after the scan: every later
     visit finds the land already up (surfaced). */
  function emerge(round) {
    var a = round.sites.a;

    /* only the land in the view the lens is over breaks the surface
       in sight of it; on a shared sea the other view's is put up at
       once, out of shot and in silence, before the lens ever gets
       there */
    var half = 50 / M.camWide(round.node) + 12;
    var seen = function (isl) {
      var x = parseFloat(isl.style.getPropertyValue('--wx'));
      var y = parseFloat(isl.style.getPropertyValue('--wy'));
      return !isFinite(x) || !isFinite(y) ||
        (Math.abs(x - a.mid.x) < half && Math.abs(y - a.mid.y) < half);
    };
    var pads = [], away = [];
    (round.together || [round]).forEach(function (r) {
      [r.sites.a, r.sites.b].forEach(function (site) {
        var list = site.mid === a.mid ? pads : away;
        list.push.apply(list, site.el.padList);
      });
    });
    var islets = round.islets.filter(seen);
    away = away.concat(round.islets.filter(function (isl) { return !seen(isl); }));
    away.forEach(function (isl) { isl.classList.add('is-up'); });
    var all = islets.concat(pads);

    var rows = all.map(function (isl) {
      return { el: isl, y: isl.getBoundingClientRect().top + (Math.random() - 0.5) * 40 };
    }).sort(function (p, q) { return p.y - q.y; }).map(function (o) { return o.el; });

    var gap = M.reduced() ? 60 : 105;

    if (airborne) {
      M.wait(gap * Math.round(rows.length * 0.55)).then(function () {
        if (R === a) {
          M.camFix(round.node, siteBox(round, a, M.camRead(round.node)), 620);
          cue('bracket');
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

  /* The same land put up at once, with no splash and no sound, on a
     screen that cannot be seen yet (resetRound): the sea every visit
     after the first comes down into. A reset ahead of the dissolve
     (leaveTo) gives the rise time to be over before it is shown. */
  function surfaced(round) {
    var land = round.islets.slice();
    (round.together || [round]).forEach(function (r) {
      land = land.concat(r.sites.a.el.padList, r.sites.b.el.padList);
    });
    land.forEach(function (isl) { isl.classList.add('is-up'); });
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
    if (!e.altState) return;
    /* a new reading: the instrument chirps (js/sound.js) */
    if (e.altState.textContent !== state) cue('altitude', state);
    e.altState.textContent = state;
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
     THE LANDING — what every round's site B shares

     The craft is flown down onto the island the player picked and
     the geometry decides what happens (js/failure.js). The piece
     below is the half of that which is the same on every screen:
     the fall.
     ============================================================ */

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
     over, never at a fixed spot. `onHit`, where given, is handed
     that same moment: a flown landing takes its heart there. */
  function failFlight(ship, pad, ref, tight, geo, id, onSettle, onHit) {
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
        if (onHit) onHit(point, kind);

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
    round.left = false;         /* site A: its craft has been seen leaving */
    round.scolding = false;
    round.landing = false;
    round.solved = false;
    dropNudge(round);

    /* takes every phase class off the craft and empties both effect
       layers, so a wreck and its scorch go with the reset. A site
       without a craft (the survey's site A) skips it. */
    if (e.ship) {
      F.resetSpaceship(e.ship);
      e.ship.classList.remove('is-in');
      e.ship.style.removeProperty('--lean');
    }
    if (e.shipDims) e.shipDims.classList.remove('is-drawn');

    /* site A's craft, back out of the frame, its flight in stopped
       where it stands */
    if (e.hover) {
      e.hover.classList.remove('is-in', 'is-gone');
      stopJets(round);
    }
    if (round.hoverAnim) {
      round.hoverAnim.cancel();
      round.hoverAnim = null;
    }

    /* the helm, on a flown landing: three hearts, the craft back at
       its hover point, the controller away */
    if (flown(round)) PILOT.reset(round);

    /* a landing being played as a cut-scene stops where it stands, and
       the lens is taken off the island at once; a craft hidden for the
       pull back (failCinema) is shown again */
    if (CINEMA) CINEMA.stop(round);
    if (SQUARE) SQUARE.stop(round);
    if (CLOSE) CLOSE.stop(round);
    if (e.ship) e.ship.style.removeProperty('visibility');

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

    if (e.topbar) {
      e.topbar.classList.remove('is-on');
      delete e.topbar.dataset.said;
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
    armNudge(round);

    return new Promise(function (resolve) {
      round.release = resolve;
      if (!live(id)) clearRound(round);      /* jumped while we armed */
    });
  }

  function endRoundPicking(round) {
    round.phase = null;
    round.scolding = false;
    dropNudge(round);

    round.el.pads.classList.remove('is-picking');
    roundPads(round).forEach(function (pad) {
      var hit = pad.querySelector('.pad__hit');
      if (hit) hit.tabIndex = -1;
    });

    var done = round.release;
    round.release = null;
    if (done) done();
  }

  /* The hand: a player who has not tapped an island NUDGE_MS after
     the question was put, or since their last tap, is shown where to
     -- a hand taps one of the matches still to be found, over and
     over, until they tap an island themselves. Every tap starts the
     wait again, so the hand only turns up for someone stuck. The
     drawing is js/pages.js's, how it taps is css/rounds.css; the
     landing's own hand, on the joystick, is js/pilot.js. */
  var NUDGE_MS = 2500;

  function armNudge(round) {
    dropNudge(round);
    round.nudgeTimer = setTimeout(function () {
      round.nudgeTimer = 0;
      if (R === round && round.phase === 'shape') showNudge(round);
    }, NUDGE_MS);
  }

  function showNudge(round) {
    var pad = roundMatches(round).filter(function (p) {
      return !p.classList.contains('is-picked');
    })[0];
    if (!pad) return;

    var hand = round.el.nudge;
    if (!hand) {
      var tpl = document.createElement('div');
      tpl.innerHTML = global.GeoPages.hand;
      hand = round.el.nudge = tpl.firstChild;
    }
    pad.appendChild(hand);

    /* from the left on the right of the frame, so it stays on screen */
    var box = pad.getBoundingClientRect();
    var frame = el.stage.getBoundingClientRect();
    hand.classList.toggle('is-flip',
      box.left + box.width / 2 > frame.left + frame.width * 0.62);

    void hand.offsetWidth;      /* so the fade plays on a fresh island */
    hand.classList.add('is-on');
    cue('hint');
  }

  function dropNudge(round) {
    clearTimeout(round.nudgeTimer);
    round.nudgeTimer = 0;
    if (round.el.nudge) round.el.nudge.classList.remove('is-on');
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
       voice lines on top of each other. Off the radio: it is said
       over the buzzer, and the channel's tones would land in it. */
    if (!round.scolding) {
      round.scolding = true;
      A.say('tryAgain', { radio: false }).then(function () { round.scolding = false; });
    }
  }

  function onRoundShapePick(round, pad) {
    if (pad.classList.contains('is-picked')) return;

    /* right or wrong, the player is at it: the hand goes, and the
       wait for it starts over */
    armNudge(round);

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
        cue('readout', i);

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

    return new Promise(function (resolve) {
      round.release = resolve;
      if (!live(id)) clearRound(round);
    });
  }

  /* ---------------------------------------------------------- the flown landing

     A landing is not chosen with a tap: the player flies the craft
     over an island and presses GO (js/pilot.js), and
     the helm hands the island back here through onRoundAreaPick(),
     which is exactly where a tap would have gone -- so the landing,
     the two failures and the fit are the same on both. What is the
     flown screen's own is in failRound() and autopilotRound(): a
     heart for each miss, the craft brought back to the middle of
     the frame, and the autopilot once the hearts are gone. */
  function flown(site) {
    return !!(PILOT && site && site.helm);
  }

  /* The player that plays this landing's `kind` of shot ('fit',
     'tight' or 'loose') as a cut-scene, or null for the landing from
     overhead: the live two-picture shots where the screen's shape has
     its pictures in (js/square-landing.js), else the square's sheets on
     its own screen (js/cinematic.js). Never under reduced motion: a
     shot with a camera shake in it is just what that setting asks to
     be spared, and the top-down landing says the same thing without
     one. */
  function cinema(site, kind) {
    if (M.reduced()) return null;
    if (SQUARE && SQUARE.has(site, kind)) return SQUARE;
    /* the sheets are the square's: on a sea shared with another
       round, only the square's landing may fall back to them */
    if (CINEMA && site.shape === 'square' && CINEMA.has(site)) return CINEMA;
    return null;
  }

  /* Around the cut-scene, the overhead lens (js/close-up.js): down onto
     the island GO was pressed over before the shot, and back up to just
     where it was once the shot has finished -- called off the shot's
     own `done`, so a long one is never cut short. `alive` stops either
     dead. Without the module the shot simply plays as it always has. */
  function closeIn(site, pad, alive) {
    if (!CLOSE) return Promise.resolve(true);
    cue('zoom', true);
    return CLOSE.zoomIn(site, pad, { alive: alive });
  }

  function closeOut(site, alive) {
    if (!CLOSE || !alive()) return Promise.resolve(false);
    cue('zoom', false);
    return CLOSE.zoomOut(site, { alive: alive });
  }

  /* for what measures the screen as the parked camera lays it out */
  function closeBare(site, fn) {
    return CLOSE ? CLOSE.bare(site, fn) : fn();
  }

  function startPiloting(round, id) {
    round.phase = 'area';
    armPilot(round);

    /* how to fly, on the first landing (`teach`) and once a visit --
       typed while the controls are already live, so nobody has to
       wait for it to finish. Later landings leave it to the hand on
       the joystick (js/pilot.js), for a player who is stuck. */
    if (round.teach && !round.helm.told) {
      round.helm.told = true;
      narrate(round.el.topbarText, 'pilotHow');
    }

    return new Promise(function (resolve) {
      round.release = resolve;
      if (!live(id)) clearRound(round);
    });
  }

  function armPilot(round) {
    PILOT.arm(round, function (pad) {
      if (R !== round || round.phase !== 'area') return;
      onRoundAreaPick(round, pad);
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
    if (flown(round)) PILOT.disarm(round);
    round.el.pads.classList.remove('is-choosing');
    roundPads(round).forEach(function (pad) {
      var hit = pad.querySelector('.pad__hit');
      if (hit) hit.tabIndex = -1;
    });
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

  /* ---------------------------------------------------------- it fits
     `auto` is the flown landing's autopilot bringing it in, with
     the promise of its own line (`auto.said`) to wait on before the
     verdict is spoken. */
  function plantRound(round, pad, ref, id, auto) {
    var e = round.el;

    round.solved = true;
    armAdvanceWatchdog(round, id);

    var player = cinema(round, 'fit');
    if (player) return plantCinema(round, pad, ref, id, auto, player);

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

        /* down for good: the controller has nothing left to fly */
        if (flown(round)) PILOT.stow(round);

        /* the weight coming on: the mass of it, the struts, the
           hydraulics letting go, and the engines winding down */
        cue('touchdown', 1);
        cue('hydraulics', 1);
        cue('spoolDown');

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
      return auto && auto.said;
    }).then(function () {
      if (!live(id)) return;
      return sayRoundPlanted(round, id, !!auto);
    });
  }

  /* ---------------------------------------------------------- it fits, close up
     The same landing played as the cut-scene (js/cinematic.js). The
     touchdown -- the chime, the confetti, the stick put away -- is the
     shot's, so it lands on the frame the craft settles in it. Under the
     cut the top-down landing runs too, in silence, so that the shot
     hands back to a craft already planted on its island. "Perfect
     match" is said over the shot, while the craft sits edge for edge
     on the rock; "landing successful" once it has handed back. The
     lens comes down onto the island before the shot and goes back up
     after it (closeIn, closeOut). */
  function plantCinema(round, pad, ref, id, auto, player) {
    var e = round.el;
    var said = null;
    var alive = function () { return live(id); };

    /* the lens down onto the island first, and the shot once it has
       stopped (js/close-up.js) */
    return closeIn(round, pad, alive).then(function () {
      if (!live(id)) return;

      /* measured off the screen as the parked camera lays it out, so
         with the lens's zoom taken off for that moment */
      var under = closeBare(round, function () {
        return F.successfulLanding(e.ship, pad, {
          refPad: ref,
          geo: round.geo,
          alive: alive,
          onTouchdown: function () {
            pad.classList.add('is-fit');
            SEA.settle(pad);
          }
        });
      });

      var shot = player.play(round, 'fit', {
        alive: alive,
        onTouchdown: function () {
          if (flown(round)) PILOT.stow(round);
          /* the shot rings the metal and lets the gas go
             (js/cinematic-sfx.js); this is the weight under it */
          cue('touchdown', 0.8);
          cue('spoolDown');
          A.sfx('correct', { volume: 0.6 });
          M.wait(220).then(function () {
            if (!live(id)) return;
            A.sfx('cheer', { volume: 0.5 });
            M.confetti(e.confetti);
          });
        },
        onSettle: function () {
          said = Promise.resolve(auto && auto.said).then(function () {
            if (live(id)) return narrate(e.topbarText, 'perfectFit');
          });
        }
      });

      /* and back out off the shot's own end, never a clock */
      return Promise.all([under, shot.then(function () {
        return closeOut(round, alive);
      })]);
    }).then(function () {
      return said;
    }).then(function () {
      if (!live(id) || auto) return;
      return narrate(e.topbarText, 'landed');
    }).then(function () {
      if (!live(id)) return;
      round.landing = false;
      var done = round.release;
      round.release = null;
      if (done) done();
    });
  }

  /* "Great work" is not said over the autopilot's landing: the
     player did not make it, and the fit is the lesson either way. */
  function sayRoundPlanted(round, id, auto) {
    var e = round.el;

    return narrate(e.topbarText, 'perfectFit')
      .then(function () {
        if (!live(id) || auto) return;
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
    var player = cinema(round, tight ? 'tight' : 'loose');
    if (player) return failCinema(round, ref, tight, id, pad, player);

    var e = round.el;

    pad.classList.add(tight ? 'is-tight' : 'is-loose');

    /* the verdict is SPOKEN OVER the struggle rather than after it,
       and awaited at the end, so a slow connection delays the retry
       prompt instead of talking over it */
    var said = null;

    /* A flown landing pays a heart for the miss, on the frame the
       craft hits the rock or the water, and flies the next attempt
       from the middle of the frame again -- the craft flies back in
       there on its jets (PILOT.arrive), and the controls wait until
       it has. */
    var helm = flown(round);

    return failFlight(e.ship, pad, ref, tight, round.geo, id, function () {
      said = narrate(e.topbarText, tight ? 'tooSmall' : 'tooLarge');
    }, helm ? function () { loseLife(round, id); } : null)
      .then(function () { return said; })
      .then(function () {
        if (!live(id)) return;
        /* put it back on the rail, callouts and all */
        pad.classList.remove('is-tight', 'is-loose');
        if (helm) PILOT.home(round, REHOME_MS);
        F.resetSpaceship(e.ship);
        e.shipDims.classList.add('is-drawn');
        return helm ? PILOT.arrive(round) : M.wait(760);
      })
      .then(function () {
        if (!live(id)) return;
        round.landing = false;
        if (helm && PILOT.lives(round) <= 0) return autopilotRound(round, ref, id);
        var warned = null;
        if (!round.solved) {
          if (helm) warned = rearm(round);
          else armRound(round);
        }
        if (round.askExact) {
          return Promise.resolve(warned).then(function () {
            if (live(id)) return narrate(e.topbarText, 'chooseExact');
          });
        }
      });
  }

  /* A heart paid for a miss, on the frame of impact, and its alert a
     beat behind -- so the crash is heard first and the warning over
     the tail of it. */
  var ALERT_MS = 380;

  function loseLife(round, id) {
    PILOT.loseLife(round);
    M.wait(ALERT_MS).then(function () {
      if (live(id)) cue('hit');
    });
  }

  /* The controls handed back after a miss -- with the caution chime
     if this is the last heart: what is said over the crash is the
     verdict, so the warning waits for the moment the player can act
     on it. Resolves once the chime is out of the way, so a line said
     next is not said over it; the controls are live at once either
     way. */
  var CAUTION_MS = 900;

  /* how long the world takes to ease back under the craft's station
     when it is put back after a miss (PILOT.home) */
  var REHOME_MS = 900;

  function rearm(round) {
    armPilot(round);
    if (PILOT.lives(round) !== 1) return M.wait(0);
    cue('caution');
    return M.wait(CAUTION_MS);
  }

  /* ---------------------------------------------------------- it does not, close up
     Both failures played as the cut-scene: off the edge of an island
     too small for it and into the sea, or wrecked on one far too big.
     The lens comes down onto the island first (closeIn), and nothing
     moves under the cut this time -- the craft waits over the island
     it was flown to. As the shot fades back the craft is gone, so the
     lens pulls back (closeOut) off the island alone; then the craft is
     put back on its rail, and the player sees it drop in at the middle
     of the frame (shipArrive), as after a miss seen from overhead. The
     heart goes on the frame the craft hits the water or the rock, with
     its sound, and the verdict is spoken over the struggle. */
  function failCinema(round, ref, tight, id, pad, player) {
    var e = round.el;
    var helm = flown(round);
    var said = null;
    var back = null;

    /* built now, inside the GO press, and fired on the frame of
       impact -- see failFlight() */
    var bang = A.prime(tight ? 'sink' : 'crash');

    var kind = tight ? 'tight' : 'loose';
    var alive = function () { return live(id); };

    /* the lens down onto the island first, and the shot once it has
       stopped (js/close-up.js) */
    return closeIn(round, pad, alive).then(function () {
      if (!live(id)) return;
      return player.play(round, kind, {
        areas: { craft: round.area, land: pad ? +pad.dataset.area : 0 },
        alive: alive,
        onSettle: function () {
          said = narrate(e.topbarText, tight ? 'tooSmall' : 'tooLarge');
        },
        onImpact: function () {
          if (helm) loseLife(round, id);
          bang({ volume: tight ? 0.75 : 0.85 });
        },
        /* the craft is lost: the shot fades back onto the island
           alone, and the lens pulls back off it with nothing on it */
        onReturn: function () {
          e.ship.style.visibility = 'hidden';
        }
      });
    }).then(function () {
      /* back out off the shot's own end, never a clock */
      return closeOut(round, alive);
    }).then(function () {
      if (!live(id)) return;
      /* the lens is all the way out: the craft is put back on its
         rail, and the player sees it come back in to the middle of
         the frame -- flown in on its jets (PILOT.arrive), or dropped
         in (shipArrive) */
      e.ship.style.removeProperty('visibility');
      if (helm) PILOT.home(round, REHOME_MS);
      F.resetSpaceship(e.ship);
      e.shipDims.classList.add('is-drawn');
      back = helm ? PILOT.arrive(round) : M.wait(960);
      return said;
    }).then(function () {
      if (!live(id)) return;
      /* the controls wait until it is on its station */
      return back;
    }).then(function () {
      if (!live(id)) return;
      round.landing = false;
      if (helm && PILOT.lives(round) <= 0) return autopilotRound(round, ref, id);
      var warned = null;
      if (!round.solved) {
        if (helm) warned = rearm(round);
        else armRound(round);
      }
      if (round.askExact) {
        return Promise.resolve(warned).then(function () {
          if (live(id)) return narrate(e.topbarText, 'chooseExact');
        });
      }
    });
  }

  /* ---------------------------------------------------------- the autopilot
     Three misses and the hearts are gone: the craft is flown to the
     island that fits, on its own jets, and landed there. The line
     goes up first and the flight starts a beat into it, so the
     player is told what is about to happen before it does. The fit
     is then the ordinary one -- outline, chime, confetti, NEXT. */
  function autopilotRound(round, ref, id) {
    var e = round.el;
    cue('autopilot');
    var said = narrate(e.topbarText, 'autoPilot');

    round.landing = true;

    return M.wait(M.reduced() ? 300 : 1100).then(function () {
      if (!live(id)) return;
      return PILOT.flyTo(round, ref);
    }).then(function () {
      if (!live(id)) return;
      disarmRound(round);
      e.ship.classList.add('is-committed');
      return plantRound(round, ref, ref, id, { said: said });
    });
  }

  /* The NEXT button's third road. It normally arrives at the end of
     the planted sequence -- touchdown and two spoken lines -- and
     every step of that is
     a promise on a clip or a clock. Should any of them fail to
     settle (a clip whose `ended` never comes, an animation that is
     cancelled under it), the player would be left on a finished
     screen with no way on. So a landing arms this as well: the
     whole sequence's length plus grace, re-armed on every planting,
     and if the button is still hidden when it fires it is shown by
     hand. Under the same generation
     check as everything else, so a jump away disarms it. */
  var ADVANCE_WATCHDOG_MS = 20000;

  function armAdvanceWatchdog(round, id) {
    M.wait(ADVANCE_WATCHDOG_MS).then(function () {
      var btn = round.el.advance;
      if (!live(id) || !round.solved || !btn || !btn.hidden || !canAdvance()) return;
      showRoundAdvance(round);
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
    cue('advance');
  }


  /* ============================================================
     SCREENS + NAV
     ============================================================ */
  var SCREENS = [
    { label: 'cockpit', node: function () { return el.screenCockpit; }, reset: resetCockpit, run: runCockpit }
  ];

  /* Screens 2 to 6 are built from js/pages.js at boot and appended
     here, so the nav, the NEXT button and goTo() pick them
     up with no special case: as far as everything below is
     concerned they are five more entries in this list.

     Built rather than written out in index.html because the five are
     one screen five times over — the same markup with a different
     shape's artwork and measurements in it. Five copies in the
     document would be five copies to keep in step, and none of them
     could own an id. */
  function addRoundScreens() {
    /* Loudly, because the mission still runs without it: the cockpit
       plays as normal and then simply stops, which looks like a broken
       LAUNCH button rather than a missing file. */
    if (!global.GeoPages) {
      if (global.console) {
        console.warn('GeoDrone: js/pages.js did not load — screens 2 to 6 are missing.');
      }
      return;
    }

    var rounds = global.GeoPages.build(el.stage, el.screenEnd || el.nav);

    /* The visits, in the order they are played: the `split` rounds'
       shape questions, then their landings -- square shapes,
       rectangle shapes, square landing, rectangle landing -- then
       every other round whole. A split round is two entries on ONE
       screen, each resetting it to its own visit (resetRound). */
    var split = rounds.filter(function (round) { return round.split; });
    var visits = split.map(function (round) { return [round, 'hunt']; })
      .concat(split.map(function (round) { return [round, 'land']; }))
      .concat(rounds.filter(function (round) { return !round.split; })
        .map(function (round) { return [round, 'full']; }));

    visits.forEach(function (v) {
      var round = v[0];
      var visit = v[1];
      SCREENS.push({
        label: round.shape + (visit === 'hunt' ? ' shapes' : visit === 'land' ? ' landing' : ''),
        round: round,
        visit: visit,
        node:  function () { return round.node; },
        reset: function () { resetRound(round, visit); },
        run:   function (opts) { return runRound(round, visit, opts); },
        leave: function (id) { return leaveRound(round, id); }
      });
    });

    /* rounds that share a sea share its NEXT button: one listener */
    var wired = [];
    rounds.forEach(function (round) {
      wireSites(round);
      if (wired.indexOf(round.el.advance) >= 0) return;
      wired.push(round.el.advance);
      round.el.advance.addEventListener('click', onAdvance);
    });
  }

  /* Screen 7, after the rounds -- so the last round's NEXT has
     somewhere to go (canAdvance()), and the arrows and the debug
     list find it where they find everything else. Only behind the
     rounds: with js/pages.js missing, LAUNCH would otherwise land
     straight on "mission complete". */
  function addEndScreen() {
    if (!el.screenEnd || SCREENS.length < 2) return;
    /* here, before runGate(), so the fleet's pictures are counted
       with everything else the loading bar waits for */
    if (el.endFleet) el.endFleet.innerHTML = global.GeoPages.fleet();
    SCREENS.push({
      label: 'complete',
      node:  function () { return el.screenEnd; },
      reset: resetEnd,
      run:   runEnd
    });
    el.restartBtn.addEventListener('click', onRestart);
  }

  /* One listener per site rather than five per site; which question
     a tap answers is decided by which site is live. */
  function wireSites(round) {
    var a = round.sites.a;
    var b = round.sites.b;

    /* a flown landing's controller and keys -- the islands stay
       unarmed on that screen, so the tap listener below never fires
       there */
    if (round.pilot && PILOT) PILOT.attach(b);

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
    syncDebug();
  }

  /* ---------------------------------------------------------- debug jump
     The third nav button opens a list: "Replay" first, which plays
     the current screen again from the top (replay()), then every
     screen, which jumps straight to the one picked through goTo()
     like the arrows, so the screen left and the one arrived at are
     both reset as usual. Like the arrows it is only there once the
     mission has started. */
  function buildDebug() {
    if (!el.navDebug || !el.navDebugMenu) return;

    var again = document.createElement('button');
    again.type = 'button';
    again.className = 'debug__item debug__item--replay';
    again.setAttribute('role', 'menuitem');
    again.setAttribute('data-replay', '');
    again.innerHTML = '<b>&#8635;</b>Replay';
    el.navDebugMenu.appendChild(again);

    SCREENS.forEach(function (screen, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'debug__item';
      b.setAttribute('role', 'menuitem');
      b.setAttribute('data-screen', i);
      b.innerHTML = '<b>' + (i + 1) + '</b>' + (screen.label || 'screen');
      el.navDebugMenu.appendChild(b);
    });

    el.navDebug.addEventListener('click', function () {
      setDebugOpen(el.navDebugMenu.hidden);
    });

    el.navDebugMenu.addEventListener('click', function (e) {
      var b = e.target.closest('.debug__item');
      if (!b || b.disabled) return;
      setDebugOpen(false);
      if (b.hasAttribute('data-replay')) replay();
      else goTo(+b.getAttribute('data-screen'));
    });

    /* a tap anywhere else, or Escape, puts the list away */
    document.addEventListener('pointerdown', function (e) {
      if (!el.navDebugMenu.hidden && !e.target.closest('#nav')) setDebugOpen(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !el.navDebugMenu.hidden) setDebugOpen(false);
    });
  }

  function setDebugOpen(open) {
    el.navDebugMenu.hidden = !open;
    el.navDebug.setAttribute('aria-expanded', open ? 'true' : 'false');
    el.navDebug.classList.toggle('is-open', open);
    if (open) syncDebug();
  }

  function syncDebug() {
    if (!el.navDebugMenu) return;
    Array.prototype.forEach.call(el.navDebugMenu.children, function (b) {
      b.disabled = busy;
      b.classList.toggle('is-current', b.getAttribute('data-screen') === String(current));
    });
  }

  /* Is there a screen after this one? Asked by every NEXT button
     before it shows itself, and it is the SAME question the ">"
     arrow answers by going disabled — a screen must never offer a
     button the nav has already given up on.

     This matters most when js/pages.js has not arrived: screens 2-6
     are built from it at boot, so without it the cockpit IS the last
     screen. That is a stale cache or a bad deploy rather than a
     state the flow can fix, so the button simply stays away. */
  function canAdvance() {
    return current < SCREENS.length - 1;
  }

  /* Every NEXT button, on every screen, goes through here: by way of
     the screen's own leave-taking where it has one (a round visit's
     zoom out, leaveTo), else straight to the next. */
  function onAdvance() {
    if (busy || leaving) return Promise.resolve();
    var here = SCREENS[current];
    var next = SCREENS[current + 1];
    if (next && here.round && next.round && next.node() === here.node()) return continueTo(current + 1);
    if (here.leave) return leaveTo(current + 1);
    return goTo(current + 1);
  }

  /* On to the next visit on the same sea, with the screen left just as
     it is: no reset and no dissolve, only the lens crossing over to the
     next site (arriveFrom). `extra` is told to that visit along with
     where it comes from. Off this sea, the screen is left as NEXT
     leaves it (leaveTo). */
  function continueTo(index, extra) {
    var from = SCREENS[current];
    var to = SCREENS[index];
    if (!to || !from.round || !to.round || to.node() !== from.node()) return leaveTo(index);

    var info = { round: from.round, visit: from.visit };
    if (extra) Object.keys(extra).forEach(function (k) { info[k] = extra[k]; });

    var btn = from.round.el.advance;
    btn.classList.remove('is-in');
    btn.hidden = true;

    current = index;
    syncNav();
    return to.run({ from: info });
  }

  /* The next visit's screen put into its opening state AHEAD of the
     hand-over, while the one being left is still on and the lens is
     climbing off it: its land comes up on a screen nobody can see
     yet, and has finished coming up by the time it dissolves in.
     Never onto the screen still showing. Says whether it did, which
     is what goTo's `preset` is told. */
  function preroll(index) {
    var to = SCREENS[index];
    if (!to || to.node() === SCREENS[current].node()) return false;
    to.reset();
    return true;
  }

  /* NEXT on a round visit: the zoom out first (the screen's `leave`),
     then the dissolve at survey height onto the next visit, already
     made ready (preroll), which comes down on its own site. A jump
     made meanwhile (the nav, the debug list) takes over, and this
     gives way to it. */
  var leaving = 0;

  function leaveTo(index) {
    if (busy || leaving || index >= SCREENS.length) return Promise.resolve();
    var from = SCREENS[current];
    var id = ++runId;                      // strand what the visit had left
    leaving = id;
    var ready = preroll(index);

    return from.leave(id).then(function () {
      if (leaving !== id) return;
      leaving = 0;
      if (!live(id)) return;
      return goTo(index, { preset: ready });
    });
  }

  /* Jump to a screen: abandon whatever was running, put the target
     back to its opening state, swap, then play its sequence.
     `silent` skips the audio cut, for the scripted launch hand-off
     that is already mid-cue and should not be clipped. `preset`: the
     target was put into its opening state already (preroll), so it
     is not reset again over the top of it. */
  function goTo(index, opts) {
    opts = opts || {};
    if (busy || index === current || index < 0 || index >= SCREENS.length) {
      return Promise.resolve();
    }
    leaving = 0;

    var from = SCREENS[current];
    var to = SCREENS[index];

    /* two visits to one screen (the debug list can jump straight
       from a split round's shapes to its landing): nothing to
       dissolve to, so it goes the way a replay goes */
    if (from.node() === to.node()) return replay(index);

    busy = true;
    syncNav();

    runId++;                               // strand the running sequence
    if (!opts.silent) {
      A.stopAll();
      /* the dissolve, heard; the launch's hand-off has its glitch */
      cue('swish');
    }

    if (!opts.preset) to.reset();

    return M.swapScreens(from.node(), to.node(), 1150).then(function () {
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

  /* Play the current screen again from the top. goTo() with no swap:
     there is no other screen to dissolve to, so this one goes soft
     and out (`is-replaying`, css/style.css), is reset while it
     cannot be seen, and comes back up. `index`, when given, is
     another visit to the same screen, played in its place. */
  function replay(index) {
    if (busy) return Promise.resolve();

    if (index != null) current = index;
    var screen = SCREENS[current];
    var node = screen.node();

    busy = true;
    syncNav();

    runId++;                               // strand the running sequence
    A.stopAll();
    cue('swish');

    node.classList.add('is-replaying');

    return M.wait(520).then(function () {
      screen.reset();
      node.classList.remove('is-replaying');
      return M.wait(650);
    }).then(function () {
      busy = false;
      syncNav();
      return screen.run();
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

  /* ---------------------------------------------------------- what to load

     Read off the document rather than kept in a second list here:
     every <img> is in document.images (screens 4-8 included — they
     are built before this runs) and every painted backdrop is the
     computed background-image of a .layer or the gate, so this
     cannot drift out of step with the page. The audio comes from
     GeoAudio's own tables, the fonts from their <link rel=preload>.

     Each file's weight is its size on disk (js/manifest.js), looked
     up by its path relative to this document, decoded. */
  function relPath(u) {
    var a = new URL(u, document.baseURI);
    var base = new URL('.', document.baseURI).pathname;
    var path = a.pathname.indexOf(base) === 0
      ? a.pathname.slice(base.length)
      : a.pathname.replace(/^\//, '');
    try { return decodeURIComponent(path); } catch (e) { return path; }
  }

  function sizeOf(u) {
    var m = global.GeoManifest || {};
    return m[relPath(u)] || 0;
  }

  /* Point an <img> at the blob the gate fetched. Decoded off-screen
     first, so the swap on an image that is already showing (the
     gate's own craft) is between two decoded copies of the same
     pixels and never blinks. A blob that will not decode (a short or
     stale copy of the file) is never handed over: the element keeps
     its file URL, which is the picture it already shows. If the blob
     is refused after all, the element goes back to its file URL,
     once. */
  function swapImg(img, original, blobUrl) {
    var probe = new Image();
    probe.src = blobUrl;
    var decoded = probe.decode
      ? probe.decode().then(function () { return true; }, function () { return false; })
      : Promise.resolve(true);
    decoded.then(function (ok) {
      if (!ok) return;
      img.addEventListener('error', function onErr() {
        img.removeEventListener('error', onErr);
        if (img.src === blobUrl) img.src = original;
      });
      img.src = blobUrl;
    });
  }

  function swapBg(node, blobUrl) {
    var probe = new Image();
    probe.src = blobUrl;
    var decoded = probe.decode ? probe.decode().catch(function () {}) : Promise.resolve();
    decoded.then(function () {
      node.style.backgroundImage = 'url("' + blobUrl + '")';
    });
  }

  function imageJobs() {
    var byUrl = {};
    var order = [];

    function add(u, apply) {
      if (!u) return;
      var abs;
      try { abs = new URL(u, document.baseURI).href; } catch (e) { return; }
      if (/^(blob|data):/i.test(abs)) return;
      if (!byUrl[abs]) { byUrl[abs] = []; order.push(abs); }
      byUrl[abs].push(apply);
    }

    Array.prototype.forEach.call(document.images, function (img) {
      var src = img.currentSrc || img.src;
      add(src, function (blobUrl) { swapImg(img, src, blobUrl); });
    });

    Array.prototype.forEach.call(
      document.querySelectorAll('.layer, .gate'),
      function (node) {
        var bg = getComputedStyle(node).backgroundImage || '';
        var m = /url\((["']?)(.*?)\1\)/.exec(bg);
        if (!m || !m[2]) return;
        add(m[2], function (blobUrl) { swapBg(node, blobUrl); });
      }
    );

    return order.map(function (u) {
      var fns = byUrl[u];
      return {
        url: u,
        size: sizeOf(u),
        apply: function (blobUrl) { fns.forEach(function (f) { f(blobUrl); }); }
      };
    });
  }

  function audioJobs() {
    return A.files().map(function (f) {
      return {
        url: f.url,
        size: sizeOf(f.url),
        apply: function (blobUrl) { A.adopt(f.file, blobUrl); }
      };
    });
  }

  /* the face: fetched so it is in before the first caption,
     and counted, but left to the CSS to use — a font is applied by
     name, not by URL */
  function fontJobs() {
    return Array.prototype.map.call(
      document.querySelectorAll('link[rel="preload"][as="font"]'),
      function (l) { return { url: l.href, size: sizeOf(l.href), apply: null }; }
    );
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

  var GATE_MIN_MS = 1150;       // a warm cache must still read as a load

  /* has every asset settled? begin() will not run until it has, so
     a keyboard or scripted start waits on the same bar the click
     does — the button being `hidden` until then is the visible half
     of the same rule */
  var ready = false;

  /* js/preload.js, or a stand-in that resolves at once: without the
     fetcher the mission still starts, it just cannot promise its
     files are in */
  var LOAD = global.GeoLoad || { run: function () { return Promise.resolve(); } };

  function runGate() {
    var jobs   = imageJobs().concat(audioJobs(), fontJobs());
    var target = 0;             // where the bytes say the bar should be
    var shown  = 0;             // where the bar actually is
    var raf    = 0;
    var t0     = performance.now();
    var slow   = !M.reduced();

    function draw(p) {
      var pct = Math.round(p * 100);
      el.gateFill.style.transform = 'scaleX(' + p.toFixed(4) + ')';
      el.gatePct.textContent = pct + '%';

      var label = statusFor(p);
      if (el.gateStatus.textContent !== label) el.gateStatus.textContent = label;
    }

    /* Eased rather than stepped: on a warm cache six megabytes land
       in the same frame, and a bar that teleports to 100% reads as a
       glitch. The easing also keeps the readout moving while a slow
       file is still in flight. `target` only ever rises (GeoLoad
       promises as much), so the bar never runs backwards. */
    function tick() {
      shown += (target - shown) * 0.10;
      if (target - shown < 0.0015) shown = target;
      draw(shown);
      raf = requestAnimationFrame(tick);
    }

    function onProgress(p) {
      if (p > target) target = p;
      if (!slow) draw(target);
    }

    if (slow) raf = requestAnimationFrame(tick);
    draw(0);

    return LOAD.run(jobs, onProgress).then(function (tally) {
      target = 1;
      if (tally && tally.failed && global.console) {
        console.warn('GeoDrone: ' + tally.failed + ' asset(s) could not be ' +
                     'prefetched; the elements keep their file URLs.');
      }
      /* let the easing run the last stretch out before handing over */
      var rest = slow ? Math.max(0, GATE_MIN_MS - (performance.now() - t0)) + 520
                      : Math.max(0, 300 - (performance.now() - t0));
      return M.wait(rest);
    }).then(function () {
      if (raf) cancelAnimationFrame(raf);
      draw(1);
      return M.wait(slow ? 260 : 0);
    }).then(function () { return REEF.prepare(); }).then(revealStart);
  }

  function revealStart() {
    ready = true;
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
    if (!ready) return;                   /* the bar has not reached the end */

    el.gate.classList.add('is-gone');
    el.nav.classList.add('is-on');

    /* Once its fade is over (.7s, css/style.css) the gate is taken
       out of the layout altogether. It never comes back, and left
       in place its craft, plumes and sheen would go on animating on
       their own compositor layers under every screen for the whole
       session. */
    M.wait(900).then(function () { el.gate.hidden = true; });

    A.unlock();
    /* the mission's systems coming up, on the press that starts it */
    cue('boot');
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
    /* a control with a sound of its own -- the flight controller's
       arrows, whose burn is their sound (js/pilot.js) */
    if (hit.hasAttribute('data-quiet')) return;

    /* `keep` so goTo()'s audio cut does not eat the click of the
       very button that asked for the jump — see fireShot() */
    A.sfx('click', { volume: 0.4, keep: true });
  }

  /* And the mouse coming over a control: a tick so faint it is felt
     more than heard, once for each control entered. The mouse only --
     a finger is already pressing by the time it is "over" anything --
     and only once the mission has started, so nothing asks for sound
     before the START press has allowed it. Pressable is decided as
     for the tap: by the CSS, which keeps a dead control from ever
     being under the pointer. */
  var overHit = null;

  function onOver(e) {
    if (e.pointerType !== 'mouse' || !el.gate.classList.contains('is-gone')) return;
    var node = e.target;
    var hit = node && node.closest ? node.closest(TAPPABLE) : null;
    if (hit === overHit) return;
    overHit = hit;
    if (!hit || hit.disabled || hit.getAttribute('aria-disabled') === 'true') return;
    cue('tick');
  }

  function boot() {
    grab();

    /* first, so every timer armed below is already pausable */
    if (global.GeoLife) global.GeoLife.init();

    if (M.reduced()) document.body.classList.add('is-reduced');

    M.starfield(el.starfield, 150);
    if (el.endStars) M.starfield(el.endStars, 150);
    W.init(el.waveCanvas);
    if (C) C.init(el.cruiseCanvas, el.screenCockpit);

    /* before runGate(), so the islands and craft on screens 2-6 are
       already in document.images when the loading bar works out what
       it has to fetch */
    addRoundScreens();
    addEndScreen();
    buildDebug();

    /* and after both, because every island on every screen needs a
       shoreline built from its own silhouette */
    SEA.init(el.stage);
    /* The reef's environment replaces the shared water on every
       landing's site. */
    REEF.init(el.stage);
    /* and draws its sea through moving water (js/reef-water.js) */
    if (global.GeoReefWater) global.GeoReefWater.init(el.stage);
    /* and plays the landings as cut-scenes (js/cinematic.js,
       js/square-landing.js): built here, before runGate(), so the shots'
       art is fetched with the rest */
    if (CINEMA) CINEMA.init(el.stage);
    if (SQUARE) SQUARE.init(el.stage);

    /* every playing screen in its opening state from the off -- after
       the water is in, because the lens parks the sea's own sheets */
    SCREENS.forEach(function (screen, i) { if (i > 0) screen.reset(); });

    runGate();

    /* first, and in the capture phase, so every control below is
       audible without knowing anything about this */
    document.addEventListener('click', onTap, true);
    document.addEventListener('pointerover', onOver, true);

    el.gateBtn.addEventListener('click', begin, { once: true });
    el.launchBtn.addEventListener('click', onLaunch);

    el.navPrev.addEventListener('click', function () { goTo(current - 1); });
    el.navNext.addEventListener('click', function () { goTo(current + 1); });

    /* every round's NEXT button takes the same road as the ">" arrow:
       onAdvance, wired in addRoundScreens() */
    syncNav();

    document.body.classList.add('is-ready');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
