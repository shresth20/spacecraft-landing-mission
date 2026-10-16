# Dynamic water environment: implementation pack

Prepared for the supplied Spacecraft Landing Mission reference. This pack addresses visual layering and motion, not new gameplay.

## Contents

- `water-motion-demo.html`: one self-contained, offline HTML/CSS/JS/SVG motion prototype. No libraries, fonts or network requests. Open it in a browser, use New layout, Replay emergence, Pause motion, the seed field, and Fewer effects.
- `CODING_AGENT_PROMPT.md`: a detailed integration brief for Claude Code/Codex working in the existing project.
- `ASSET_PROMPTS.md`: separate reference-guided artwork prompts plus export checks.
- `asset_manifest.example.json`: a proposed metadata schema separating source art, exact landing footprint, waterline and satellites. All image dimensions/contours in this example require measurement before production use.
- `reference.png`: the original user-supplied flattened reference, for visual comparison only.
- `TEST_RESULTS.md`: the limited standalone checks performed on the prototype.

## Important scope

The original separated raster assets are not included. The orange land, rocks and spacecraft in the demo are intentionally simplified inline SVG placeholders, NOT extracted/reference-identical assets. The prototype demonstrates mechanisms, not final art direction. It has no movement controls, scoring, collisions or landing validation. It has not been integrated into or tested against the user's existing game.

The prototype uses a simple upward translation, opacity and blue wash for emergence. A production-quality reveal can add a small local clipping mask and better sprite-specific wet highlights. Its shoreline paths are simplified geometric templates, not automatically traced silhouettes. Replace/adapt `squareShore()` and `rockShore()` to the final asset's actual contact contour. Optional peripheral land is specified in the prompts but is not drawn by the prototype.

## How to use the pack

1. Review the motion demo. New layout changes positions; replay and resize preserve them. The same seed produces the same arrangement. The example 6 x 6 ship and 36-square-unit top surface have identical footprints.
2. Prepare the reference-matched transparent sprites described in ASSET_PROMPTS.md. Reuse original source exports whenever possible.
3. Give the coding agent CODING_AGENT_PROMPT.md, reference.png, the assets, and the actual game project. Require inspection of existing coordinate/lifecycle code before editing.
4. Implement one island with one shoreline first. Compare its static appearance to the reference before adding multiple animated objects.
5. Add clustered satellites, submerged shimmer and seeded decoration. Profile normal play, zoom and transitions on target devices.

Do not replace the working game with the standalone prototype. The demo's rejection sampler is an illustration; the existing game must remain authoritative for interactive positions and areas.

## Replacing prototype sprites

Find `const ART` in water-motion-demo.html. Set each `src` to a local asset path. `land` and `ship` have a `surface` rectangle (x, y, w, h) expressed in SOURCE IMAGE PIXELS. The demo maps that rectangle to the target square footprint and preserves padding and side faces outside it. Enter measured values, not the example defaults. External sprites are decoded before scene reveal. Invalid/missing sources fall back to clearly labeled placeholder art and log a warning.

The source image alone cannot define the correct local waterline. Update the simplified shoreline templates when changing silhouettes, cliff heights or sprite anchors. A production integration should consume per-asset contour metadata rather than use the same generic outline for every sprite.

## Coordinate and lifecycle rules

Use one logical world coordinate system, a single compatible world/camera transform, and separate inner wrappers for emergence and ripple animation. Treat each island as one logical data object even when its children are drawn in different depth groups. Satellites use local offsets. Never generate an independent visual position that disagrees with the gameplay collider.

Randomize only when a new round/screen requires it. Resize is presentation, not a new random event. Keep terrain still during active play; only water and highlights move. Do not change square areas to solve layout collisions. Reduce decorations or use a known-valid layout instead.

## Performance notes

The prototype uses a single SVG stage for ease of inspection. This is not a recommendation to migrate existing game objects into SVG. Integrate SVG decorations around the existing HTML game instead. Logical depth groups are not instructions to force compositing layers.

Transform/opacity are preferred, but animated SVG content may still repaint. The few animated dash highlights are optional and not compositor-only; Fewer effects hides them and secondary currents/ripples. No full-screen blur, turbulence, displacement filters, frame-by-frame path regeneration, requestAnimationFrame loop, or blanket will-change promotion is used.

Reduced motion renders visible final-state art; the document visibility handler pauses decorative animations. The exported `WaterDemo.destroy()` removes listeners and nodes. Production readiness must use the existing game's lifecycle and handle reduced-motion/cancelation correctly rather than depend only on an animationend event.

## Primary technical references

- High-performance animations: https://web.dev/articles/animations-guide
- Layer count and compositing: https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count
- SVG masking: https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Element/mask
- SVG clipping: https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Element/clipPath
- SVG dashed highlights: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/stroke-dasharray
- SVG dash animation: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/stroke-dashoffset
- Decode before reveal: https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement/decode
- Page visibility: https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API
- Reduced motion: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion
- Non-interactive decoration: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/pointer-events

These document platform behavior. Layer counts, timings, asset counts, coordinates and composition limits in this pack are proposed starting points, not values measured from the reference or guarantees of performance.
