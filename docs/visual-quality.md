# HARBOR / 01 — first quality slice

[Open the live study](https://zhudaandzhuer.github.io/zhuda-neon-racer/visual.html).

The goal is a believable, controllable Web 3D scene with an eventual AAA visual feel. This slice prioritizes visual capability over device budgets. It is separate from the stable race entry and preserves its driving rules and saves. EXPLORE uses a third-person arcade vehicle with a fixed 120 Hz simulation: acceleration, coasting momentum, brake-before-reverse, speed-sensitive steering, lateral grip and handbrake slip. A suspended body pitches/rolls separately from four independently steered/spinning wheels. A damped chase camera has independent orbit, automatic return while driving and facade obstruction checks. The bridge connects to the quay through an actual access ramp and forecourt; a capsule footprint contacts paving edges, warehouses, containers and crane legs. This is an arcade handling model, without a full rigid-body suspension solver.

Controls: W/up accelerates, S/down brakes then reverses, A/D or left/right steers, Space is the handbrake, Shift boosts, drag or touch orbits, R resets. Touch controls include throttle, reverse, steering and handbrake. The speedometer shows km/h and D/N/R. DRIVE remains the presentation path.

The entire 5.42 × 2.12 m capsule now contacts solid boxes and the connected paving perimeter. Movement advances to contact and projects the remaining displacement and velocity along the wall; it does not bounce or commit independent X/Z moves. Rotation is checked after translation and clips to the last clear orientation, so a blocked turn cannot trap the car in an overlapping pose or prevent reverse from making room. Bridge/ramp/forecourt joins stay open. A head-on impact stops the car; S reverses away without RESET. This remains a consumer arcade solver rather than a general rigid-body engine.

## Graphics and performance settings

The default is **Auto**. Open SETTINGS in any presentation view or while driving. The modal blocks driving input and pauses vehicle/presentation movement; the scene continues rendering so its performance can be measured. Native dialog focus handling and Escape close are supported. Mode and 30/60 FPS target save locally; unavailable persistent storage falls back to the session. A target is a goal, not a guaranteed frame rate.

| Mode | Render budget | Shadows | Planar reflections | Post effects |
| --- | --- | --- | --- | --- |
| Performance | Up to .8 DPR / .8M pixels | Off | Off | HDR / ACES; AO, bloom and TAA off |
| Balanced | Up to 1.2 DPR / 1.8M pixels | 2048, two cascades, 85 m | 640 × 400, up to 15 FPS | Light bloom / low TAA; AO off |
| High | Up to 2 DPR / 8.3M pixels | 4096, four cascades, 130 m | 1280 × 800, up to 60 FPS | High AO / TAA, bloom, HDR / ACES |

Pixel budgets respect native density and the SDK's .5 minimum DPR. Auto starts at Performance on coarse-pointer or limited-memory/core devices and Balanced otherwise. After warmup it measures actual **Laya render ticks**, including the 30 FPS engine setting. Sustained slow windows lower a tier, then lower resolution within Performance. Upgrades require 20 seconds of stable windows; a failed trial blocks further upgrades for 90 seconds. Hidden-tab intervals and initial shader/resize warmup do not trigger quality changes. Manual modes never change themselves. Driving rules and the fixed vehicle simulation are preserved.

Reflection resizing destroys the previous camera and target. Disabling reflections disables that camera, rather than merely hiding the reflected pixels. Repeated quality switches reach a bounded target pool. All source models/textures are still loaded: these settings control rendering cost and do not introduce model streaming or geometry LOD.

The WebGL report records short 16-frame stationary captures for each tier. Results vary with concurrent rendering load and are test-environment observations, not sustained device guarantees or GPU timings. A separate live in-app browser check settled to Auto · Performance at approximately 60 FPS.

## Delivered baseline

- A 240 m physically sized harbor bridge, shoulders, joints, railings, drainage grates, access covers, resurfaced repairs, cranes, warehouses, quay and water. Containers and warehouses meet their paved support surfaces.
- Real CC0 4K pure-sky HDR, matching sky orientation and direct shadow light, 256px nine-mip offline GGX specular convolution and diffuse SH9.
- 2K photographed asphalt/concrete maps with explicit sRGB/data handling, UV-derived tangent frames and OpenGL normal convention in color/depth-normal passes.
- Native PBR surface hooks for wetness, tire wear, paint and window grids; real 1280×800 half-float planar pool reflections.
- 4096 soft cascaded shadows, HDR, high-quality AO, restrained bloom, ACES and TAA with camera-cut reset.
- A separate 319,998-triangle S800 with original 4K PBR maps. The generated normal strength is reduced to .25 in this scene. The original source is retained; this is a static reconstruction with no independent wheel rig.
- Free driving uses the separate [authored S800 rig](../source-assets/maextro_s800_hero_v2/README.md), with rolling tyres, Ackermann-style front steering and a suspended body. The original vehicle remains in the five presentation views. Both model sources and limitations are documented.
- Imported authored hard-surface tower, near-field barrier and three-bay dock warehouse models, replacing uneven AI candidates. Source dimensions, validation, material inventories and hashes are in `public/visual-assets/scenery.json`. The warehouse retains its full 372,884 triangles and all original normals, tangents, UVs and PNG maps; [its source scripts](../source-assets/dock_warehouse/README.md) are included. All are static assets; the rest of the scenery is authored in this consumer.

`public/visual-assets/sources.json` records CC0 source URLs, bytes and SHA-256. The reproducible Blender/NumPy script `scripts/prepare-visual.py` creates the convolved light and packed native material maps. `scripts/prepare-model.py` creates the separate hero vehicle without modifying the original. The engine repository contains no game art.

## Acceptance and evidence

Run `npm test` for the rule, handling and adaptive quality checks, including frame-rate equivalence, acceleration/coast/brake/reverse, zero-speed steering, obstacle contact, continuous ramp support, camera obstruction, safe preference loading, pixel budgets, manual locking, hidden-tab handling and upgrade/downgrade hysteresis. Run `node tests/visual.mjs` after typecheck/build for actual WebGL checks. It locks High quality through a URL override for deterministic lighting checks, uses a clean Chrome profile and repository subpath, captures five views and `visual-driving.png`, and saves `evidence/visual-verification.json`. It exercises the loaded wheel nodes, body roll, momentum/braking, independent orbit and real touch cancellation, as well as GPU cube-face readback, PBR bindings, reflection/shadow/lighting contributions and 30 drawn pipeline replacements. It also switches real quality settings, reloads saved preferences, checks modal input isolation and verifies bounded resources across repeated reflection/pipeline resizing. Handling snapshots are sampled in the same browser evaluation against simulation time, avoiding CDP delays between input release and state sampling. Estimated resource memory is labeled as an estimate, not measured GPU usage. This quality study has no mobile performance acceptance claim.

Local capture uses a 1600 × 1000 viewport; software-rendered CI uses 1024 × 768 with the same scene assets, shader pipeline, reflection target and shadow settings. The report records the viewport. Each check logs progress, and transport timeouts/renderer crashes fail explicitly.

The complete 10-check suite also passed locally using SwiftShader software rendering at the CI viewport, including all 30 full-scene pipeline replacements with unchanged resource totals. The first bounded cloud run passed all nine visual checks and reached replacement 5/30 before its 20-minute job budget expired. The job budget is now 50 minutes, including the added quality-switch checks. The 30-cycle render evaluation has a 10-minute transport budget: the prior software runner completed 25 cycles at roughly 11 seconds per cycle before its old 5-minute transport limit expired. All 30 cycles and all rendering checks remain required. This is a correctness run without a frame-rate acceptance target.

Rendering tests establish that the features are active and consistent. Screenshot review remains a separate art gate: the current scene still has generic distant architecture, limited prop storytelling and reconstructed car surfaces. The near-field warehouse is authored geometry with recessed doors, canopy, skylights, pipes and ladders; it is reviewed in the actual game lighting. It is not accepted as final AAA quality and does not claim Unreal, Lumen or Nanite parity.

### Accepted rendering evidence

The [13-check real WebGL report](visual-verification.json) includes the loaded driving rig, actual wheel rotation/steering, body reaction, acceleration/coast/brake, independent camera orbit and touch cancellation. Keyboard-driven collision regressions hit the actual warehouse corner, bridge rail and outer quay edge, then reverse free without RESET and verify the visible GLB position. Unit coverage also checks glancing wall slides, simultaneous corner contacts, high-speed thin obstacles and consistent recovery at 30/60/120 render FPS. It also verifies all six cube axes plus fractional mip interpolation, material/4K glTF normal bindings, five settled camera views, the warehouse's rotated metre bounds and support contact, drive/stop behavior, reflection/shadow/lighting pixel changes and 30 drawn pipeline replacements. Native glTF materials use `u_NormalScale`; assigning the `PBRStandardMaterial.normalTextureScale` property to a plain glTF `Material` has no effect. The original normal-map comparison remains in the current report.

All 169 warehouse renderers cast and receive shadows; its world bounds are (−56, −5, 45) to (−38, 13, 75) m. The source GLB separately passed fresh-import bounds and BVH tests for its recessed doors, windows and skylights. The machine-readable report records reflection, shadow and combined-lighting pixel differences for the current capture. These differences demonstrate contribution, not a photorealism score. Resource totals remained exactly stable through the drawn replacement loop.

![Actual in-engine dock view](visual-dock.jpg)

![Actual in-engine bridge view](visual-hero.jpg)

## Grow from small to large

1. **Material and lighting benchmark:** keep fixed hero, road, close-surface and wide cameras. Preserve color-space, normal, shadow, reflection and teardown checks. This establishes the technical baseline delivered here.
2. **One finished hero location:** replace remaining generic warehouse masses with a coherent authored facade kit; add grounded entrances, loading equipment, drain covers, repaired road patches, dirt/decal breakup and plausible object contact. Rework the vehicle's manufactured panels, glass, wheels and separate rig. Review at close distance and in motion. Expand only after this location passes the art gate.
3. **Local light and reflection:** capture/parallax-correct local reflection probes, add authored/baked indirect-light assets with a reproducible source, and validate probe boundaries while driving. Separate material errors from insufficient global illumination. Add depth of field or other cinematic controls only where camera intent requires them.
4. **A continuous playable segment:** connect the finished location to the race's real controls and rules; validate moving shadow/reflection behavior, weather transitions, wet/dry surface consistency, camera collision and cuts. Produce a continuous real render capture, with no pre-rendered footage presented as gameplay.
5. **District and city:** build additional locations from the accepted kit and lighting workflow, then address streaming, LOD and hardware budgets. Performance work must preserve the accepted composition/material response rather than redefine the initial visual target.

Each step is a rendered acceptance milestone, not a feature-count target. The engine owns reusable rendering contracts; this game owns locations, assets, vehicle rigs, weather/art settings and gameplay.
