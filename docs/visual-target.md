# Visual target

What "polished, cinematic Three.js driving demo" means for this project, where the game stood at the start of
the showcase pass, and what is being changed. The "before" set is in
[`screenshots/before/`](screenshots/before/sheet.jpg), produced by `npx tsx scripts/screens.ts`.

## References

Captured with `scripts/debug/refshots.ts` into [`references/`](references/). Four are used (the brief asked for 3–5).

| Reference | Why it is a reference |
|---|---|
| [three.js `webgl_materials_car`](https://threejs.org/examples/webgl_materials_car.html) ([shot](references/threejs-materials-car.png)) | Car paint done right: clearcoat over metallic flake, an HDR environment giving long soft reflections along the body, a soft contact shadow under the car. |
| [Bruno Simon's portfolio](https://bruno-simon.com/) ([shot](references/bruno-simon.png)) | Art direction and cohesion: one warm palette across every object, soft coloured shadows, dense foliage made of alpha cards, particles and tyre trails that react to driving. Stylised, but everything belongs to the same picture. |
| [Threejs-Punk Drive](https://threejspunk.vercel.app/) ([shot](references/threejs-punk-drive.png)) | Night mood: emissive signage with real bloom, depth of field and bokeh, wet reflective road, lens effects. WebGPU + TSL. |
| [PureDrive-RT configurator](https://puredrive-rt.nourtin.com/) ([shot](references/puredrive-rt.png)) | Production restraint: HDR lighting, clean tone mapping, no banding or aliasing, adaptive quality that holds frame rate. |

Not captured:
- Slow Roads (slowroads.io) sits behind a Cloudflare bot check, and I did not try to get around it.
- racing.pmnd.rs failed with a network error.
- Little Workshop's "Track" and "Infinitown" demos returned 502.

## What makes the references look good

1. **Image-based lighting.** Reflections and ambient light come from an HDR environment, so metal, glass and paint show a real sky and horizon instead of a flat gradient.
2. **Tone and grade.** The image is graded on purpose: warm highlights, cooler shadows, lifted blacks for haze, nothing clipped. Exposure is balanced so interiors and skies both hold detail.
3. **Shadows.** Crisp near the camera, soft and present in the distance, and always a contact shadow under the car.
4. **Surface detail.** Albedo, normal and roughness variation on every large surface. The road shows aggregate, patches, cracks and stains, and its roughness breaks up the sky reflection.
5. **Vegetation.** Trees have branch structure and leaf cards with light passing through, not solid blobs.
6. **Temporal stability.** Thin geometry (wires, poles, lane lines, railings) does not crawl or shimmer when the camera moves.
7. **Motion.** The car sits rock-steady in frame, with the camera easing behind it. Effects respond to driving: smoke, skid marks, a little shake that grows with speed.
8. **Composition.** Depth cues from haze, a horizon you can read, lights that bloom at night, and a photo/replay camera that frames the car like a film shot.

## Where the game fell short (before)

- **Trees** are low-poly green blobs on a stick. This is the single biggest "toy" tell in every shot.
- **Lighting is flat.**
  - Noon is washed out and grey-white, with weak, short-range shadows from a single 2048 map covering 55–70 m.
  - Dusk has a saturated analytic sky with no clouds and dark, unlit geometry.
  - Night is mostly black with a black sky.
- **No colour grading.** The image has no palette. Greens are saturated, everything else is pale.
- **Exposure.** The hood and the beige interior clip to white at noon.
- **Surfaces are procedural canvases.** The asphalt has no normal detail, sidewalks are a loud diamond pattern, and facades are flat boxes with painted windows.
- **Aliasing.** Overhead wires, poles, lane markings and the curb stripes shimmer in motion. SMAA runs only on High and does not fix sub-pixel crawl.
- **Reflections** come from the analytic sky only: no clouds, no horizon detail, weak at night.
- **Traffic** is box-built.
- **No driving feedback effects:** no skid marks, no smoke, no camera response to the road surface.
- **No way to frame a shot:** no photo mode, no replay.

## Target for this pass

Hero stretch: **Main Boulevard Gulberg around the spawn** (about 1 km of dual carriageway with a green median, from the Jail Road end to the Main Market / MM Alam junction). The rest of the map keeps its current level of detail but inherits the global lighting, grading, anti-aliasing and road material.

- **Smooth:** fixed-step physics with interpolated rendering, verified by measurement; temporal anti-aliasing.
- **Lit:** Poly Haven HDRIs for sky, reflections and ambient light at day, dusk and night; cascaded shadow maps; a LUT grade for a warm, slightly hazy Lahore look.
- **Textured:** real PBR textures (Poly Haven / ambientCG, KTX2) on the road, sidewalks and walls; road decals in the hero stretch.
- **Alive:** proper trees, denser signage, better traffic models, tyre smoke, skid marks, speed shake, and a cinematic replay / photo camera.
- **In budget:** Medium holds 60 fps at Retina 2× with the GPU under 12 ms per frame, no console errors, physics tests passing.
