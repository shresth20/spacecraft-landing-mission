# Integrate the reference water environment into the existing game

## Task and non-negotiable scope

Work in the existing Spacecraft Landing Mission HTML/CSS/JavaScript project. The movement, controller, collisions, landing validation, area calculations, scoring, screen flow, localization, audio, and UI already exist. Improve the visual environment only. Do not rebuild the game or substitute new gameplay logic.

Use the supplied reference.png as the visual target. The accompanying water-motion-demo.html is a standalone geometry/motion prototype with deliberately simplified inline SVG placeholder art. It is NOT reference-identical artwork and is NOT a drop-in replacement for the game. Do not copy its simplified art into production or mistake its layout sampler for the game's authoritative level generator.

First inspect the project and report: relevant existing files, current world-coordinate and zoom systems, authoritative island positions/footprints, scene lifecycle hooks, asset-loading code, existing animation library, and reusable artwork. Reuse existing source assets and conventions. Change as few files as practical. Do not change game IDs, handlers, public APIs, or asset paths unnecessarily.

Use HTML, CSS and small inline SVG graphics. Do not add Canvas, WebGL, Three.js, a framework, an animation dependency, remote fonts, or CDN requests. Existing animation utilities may be reused. The result must work offline with local assets.

## Visual target

Match the reference's deep blue alien water, cyan/turquoise currents and water-contact highlights, orange rocky square platforms, shallow visible side faces, soft vector-like shading, and near-top-down camera. Keep one consistent lighting direction across sprites.

Preserve the original ship, nozzles, flame, controller, hearts, dimension labels, and interface. Keep the scene uncluttered and the center readable. Follow the project's requested sharp square corners and straight landing edges. Do not add plants, coral, beaches, sunlight streaks, large particles, or unrelated science-fiction decorations.

A correct implementation needs separate reference-matched art plus attached procedural water effects. Do not use the whole reference as a moving background: its embedded islands, UI, rocks and waves would remain baked in. Do not simulate the final artwork with generic CSS rectangles. Report missing source art instead of pretending a generated approximation is an exact extraction.

## Assets and metadata

Expect these local resources, retaining existing file names when present:
- One water-only background with subtle broad color texture, but no objects, shorelines or directional sunlight.
- One to three orange square platform variants without numbers, small rocks or surrounding water.
- Six to eight individual small dry-rock variants with actual alpha transparency.
- Four to six submerged blue/teal rock clusters, no rectangular patch of water.
- Optional three to four peripheral land fragments, used sparingly at screen edges.
- Existing separated ship, nozzle, flame and controller artwork.

Use asset_manifest.example.json as a schema illustration, not as measured production data. For each sprite, record source dimensions, anchor, exact top-surface/footprint rectangle or polygon, shallow cliff extents, and a local water-contact outline. Measure these values from the actual assets. Remove baked water fringes and fake checkerboard backgrounds. Keep labels in existing HTML/SVG/localization systems.

Separate the mathematical footprint from the sprite's transparent padding, bevel, cliff, shadow, exhaust and decorative rocks. A 6 x 6 ship and its 36-square-unit landing surface must map to the same world footprint and scale. Never resize gameplay footprints solely to make a randomized layout fit. Do not stretch a square into a rectangle. Water contours may be rounded while the playable surface remains sharp-cornered.

Do not arbitrarily rotate strongly lit 2.5D sprites: their side faces and highlights would rotate too. Prefer exported variants; use only lighting-compatible small rotations where justified.

## Nine logical depth groups

Adapt these groups to the existing DOM; these are draw-order concepts, not instructions to promote nine GPU layers:
1. Static deep-water background.
2. Submerged rock sprites and their baked depth shadows.
3. Low-opacity surface tint/local shimmer above submerged rocks.
4. Faint, slow open-water current paths.
5. Water-only shoreline halos and expanding ripples behind dry objects.
6. Dry platforms, peripheral fragments and separate satellite rocks.
7. Carefully restricted front contact highlights, emergence water wash and ship water shadow as appropriate.
8. Existing ship/nozzles/flame and world-anchored measurement labels.
9. Existing persistent HUD/controller/header/footer.

