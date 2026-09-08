/* ============================================================
   Geo Drone — screens 4 to 8, one round per shape

   Screen 2, the survey, teaches the mission in two halves on one
   sea: its first site asks "which of these is the same SHAPE as
   the craft", and its second asks "which of these is the same
   AREA" (see buildSurvey below, and runSurvey in js/script.js).
   From screen 4 on -- there is no screen 3 any more; the landing
   moved onto the survey -- each screen is one complete round that
   asks both, for a new shape and a new area formula:

     4  square         area = side x side
     5  rectangle      area = length x width
     6  parallelogram  area = base x height
     7  trapezium      area = 1/2 x (a + b) x height
     8  rhombus        area = 1/2 x d1 x d2

   and every one of them runs the same six beats:

     identify the shape  →  filter the landing zones that match it
     →  work out the area the craft needs  →  compare the areas on
     offer  →  pick the exact match  →  land

   This file is the DATA and the MARKUP. The flow that plays it is
   runRound() in js/script.js, which is one function for all five
   screens — the difference between them lives entirely below.

   ── why the numbers are here and not in the stylesheet ─────────

   Landing is one flat shape coming down onto another (the camera
   looks straight down), so a craft is square on an island when the
   two CENTRES OF AREA line up, and it FITS when the two painted
   areas match. Both of those are properties of the artwork, not of
   the layout, so every figure below was measured off the alpha
   channel of the PNG it describes:

     land          fill %  centre of area      craft            fill %  centre of area
     Triangle       36.623  (49.94, 63.45)     Triangle ship     31.407  (49.92, 47.72)
     Square         59.110  (50.04, 50.08)     Square ship       37.389  (49.84, 37.83)
     Rectangle      28.000  (49.97, 49.93)     Rectangle ship    26.957  (49.81, 43.16)
     Parallelogram  36.281  (50.15, 49.98)     Trapezium ship    29.117  (50.26, 38.85)
     Trapezium      38.396  (49.96, 56.36)     Parallelogram sh  39.193  (49.92, 45.09)
     Rhombus        31.797  (50.00, 49.82)     Rhombus ship      21.258  (49.89, 41.49)

   A craft's fill is its HULL: the flame is masked out by colour,
   which is what reproduces the 31.407% / (49.92, 47.72) that screen
   3 was built on. Everything else — the pad sizes, the ship box,
   the fall arithmetic in plan() (js/failure.js) — is derived from
   those two columns at load, so there is one place to correct if a
   PNG is ever redrawn, and no figure is repeated anywhere it could
   drift.

   ── the two pieces of artwork that are swapped ─────────────────

   Parallelogram spaceship.png is a TRAPEZIUM: its rows widen from
   45.9% of the canvas at the top to 95.7% at the bottom.
   Trapezium spaceship.png is a PARALLELOGRAM: every row is 58.0%
   wide and they shear steadily sideways.

   The two land tiles are both correct, so the round for each shape
   is wired to the craft whose hull IS that shape, which is why the
   `craft` names below read as though they were crossed over. They
   are not: the files are. Renaming the two PNGs and swapping these
   two lines back is a safe change to make later.

   ── where the artwork still does not quite agree ─────────────

   Matched on AREA, a craft and its island are not always the same
   PROPORTIONS, because the two sets of drawings were not drawn to
   one ratio. The AREAS are exact in every case — that is what the
   lesson rests on, and it follows from the two fills alone — but a
   silhouette can still come out wider or shorter than the one it
   matches. Closing that is an artwork change, not a code one:
   forcing it here (a non-uniform squash, or scaling to a side
   instead of to the area) would make the too-small and too-large
   verdicts lie.

   The land as it now stands, painted, in per cent of its own box:

     triangle       93.2 x 78.9   ratio 1.18
     square         77.5 x 76.8   ratio 1.01
     rectangle      70.0 x 40.0   ratio 1.75
     parallelogram  96.9 x 57.0   ratio 1.70
     trapezium      95.4 x 56.6   ratio 1.69
     rhombus        69.2 x 92.6   ratio 0.75

   Those are new. The previous artwork had the rectangle at 2.14
   and the rhombus at 0.96, so the pairing each round strikes with
   its (unchanged) craft has moved: the rectangle round now agrees
   far better than it did — 1.75 against its hull's 1.82 — and the
   rhombus round is the tall one at both ends. (The rectangle read
   1.32 here until its tile was squared up: 70.0 x 53.2 was two
   percentages of a 4:3 canvas being divided as though the canvas
   were square. See the note over LAND.) Measure the hulls off the craft PNGs before trying to
   close any of the remaining gaps — the figures that used to sit
   here were read off the hull's own triangle rather than its
   painted extent, and on a craft with a nozzle below the base
   those are not the same reading.
   ============================================================ */

