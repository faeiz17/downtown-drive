# Downtown Drive

An arcade street-racing game in the browser: a tuned Mitsubishi Lancer (plate DAK 539) through downtown Los Angeles, built from OpenStreetMap. Arcade handling (AWD turbo, drifting, nitrous, knockable traffic), pick-a-time-of-day (dawn / day / afternoon / evening / night) with optional rain.

> The sections below still describe the earlier Gulberg, Lahore build in places. The map is now `data/osm/dtla.overpass.json` → `public/world/city.world.json` (`npm run build:world`), traffic drives on the right (`DRIVE_SIDE` in `src/data/geo.ts`).

**Audio credits (all CC0, Freesound):** engine loops from #496171 *editboy23*; tyre squeal #71739 *audible-edge*; backfire #105351 *CeebFrack*; nitrous #404333 *strexet*; rain #156994 *chrscrwfrd18*; thunder #581125 *Fission9*. Sky HDRIs: Poly Haven (CC0).

## Setup

Node 20.19 or newer.

```bash
npm install
npm run dev
```

`predev` checks the cached map and the car model and rebuilds them if their sources are newer. Open the URL Vite prints (default http://localhost:5173).

| Script | What it does |
|---|---|
| `npm run dev` | Play in the browser |
| `npm run build` | Typecheck and production build into `dist/` |
| `npm run fetch:osm` | Download Gulberg from the Overpass API (`-- --force` to refresh) |
| `npm run build:world` | Compile the OSM cache into `public/world/gulberg.world.json` |
| `npm run build:car` | Rebuild `public/models/lancer.glb` from the Sketchfab base mesh |
| `npm run validate:car` | Check the GLB size, compression, and node names |
| `npm run test:physics` | Headless 0–100, top speed, braking, and handbrake checks |
| `npm run smoke` | Headless drive: day, night, interior camera, console errors |

## Controls

Pakistan drives on the left. The car is right-hand drive. The 4-speed gearbox shifts by itself — the dash shows **D** or **R**, and you never select a gear. Hold the brake at a standstill to reverse; press the accelerator to go forward again.

| Action | Keyboard | Gamepad |
|---|---|---|
| Accelerate | W / ↑ | RT |
| Brake / reverse | S / ↓ | LT |
| Steer | A D / ← → | Left stick |
| Handbrake | Space | RB / A |
| Horn | H (hold) | L3 / B |
| Headlights | L | D-pad up |
| Indicators | Q / E | D-pad left / right |
| Hazards | Z | D-pad down |
| Camera | C | Back / View |
| Look back | B | R3 |
| Orbit camera | Drag | Right stick |
| Reset onto the road | R | Y |
| Minimap | M | — |
| Pause | Esc / P | Start |

Cameras, in order: chase, far chase, hood, interior. Chase FOV opens up with speed. Headlights turn on by themselves after dark.

The main menu has Play, Settings (Low / Medium / High, time of day, smog, traffic, volumes), and this control list.

## Architecture

```
src/car        Lancer runtime: GLB, wheels, lights, decals
src/world      Chunked roads, buildings, plots, instanced props
src/physics    Rapier world, raycast suspension, tyres, 4-speed auto
src/traffic    Lane graph, signals, rickshaws / bikes / cars
src/render     Day/night sky, postprocessing, quality presets
src/camera     Chase, hood, interior
src/audio      Synthesised inline-4 engine, tyre squeal, horn, city
src/core       Game loop, input, settings, profiler, frame pacer
src/ui         Menu, HUD, minimap
src/data       Shared geo projection and world types
scripts/       OSM fetch, world compile, car export
data/osm/      Cached Overpass JSON (offline after the first fetch)
public/world/  Compiled world the game loads
public/models/ lancer.glb
```

Each frame the game steps physics at a fixed rate, streams world chunks and colliders around the car, updates traffic, then draws through SSAO, motion blur, bloom, ACES tone mapping, and SMAA (which of those run depends on the quality preset).

## The car

Findings from the photos are in [`docs/car-reference.md`](docs/car-reference.md).

**Decision: edit a real CS-generation mesh instead of photogrammetry or a from-scratch model.** The photo set is a walk-around, not a survey with enough overlap for COLMAP. A first procedural body had the wrong proportions. The shipped model starts from [Mitsubishi Lancer 2005 by 87-Motors](https://sketchfab.com/3d-models/mitsubishi-lancer-2005-35b9078ad80b44a9b87634f17e1231dc) (Sketchfab, CC-BY-4.0), stored at `assets-src/sketchfab-lancer-2005.glb`. `scripts/car/editLancer.ts` then:

- drops the roof rack and fog lamps
- paints it `#1d3658` (sampled from overcast door and quarter-panel photos) with a clearcoat
- adds black mesh wheels, Dunlop sidewall lettering, a trunk wing, sunroof, smoked glass, mud flaps, visors, and Punjab plate DAK 539
- replaces the tail lamps with Altezza-style lenses (separate brake, tail, reverse, and indicator elements)
- moves the interior to right-hand drive and splits the steering wheel onto its own pivot

Wheel positions are measured from the base mesh arches: wheelbase 2.59 m, track 1.47 m, 185/60 R15. The GLB is about 1.1 MB with meshopt compression (budget 10 MB). Separate nodes exist for the body, four wheels, steering wheel, headlights, tail lamps, brake lamps, and glass, so they can spin, steer, and light up.

The 1.6 automatic is modelled as 105 hp / 150 Nm through a 4-speed torque converter that flares to its ~2,700 rpm stall speed at full throttle. `npm run test:physics` measures 0–100 km/h in 13.6 s, full-throttle upshifts at 56 / 106 / 162 km/h, 100–0 braking in 44 m and a top speed of about 170 km/h (published figures are roughly 12–13 s and 180 km/h). Reverse is limited to about 30 km/h. ABS, traction control, stability, and counter-steer are on by default and can be turned off in Settings (with assists off the front wheels will spin on launch).

The engine sound is synthesised in `src/audio/EngineSound.ts`: loops are rendered from simulated combustion pulses of an inline-4 (even 180° firing, slight cylinder-to-cylinder variation, exhaust resonances) at six rpm points, on and off throttle, then crossfaded and pitched live. It adds induction roar, overrun crackle when lifting off at high rpm, and a muffled cabin version for the interior camera. `scripts/debug/engine-audio.ts` renders a rev sweep to WAV plus a spectrogram for checking.

## The map

**Decision: widen the requested box so Kalma Chowk is not on the edge.** The brief asked for latitude 31.500–31.535, longitude 74.330–74.365. Kalma Chowk (31.5048, 74.3317) sat about 150 m inside the west edge, so the fetch uses 31.498–31.535, 74.325–74.362. That still covers Main Boulevard Gulberg, MM Alam Road, Liberty Market / Liberty Chowk, Hussain Chowk, and Kalma Chowk, and it includes the Lahore Canal, Canal Road, Gymkhana, and Gaddafi Stadium.

**Decision: fill gaps procedurally.** OSM here is thin (on the order of a thousand building footprints, few tagged lamps). Roads use highway class and lane tags for width, markings, sidewalks, curbs, medians, and roundabouts. Buildings extrude real footprints, using height or level tags when they exist and otherwise 2–6 commercial floors or 1–3 residential. Untagged blocks become plots with boundary walls and gates. Trees, streetlights, electricity poles, and billboards are placed from the road graph and landuse. Street names on the minimap are `name:en`, falling back to `name`.

You spawn on Main Boulevard Gulberg beside Mega Tower (63-B, next to KFC), in the left lane.

The world is compiled once to `public/world/gulberg.world.json` and loaded from disk, so play does not need the network. Geometry is chunked, props are instanced with a near/far LOD, and static colliders stream with the car.

## Trailer

`npm run` equivalents (all via tsx): `scripts/trailer.ts preview|render|post [landscape|portrait]`. `render` plays 13 scripted sequences
frame by frame in headless Chrome (drifts are ghost-mode takes validated against prop clearance), `post` grades, adds the title, mixes audio
and encodes `showcase/downtown-drive-trailer-45s.mp4` (plus `-vertical.mp4`). `scripts/cinematic.ts` is unchanged.

**Music and SFX.** The music (135 BPM, drops at 4 s and 36 s) is composed procedurally in `scripts/trailer/audio.py`; no third-party music.
SFX samples (CC0): Freesound #496171 (editboy23, engine), #71739 (audible-edge, squeal), #105351 (CeebFrack, backfire),
#404333 (strexet, nitro), #156994 (chrscrwfrd18, rain), #581125 (Fission9, thunder). HDRIs and textures: Poly Haven (CC0).
Billboard brands are invented.

## Attribution

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the [Open Database License](https://opendatacommons.org/licenses/odbl/) (ODbL). Buildings, trees, lamps, and shop signage that are not in the extract are procedural.

Car base mesh: “Mitsubishi Lancer 2005” by 87-Motors, [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/). Changes are the edits listed above.

## Performance

The game is GPU-bound on high-DPI screens, so measure at the real device scale. `npx tsx scripts/bench.ts medium 40 2` drives the autopilot through the streets in a 1512×945 window at Retina 2× and reports GPU time (`EXT_disjoint_timer_query_webgl2`), CPU time per system and jank. `scripts/debug/gpucost.ts` shows what each feature costs at a fixed view.

GPU time per frame on an Apple M3 Pro at Retina 2×:

| Preset | Before tuning | Now |
|---|---|---|
| Medium | 21.7 ms (can't hold 60 fps) | 6.5–11 ms |
| High | 93.6 ms (~10 fps) | ~10 ms at pixel ratio 1.0, up to 16 ms at 1.25 |

CPU time is 4–5 ms per frame. Where the GPU time went, and what changed:

- **SSAO** was about half the frame. It now runs at half resolution in N8AO's Performance mode.
- **Lights.** There were 13; there are now 3 on Medium. The sun and moon share one light and the headlights are one spot. Street point lights run on High only, stay visible all night so shader programs never recompile mid-drive, and switch off at dawn.
- **Sky.** The Preetham sky renders into a cubemap only when the sun moves, instead of shading every pixel every frame.
- **Shadows.** 2048 maps with a tight camera. Only props in an inner ring cast shadows, and chunk building meshes are split into quadrants so both cameras cull them.
- **Post-processing.** The NaN/HDR sanitiser shares the motion-blur pass, and it runs before bloom.
- **Dynamic resolution** keeps the frame inside its budget. The pixel ratio changes at the start of a frame, because resizing the canvas clears it.
- **Frame pacing** (`src/core/FramePacer.ts`). On a 120 Hz screen the game renders on an even cadence (120 fps if it fits, otherwise a locked 60) instead of alternating 8 ms and 16 ms frames.
- **Garbage collection.** Vehicle physics, the camera and traffic avoid per-frame allocations. Traffic physics bodies are pooled and pre-warmed during loading.

Driving feel: keyboard steering reaches full lock in about 0.18 s (it was about 0.7 s through two stacked ramps). The chase camera uses frame-rate-independent exponential damping instead of a spring, so it doesn't overshoot or wobble at 60, 120 or 144 Hz.

## Claude Code skills

`.claude/skills/` holds three community skills, reviewed before installing (no scripts, network calls or credential access). The rules above follow from them:

- `game-developer` (Jeffallan/claude-skills, MIT): profile first, object pooling, no allocations in update loops, delta-time movement, tuning values kept together
- `three-best-practices` (emalorenzo/three-agent-skills, MIT): pixel-ratio limits, ≤ 3 dynamic lights, shadow sizing, merged post-processing passes, `setAnimationLoop`, streaming, disposal
- `shader-techniques` (majiayu000/claude-skill-registry, MIT): cheap post shaders and avoiding extra full-screen passes

The Blender, Unity/VRoid pipeline and CAD/3D-printing skills from the same list don't apply to a browser Three.js game and aren't installed.