Keep decorative layers pointer-events:none and out of keyboard focus. Do not disable interaction on existing playable objects or controls. Clip effects where needed so water lines never cross a dry top surface or UI. Prefer correct draw order over an expensive whole-scene mask. Use small local masks only when needed. Mask geometry must use the same coordinates as its parent object.

## Three distinct water systems

A. Ambient currents: generate a small number of smooth, irregular SVG Bezier curves once at scene setup. Use long curves with occasional restrained curls, not repeated horizontal stripes, radial gradients, sinusoidal grids, uniform rings or a neon web. Animate two sparse groups with slow transform/opacity changes and a few pixels of drift. Keep most open water quiet.

B. Island/dry-rock shoreline: each instance owns a contact contour derived from its actual waterline silhouette, not the image bounding box. Start with a thin inner cyan contact line, a broad faint duplicate stroke, and one or two outward ripple paths. Vary phase, duration and opacity per instance. For the final art, trace or generate correct offset contours; scaling a rectangle is only a visual approximation, especially for larger expansions and irregular rocks. Generate contours on setup/geometry change, never every frame.

Anchor the waterline to the object's world position. Animate an inner wave wrapper, not the positioning wrapper. A land-rise animation must not drag its surrounding water upwards. Draw the rings beneath dry art, with only front contact fragments above it.

C. Submerged-rock shimmer: keep fully submerged rocks still during the active round. Overlay only a few very faint broken cyan arcs or local caustic highlights, weaker than island shorelines. Do not give fully submerged rocks a bright foam waterline. Avoid mirror-image reflections, large glows, and a visible rectangle around any sprite.

Optional moving crests: a few short SVG stroke-dasharray/stroke-dashoffset highlights can travel along selected contours. This is not free/compositor-only animation; keep the count small, profile it, and disable it in the low-effects mode. Use crossfaded precomputed fragments as a simpler fallback. Avoid animated full-screen SVG turbulence, displacement, blur and filters.

Suggested tuning, in a roughly 1600 x 900 logical world, not measured requirements:
- Ambient drift: 18-30 seconds, about 6-16 logical pixels total travel.
- Shoreline ripples: 5-9 seconds, about 8-20 logical pixels of outward travel.
- Submerged shimmer: 6-12 seconds, very low opacity.
- Traveling crests: 10-18 seconds, very few paths.
- Land reveal: 1.2-1.6 seconds, approximately 12-20 logical pixels of upward illustration movement; final footprint stays fixed.
- Satellite timing: about 80-180 ms after or around the parent land reveal.
- One-time emergence ripple: 1.6-2.2 seconds, followed by the calm idle state.

Keep duration, opacity, density and distances centralized in a visual configuration rather than duplicated across screens.

## Island clusters and emergence

Represent each platform as a reusable island-cluster data object containing its ID, authoritative gameplay footprint/position, sprite/anchor metadata, waterline contour, animation phase, and satellite rocks with LOCAL dx/dy offsets. Art and water effects can be rendered in different depth groups while reading the same object data.

Place three to five small dry rocks around each island, outside the landing footprint. Avoid the four instructional corners and keep clear water gaps. Do not bake satellites into the platform image; they must be independently reusable. Their world position equals parent island position plus local offset. Keep those offsets fixed for the round.

Reveal sequence: subtle submerged silhouette, small local disturbance, upward/tinted reveal of the already full-size platform, near-simultaneous satellite reveal, a soft outward ripple, then calm idle shorelines. Fade a blue water wash off the artwork to suggest wet emergence. A local clipping mask can conceal the lower side face for a stronger rising illusion. Do not grow the island from scale(0), bounce it, rotate it or continuously bob solid terrain. Fade labels at the right existing readiness point.

Integrate with the existing game's island-ready/round-start hook. Only delay interactivity if the existing lifecycle allows it and the change is explicitly appropriate. Do not silently alter collision or landing timing. Reduced-motion and canceled animations must resolve readiness safely; do not depend exclusively on animationend or a fixed timeout.

