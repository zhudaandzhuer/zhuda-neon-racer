# S800 driving model

`public/visual-assets/maextro-s800-driving.glb` is the authored reference reconstruction used by HARBOR's free-driving mode. The presentation cameras retain the original textured reconstruction.

- SHA-256: `487ad7cb03d39cda089a8693cb95ebc09f6a3b8932fca522af2a9a67d30cceee`
- 35,748,024 bytes; 1,055,092 triangles; 567 meshes; 15 materials.
- Metres, glTF Y up, +Z front. Body dimensions approximately 2.000 × 1.542 × 5.483 m; 3.370 m wheelbase.
- `wheel_FL`, `wheel_FR`, `wheel_RL`, `wheel_RR` steer about local Y. Each `_axle` child spins about local X. The calipers stay with the steering root. Tyre radius 0.388 m and track 1.720 m are estimates.
- In the consumer, a separate suspended-body node receives acceleration pitch and lateral roll. Wheels retain their contact height. Front steering uses different inner/outer angles; wheel spin follows signed travelled distance.

Source recipes are in `source/`; `validation.json` records fresh GLB reimport, measured bounds, ground contact and wheel pivots. `reference_sources.json` records provenance. The editable `.blend` and reference images are retained in the local model-production archive, `generated_models/maextro_s800_hero_v2/`.

This is a reference reconstruction, with simplified rear styling, windows, interior and lamps. Dimensions alone do not establish accurate body sections or AAA art quality. AI concept views informed the design; they are not final-model renders. Standard metallic/roughness PBR is available; optional clearcoat/transmission/IOR extensions depend on the renderer. No required decoder extension or external image is used.