(function (global) {
  'use strict';

  var doc = document;

  /* ---------------------------------------------------------- the land
     One entry per shape of island, and every figure in it is read
     off that PNG's alpha channel rather than chosen: `fill` is how
     much of the canvas the painted land covers, `cx`/`cy` its centre
     of area, `outline` and `clip` the silhouette traced in the same
     box units. So the verdict outline is the actual coastline, the
     tap target is the actual land, the water's shore is built on the
     actual shore, and `label` is the point a printed number has to
     sit on to look centred.

     EVERY ONE OF THESE PNGs MUST BE SQUARE. The figures are per cent
     of the canvas, .zone and .pad are `aspect-ratio: 1`, and every
     <svg> the water draws on them — shore, laps, surf, blast — has
     `viewBox="0 0 100 100"`. A land tile that is not square renders
     at 100% x (h/w) of that box and top-aligns, so its painting ends
     up somewhere its own percentages do not describe: the coast, the
     foam and the wake all draw in the right place for the box and
     the wrong place for the land. Rectangle.png shipped 1448 x 1086
     and did exactly that — its shore sat a tenth of a box below its
     shoreline. It is now padded out to 1448 x 1448, transparently,
     with the painting untouched.

     Padding a tile does not change how big the island comes out:
     boxFor() sizes the box from `fill`, so a tile that covers less
     of its canvas simply gets a bigger box and the painted land is
     the same number of pixels either way.

     Re-measured when the six land PNGs were redrawn. The trace is a
     convex hull of the alpha mask simplified to the shape's own
     corner count; each polygon's own area agrees with the measured
     coverage to better than 1%, which is the check that it snapped
     to the real corners rather than near them.

     The land moved and the CRAFT artwork did not, so everything
     downstream of the two together — the box factors, the ship box,
     FIT_AREA — is derived at load from these figures and the CRAFT
     ones, and none of it is written down twice. */
  var LAND = {
    triangle: {
      img: 'Triangle.png', fill: 36.623, cx: 0.4994, cy: 0.6345,
      outline: 'M50 10.9L96.5 89.8L3.3 89.6z',
      clip: 'polygon(50% 10.9%, 96.5% 89.8%, 3.3% 89.6%)',
      label: [49.9, 63.4],
      adjective: 'triangular'
    },

    square: {
      img: 'Square.png', fill: 59.110, cx: 0.5004, cy: 0.5008,
      outline: 'M11.4 11.7L88.8 11.7L88.8 88.5L11.3 88.5z',
      clip: 'polygon(11.4% 11.7%, 88.8% 11.7%, 88.8% 88.5%, 11.3% 88.5%)',
      label: [50.0, 50.1],
      adjective: 'square'
    },

    rectangle: {
      img: 'Rectangle.png', fill: 28.000, cx: 0.4997, cy: 0.4993,
      outline: 'M85 30L85 70L15 70L15 30z',
      clip: 'polygon(85% 30%, 85% 70%, 15% 70%, 15% 30%)',
      label: [50.0, 49.9],
      adjective: 'rectangular'
    },

    parallelogram: {
      img: 'Parallelogram.png', fill: 36.281, cx: 0.5015, cy: 0.4998,
      outline: 'M34.5 21.5L98.5 21.5L65.7 78.5L1.6 78.4z',
      clip: 'polygon(34.5% 21.5%, 98.5% 21.5%, 65.7% 78.5%, 1.6% 78.4%)',
      label: [50.1, 50.0],
      adjective: 'parallelogram'
    },

    trapezium: {
      img: 'Trapezium.png', fill: 38.396, cx: 0.4996, cy: 0.5636,
      outline: 'M29.5 24.3L70.5 24.3L97.6 80.9L2.2 80.8z',
      clip: 'polygon(29.5% 24.3%, 70.5% 24.3%, 97.6% 80.9%, 2.2% 80.8%)',
      label: [50.0, 56.4],
      adjective: 'trapezium'
    },

    rhombus: {
      img: 'Rhombus.png', fill: 31.797, cx: 0.5000, cy: 0.4982,
      outline: 'M50 3.5L84.6 50L49.8 96.1L15.4 49.9z',
      clip: 'polygon(50% 3.5%, 84.6% 50%, 49.8% 96.1%, 15.4% 49.9%)',
      label: [50.0, 49.8],
      adjective: 'rhombus'
    }
  };

  /* The bounding box of each painted silhouette, in box units, read
     out of that shape's own clip polygon rather than written down a
     second time — the scatter below has to know how much water an
     island actually covers, and this way that figure cannot drift
     from the outline it came from. */
  Object.keys(LAND).forEach(function (key) {
    var n = LAND[key].clip.match(/-?[\d.]+(?=%)/g).map(Number);
    var xs = [], ys = [], i;
    for (i = 0; i < n.length; i += 2) { xs.push(n[i]); ys.push(n[i + 1]); }
    LAND[key].ext = [
      Math.min.apply(null, xs) / 100, Math.min.apply(null, ys) / 100,
      Math.max.apply(null, xs) / 100, Math.max.apply(null, ys) / 100
    ];
  });


  /* ---------------------------------------------------------- callouts
     The dimension overlay is drawn in PERCENT OF THE SHIP BOX: the
     <svg> is placed at -28%/-6% and sized 132%, and its viewBox is
     the same numbers, so one user unit is one percent of the box and
     every coordinate below can be read straight off the hull
     measurements. Same contract as screen 3.

     Three primitives, so a callout is described by the points it
     measures rather than by a hand-written path:

       across()  a tick-capped line and the number, measuring a
                 horizontal side
       beside()  the same, turned down the left-hand side
       perp()    the perpendicular height dropped through the shape,
                 with the little square that says it is a right
                 angle

     The line runs the measured length and stops there: no witness
     lines reaching back to the hull's corners. They put four more
     strokes across open water for no reading the number does not
     already give, and at this size they crowded the craft.        */

  /* half-length of the tick that caps each end of a dimension line */
  var CAP = 3.6;

  function path(cls, d) { return '<path class="' + cls + '" d="' + d + '" />'; }

  function num(x, y, txt) {
    return '<text class="dim__text" x="' + x + '" y="' + y + '">' + txt + '</text>';
  }

  function numDown(x, y, txt) {
    return '<text class="dim__text" x="' + x + '" y="' + y +
           '" transform="rotate(-90 ' + x + ' ' + y + ')">' + txt + '</text>';
  }

  /* o: x1, x2  the two points being measured
        y       where the dimension line goes — under the exhaust for
                a base, over the nose for a top side
        ty      the number's baseline
        tx      only when the number should not sit at the midpoint */
  function across(o) {
    return path('dim__line', 'M' + o.x1 + ' ' + o.y + 'H' + o.x2) +
           path('dim__tip', 'M' + o.x1 + ' ' + (o.y - CAP) + 'V' + (o.y + CAP) +
                            'M' + o.x2 + ' ' + (o.y - CAP) + 'V' + (o.y + CAP)) +
           num(o.tx == null ? (o.x1 + o.x2) / 2 : o.tx, o.ty, o.text);
  }

  /* o: y1, y2  the two rows being measured
        x       where the dimension line goes (negative: off to the
                left of the craft, in open water)                    */
  function beside(o) {
    return path('dim__line', 'M' + o.x + ' ' + o.y1 + 'V' + o.y2) +
           path('dim__tip', 'M' + (o.x - CAP) + ' ' + o.y1 + 'H' + (o.x + CAP) +
                            'M' + (o.x - CAP) + ' ' + o.y2 + 'H' + (o.x + CAP)) +
           numDown(o.x - 7, (o.y1 + o.y2) / 2, o.text);
  }

  function perp(x, yt, yb) {
    return path('dim__inner', 'M' + x + ' ' + yt + 'V' + yb) +
           path('dim__square', 'M' + x + ' ' + (yb - 7.4) + 'H' + (x + 7.4) + 'V' + yb);
  }


  /* ---------------------------------------------------------- the craft
     `fill` and `c` are the HULL, flame masked out. `flame` is how
     far down the exhaust reaches, in box units, off the unmasked
     alpha: a base callout goes UNDER the flame, never through it,
     which is why each one sits at a different y — and it is the
     lowest ink on the craft, so it is what has to clear the island
     row while the craft is hovering over it.                       */
  var CRAFT = {
    square: {
      img: 'Square spaceship.png', fill: 37.389, cx: 0.4984, cy: 0.3783,
      flame: 0.9091,
      alt: 'Square spaceship, each side 6 units',
      /* hull x 18.2..81.5, y 8.3..67.3 — 63.3 across by 59.0 down,
         so the drawn square is 7% wider than it is tall. Both sides
         are still called 6 units: the area is exact, the artwork is
         a little out of square. */
      dims:
        across({ x1: 18.2, x2: 81.5, y: 95, ty: 110, text: '6 units' }) +
        beside({ x: -8, y1: 8.3, y2: 67.3, text: '6 units' })
    },

    rectangle: {
      img: 'Rectangle spaceship.png', fill: 26.957, cx: 0.4981, cy: 0.4316,
      flame: 0.8780,
      alt: 'Rectangular spaceship, 10 units long and 5 units wide',
      /* hull x 14.75..84.85, y 23.92..62.36 */
      dims:
        across({ x1: 14.75, x2: 84.85, y: 92, ty: 107, text: '10 units' }) +
        beside({ x: -8, y1: 23.92, y2: 62.36, text: '5 units' })
    },

    /* the parallelogram-hulled craft — the file called Trapezium */
    parallelogram: {
      img: 'Trapezium spaceship.png', fill: 29.117, cx: 0.5026, cy: 0.3885,
      flame: 0.8804,
      alt: 'Parallelogram spaceship, base 7 units, height 6 units',
      /* top edge y 14.0 from x 35.7 to 92.7, bottom edge y 63.9 from
         x 7.3 to 64.5: every row 57.9 wide, sheared 0.58 sideways
         per unit down. The height callout is the PERPENDICULAR one —
         that is the whole point of the shape — so it is dropped
         through the middle as well as measured down the side. */
      dims:
        perp(50, 14, 63.9) +
        across({ x1: 7.3, x2: 64.5, y: 92, ty: 107, text: '7 units' }) +
        beside({ x: -8, y1: 14, y2: 63.9, text: '6 units' })
    },

    /* the trapezium-hulled craft — the file called Parallelogram */
    trapezium: {
      img: 'Parallelogram spaceship.png', fill: 39.193, cx: 0.4992, cy: 0.4509,
      flame: 0.9577,
      alt: 'Trapezium spaceship, parallel sides 5 and 10 units, height 6 units',
      /* top edge y 14.2 from x 27.2 to 72.8 (45.6 across), bottom
         edge y 69.4 from x 2.4 to 97.3 (94.9 across), 55.2 apart —
         which is 5 : 10 : 6 to within a percent, so the numbers
         printed on it are the numbers it is drawn at. */
      dims:
        perp(50, 14.2, 69.4) +
        across({ x1: 27.2, x2: 72.8, y: 9, ty: 4.5, text: '5 units' }) +
        across({ x1: 2.4, x2: 97.3, y: 100, ty: 115, text: '10 units' }) +
        beside({ x: -8, y1: 14.2, y2: 69.4, text: '6 units' })
    },

    rhombus: {
      img: 'Rhombus spaceship.png', fill: 21.258, cx: 0.4989, cy: 0.4149,
      flame: 0.9410,
      alt: 'Rhombus spaceship, diagonals 6 units and 7 units',
      /* vertices (49.9, 5.5) (79.7, 41.4) (49.9, 76.6) (20.2, 41.4).

         The short diagonal is measured ON ITSELF rather than from a
         line under the craft: this hull is only 21% of its box, so a
         box big enough to match the island's area puts anything
         drawn below the exhaust down among the islands. Tick caps
         on the two side vertices, number under the line. The long
         diagonal is dashed through the middle and measured off to
         the left in the usual way.

         The number sits off to the LEFT of centre rather than under
         the middle of the line it belongs to: dead centre puts it
         under the porthole and, worse, straight across the long
         diagonal, which then reads as two broken lines instead of
         one. Out here it is clear of both, and of the short
         diagonal above it. */
      dims:
        path('dim__inner', 'M49.9 5.5V76.6') +
        path('dim__line', 'M20.2 41.4H79.7') +
        path('dim__tip', 'M20.2 37.8V45M79.7 37.8V45') +
        num(32, 57, '6 units') +
        beside({ x: -8, y1: 5.5, y2: 76.6, text: '7 units' })
    }
  };


  /* ---------------------------------------------------------- the rounds

     `row` is the three islands of the round's own shape, left to
     right, in SQUARE UNITS. The smallest is always in the middle,
     for the reason screen 3's middle pad is the smallest one: the
     craft's base callout hangs below the hull, and only the shortest
     island leaves it room. Which side holds the answer alternates,
     so the fit is never in the same place twice.

     The wrong answers are the arithmetic slips the shape invites,
     not arbitrary numbers — the perimeter instead of the area, or
     the product of the two lengths with the half forgotten — so
     flying the craft onto one is the mistake made visible.

     `decoys` are the two shapes that are NOT the round's shape, and
     they are chosen mathematically rather than for variety: a square
     IS a rectangle, a rhombus and a parallelogram, and a rhombus IS
     a parallelogram, so none of those can ever stand as a wrong
     answer to "select the parallelograms". Every pairing below is
     one a mathematician would accept.                              */
  var ROUNDS = [
    {
      shape: 'square',
      area: 36,                       /* 6 x 6 */
      say: 'The spaceship is a square. Select all the square landing zones.',
      areaKey: 'calcArea',
      copy: {
        formula: 'AREA = SIDE × SIDE',
        tally:   'SIDE 6',
        sum:     'AREA = 6 × 6 = 36'
      },
      row: [54, 24, 36],              /* 24 is the perimeter */
      decoys: ['triangle', 'trapezium']
    },

    {
      shape: 'rectangle',
      area: 50,                       /* 10 x 5 */
      say: 'The spaceship is a rectangle. Select all the rectangular landing zones.',
      areaKey: 'findArea',
      copy: {
        formula: 'AREA = LENGTH × WIDTH',
        tally:   'LENGTH 10 · WIDTH 5',
        sum:     'AREA = 10 × 5 = 50'
      },
      row: [50, 30, 75],              /* 30 is the perimeter */
      decoys: ['trapezium', 'rhombus']
    },

    {
      shape: 'parallelogram',
      area: 42,                       /* 7 x 6 */
      say: 'The spaceship is a parallelogram. Select all the parallelogram landing zones.',
      areaKey: 'calcArea',
      copy: {
        formula: 'AREA = BASE × HEIGHT',
        tally:   'BASE 7 · HEIGHT 6',
        sum:     'AREA = 7 × 6 = 42'
      },
      row: [63, 30, 42],
      decoys: ['triangle', 'trapezium']
    },

    {
      shape: 'trapezium',
      area: 45,                       /* 1/2 x (5 + 10) x 6 */
      say: 'The spaceship is a trapezium. Select all the trapezium landing zones.',
      areaKey: 'findArea',
      copy: {
        formula: 'AREA = ½ × (A + B) × HEIGHT',
        tally:   'A 5 · B 10 · HEIGHT 6',
        sum:     'AREA = ½ × (5 + 10) × 6 = 45'
      },
      row: [45, 30, 90],              /* 90 is the half forgotten */
      decoys: ['rhombus', 'triangle']
    },

    {
      shape: 'rhombus',
      area: 21,                       /* 1/2 x 6 x 7 */
      /* this hull fills only 21% of its canvas, so the box that
         matches a 21-unit island is the tallest on any screen — it
         is hung 3% lower than the others, in css/rounds.css, to
         keep its nose clear of the narration bar */
      say: 'The spaceship is a rhombus. Select all the rhombus landing zones.',
      areaKey: 'calcArea',
      copy: {
        formula: 'AREA = ½ × D₁ × D₂',
        tally:   'D₁ 6 · D₂ 7',
        sum:     'AREA = ½ × 6 × 7 = 21'
      },
      row: [42, 14, 21],              /* 42 is the half forgotten */
      decoys: ['rectangle', 'triangle']
    }
  ];


  /* ---------------------------------------------------------- sizing

     FIT_AREA is what screen 3's 20-unit island actually covers:
     17 box units squared, of which the triangle paints 36.623%. Every
     round's own fit island is drawn to cover the SAME painted area,
     so a 36-unit square and a 20-unit triangle look like the same
     amount of ground and the series keeps one scale throughout.

     From there:
       k(area)  = kFit x sqrt(area / fit area)   — areas in true
                  proportion to the numbers printed on them
       fit      = sqrt(land fill / hull fill)    — a length ratio, so
                  the square root of two areas
       shipK    = kFit x fit                     — the box that makes
                  the PAINTED hull cover exactly the fit island

     DECOY_AREA is a bit under half the fit island: enough to read as
     an island, small enough to sit in the middle distance without
     competing with the row that carries the question.               */
  var FIT_AREA = 17 * 17 * 0.36623;      /* = 105.84 box units of land */
  var DECOY_AREA = FIT_AREA * 0.45;

  function boxFor(paintedArea, land) {
    return Math.sqrt(paintedArea / (land.fill / 100));
  }

  function round2(n) { return Math.round(n * 100) / 100; }


  /* ---------------------------------------------------------- layout
     Where each island sits is a LAYOUT question, so it lives in
     css/rounds.css against the slot classes handed out below —
     `pad--row1/2/3` for the three of the round's own shape, sitting
     in a row on one centre-of-area line exactly as screen 3's three
     do, and `pad--far1/2` for the two decoys, which sit higher up
     the frame, smaller, and wide of the craft's callouts (those
     reach 28% of the ship box out to its left). Keeping it there is
     what lets the portrait and short-screen blocks move a whole
     rank, which an inline style could not be overridden to do.

     The order they breach the water in: near, far, near, near, far,
     so the archipelago arrives scattered instead of in two batches.
     Indices into the DOM order, which is decoys-then-row so the two
     far islands paint behind the three that carry the question. */
  var REVEAL = [2, 0, 3, 4, 1];


  /* ---------------------------------------------------------- the scatter

     While the SHAPE is the question, the five islands are strewn
     about the water and shuffled every time the screen is entered.
     That is not decoration: with the round's own three always in a
     row across the front, "pick the front three" wins the shape task
     without ever looking at a shape, and the question stops being a
     question.

     The survey's first site asks that same question of that same
     five — three matches and two decoys — so it is laid out through
     the same scatter() below, on the same stations, with the same
     shuffle (see buildSurvey, and resetSurvey in js/script.js).

     Once the shape task is over the three survivors drop the scatter
     and go home to the row, which is the arrangement everything
     downstream — the craft's callouts, the HUD line, the fall
     arithmetic — was tuned against. The craft only flies in after
     that: it comes down the middle of the frame, which is water a
     scattered island can perfectly well be sitting in.

     ── the five stations ──

     Two set back and inset, three across the front. The front three
     ARE the row (the same 21/50/79 the area task uses, on the same
     --land-y), so an island that happens to be scattered onto its
     own row station simply stays where it is when the row forms.

     Their y comes off the round's own --far-y and --land-y rather
     than being written here, because the rhombus round runs to a
     smaller unit and a higher row than the other four — see
     css/rounds.css. Read, not hard-coded, so the two cannot drift.

     ── why the shuffle is sampled and not just applied ──

     The islands are sized by the areas printed on them, so they are
     not interchangeable: the trapezium round's 90-unit island is a
     third of the frame across and the rhombus round's 42-unit one is
     40% of it top to bottom, while a decoy is a third of that. Some
     permutations of five such objects across five fixed stations
     simply overlap.

     So every draw is measured before it is used, and rejected if two
     islands would touch or one would leave the water. What is left
     is genuinely random — no station is reserved for the big island,
     which is what ordering the stations by capacity would have
     amounted to — and nothing can ever be laid on top of anything
     else. If a frame is too cramped for any draw at all, the islands
     stay in the row: the shuffle is what gives, not the layout.     */

  /* the water the islands may use: clear of the narration bar above
     and the HUD line below */
  var BAND = [0.17, 0.86];
  var SIDES = 0.02;                        /* air at each edge */
  /* Islands have to CLEAR each other, not merely not intersect.
     offsetWidth is a whole number of pixels while the real box is
     fractional, so a draw accepted at exactly touching can come out
     a fraction over — and on a small frame, where the gaps are
     proportionally tight, plenty of draws sit right at that line. */
  var CLEAR = 3;
  var STATION_X = [37, 63, 21, 50, 79];    /* two behind, three across */
  var DRAWS = 200;

  function shuffled(list) {
    var a = list.slice(), i, j, t;
    for (i = a.length - 1; i > 0; i--) {
      j = Math.floor(Math.random() * (i + 1));
      t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* One island, measured: how far its painted silhouette reaches
     from its centre of area on each side — which is what has to
     fit, not the box.

     All four come off offsetWidth and not offsetHeight: the box is
     square by construction on every screen, and the width is the
     axis that is always laid out even before the artwork has
     decoded. */
  function measure(el) {
    var land = LAND[el.dataset.shape];
    var w = el.offsetWidth;
    return {
      el: el,
      cx: land.cx,
      cy: land.cy,
      w: w,
      left:  (land.cx - land.ext[0]) * w,
      right: (land.ext[2] - land.cx) * w,
      up:    (land.cy - land.ext[1]) * w,
      down:  (land.ext[3] - land.cy) * w
    };
  }

  function stationsOf(sec, W, H) {
    var cs = global.getComputedStyle(sec);
    var far = parseFloat(cs.getPropertyValue('--far-y'));
    var land = parseFloat(cs.getPropertyValue('--land-y'));
    return STATION_X.map(function (x, i) {
      return { x: W * x / 100, y: H * (i < 2 ? far : land) / 100 };
    });
  }

  function collides(list, W, H) {
    var i, j, a, b;
    for (i = 0; i < list.length; i++) {
      a = list[i];
      if (a.x - a.m.left < W * SIDES + CLEAR ||
          a.x + a.m.right > W * (1 - SIDES) - CLEAR ||
          a.y - a.m.up < H * BAND[0] + CLEAR ||
          a.y + a.m.down > H * BAND[1] - CLEAR) return true;
      for (j = i + 1; j < list.length; j++) {
        b = list[j];
        if (a.x - a.m.left - CLEAR < b.x + b.m.right &&
            b.x - b.m.left - CLEAR < a.x + a.m.right &&
            a.y - a.m.up - CLEAR < b.y + b.m.down &&
            b.y - b.m.up - CLEAR < a.y + a.m.down) return true;
      }
    }
    return false;
  }

  /* Shuffle `els` across this section's five stations and hand each
     placement to `place(el, x, y, m)`, where x/y are px within the
     section and name the point the island's CENTRE OF AREA should
     land on. `m` is that island's measurement, for a caller that
     positions by its box rather than by that centre.

     Returns the islands back to front, left to right — the order
     they should breach in, so the archipelago comes out of the
     distance instead of in document order — or null if no draw of
     five fitted, which is the caller's cue to leave them wherever
     its stylesheet put them. */
  function strew(sec, els, place) {
    var W = sec.clientWidth;
    var H = sec.clientHeight;
    if (!W || !H || !els.length) return null;

    var art = els.map(measure);
    var spots = stationsOf(sec, W, H);
    var placed = null;

    for (var t = 0; t < DRAWS && !placed; t++) {
      var draw = shuffled(art).map(function (m, i) {
        return { m: m, x: spots[i].x, y: spots[i].y };
      });
      if (!collides(draw, W, H)) placed = draw;
    }

    if (!placed) return null;

    placed.forEach(function (o) { place(o.m.el, o.x, o.y, o.m); });

    return placed.slice()
      .sort(function (a, b) { return (a.y - b.y) || (a.x - b.x); })
      .map(function (o) { return o.m.el; });
  }

  /* A round screen's islands are anchored on their centre of area
     already (see .pad in css/style.css), so the station goes
     straight into --sx/--sy as a percentage. */
  function scatter(round) {
    var pads = round.el.padList;
    var W = round.node.clientWidth || 1;
    var H = round.node.clientHeight || 1;

    var order = strew(round.node, pads, function (el, x, y) {
      el.style.setProperty('--sx', (x / W * 100).toFixed(3) + '%');
      el.style.setProperty('--sy', (y / H * 100).toFixed(3) + '%');
      el.classList.add('is-scattered');
    });

    if (order) {
      round.el.reveal = order;
      return;
    }

    /* too cramped for any draw: back to the row it was laid out at */
    pads.forEach(function (pad) { pad.classList.remove('is-scattered'); });
    round.el.reveal = REVEAL.map(function (i) { return pads[i]; });
  }

  /* ---------------------------------------------------------- dealing

     Hand `classes` out among `els` at random, dropping whichever of
     them an element is already wearing.

     This is how a station gets attached to an island rather than
     written into it: the classes carry nothing but a position, so
     dealing them again moves the islands without touching a size, a
     printed number or a `data-area`. Which matters, because the
     drawn area has to stay true to the number on it — that is the
     whole lesson — so it is the POSITION that has to be the random
     part and never the pairing.

     A class rather than an inline `--cx`, for one specific reason:
     `.pad.is-scattered` overrides `--cx` from a rule, and an inline
     property would outrank it and break the shape task's scatter. */
  function deal(els, classes) {
    var order = shuffled(classes);
    els.forEach(function (el, i) {
      classes.forEach(function (c) { el.classList.remove(c); });
      if (order[i]) el.classList.add(order[i]);
    });
  }

  var ROW_SLOTS = ['pad--row1', 'pad--row2', 'pad--row3'];

  /* A round's three matching islands, dealt across the three row
     stations. Called from the screen's reset, so every entry asks
     the area question with the answer somewhere else. */
  function dealRow(round) {
    deal(round.el.padList.filter(function (pad) {
      return pad.dataset.shape === round.shape;
    }), ROW_SLOTS);
  }

  /* The three that matched go home to the row to be compared. Their
     row positions are the ones they were laid out at, so dropping
     the scatter is the whole move — and it is the LAYOUT that
     changes, not a transform, so the landing still reads the position
     each island is really at. `left`/`top` transition in
     css/rounds.css, which is what turns the change into a glide. */
  function regroup(round) {
    round.el.padList.forEach(function (pad) {
      if (pad.dataset.shape === round.shape) pad.classList.remove('is-scattered');
    });
  }


  /* ============================================================
     THE SURVEY -- screen 2's two sites and the sea between them

     The survey is one shot over one sea, and the lens comes down on
     it twice. Each place it comes down on is a SITE: a frame-sized
     coordinate box inside the camera plate (see .site in
     css/style.css), holding five islands laid out exactly as a
     round screen lays out its five -- same stations, same --pu,
     same centre-of-area anchoring -- so the shape task and the
     landing are played on the same kind of island as every screen
     after them.

       site A   three triangles of three sizes, two other shapes.
                Strewn across the five stations on every entry,
                as a round is. The SHAPE question.
       site B   three triangles of 30, 12 and 20 square units,
                dealt across the row, and the craft. Nothing else:
                the shape question has been answered by the time
                the lens gets here, so the only islands on the
                water are the three the area question is about.
                What used to be screen 3, on the same sea as the
                shape question instead of a screen of its own.

     Site A carries all five other shapes as decoys and shows TWO
     of them, a different pair every visit: an island's shoreline
     is built from its silhouette at load (js/water.js), so
     swapping a pad's shape later would leave it wearing the wrong
     coast. Hiding three of five is the same random pair with none
     of that.

     And around and between the two sites, the ISLETS: the rest of
     the archipelago, twenty-odd small islands of every shape,
     which are what the wide shot is of. Scenery -- no shoreline,
     no tap target, no number -- and kept out of both sites'
     frames, so neither task ever has a sixth island in it.

     The site objects come back shaped like a round (the same `el`
     fields, `shape`, `area`, `copy`, `geo`), because that is what
     lets js/script.js play them through the round helpers rather
     than a second copy of them.
     ============================================================ */

  var SURVEY = {
    shape: 'triangle',
    area: 20,                        /* 1/2 x 8 x 5 */
    copy: {
      formula: 'AREA = ½ × BASE × HEIGHT',
      tally:   'BASE 8 · HEIGHT 5',
      sum:     'AREA = ½ × 8 × 5 = 20'
    },

    /* site A's three triangles are sizes, not answers: the areas
       are never printed there, they only make the three visibly
       different -- and out of step with the two decoys, which are
       drawn to the fit island's own painted area so that the
       biggest three and the smallest three are both wrong. */
    sizesA: [26, 12, 20],

    /* site B's row, as screen 3 had it: 30 too much room, 12 too
       little, 20 the fit */
    row: [30, 12, 20],

    /* every shape that is not the craft's */
    decoys: ['square', 'rectangle', 'parallelogram', 'trapezium', 'rhombus'],

    /* the islets: how many, and the range of land they cover, in
       painted box units -- between a third and two thirds of the
       fit island */
    islets: 16,
    isletArea: [FIT_AREA * 0.30, FIT_AREA * 0.66],

    /* the world the islets are strewn over, in per cent of one
       frame. Site A's frame is (0..100, 0..100); site B's is a
       frame right and 45% down (css/style.css). The lens at
       survey height (--cam-wide .32, centred between the two)
       sees about -56..256 by -84..229, so this is the part of it
       with a margin, and EXCLUDE is the two sites' frames with a
       margin of their own. */
    world: { l: -44, r: 244, t: -68, b: 214 },
    exclude: [
      { l: -8,  r: 108, t: -8, b: 108 },
      { l: 92,  r: 208, t: 37, b: 153 }
    ]
  };

  /* the shape order the islets cycle through, so all six land
     tiles are on the water however few islets fit */
  var ISLET_SHAPES = ['triangle', 'square', 'rectangle',
                      'parallelogram', 'trapezium', 'rhombus'];

  function isletHTML(shape, k) {
    var land = LAND[shape];
    return '<div class="islet" data-shape="' + shape + '"' +
                ' style="--k:' + round2(k) + ';--icx:' + land.cx + ';--icy:' + land.cy + '">' +
      '<span class="islet__wake"></span>' +
      '<span class="islet__splash"></span>' +
      '<img class="islet__img" src="assets/images/' + encodeURI(land.img) + '" alt="" />' +
    '</div>';
  }

  /* Build one site's islands into its .pads: three triangles and,
     where `decoyArea` is given, all five decoys, hidden until
     arrangeSite() shows a pair. `areas` null for a site that never
     prints a number. Decoys first in the DOM, so they paint behind
     the row that carries the question -- the same order a round is
     built in, and the order REVEAL indexes. */
  function siteHTML(sizes, areas, decoyArea) {
    var land = LAND[SURVEY.shape];
    var kFit = boxFor(FIT_AREA, land);
    var out = [];

    if (decoyArea != null) {
      SURVEY.decoys.forEach(function (shape) {
        out.push(padHTML(shape, {
          k: boxFor(decoyArea, LAND[shape]),
          slot: 'far1',
          area: null
        }));
      });
    }

    sizes.forEach(function (size, i) {
      out.push(padHTML(SURVEY.shape, {
        k: kFit * Math.sqrt(size / SURVEY.area),
        slot: 'row' + (i + 1),
        area: areas ? areas[i] : null
      }));
    });

    return out.join('');
  }

  function siteOf(node, key, offset) {
    var all = Array.prototype.slice.call(node.querySelectorAll('.pad'));
    return {
      key: key,
      node: node,
      offset: offset,
      shape: SURVEY.shape,
      area: SURVEY.area,
      copy: SURVEY.copy,
      geo: null,                         /* the triangle's: plan()'s default */
      el: {
        pads: node.querySelector('.pads'),
        all: all,
        padList: all.slice(),
        reveal: all.slice(),
        ship: node.querySelector('.ship'),
        shipCraft: node.querySelector('.ship__craft'),
        shipDims: node.querySelector('.ship__dims')
      }
    };
  }

  /* Called once, at boot, before js/water.js dresses the stage, so
     every pad built here gets its shoreline with the rest. */
  function buildSurvey(screen) {
    if (!screen) return null;

    var a = screen.querySelector('.site--a');
    var b = screen.querySelector('.site--b');
    var sea = screen.querySelector('.islets');
    if (!a || !b || !sea) return null;

    a.querySelector('.pads').innerHTML = siteHTML(SURVEY.sizesA, null, FIT_AREA);
    b.querySelector('.pads').innerHTML = siteHTML(SURVEY.row, SURVEY.row, null);

    var islets = [];
    for (var i = 0; i < SURVEY.islets; i++) {
      var shape = ISLET_SHAPES[i % ISLET_SHAPES.length];
      var area = SURVEY.isletArea[0] +
                 Math.random() * (SURVEY.isletArea[1] - SURVEY.isletArea[0]);
      islets.push(isletHTML(shape, boxFor(area, LAND[shape])));
    }
    sea.innerHTML = islets.join('');

    return {
      shape: SURVEY.shape,
      area: SURVEY.area,
      copy: SURVEY.copy,
      decoys: SURVEY.decoys.slice(),
      sites: {
        a: siteOf(a, 'a', { x: 0, y: 0 }),
        b: siteOf(b, 'b', { x: 100, y: 45 })
      },
      islets: Array.prototype.slice.call(sea.querySelectorAll('.islet'))
    };
  }

  /* Show two of a site's five decoys and hide the rest, and hand
     the pair the slots the site's layout wants them on -- the far
     rank, which is the scatter's fallback. Sets padList to the
     islands in play, decoys first. A site built without decoys
     (site B) comes out as its three triangles. */
  function arrangeSite(site, pair, slots) {
    var tris = [], shown = [];

    site.el.all.forEach(function (pad) {
      var shape = pad.dataset.shape;
      if (shape === site.shape) { tris.push(pad); return; }
      var on = pair.indexOf(shape) >= 0;
      pad.hidden = !on;
      if (on) shown.push(pad);
    });

    /* in the order the pair was drawn, so the slot deal is random
       with respect to the shape */
    shown.sort(function (p, q) {
      return pair.indexOf(p.dataset.shape) - pair.indexOf(q.dataset.shape);
    });
    site.el.all.forEach(function (pad) {
      ['pad--far1', 'pad--far2'].forEach(function (c) { pad.classList.remove(c); });
    });
    shown.forEach(function (pad, i) { if (slots[i]) pad.classList.add(slots[i]); });

    site.el.padList = shown.concat(tris);
    site.el.reveal = REVEAL.map(function (i) { return site.el.padList[i]; })
                           .filter(function (pad) { return !!pad; });
    return site.el.padList;
  }

  /* Two different decoys, drawn at random */
  function drawPair(pool) {
    var a = shuffled(pool);
    return [a[0], a[1]];
  }

  /* Strew the islets over the world, clear of the two sites and of
     each other. Rejection sampling, like the pads' own scatter: a
     spot is drawn, measured against the exclusions and against
     every islet already placed, and kept only if it is clear.
     Returns the islets back to front, the order they should
     surface in. */
  function strewIslets(cam, islets) {
    var W = cam.clientWidth || 1;
    var H = cam.clientHeight || 1;
    var world = SURVEY.world;
    var placed = [];

    function clear(x, y, rx, ry) {
      var i, e, o;
      for (i = 0; i < SURVEY.exclude.length; i++) {
        e = SURVEY.exclude[i];
        if (x + rx > e.l && x - rx < e.r && y + ry > e.t && y - ry < e.b) return false;
      }
      for (i = 0; i < placed.length; i++) {
        o = placed[i];
        if (Math.abs(x - o.x) < rx + o.rx + 4 && Math.abs(y - o.y) < ry + o.ry + 4) return false;
      }
      return true;
    }

    islets.forEach(function (el) {
      var w = el.offsetWidth || 1;
      var rx = w / W * 100 / 2;
      var ry = w / H * 100 / 2;
      var t, x, y;

      for (t = 0; t < 80; t++) {
        x = world.l + rx + Math.random() * (world.r - world.l - 2 * rx);
        y = world.t + ry + Math.random() * (world.b - world.t - 2 * ry);
        if (clear(x, y, rx, ry)) break;
      }
      if (t === 80) {
        /* nowhere clear: park it well off the visible sea */
        x = world.l - 60; y = world.t - 60;
      }

      el.style.setProperty('--wx', x.toFixed(2) + '%');
      el.style.setProperty('--wy', y.toFixed(2) + '%');
      placed.push({ x: x, y: y, rx: rx, ry: ry, el: el });
    });

    return placed.slice()
      .sort(function (a, b) { return (a.y - b.y) || (a.x - b.x); })
      .map(function (o) { return o.el; });
  }


  /* ---------------------------------------------------------- markup */

  var BADGE =
    '<span class="topbar__badge" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24">' +
        '<path d="M12 2.2c2.7 2.8 4.1 6.3 4.1 9.8v3.4H7.9V12c0-3.5 1.4-7 4.1-9.8z" />' +
        '<path d="M7.9 12.4 5.1 15.3v3.4l2.8-2M16.1 12.4l2.8 2.9v3.4l-2.8-2" />' +
        '<path d="M10.2 15.8c0 2.2.7 4.1 1.8 5.4 1.1-1.3 1.8-3.2 1.8-5.4z" />' +
        '<circle cx="12" cy="9.2" r="1.7" />' +
      '</svg>' +
    '</span>';

  /* One island. `area` is null for a decoy: it never gets as far as
     the arithmetic, so it is never given a number to print. */
  function padHTML(shape, o) {
    var land = LAND[shape];

    var vars = [
      '--k:' + round2(o.k),
      '--pcx:' + land.cx,
      '--pcy:' + land.cy,
      '--ax:' + land.label[0] + '%',
      '--ay:' + land.label[1] + '%',
      '--clip:' + land.clip
    ].join(';');

    var name = land.adjective + ' landing zone';

    return '<div class="pad pad--' + o.slot + '" data-shape="' + shape + '"' +
                ' data-name="' + land.adjective + '"' +
                (o.area == null ? '' : ' data-area="' + o.area + '"') +
                ' style="' + vars + '">' +
      '<img class="pad__img" src="assets/images/' + encodeURI(land.img) + '" alt="" />' +
      '<svg class="pad__fit" viewBox="0 0 100 100" aria-hidden="true">' +
        '<path d="' + land.outline + '" />' +
      '</svg>' +
      (o.area == null ? ''
        : '<p class="pad__area"><b>' + o.area + '</b><i>sq units</i></p>') +
      '<button class="pad__hit" type="button" tabindex="-1" aria-label="' + name + '"></button>' +
    '</div>';
  }

  function sectionHTML(round) {
    var land = LAND[round.shape];
    var craft = CRAFT[round.shape];

    var kFit = boxFor(FIT_AREA, land);
    var fit = Math.sqrt(land.fill / craft.fill);

    var pads = [];

    /* decoys first, so they paint behind the row that matters */
    round.decoys.forEach(function (shape, i) {
      pads.push(padHTML(shape, {
        k: boxFor(DECOY_AREA, LAND[shape]),
        slot: 'far' + (i + 1),
        area: null
      }));
    });

    round.row.forEach(function (area, i) {
      pads.push(padHTML(round.shape, {
        k: kFit * Math.sqrt(area / round.area),
        slot: 'row' + (i + 1),
        area: area
      }));
    });

    var vars = [
      '--ship-k:' + round2(kFit * fit),
      '--scx:' + craft.cx,
      '--scy:' + craft.cy
    ].join(';');

    return '<section class="screen screen--round" data-shape="' + round.shape +
                   '" style="' + vars + '">' +

      '<div class="layer layer--bg s3-bg" aria-hidden="true"></div>' +

      /* .ship__cast and .ship__wash are not written here: js/water.js
         inserts them at the front of .ship, and css/failure.css
         animates the cast one as the landing shadow. .ship__dust is
         the touchdown puff, and .engine-flame is off unless the
         craft artwork has no exhaust painted on it — see block 2 of
         css/failure.css. */
      '<div class="ship">' +
        '<span class="ship__dust" aria-hidden="true"></span>' +
        '<div class="ship__craft">' +
          '<img class="ship__img" src="assets/images/' + encodeURI(craft.img) +
               '" alt="' + craft.alt + '" />' +
          '<span class="engine-flame" aria-hidden="true"></span>' +
          '<svg class="ship__dims" viewBox="-28 -6 132 132" aria-hidden="true">' +
            craft.dims +
          '</svg>' +
        '</div>' +
      '</div>' +

      '<div class="pads">' + pads.join('') + '</div>' +

      /* The landing's effect layers, one either side of the craft:
         the back one (z 3) holds the scorch mark the wreck lies on
         and half the spray, the front one (z 6) the rest. Between
         them sits the water overlay (z 5), which is painted OVER a
         sinking craft so it goes under something rather than
         fading out. All three are filled by js/failure.js. */
      '<div class="fx-layer fx-layer--back" aria-hidden="true"></div>' +
      '<div class="water-depth-overlay" aria-hidden="true"></div>' +
      '<div class="fx-layer fx-layer--front" aria-hidden="true"></div>' +

      '<div class="confetti" aria-hidden="true"></div>' +

      '<div class="hud">' +
        '<p class="hud__caption" role="status" aria-live="polite"></p>' +
        '<p class="hud__tally" role="status" aria-live="polite"></p>' +
      '</div>' +

      '<header class="topbar">' +
        '<div class="topbar__frame">' + BADGE +
          '<p class="topbar__text" role="status" aria-live="polite"></p>' +
        '</div>' +
      '</header>' +

      '<div class="advance">' +
        '<button class="advance__btn" type="button" hidden>' +
          '<span class="advance__label">NEXT</span>' +
          '<svg class="advance__arrow" viewBox="0 0 24 24" aria-hidden="true">' +
            '<path d="m9 5 7 7-7 7" /></svg>' +
        '</button>' +
      '</div>' +

    '</section>';
  }


  /* ---------------------------------------------------------- build
     Called once, at load, from the bottom of the document — so the
     islands and the craft are in `document.images` before the start
     gate counts what it has to wait for, and the round screens are
     covered by the loading bar like everything else.

     Each round comes back with its elements already looked up (there
     are no ids on these screens: five copies of one screen cannot
     each own an id, and the flow is handed the round it is playing
     anyway) and with the four figures the landing's plan() needs.  */
  function build(stage, before) {
    if (!stage) return [];

    return ROUNDS.map(function (round) {
      var host = doc.createElement('div');
      host.innerHTML = sectionHTML(round);

      var node = host.firstChild;
      stage.insertBefore(node, before || null);

      var land = LAND[round.shape];
      var craft = CRAFT[round.shape];
      var pads = Array.prototype.slice.call(node.querySelectorAll('.pad'));

      round.node = node;
      round.el = {
        ship: node.querySelector('.ship'),
        shipCraft: node.querySelector('.ship__craft'),
        shipDims: node.querySelector('.ship__dims'),
        pads: node.querySelector('.pads'),
        padList: pads,
        /* the order they surface in, near and far alternating */
        reveal: REVEAL.map(function (i) { return pads[i]; }),
        confetti: node.querySelector('.confetti'),
        hud: node.querySelector('.hud'),
        caption: node.querySelector('.hud__caption'),
        tally: node.querySelector('.hud__tally'),
        topbar: node.querySelector('.topbar'),
        topbarText: node.querySelector('.topbar__text'),
        advance: node.querySelector('.advance__btn')
      };

      /* what the fall arithmetic in js/animation.js runs on */
      round.geo = {
        shipCX: craft.cx, shipCY: craft.cy,
        padCX: land.cx, padCY: land.cy,
        fit: Math.sqrt(land.fill / craft.fill)
      };

      return round;
    });
  }

  global.GeoPages = {
    build: build, scatter: scatter, regroup: regroup,
    deal: deal, dealRow: dealRow,
    buildSurvey: buildSurvey, arrangeSite: arrangeSite,
    drawPair: drawPair, strewIslets: strewIslets,
    rounds: ROUNDS, survey: SURVEY, land: LAND, craft: CRAFT
  };
})(window);
