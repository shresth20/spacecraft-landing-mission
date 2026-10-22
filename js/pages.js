/* ============================================================
   Geo Drone — the round screens, one per shape

   Every playing screen is one continuous camera shot over one sea,
   and every round brings the lens down on it twice: on SITE A for
   "which of these is the same SHAPE as the craft", and on SITE B
   for "which of these is the same AREA". The square's round is the
   first, and opens behind the drone's dark-and-scan opening
   (`intro`); every other opens straight onto the water:

     2  square         area = side x side          (with the opening)
     3  rectangle      area = length x width
     4  parallelogram  area = base x height
     5  trapezium      area = 1/2 x (a + b) x height
     6  rhombus        area = 1/2 x d1 x d2

   (the triangle was taken out of the mission on 2026-10-21: its
   round, and its island from the shape question). Every one of them plays
   the square's landing: the reef sea, the flown craft, GO, and the
   landing or the crash as a close-up cut-scene (js/square-landing.js,
   js/square-crash.js) -- see `reef` and `cinema` on the rounds.

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
     Square         59.110  (50.04, 50.08)     Square craft      37.943  (49.97, 50.02)
     Rectangle      39.870  (49.90, 50.13)     Rectangle craft   22.469  (50.00, 49.99)
     Parallelogram  33.706  (49.83, 47.61)     Parallelogram cr  16.233  (50.17, 50.03)
     Trapezium      41.420  (49.97, 49.29)     Trapezium craft   17.507  (50.03, 52.26)
     Rhombus        31.226  (49.94, 48.61)     Rhombus craft     17.124  (50.03, 50.35)

   The four shaped tiles were redrawn on 2026-10-21 as slabs of rock
   seen from above (assets/images/new, cut and measured by
   tools/build_lands.py); the square's is as it was.

   Every craft is the bare hull -- no nozzle and no exhaust painted
   on, since every landing is flown and the nozzles are built round
   it -- so a craft's fill is all hull (tools/build_crafts.py).
   Everything else — the pad sizes, the ship box, the fall
   arithmetic in plan() (js/failure.js) — is derived from those two
   columns at load, so there is one place to correct if a PNG is
   ever redrawn, and no figure is repeated anywhere it could drift.

   ── the crafts' names ────────────────────────────────────────

   Two source drawings of the bare crafts in assets/images/new are
   misnamed (parallelogram is a trapezium and the other way round);
   the "<shape>-craft.webp" files are named after what each one IS, so
   nothing here is crossed over any more.

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

   The land and the hulls as they now stand, painted, in per cent of
   their own boxes:

     land           extent        ratio      hull           ratio
     square         77.5 x 76.8   1.01       64.0 x 59.6    1.07
     rectangle      80.6 x 50.2   1.61       64.0 x 35.2    1.82
     parallelogram  90.1 x 57.2   1.58       65.0 x 37.4    1.74
     trapezium      99.3 x 58.0   1.71       64.7 x 36.9    1.75
     rhombus        71.6 x 88.0   0.81       53.3 x 64.5    0.83

   Close enough everywhere that the hull covers most of the island
   that fits when the two centres are lined up, which is what lets
   the lock-on in js/pilot.js ask for four-fifths of it.
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
     the wrong place for the land. (rectangle.webp once shipped
     1448 x 1086 and did exactly that.)

     Padding a tile does not change how big the island comes out:
     boxFor() sizes the box from `fill`, so a tile that covers less
     of its canvas simply gets a bigger box and the painted land is
     the same number of pixels either way.

     The trace is a convex hull of the alpha mask simplified to the
     shape's own corner count, each side refitted through its middle
     (tools/build_lands.py). The four shaped tiles are slabs with a
     visible edge along the bottom, so their trace takes that edge in
     with the top: a strip a hundredth of the box deep, the same on
     all three islands of a round, so the areas stay in proportion.

     The land moved and the CRAFT artwork did not, so everything
     downstream of the two together — the box factors, the ship box,
     FIT_AREA — is derived at load from these figures and the CRAFT
     ones, and none of it is written down twice. */
  var LAND = {
    square: {
      img: 'square.webp', fill: 59.110, cx: 0.5004, cy: 0.5008,
      outline: 'M11.4 11.7L88.8 11.7L88.8 88.5L11.3 88.5z',
      clip: 'polygon(11.4% 11.7%, 88.8% 11.7%, 88.8% 88.5%, 11.3% 88.5%)',
      label: [50.0, 50.1],
      adjective: 'square'
    },

    rectangle: {
      img: 'rectangle.webp', fill: 39.870, cx: 0.4990, cy: 0.5013,
      outline: 'M9.8 25.1L90.1 25.1L90 75.1L9.5 75.3z',
      clip: 'polygon(9.8% 25.1%, 90.1% 25.1%, 90% 75.1%, 9.5% 75.3%)',
      label: [49.9, 50.2],
      adjective: 'rectangular'
    },

    parallelogram: {
      img: 'parallelogram.webp', fill: 33.706, cx: 0.4983, cy: 0.4761,
      outline: 'M94.6 19L64.8 76.1L4.5 76.2L35.5 19z',
      clip: 'polygon(94.6% 19%, 64.8% 76.1%, 4.5% 76.2%, 35.5% 19%)',
      label: [49.8, 47.6],
      adjective: 'parallelogram'
    },

    trapezium: {
      img: 'trapezium.webp', fill: 41.420, cx: 0.4997, cy: 0.4929,
      outline: 'M72.5 16.7L99.6 74.7L0.3 74.7L27.7 16.7z',
      clip: 'polygon(72.5% 16.7%, 99.6% 74.7%, 0.3% 74.7%, 27.7% 16.7%)',
      label: [50.0, 45.7],
      adjective: 'trapezium'
    },

    rhombus: {
      img: 'rhombus.webp', fill: 31.226, cx: 0.4994, cy: 0.4861,
      outline: 'M49.9 5L85.7 47.8L49.9 93L14.1 47.9z',
      clip: 'polygon(49.9% 5%, 85.7% 47.8%, 49.9% 93%, 14.1% 47.9%)',
      label: [49.9, 48.4],
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

  /* o: a, b     the two corners of a SLANTED side, a the lower one
        off      how far the dimension line stands off the side, to
                 the left of the way from a to b (so, with a the
                 lower corner, outward on a left-hand side and inward
                 on a right-hand one -- give it a negative value there)
        text     the number, set along the line and reading upward
     The same tick-capped line as across() and beside(), turned to
     the side's own angle, for a parallelogram's slant side and a
     rhombus's side -- the one length neither of the others can
     measure. */
  function along(o) {
    var dx = o.b[0] - o.a[0], dy = o.b[1] - o.a[1];
    var len = Math.hypot(dx, dy) || 1;
    var ux = dx / len, uy = dy / len;         /* along the side */
    var nx = uy, ny = -ux;                    /* to its left */
    var off = o.off == null ? 9 : o.off;
    var p = function (x, y) { return r1(x) + ' ' + r1(y); };
    var a = [o.a[0] + nx * off, o.a[1] + ny * off];
    var b = [o.b[0] + nx * off, o.b[1] + ny * off];
    /* the number along the line, never upside down, and outside it:
       its glyphs stand up off the baseline, so where the baseline
       goes depends on which way that "up" turns out to point */
    var deg = Math.atan2(uy, ux) * 180 / Math.PI;
    if (deg > 90) deg -= 180; else if (deg < -90) deg += 180;
    var rad = deg * Math.PI / 180;
    var upx = Math.sin(rad), upy = -Math.cos(rad);
    var ox = off < 0 ? -nx : nx, oy = off < 0 ? -ny : ny;     /* away from the hull */
    var gap = upx * ox + upy * oy > 0 ? 4 : 9.5;
    var tx = (a[0] + b[0]) / 2 + ox * gap;
    var ty = (a[1] + b[1]) / 2 + oy * gap;
    return path('dim__line', 'M' + p(a[0], a[1]) + 'L' + p(b[0], b[1])) +
           path('dim__tip', 'M' + p(a[0] - nx * CAP, a[1] - ny * CAP) + 'L' + p(a[0] + nx * CAP, a[1] + ny * CAP) +
                            'M' + p(b[0] - nx * CAP, b[1] - ny * CAP) + 'L' + p(b[0] + nx * CAP, b[1] + ny * CAP)) +
           '<text class="dim__text" x="' + r1(tx) + '" y="' + r1(ty) +
           '" transform="rotate(' + r1(deg) + ' ' + r1(tx) + ' ' + r1(ty) + ')">' + o.text + '</text>';
  }

  function r1(n) { return Math.round(n * 10) / 10; }


  /* ---------------------------------------------------------- the craft

     Every craft is flown by hand (`pilot` on every round, and
     js/pilot.js), so every one is drawn BARE: the hull alone, no
     nozzle and no painted exhaust, keyed off a black ground and
     centred on its canvas with its longer side at 64% of it. The
     four nozzles and their burns are built round it (thrustersHTML).
     The square was cut by hand; the other five by
     tools/build_crafts.py, which prints every figure below off the
     file's own alpha channel and agrees with the square's to the
     tenth.

       fill, cx, cy  the hull: how much of the canvas it covers, and
                     its centre of area
       hull          its painted extent, l t r b, per cent -- what the
                     craft is kept on screen by (js/pilot.js)
       poly          its corners, per cent: what the lock-on measures
                     how much of an island the hull covers against.
                     The extent alone would not do: it is half again
                     a pointed hull's area, and on the parallelogram
                     round it covers the 63-unit island so badly that
                     it could never be landed on
       nozzle        how wide the bell is, per cent of the box. The
                     boxes are sized to make every hull the same
                     painted area, so this is the square's 21% scaled
                     by the root of the fills -- every round's bell is
                     the same size on screen
       noz           where each nozzle is hung, t r b l: on the line
                     through the centre of area, at the coast, and
                     moved in until there is metal across the whole of
                     the bell's flange -- so on a point (the rhombus's
                     four) it is bolted on rather
                     than left hanging beside it. Without it (the
                     square) a nozzle is hung at the middle of each
                     side of `hull`, which on a square is the same

     Two of the source drawings in assets/images/new are misnamed
     ("parallelogram-craft.png" is a trapezium and the other way
     round); the files here are named after what they ARE.

     Each pair of callouts stands just off the hull, 8 units out, to
     the left and underneath. They need not clear where a nozzle runs
     out to: they are only up while the craft is settled with every
     nozzle stowed (`is-flying` takes them off, css/pilot.css). */
  var CRAFT = {
    /* hull x 18.0..82.0, y 20.2..79.8 — 64.0 across by 59.6 down, so
       the drawn square is still 7% wider than it is tall. Both sides
       are still called 5 units: the area is exact, the artwork is a
       little out of square. */
    square: {
      img: 'square-craft.webp', fill: 37.943, cx: 0.4997, cy: 0.5002,
      hull: [18.0, 20.2, 82.0, 79.8],
      alt: 'Square spaceship, each side 5 units',
      dims:
        across({ x1: 18.0, x2: 82.0, y: 88, ty: 102, text: '5 units' }) +
        beside({ x: 10, y1: 20.2, y2: 79.8, text: '5 units' })
    },

    /* hull x 18.0..82.0, y 32.4..67.6: 1.82 to 1, the 2 to 1 of its
       numbers drawn a little short */
    rectangle: {
      img: 'rectangle-craft.webp', fill: 22.469, cx: 0.5000, cy: 0.4999,
      hull: [18.0, 32.4, 82.0, 67.6],
      poly: [[81.9, 67.5], [18.0, 67.5], [18.0, 32.4], [81.9, 32.4]],
      nozzle: 16.2,
      noz: { t: [50.0, 32.4], r: [82.0, 50.0], b: [50.0, 67.6], l: [18.0, 50.0] },
      alt: 'Rectangular spaceship, 8 units long and 4 units wide',
      dims:
        across({ x1: 18.0, x2: 82.0, y: 76, ty: 90, text: '8 units' }) +
        beside({ x: 10, y1: 32.4, y2: 67.6, text: '4 units' })
    },

    /* Top edge y 31.2 from x 39.3 to 82.5, bottom edge y 68.6 from
       x 17.5 to 61.1: every row 43.4 wide, sheared 0.58 sideways per
       unit down. The height callout is the PERPENDICULAR one — that
       is the whole point of the shape — so it is dropped through the
       middle as well as measured down the side. The slant side is
       measured on the right-hand one, standing just off it. */
    parallelogram: {
      img: 'parallelogram-craft.webp', fill: 16.233, cx: 0.5017, cy: 0.5003,
      hull: [18.0, 31.2, 82.0, 68.8],
      poly: [[82.5, 31.2], [61.1, 68.6], [17.5, 68.6], [39.3, 31.3]],
      nozzle: 13.7,
      noz: { t: [50.2, 31.2], r: [69.9, 50.0], b: [50.2, 68.8], l: [30.5, 50.0] },
      alt: 'Parallelogram spaceship, base 7 units, height 5 units, slant side 6 units',
      dims:
        perp(50, 31.2, 68.6) +
        across({ x1: 17.5, x2: 61.1, y: 77, ty: 91, text: '7 units' }) +
        beside({ x: 10, y1: 31.2, y2: 68.6, text: '5 units' }) +
        along({ a: [61.1, 68.6], b: [82.5, 31.2], off: -9, text: '6 units' })
    },

    /* Top edge y 31.5 from x 35.0 to 65.1 (30.1 across), bottom edge
       y 68.4 from x 17.6 to 82.3 (64.7 across), 36.9 apart — 8 : 17.2
       : 9.8 against its numbers' 8 : 12 : 5. The short side's callout
       goes over the top. */
    trapezium: {
      img: 'trapezium-craft.webp', fill: 17.507, cx: 0.5003, cy: 0.5226,
      hull: [18.0, 31.5, 82.0, 68.5],
      poly: [[82.3, 68.4], [17.6, 68.4], [35.0, 31.5], [65.1, 31.5]],
      nozzle: 14.3,
      noz: { t: [50.0, 31.5], r: [73.0, 52.3], b: [50.0, 68.5], l: [27.0, 52.3] },
      alt: 'Trapezium spaceship, parallel sides 8 and 12 units, height 5 units',
      dims:
        perp(50, 31.5, 68.4) +
        across({ x1: 35.0, x2: 65.1, y: 24, ty: 19.5, text: '8 units' }) +
        across({ x1: 17.6, x2: 82.3, y: 77, ty: 91, text: '12 units' }) +
        beside({ x: 10, y1: 31.5, y2: 68.4, text: '5 units' })
    },

    /* Vertices (50.1, 17.7) (76.6, 50.9) (50.0, 82.2) (23.3, 50.8).

       The short diagonal is measured ON ITSELF rather than from a
       line under the craft: tick caps on the two side vertices,
       number under the line. The long diagonal is dashed through the
       middle and measured off to the left in the usual way.

       The number sits off to the LEFT of centre rather than under
       the middle of the line it belongs to: dead centre puts it
       under the porthole and, worse, straight across the long
       diagonal, which then reads as two broken lines instead of
       one. */
    rhombus: {
      img: 'rhombus-craft.webp', fill: 17.124, cx: 0.5003, cy: 0.5035,
      hull: [23.4, 18.0, 76.6, 82.0],
      poly: [[50.1, 17.7], [76.6, 50.9], [50.0, 82.2], [23.3, 50.8]],
      nozzle: 14.1,
      noz: { t: [50.0, 22.2], r: [73.4, 50.4], b: [50.0, 78.1], l: [26.6, 50.4] },
      alt: 'Rhombus spaceship, diagonals 6 units and 8 units, each side 5 units',
      dims:
        path('dim__inner', 'M50 17.7V82.2') +
        path('dim__line', 'M23.3 50.8H76.6') +
        path('dim__tip', 'M23.3 47.2V54.4M76.6 47.2V54.4') +
        num(35, 66.5, '6 units') +
        beside({ x: 15, y1: 17.7, y2: 82.2, text: '8 units' }) +
        /* the side: the upper right one, standing just off it */
        along({ a: [76.6, 50.9], b: [50.1, 17.7], off: -9, text: '5 units' })
    }
  };


  /* ---------------------------------------------------------- the rounds

     `row` is the three islands of the round's own shape, left to
     right, in SQUARE UNITS: too big, too small, the fit. The
     smallest is always in the middle, for the reason screen 3's
     middle pad is the smallest one: the craft's base callout hangs
     below the hull, and only the shortest island leaves it room.
     Which side holds the answer alternates, so the fit is never in
     the same place twice.

     The wrong answers are the arithmetic slips the shape invites,
     not arbitrary numbers — the perimeter instead of the area, or
     the product of the two lengths with the half forgotten — so
     flying the craft onto one is the mistake made visible.

     `decoyPool` is every shape that is NOT the round's shape, and
     two of them are drawn at random on every visit (see arrangeSite
     below). The pools are cut mathematically rather than for
     variety: a square IS a rectangle, a rhombus and a parallelogram,
     and a rhombus IS a parallelogram, so none of those can ever
     stand as a wrong answer to "select the parallelograms". A
     trapezium is read the way the mission draws it -- exactly one
     pair of parallel sides -- so every other shape is a fair wrong
     answer to it. Every pool below is one a mathematician would
     accept.                                                        */
  var ROUNDS = [
    /* The first round opens behind the drone's dark-and-scan opening
       (`intro`): the dark, the bezel, the scan that finds the
       archipelago, then the shape question on site A, the lens's
       crossing to site B and the landing, as on every other round.

       Every landing is FLOWN (`pilot`): the craft hovers in the
       middle of the frame, its three islands are strewn round it
       (strewPilot below), and the player brings it over the one they
       want with the controller -- three hearts for three wrong
       landings, and the autopilot after that. See js/pilot.js. On a
       full round that is site B only: the shape question on site A
       is still a tap.

       Every landing's sea is the REEF (`reef`): the square's ocean,
       rocks under the water, and each island stood in it as a slab of
       rock with small dry rocks round it. See js/reef.js. On a full
       round that is site B's sea; site A's islands stand on the same
       ocean with the shoreline js/water.js draws them.

       And every landing is played as a cut-scene (`cinema`): GO zooms
       the lens onto the island and cuts to the landing seen from the
       angle, the shape's own craft and island drawn live
       (js/square-landing.js, js/square-crash.js, art from
       tools/build_landings.py). A shape whose angle art is not in yet
       lands from overhead instead, as it always did.

       The areas, in square units, are the numbers the dimensions
       give: `row` is the island too big, the island too small and
       the one that fits, in that order (see below). */
    {
      shape: 'square',
      intro: true,
      pilot: true,
      reef: true,
      cinema: true,
      area: 25,                       /* 5 x 5 */
      say: 'The spaceship is a square. Select all the square landing zones.',
      areaKey: 'calcArea',
      row: [30, 20, 25],              /* 20 is the perimeter */
      decoyPool: ['rectangle', 'parallelogram', 'trapezium', 'rhombus']
    },

    {
      shape: 'rectangle',
      pilot: true,
      reef: true,
      cinema: true,
      area: 32,                       /* 8 x 4 */
      say: 'The spaceship is a rectangle. Select all the rectangular landing zones.',
      areaKey: 'findArea',
      row: [40, 24, 32],              /* 24 is the perimeter */
      decoyPool: ['parallelogram', 'trapezium', 'rhombus']   /* a square IS a rectangle */
    },

    {
      shape: 'parallelogram',
      pilot: true,
      reef: true,
      cinema: true,
      area: 35,                       /* base 7 x height 5 */
      say: 'The spaceship is a parallelogram. Select all the parallelogram landing zones.',
      areaKey: 'calcArea',
      row: [42, 26, 35],              /* 42 is base x slant side; 26 the perimeter */
      /* Strictly, squares, rectangles and rhombi ARE parallelograms;
         with the triangle gone the trapezium is the only shape that is
         not, and a pair is needed. The rectangle stands in: as the
         mission draws them -- the parallelogram always slanted, the
         rectangle always square-cornered -- it reads as a different
         shape, and it is the one of the three furthest from the slant. */
      decoyPool: ['trapezium', 'rectangle']
    },

    {
      shape: 'trapezium',
      pilot: true,
      reef: true,
      cinema: true,
      area: 50,                       /* 1/2 x (8 + 12) x 5 */
      say: 'The spaceship is a trapezium. Select all the trapezium landing zones.',
      areaKey: 'findArea',
      row: [60, 40, 50],              /* 60 is 12 x 5; 40 is 8 x 5 */
      decoyPool: ['square', 'rectangle', 'parallelogram', 'rhombus']
    },

    {
      shape: 'rhombus',
      pilot: true,
      reef: true,
      cinema: true,
      area: 24,                       /* 1/2 x 6 x 8 */
      /* the tall one at both ends: drawn to a smaller unit than the
         others, in css/rounds.css */
      say: 'The spaceship is a rhombus. Select all the rhombus landing zones.',
      areaKey: 'calcArea',
      row: [30, 20, 24],              /* 30 is side x short diagonal; 20 the perimeter */
      decoyPool: ['rectangle', 'parallelogram', 'trapezium']   /* a square IS a rhombus */
    }
  ];

  /* Site A's three islands of the round's own shape are SIZES, not
     answers -- the areas are never printed there -- and these are
     the sizes, as multiples of the round's area: visibly three
     different islands, and out of step with the two decoys, which
     are drawn to the fit island's own painted area so that neither
     the biggest three nor the smallest three are the answer. */
  var SIZES_A = [1.3, 0.6, 1.0];


  /* ---------------------------------------------------------- sizing

     FIT_AREA is a fixed amount of painted land: what the mission's
     first fit island (a 20-unit triangle, since taken out) covered,
     17 box units squared at a fill of 36.623%. Every round's own fit
     island is drawn to cover that SAME painted area, so a 25-unit
     square and a 50-unit trapezium look like the same amount of
     ground and the series keeps one scale throughout.

     From there:
       k(area)  = kFit x sqrt(area / fit area)   — areas in true
                  proportion to the numbers printed on them
       fit      = sqrt(land fill / hull fill)    — a length ratio, so
                  the square root of two areas
       shipK    = kFit x fit                     — the box that makes
                  the PAINTED hull cover exactly the fit island */
  var FIT_AREA = 17 * 17 * 0.36623;      /* = 105.84 box units of land */

  function boxFor(paintedArea, land) {
    return Math.sqrt(paintedArea / (land.fill / 100));
  }

  function round2(n) { return Math.round(n * 100) / 100; }


  /* ---------------------------------------------------------- layout
     Where each island sits is a LAYOUT question, so it lives in
     css/rounds.css against the slot classes handed out below —
     `pad--row1/2/3` for the three of the round's own shape, sitting
     in a row on one centre-of-area line, and `pad--far1/2` for the
     two decoys on site A, which sit higher up the frame. Keeping it
     there is what lets the portrait and short-screen blocks move a
     whole rank, which an inline style could not be overridden to do.

     Site A's five are then strewn across those five stations on
     every visit (scatter below); site B's three stay in the row. */


  /* ---------------------------------------------------------- the scatter

     While the SHAPE is the question, the five islands are strewn
     about the water and shuffled every time the screen is entered.
     That is not decoration: with the round's own three always in a
     row across the front, "pick the front three" wins the shape task
     without ever looking at a shape, and the question stops being a
     question.

     The first round's site A asks it behind the drone's opening, of
     the same five -- three matches and two decoys -- laid out through
     the same scatter() below, on the same stations, with the same
     shuffle (see resetRound in js/script.js).

     The area question is asked somewhere else entirely: site B, a
     frame away, where the three islands of the round's shape stand
     in the row everything downstream — the craft's callouts, the
     HUD line, the fall arithmetic — was tuned against, and nothing
     else stands at all. The craft comes down the middle of that
     frame, which is water by construction.

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

  /* `gap` is the water two islands must keep between them -- CLEAR
     unless a caller wants more */
  function collides(list, W, H, gap) {
    var i, j, a, b;
    if (gap == null) gap = CLEAR;
    for (i = 0; i < list.length; i++) {
      a = list[i];
      if (a.x - a.m.left < W * SIDES + CLEAR ||
          a.x + a.m.right > W * (1 - SIDES) - CLEAR ||
          a.y - a.m.up < H * BAND[0] + CLEAR ||
          a.y + a.m.down > H * BAND[1] - CLEAR) return true;
      for (j = i + 1; j < list.length; j++) {
        b = list[j];
        if (a.x - a.m.left - gap < b.x + b.m.right &&
            b.x - b.m.left - gap < a.x + a.m.right &&
            a.y - a.m.up - gap < b.y + b.m.down &&
            b.y - b.m.up - gap < a.y + a.m.down) return true;
      }
    }
    return false;
  }

  /* Shuffle `els` across this section's five stations and hand each
     placement to `place(el, x, y, m)`, where x/y are px within the
     section and name the point the island's CENTRE OF AREA should
     land on. `m` is that island's measurement, for a caller that
     positions by its box rather than by that centre.

     Returns the placements, or null if no draw of five fitted,
     which is the caller's cue to leave them wherever its
     stylesheet put them. */
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

    return placed;
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

    if (order) return;

    /* too cramped for any draw: back to the row it was laid out at */
    pads.forEach(function (pad) { pad.classList.remove('is-scattered'); });
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

  /* ---------------------------------------------------------- the pilot's sea

     On a FLOWN landing (`pilot`) the craft hovers in the middle of
     the frame and the player takes it to an island, so the row is
     the wrong picture: three islands lined up under the craft are
     three islands it can drop straight onto. They are strewn round
     it instead, a different way on every entry.

     Eight spots ring the craft -- two either side, two above, two
     below -- and a draw takes three of them, each nudged up to
     PILOT_JITTER either way so no two visits look laid out on one
     grid. A draw is kept only if:

       · every island is clear of the others by PILOT_GAP, so there
         is always water to fly between them
       · none of them is under the craft's hover point, which is
         where it comes in and where it comes back to after a miss
         -- the craft must start, and restart, over open sea
       · none is under the controller or the hearts, the two pieces
         of the frame the player is watching while they fly
       · they are not all on one side of the craft

     Same rejection sampling as the shape task's scatter, and the
     same fallback: a frame too cramped for any draw keeps the row.

     Before that fallback, a second, looser pass. The craft is kept
     clear by its whole box on the first, and on the slimmer hulls
     (the rhombus, the parallelogram: a sixth of their
     canvas) that box is mostly empty water. And the rhombus round's
     islands are tall: on a landscape frame not one of them fits
     above or below the craft, so no draw of the eight spots can
     place all three. So the second pass keeps the craft clear by its
     hull and the reach of its nozzles instead, and puts each island
     anywhere on the water -- every other rule as before. The
     square's screen is always laid out by the first. */
  var PILOT_SPOTS = [
    [17, 33], [17, 70], [34, 24], [66, 24],
    [83, 33], [83, 70], [34, 77], [66, 77]
  ];
  var PILOT_JITTER = 3;      /* per cent of the frame, either way */
  var PILOT_GAP = 22;        /* px of water between two islands */
  var PILOT_LOOSE = 8000;    /* draws on the second pass: most of
                                anywhere is somewhere an island cannot
                                go, and each one costs next to nothing */

  /* the nozzle's depth for its width -- nozzle.webp is 320 x 123,
     and css/pilot.css draws it at that aspect */
  var NOZZLE_ASPECT = 2.6;

  /* `el`'s layout box inside `host`, off the offset chain -- so it is
     the box the stylesheet laid out, with no transform in it */
  function boxIn(el, host, pad) {
    var x = 0, y = 0, n = el;
    while (n && n !== host) {
      x += n.offsetLeft;
      y += n.offsetTop;
      n = n.offsetParent;
    }
    pad = pad || 0;
    return { l: x - pad, t: y - pad,
             r: x + el.offsetWidth + pad, b: y + el.offsetHeight + pad };
  }

  function hits(o, k) {
    return o.x - o.m.left < k.r && o.x + o.m.right > k.l &&
           o.y - o.m.up < k.b && o.y + o.m.down > k.t;
  }

  /* The flown craft's hull and the reach of its run-out nozzles,
     inside `host` -- its box cut down to the metal it can actually
     put over an island */
  function hullIn(ship, host, craft, pad) {
    var k = boxIn(ship, host, 0);
    var w = k.r - k.l;
    var reach = (craft.nozzle || 21) / NOZZLE_ASPECT / 100;
    return {
      l: k.l + w * (craft.hull[0] / 100 - reach) - pad,
      t: k.t + w * (craft.hull[1] / 100 - reach) - pad,
      r: k.l + w * (craft.hull[2] / 100 + reach) + pad,
      b: k.t + w * (craft.hull[3] / 100 + reach) + pad
    };
  }

  function strewPilot(round) {
    var site = round.sites.b;
    var sec = round.node;
    var W = sec.clientWidth;
    var H = sec.clientHeight;
    var pads = site.el.padList;
    if (!W || !H || !pads.length) return false;

    var art = pads.map(measure);
    var ship = site.el.ship;
    var craft = CRAFT[round.shape];

    /* The keep-outs, in the frame's coordinates. The site is the
       frame's own size and sits square on it with the lens down, so
       the craft's box inside the site is its box on the frame. */
    var chrome = [];
    [round.el.stick, round.el.lives].forEach(function (el) {
      if (el && el.offsetWidth) chrome.push(boxIn(el, sec, 12));
    });

    /* each pass: how many draws, the craft's keep-out, and where a
       draw puts island `i`, in per cent of the frame */
    var passes = [{
      draws: DRAWS * 2,
      ship: ship ? boxIn(ship, site.node, 10) : null,
      spots: function () {
        return shuffled(PILOT_SPOTS).map(function (s) {
          return [s[0] + (Math.random() * 2 - 1) * PILOT_JITTER,
                  s[1] + (Math.random() * 2 - 1) * PILOT_JITTER];
        });
      }
    }];
    if (ship && craft && craft.hull) {
      passes.push({
        draws: PILOT_LOOSE,
        ship: hullIn(ship, site.node, craft, 10),
        spots: function () {
          return art.map(function () {
            return [100 * (SIDES + Math.random() * (1 - 2 * SIDES)),
                    100 * (BAND[0] + Math.random() * (BAND[1] - BAND[0]))];
          });
        }
      });
    }

    for (var p = 0; p < passes.length; p++) {
      var keep = chrome.concat(passes[p].ship ? [passes[p].ship] : []);

      for (var t = 0; t < passes[p].draws; t++) {
        var spots = passes[p].spots();
        var draw = art.map(function (m, i) {
          return { m: m, x: W * spots[i][0] / 100, y: H * spots[i][1] / 100 };
        });

        var left = draw.some(function (o) { return o.x < W / 2; });
        var right = draw.some(function (o) { return o.x > W / 2; });
        if (!left || !right) continue;
        if (collides(draw, W, H, PILOT_GAP)) continue;
        if (draw.some(function (o) { return keep.some(function (k) { return hits(o, k); }); })) continue;

        draw.forEach(function (o) {
          o.m.el.style.setProperty('--sx', (o.x / W * 100).toFixed(3) + '%');
          o.m.el.style.setProperty('--sy', (o.y / H * 100).toFixed(3) + '%');
          o.m.el.classList.add('is-scattered');
        });
        return true;
      }
    }

    /* too cramped for any draw: the row, as every other landing */
    pads.forEach(function (pad) { pad.classList.remove('is-scattered'); });
    dealRow(site);
    return false;
  }

  /* ============================================================
     THE SITES -- how every playing screen is laid out

     Each screen is one shot over one sea, and the lens comes down
     on it twice. Each place it comes down on is a SITE: a
     frame-sized coordinate box inside the camera plate (see .site
     in css/style.css), holding the islands of one question, laid
     out on the same stations, the same --pu and the same
     centre-of-area anchoring as the other.

       site A   three islands of the round's own shape, three sizes,
                and two other shapes drawn from the round's decoy
                pool -- a different pair every visit. Strewn across
                the five stations. The SHAPE question.
       site B   three islands of the round's own shape carrying the
                round's three areas, dealt across the row, and the
                craft. Nothing else: the shape question has been
                answered by the time the lens gets here, so the only
                islands on the water are the three the area question
                is about.

     Site A carries every shape in its pool as a decoy and shows TWO
     of them: an island's shoreline is built from its silhouette at
     load (js/water.js), so swapping a pad's shape later would leave
     it wearing the wrong coast. Hiding all but two is the same
     random pair with none of that.

     And around and between the two sites, the ISLETS: the rest of
     the archipelago, sixteen small islands cycling through every
     shape the mission has, which are what the wide shot is of.
     Scenery -- no shoreline, no tap target, no number -- and kept
     out of the frame of every site the screen plays (`round.plays`),
     so no question ever has an extra island in it.

     A screen that plays only one site -- the survey plays A, the
     first round's landing plays B -- still has both, the other one
     empty, so the camera and every helper see the same two sites
     on every screen.

     Both sites come back shaped like a round (the same `el` fields,
     `shape`, `area`, `geo`), because that is what lets
     js/script.js play them through one set of helpers.
     ============================================================ */

  /* the islets: how many, and the range of land they cover, in
     painted box units -- between a third and two thirds of the fit
     island -- cycling through every shape */
  var ISLETS = 16;
  var ISLET_AREA = [FIT_AREA * 0.30, FIT_AREA * 0.66];
  var ISLET_SHAPES = ['square', 'rectangle', 'parallelogram', 'trapezium', 'rhombus'];

  /* The world the islets are strewn over, in per cent of one frame.
     Site A's frame is (0..100, 0..100); site B's is a frame right
     and 45% down (css/style.css). The lens at survey height
     (--cam-wide .32, centred between the two) sees about -56..256
     by -84..229, so WORLD is the part of it with a margin, and
     EXCLUDE is each site's frame with a margin of its own. */
  var WORLD = { l: -44, r: 244, t: -68, b: 214 };
  var EXCLUDE = {
    a: { l: -8, r: 108, t: -8, b: 108 },
    b: { l: 92, r: 208, t: 37, b: 153 }
  };

  function isletHTML(shape, k) {
    var land = LAND[shape];
    return '<div class="islet" data-shape="' + shape + '"' +
                ' style="--k:' + round2(k) + ';--icx:' + land.cx + ';--icy:' + land.cy + '">' +
      '<span class="islet__wake"></span>' +
      '<span class="islet__splash"></span>' +
      '<img class="islet__img" src="assets/images/' + encodeURI(land.img) + '" alt="" />' +
    '</div>';
  }

  function isletsHTML() {
    var out = [];
    for (var i = 0; i < ISLETS; i++) {
      var shape = ISLET_SHAPES[i % ISLET_SHAPES.length];
      var area = ISLET_AREA[0] + Math.random() * (ISLET_AREA[1] - ISLET_AREA[0]);
      out.push(isletHTML(shape, boxFor(area, LAND[shape])));
    }
    return out.join('');
  }

  /* One site's islands: three of the round's shape at `sizes` (areas
     in square units; printed only where `print` is true) and, where
     `decoyArea` is given, every shape in the round's pool as a
     decoy, hidden until arrangeSite() shows a pair. Decoys first in
     the DOM, so they paint behind the row that carries the question. */
  function siteHTML(round, sizes, print, decoyArea) {
    var land = LAND[round.shape];
    var kFit = boxFor(FIT_AREA, land);
    var out = [];

    if (decoyArea != null) {
      round.decoyPool.forEach(function (shape) {
        out.push(padHTML(shape, {
          k: boxFor(decoyArea, LAND[shape]),
          slot: 'far1',
          area: null
        }));
      });
    }

    sizes.forEach(function (size, i) {
      out.push(padHTML(round.shape, {
        k: kFit * Math.sqrt(size / round.area),
        slot: 'row' + (i + 1),
        area: print ? size : null
      }));
    });

    return out.join('');
  }

  /* site A's three islands of the round's own shape, in square units */
  function sizesA(round) {
    return SIZES_A.map(function (m) { return round.area * m; });
  }

  /* A landing-only screen never leaves site B, so it has no shape
     question to lay out and no wide shot to need an archipelago */
  function sitesHTML(round) {
    var full = !round.landingOnly;
    return '<div class="islets" aria-hidden="true">' + (full ? isletsHTML() : '') + '</div>' +
      '<div class="site site--a">' +
        '<div class="pads">' +
          (full ? siteHTML(round, sizesA(round), false, FIT_AREA) : '') +
        '</div>' +
      '</div>' +
      '<div class="site site--b">' +
        shipHTML(round) +
        '<div class="pads">' + siteHTML(round, round.row, true, null) + '</div>' +
        fxHTML() +
      '</div>';
  }

  /* The drone's opening, on the first round (`intro`): the dark over
     the water, the scanner's sweep, and the camera bezel that is
     retired once the scan lands. Their look is css/style.css's; the
     flow that plays them is runRound() in js/script.js. */
  var BLACKOUT = '<div class="blackout" aria-hidden="true"></div>';
  var SCANNER =
    '<div class="scanner" aria-hidden="true">' +
      '<div class="scanner__wash"></div>' +
      '<div class="scanner__bar">' +
        '<span class="scanner__core"></span>' +
        '<span class="scanner__glow"></span>' +
      '</div>' +
    '</div>' +
    '<div class="layer layer--hud drone-hud" aria-hidden="true"></div>';

  /* Everything a round shares between its two sites and its lens */
  var CHROME =
    '<div class="aerial" aria-hidden="true"></div>' +
    '<div class="fix" aria-hidden="true">' +
      '<div class="fix__box">' +
        '<span class="fix__ring"></span>' +
        '<i class="fix__c fix__c--tl"></i><i class="fix__c fix__c--tr"></i>' +
        '<i class="fix__c fix__c--bl"></i><i class="fix__c fix__c--br"></i>' +
      '</div>' +
    '</div>' +
    '<div class="alt" aria-hidden="true">' +
      '<span class="alt__track"><i class="alt__mark"></i></span>' +
      '<span class="alt__read">' +
        '<span class="alt__row"><b class="alt__num">4200</b><i class="alt__unit">m</i></span>' +
        '<em class="alt__state">STANDBY</em>' +
      '</span>' +
    '</div>';

  /* One site, shaped like a round so the flow's helpers can play it:
     the round's own figures, plus this site's node, offset and
     islands. `el.all` is every island it carries, hidden ones
     included; `el.padList` the ones in play, set by arrangeSite(). */
  function siteOf(round, node, key, offset) {
    var all = Array.prototype.slice.call(node.querySelectorAll('.pad'));
    return {
      node: node,
      offset: offset,
      shape: round.shape,
      area: round.area,
      geo: round.geo,
      askExact: round.askExact !== false,
      el: {
        pads: node.querySelector('.pads'),
        all: all,
        padList: all.slice(),
        ship: node.querySelector('.ship'),
        shipDims: node.querySelector('.ship__dims')
      }
    };
  }

  /* Look a built screen up into the object the flow plays: the two
     sites, the islets, the lens's plate and every piece of chrome.
     Five copies of one screen cannot each own an id, so a class is
     how everything is found. */
  function wireRound(node, round) {
    var land = LAND[round.shape];
    var craft = CRAFT[round.shape];

    round.node = node;

    /* the sites the screen actually plays */
    round.plays = round.shapeOnly ? ['a'] : round.landingOnly ? ['b'] : ['a', 'b'];

    /* what the fall arithmetic in js/failure.js runs on, for every
       screen with a craft to land */
    round.geo = craft ? {
      shipCX: craft.cx, shipCY: craft.cy,
      padCX: land.cx, padCY: land.cy,
      fit: Math.sqrt(land.fill / craft.fill)
    } : null;

    round.sites = {
      a: siteOf(round, node.querySelector('.site--a'), 'a', { x: 0, y: 0 }),
      b: siteOf(round, node.querySelector('.site--b'), 'b', { x: 100, y: 45 })
    };
    round.islets = Array.prototype.slice.call(node.querySelectorAll('.islet'));

    round.el = {
      cam: node.querySelector('.cam'),
      bg: node.querySelector('.layer--bg'),
      alt: node.querySelector('.alt'),
      altNum: node.querySelector('.alt__num'),
      altState: node.querySelector('.alt__state'),
      confetti: node.querySelector('.confetti'),
      topbar: node.querySelector('.topbar'),
      topbarText: node.querySelector('.topbar__text'),
      advance: node.querySelector('.advance__btn'),
      /* a flown landing only (`pilot`): the controller and the hearts */
      stick: node.querySelector('.stick'),
      lives: node.querySelector('.lives'),
      /* the first round's opening only (`intro`) */
      blackout: node.querySelector('.blackout'),
      scanner: node.querySelector('.scanner'),
      bezel: node.querySelector('.drone-hud')
    };

    /* the frame-level chrome both sites share -- the helpers reach
       it through the site, as they reach a round's own */
    ['a', 'b'].forEach(function (k) {
      var site = round.sites[k];
      site.el.confetti = round.el.confetti;
      site.el.topbar = round.el.topbar;
      site.el.topbarText = round.el.topbarText;
      site.el.advance = round.el.advance;
      site.el.stick = round.el.stick;
      site.el.lives = round.el.lives;
    });

    return round;
  }

  /* Show two of a site's decoys and hide the rest, and hand the pair
     the slots the site's layout wants them on -- the far rank, which
     is the scatter's fallback. Sets padList to the islands in play,
     decoys first. A site built without decoys (site B) comes out as
     its three islands of the round's shape. */
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
    return site.el.padList;
  }

  /* Two different decoys, drawn at random */
  function drawPair(pool) {
    var a = shuffled(pool);
    return [a[0], a[1]];
  }

  /* Strew the islets over the world, clear of the sites in `keys`
     (both, by default) and of each other. Rejection sampling, like
     the pads' own scatter: a spot is drawn, measured against the
     exclusions and against every islet already placed, and kept
     only if it is clear. */
  function strewIslets(cam, islets, keys) {
    var W = cam.clientWidth || 1;
    var H = cam.clientHeight || 1;
    var placed = [];
    var keep = (keys || ['a', 'b']).map(function (k) { return EXCLUDE[k]; });

    function clear(x, y, rx, ry) {
      var i, e, o;
      for (i = 0; i < keep.length; i++) {
        e = keep[i];
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
        x = WORLD.l + rx + Math.random() * (WORLD.r - WORLD.l - 2 * rx);
        y = WORLD.t + ry + Math.random() * (WORLD.b - WORLD.t - 2 * ry);
        if (clear(x, y, rx, ry)) break;
      }
      if (t === 80) {
        /* nowhere clear: park it well off the visible sea */
        x = WORLD.l - 60; y = WORLD.t - 60;
      }

      el.style.setProperty('--wx', x.toFixed(2) + '%');
      el.style.setProperty('--wy', y.toFixed(2) + '%');
      placed.push({ x: x, y: y, rx: rx, ry: ry });
    });
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
      /* the second path is the flown landing's lock-on, drawn round
         the coast while the craft holds over it (css/pilot.css);
         pathLength makes both run 0..100 whatever the shape */
      '<svg class="pad__fit" viewBox="0 0 100 100" aria-hidden="true">' +
        '<path d="' + land.outline + '" pathLength="100" />' +
        '<path class="pad__trace" d="' + land.outline + '" pathLength="100" />' +
      '</svg>' +
      (o.area == null ? ''
        : '<p class="pad__area"><b>' + o.area + '</b><i>sq units</i></p>') +
      '<button class="pad__hit" type="button" tabindex="-1" aria-label="' + name + '"></button>' +
    '</div>';
  }

  /* ---------------------------------------------------------- the helm
     The flown landing's three pieces of markup: the craft's four
     thrusters, the hearts, and the controller. What they DO is
     js/pilot.js; how they look and burn is css/pilot.css. */

  /* One nozzle per side of the hull, t r b l, each built pointing
     DOWN and turned to its side by the stylesheet, so the four are
     one piece of markup. Before the hull in source order: the hull
     is painted over the nozzle's flange, and the burn comes out from
     under the bell. Inside the jet, back to front: the light it
     throws on the water, the plume, the hot middle, the white core,
     and three sparks that only fly while it is burning hard. */
  function thrustersHTML() {
    return ['t', 'r', 'b', 'l'].map(function (side) {
      return '<span class="thruster thruster--' + side + '" aria-hidden="true">' +
        '<span class="thruster__jet">' +
          '<i class="jet__glow"></i>' +
          '<i class="jet__plume"></i>' +
          '<i class="jet__mid"></i>' +
          '<i class="jet__core"></i>' +
          '<i class="jet__spark"></i><i class="jet__spark"></i><i class="jet__spark"></i>' +
        '</span>' +
        '<img class="thruster__bell" src="assets/images/nozzle.webp" alt="" draggable="false" />' +
        '<i class="thruster__heat"></i>' +
      '</span>';
    }).join('');
  }

  /* One heart: an empty socket, and the full heart over it in two
     halves -- whole while it is held, split apart when it is lost.
     Flat fills from the stylesheet and no gradient, because a
     gradient needs an id and a built screen cannot own one. */
  var HEART_PATH = 'M12 21.2l-1.4-1.3C5.4 15.4 2 12.3 2 8.5 2 5.4 4.4 3 7.5 3c1.7 0 ' +
                   '3.4.8 4.5 2.1C13.1 3.8 14.8 3 16.5 3 19.6 3 22 5.4 22 8.5c0 ' +
                   '3.8-3.4 6.9-8.6 11.5z';

  function heartSVG(shine) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<path class="life__body" d="' + HEART_PATH + '" />' +
      (shine ? '<path class="life__shine" d="M5.6 9.2c0-1.7 1-3 2.6-3.2" />' : '') +
    '</svg>';
  }

  function lifeHTML() {
    return '<span class="life">' +
      '<span class="life__slot">' + heartSVG(false) + '</span>' +
      '<span class="life__half life__half--l">' + heartSVG(true) + '</span>' +
      '<span class="life__half life__half--r">' + heartSVG(true) + '</span>' +
    '</span>';
  }

  var LIVES =
    '<div class="lives" role="img" aria-label="3 of 3 hearts left">' +
      lifeHTML() + lifeHTML() + lifeHTML() +
    '</div>';

  /* The hand that shows a stuck player what to do: it taps an island
     on the shape question (js/script.js) and works the joystick on a
     landing (js/pilot.js). How it looks and moves is css/rounds.css
     and css/pilot.css; the fingertip is (28, 4) of the 64 x 80. */
  var HAND =
    '<span class="nudge" aria-hidden="true">' +
      '<i class="nudge__ring"></i>' +
      '<svg class="nudge__hand" viewBox="0 0 64 80">' +
        '<path fill="#fff" stroke="#123a5e" stroke-width="3" stroke-linejoin="round"' +
          ' d="M22 36V9a6 6 0 0 1 12 0v22a5 5 0 0 1 10 0v2a5 5 0 0 1 9.5 1v2' +
          'a4.5 4.5 0 0 1 9 1V56c0 10-7 18-17 18H37c-6 0-10-2.6-13.6-7.4' +
          'L10.5 49.5a5 5 0 0 1 7.6-6.4L22 47Z" />' +
        '<path fill="none" stroke="#123a5e" stroke-width="2.4" stroke-linecap="round"' +
          ' d="M34 31v9M44 33v8M53.5 36v6" />' +
      '</svg>' +
    '</span>';

  /* The joystick: the ring, the knob dragged round inside it, and GO,
     which takes the knob's place once the craft is settled over an
     island (tools/build_joystick.py cuts the ring and the knob).
     GO is `data-quiet` and plays its own tick (js/pilot.js), since
     a press on it is read off the stick's pointer and never reaches
     the game-wide tap tick (onTap in js/script.js) as a click. */
  var STICK =
    '<div class="stick" role="group" aria-label="Flight joystick: drag it, or use the arrow keys, to fly">' +
      '<img class="stick__base" src="assets/images/joystick-base.webp" alt="" draggable="false" />' +
      '<span class="stick__knob" aria-hidden="true">' +
        '<img src="assets/images/joystick-knob.webp" alt="" draggable="false" />' +
      '</span>' +
      '<button class="stick__go" type="button" data-quiet tabindex="-1" aria-hidden="true"' +
             ' aria-label="Go: land here">' +
        '<span class="stick__go-word">GO</span>' +
      '</button>' +
      '<span class="stick__auto" aria-hidden="true">AUTOPILOT</span>' +
      HAND +
    '</div>';

  /* the craft, from its CRAFT entry. .ship__cast and .ship__wash are
     not written here: js/water.js inserts them at the front of
     .ship, and css/failure.css animates the cast one as the landing
     shadow. .ship__dust is the touchdown puff, and .engine-flame is
     off unless the craft artwork has no exhaust painted on it -- see
     block 2 of css/failure.css. */
  /* A flown craft's figures, for css/pilot.css and js/pilot.js: its
     extent and where each nozzle hangs as custom properties, and its
     corners as `data-hull`, which is what the lock-on measures. */
  function helmAttrs(craft) {
    var vars = [
      '--hull-l:' + craft.hull[0] + '%', '--hull-t:' + craft.hull[1] + '%',
      '--hull-r:' + craft.hull[2] + '%', '--hull-b:' + craft.hull[3] + '%'
    ];
    if (craft.nozzle) vars.push('--nozzle-w:' + craft.nozzle + '%');
    if (craft.noz) {
      Object.keys(craft.noz).forEach(function (s) {
        vars.push('--noz-' + s + '-x:' + craft.noz[s][0] + '%',
                  '--noz-' + s + '-y:' + craft.noz[s][1] + '%');
      });
    }
    var poly = craft.poly
      ? ' data-hull="' + craft.poly.map(function (p) { return p.join(' '); }).join(' ') + '"'
      : '';
    return ' style="' + vars.join(';') + '"' + poly;
  }

  function shipHTML(round) {
    var craft = CRAFT[round.shape];
    var flown = !!(round.pilot && craft.hull);
    return '<div class="ship' + (flown ? ' is-piloted' : '') + '"' +
                (flown ? helmAttrs(craft) : '') + '>' +
      '<span class="ship__dust" aria-hidden="true"></span>' +
      '<div class="ship__craft">' +
        (flown ? thrustersHTML() : '') +
        '<img class="ship__img" src="assets/images/' + encodeURI(craft.img) +
             '" alt="' + craft.alt + '" />' +
        '<span class="engine-flame" aria-hidden="true"></span>' +
        '<svg class="ship__dims" viewBox="-28 -6 132 132" aria-hidden="true">' +
          craft.dims +
        '</svg>' +
      '</div>' +
    '</div>';
  }

  /* The landing's effect layers, one either side of the craft: the
     back one (z 3) holds the scorch mark the wreck lies on and half
     the spray, the front one (z 6) the rest. Between them sits the
     water overlay (z 5), which is painted OVER a sinking craft so it
     goes under something rather than fading out. All three are
     filled by js/failure.js -- and they live inside site B, because
     the points they are parked on are worked out in screen
     coordinates, and with the lens down on the site the site's box
     IS the screen's box. */
  function fxHTML() {
    return '<div class="fx-layer fx-layer--back" aria-hidden="true"></div>' +
           '<div class="water-depth-overlay" aria-hidden="true"></div>' +
           '<div class="fx-layer fx-layer--front" aria-hidden="true"></div>';
  }

  function sectionHTML(round) {
    var land = LAND[round.shape];
    var craft = CRAFT[round.shape];

    var kFit = boxFor(FIT_AREA, land);
    var fit = Math.sqrt(land.fill / craft.fill);

    var vars = [
      '--ship-k:' + round2(kFit * fit),
      '--scx:' + craft.cx,
      '--scy:' + craft.cy
    ].join(';');

    /* data-intro: the screen opens in the dark, and its sea is lit up
       by the scan (css/style.css, css/reef.css). data-landing: a screen
       that is only the landing, with no shape question in front of it
       -- so no site A, no islets and no survey haze to show
       (css/reef.css); no round is one now. */
    return '<section class="screen screen--round" data-shape="' + round.shape + '"' +
                   (round.pilot ? ' data-pilot' : '') +
                   (round.reef ? ' data-reef' : '') +
                   (round.cinema ? ' data-cinema' : '') +
                   (round.intro ? ' data-intro' : '') +
                   (round.landingOnly ? ' data-landing' : '') + ' style="' + vars + '">' +

      '<div class="layer layer--bg s3-bg" aria-hidden="true"></div>' +
      (round.intro ? BLACKOUT : '') +

      /* the camera plate: the islets, the two sites, and the wave
         fronts js/water.js mounts in here. See .cam in css/style.css */
      '<div class="cam">' + sitesHTML(round) + '</div>' +

      CHROME +
      (round.intro ? SCANNER : '') +

      '<div class="confetti" aria-hidden="true"></div>' +

      /* the flown landing's hearts (top left) and controller (bottom
         right) -- see js/pilot.js */
      (round.pilot ? LIVES + STICK : '') +

      /* the landing screen's bar stays up while each sentence is
         spoken and steps aside once it is finished, so the craft,
         the islands and the controller are left clear -- see
         narrate() in js/script.js. The value is the grace (ms) a
         following line has to keep the bar up. */
      '<header class="topbar"' + (round.landingOnly ? ' data-step-aside="400"' : '') + '>' +
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

     Each round comes back wired (wireRound): its two sites, its
     islets, its lens and its chrome already looked up -- there are
     no ids on these screens; five copies of one screen cannot each
     own an id, and the flow is handed the round it is playing anyway
     -- and with the four figures the landing's plan() needs.       */
  function build(stage, before) {
    if (!stage) return [];

    return ROUNDS.map(function (round) {
      var host = doc.createElement('div');
      host.innerHTML = sectionHTML(round);

      var node = host.firstChild;
      stage.insertBefore(node, before || null);

      return wireRound(node, round);
    });
  }

  global.GeoPages = {
    build: build,
    scatter: scatter, dealRow: dealRow, strewPilot: strewPilot,
    arrangeSite: arrangeSite, drawPair: drawPair, strewIslets: strewIslets,
    rounds: ROUNDS, land: LAND, world: WORLD, hand: HAND
  };
})(window);
