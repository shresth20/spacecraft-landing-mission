# Reference-matched asset preparation

The pack does not contain original separated raster artwork. `reference.png` is the user's flattened source image; `water-motion-demo.html` contains only labeled vector placeholders. Exact source sprites should be reused whenever available. Generating or inpainting a replacement can approximate the reference but does not recover the original hidden pixels.

## Shared style instructions

Use the supplied reference image as the sole art-direction reference. Preserve its near-top-down camera, very shallow visible side faces, orange mineral terrain, soft-shaded vector-like 2.5D rendering, restrained crack texture, clean edges, consistent upper-left lighting, and polished educational-game appearance. Do not switch to photorealism, a different isometric angle, pixel art, heavy outlines, tall cliffs, tropical beaches or detailed 3D materials. No text, interface, numbers, plants, coral, grasses or added characters. Export individual sprites with true alpha transparency where requested, not a checkerboard painted into the image. Do not include neighboring objects or cyan water/wave fringes in isolated dry sprites.

The following are asset-generation/editing prompts, not claims that these assets have already been made.

## 1. Water-only background

Using the reference, create only the underlying deep blue alien-water background in the same visual style and color family. Retain gentle broad tonal variation and subtle texture. Remove all islands, rocks, submerged objects, plants, ships, controls, hearts, text, sparkles, foam, object-shaped waterline curves and visible wave strokes. No sunlight reflection, bright white patches or concentrated light-blue glow. The image should be a clean calm water base over which moving SVG effects can be drawn. Full-bleed landscape, approximately 16:9. This background is opaque, not transparent.

Suggested export: water-base.webp; one background at a resolution justified by the actual display/zoom. A 1920 x 1080 source is a practical starting point for review, not a mandatory runtime texture size.

## 2. Square landing platform

Isolate one orange rocky landing platform matching the reference's material, shading and near-top-down camera. Its playable top surface must be an exact square, with four sharp corners and straight sides. Retain a restrained crack texture and only the reference's shallow side thickness. Remove all numbers, text, little rocks, plants, water, cyan waves, glows extending into water and detached shadows. Keep the entire square unobstructed. Do not cut, bevel away, distort or round the playable corners. Center one platform on a truly transparent background with small consistent padding. Create alternate texture variants without changing camera angle or footprint geometry.

Suggested exports: land-square-01.webp to land-square-03.webp, usually 512-768 pixels across during production review. Measure the actual square surface rectangle and contact silhouette after export; do not infer them from the canvas border.

## 3. Separate small dry rocks

Create six to eight individual small orange rock variants matching the landing platform's material, reference camera angle, shallow thickness and lighting direction. Each is a separate reusable sprite with an irregular natural silhouette and restrained faceted shading. No square platform, plant, water, foam, cyan glow, text, grounded water shadow or background. True alpha transparency. Keep the perspective and apparent depth consistent across the entire set. Prefer separately exported images rather than an unsegmented contact sheet.

Suggested exports: dry-rock-01.webp to dry-rock-08.webp, often 128-256 pixels across after downsampling for runtime.

## 4. Submerged blue/teal rock clusters

Create four to six isolated underwater rock clusters in the exact visual family of the blue/teal submerged rocks in the reference. Use softly shaded faceted forms, subdued blue-green contrast and a sense of underwater depth. Match the same near-top-down camera. Each cluster is isolated on true transparency. No rectangular blue water background, opaque haze panel, bright foam ring, plants, coral, fish, text or surface waves. Blue/teal tint may be baked into the rock material; surface shimmer will be added in code. Avoid the bright orange appearance of dry rock.

Suggested exports: submerged-rocks-01.webp to submerged-rocks-06.webp, often 256-384 pixels across as a starting point.

## 5. Optional peripheral land fragments

Create three to four irregular orange rocky land fragments matching the main platform's material and shallow camera view, for partial visibility at the edges of the game screen. Each fragment is a standalone transparent sprite with a complete clean silhouette. No water, foam, plants, text, small surrounding rocks or baked glow. These are environmental framing objects, not alternative playable square platforms. Keep detail modest.

Suggested exports: edge-land-01.webp to edge-land-04.webp. Use at most a few partially offscreen instances and omit them when they crowd gameplay.

## What to reuse unchanged

Reuse existing separated spacecraft body, nozzles, flame and controller components. Do not regenerate these merely to implement moving water. Keep UI labels, numbers and arrows in the existing interactive/localized layers.

## Export checks

- Verify alpha by viewing each sprite over both a dark and a light test background.
- Ensure there is no blue rectangle or cyan baked shoreline around it.
- Keep square top surfaces truly square and free of satellite rocks.
- Record source image size and the exact top-surface/footprint bounds.
- Trace the water-contact contour in sprite coordinates; it can differ from the square top because of a shallow cliff.
- Keep shadows, glow and exhaust outside gameplay footprints.
- Make runtime dimensions proportional to visible size and actual zoom/DPR needs; larger source artwork is not automatically better.
- Avoid rotating/reflecting sprites in ways that change their lighting or camera direction.

## Why a screenshot crop is not enough

A crop includes the neighboring water and any baked waves, and text removal leaves unknown terrain behind it. Masking can isolate visible pixels, but the screenshot does not contain independent original layers or fully hidden surfaces. Source sprite exports offer the closest match. Reference-guided editing is a fallback, with its visual changes reviewed explicitly.