## Random placement without breaking gameplay

The existing game remains the source of truth for all interactive island positions. Use its approved layout and extend its existing placement hook only where necessary. Never generate an independent visual position that disagrees with the collider or landing target.

Use seeded randomness keyed to screen/round identity for decorations and, where already supported, island placements. Same seed must reproduce the same arrangement for debugging. Randomize at new-screen/new-round setup only. Resizing, pausing, opening a popup or replaying an animation must not regenerate the layout. Do not teleport rocks during active play or sample Math.random() in an animation loop.

Placement order: reserve existing ship spawn and control/HUD safe areas; obtain/place valid gameplay islands; reserve each full art + satellite + ripple extent; attach satellites; place submerged clusters in remaining water; place optional peripheral fragments last. Preserve safe ship movement corridors according to the existing gameplay rules. Avoid incidental clustering and evenly spaced grid layouts.

Use bounded rejection attempts with a known-valid fallback. When space is tight, reduce decoration counts rather than changing island areas, swallowing corners, placing art under controls or forcing overlap. Do not assume center-distance alone guarantees non-overlap; account for actual extents.

## Responsiveness, loading and performance

Use the existing logical world and camera transform. Background, islands, rocks, masks, shoreline paths and ship must share compatible coordinates and world zoom. Persistent UI can remain outside the world transform. Preserve aspect ratio/letterboxing according to the current layout. Do not stretch X and Y independently.

Separate positioning, camera zoom and visual-animation wrappers so CSS and JavaScript do not overwrite the same transform. Do not animate top/left/width/height for idle effects. Prefer transforms and opacity, while profiling actual SVG rasterization rather than assuming all SVG transforms are composited. Do not add will-change or translateZ(0) to every node.

Decode required artwork before revealing the scene, handle loading errors explicitly, and only prepare assets needed for the relevant screen. Do not use an unexplained fixed delay to hide decode stalls. Match texture dimensions to on-screen size, DPR and actual zoom requirements; do not make every small rock a 2048-pixel texture.

No continuous JavaScript loop is needed for idle CSS effects. Reuse the game's existing shared update loop for genuine gameplay-dependent updates. Generate masks, paths and layouts at setup/geometry changes. Clean up nodes, observers, timeouts, callbacks and animation handles when a scene is destroyed.

Pause decorative motion during existing game pause and when the document is hidden. Honor prefers-reduced-motion: render the final visible island state without traveling/bobbing effects. Provide a low-effects quality option that disables secondary current paths, secondary ripples and traveling dash highlights while retaining correct artwork and static contact outlines.

Inspect existing zoom and transition stutters; do not promise this visual layer fixes an unprofiled performance problem. Profile target tablet/laptop hardware and existing zoom sequences. No full-screen animated blur, heavy animated filters or unnecessary compositing promotions.

## Implementation and acceptance

Fit the existing folder structure. Suggested additions only if appropriate: js/environment.js, js/water-effects.js, css/environment.css, and assets/image/environment/. Centralize asset/config data. Do not refactor unrelated code.

Expose a small lifecycle adapter equivalent to prepare, setLayout, revealIsland, pause, resume and destroy, using the project's naming conventions. Do not fabricate calls to functions that do not exist; inspect and connect to the actual implementation.

Work in stages: first static composition with original sprites, then one island and its anchored waterline, then one emergence sequence, then satellites/submerged shimmer, then randomized screens, finally performance tuning. Show a static and animated comparison with reference.png before multiplying effects across all screens.

Verify: original controls/collisions/scoring/area math unchanged; matching ship/land footprint; clean alpha edges; no water over dry faces; each contour follows its object; satellites never cover the landing square; no clutter under HUD; stable positions through resize/pause/replay; several seeded layouts; safe fallback; one-time reveals; no node/listener growth over repeated rounds; reduced-motion readiness; asset failure behavior; and no new zoom/pan flicker.

Deliver actual code changes, an asset/metadata mapping, a centralized tuning block, and a list of tests performed with any remaining art or integration limitations. Do not claim exact visual fidelity or target-device performance unless verified.
