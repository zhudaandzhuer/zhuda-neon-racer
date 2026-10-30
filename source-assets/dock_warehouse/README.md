# Dock warehouse source

The 30 × 18 × 18 m warehouse is authored geometry with three recessed loading bays, a canopy, industrial windows, roof skylights, ventilation, pipes and a caged maintenance ladder. Dimensions use metres, glTF +Y up, +Z front and a bottom-centre pivot. The scene places it on the quay at Y = −5 m.

The published GLB preserves all positions, geometric normals, tangents, UVs and 12 embedded 2K PNG maps. It has 372,884 triangles, 15 materials and 169 named mesh components. Its 77,567,276-byte size is intentional for this visual capability study. The original editable Blender file remains in the local model-production archive; these scripts reproduce the asset and authored materials.

Requirements: Blender 5.2.2 LTS; Python with NumPy and Pillow. From the repository root:

```sh
python3 source-assets/dock_warehouse/source/make_materials.py
blender -b --python source-assets/dock_warehouse/source/build_warehouse.py
cp source-assets/dock_warehouse/dock_warehouse_full.glb source-assets/dock_warehouse/dock_warehouse.glb
cp source-assets/dock_warehouse/full_stats.json source-assets/dock_warehouse/stats.json
blender -b --python source-assets/dock_warehouse/source/verify_warehouse.py -- --views preview front loading_detail
```

The verification freshly imports the exported GLB, checks world bounds, probes the actual door recesses and returns, glazing and skylights with material-aware rays, then renders the actual mesh. Source inventory, SHA-256, byte counts, embedded map channels and the accepted validation report are recorded in [scenery.json](../../public/visual-assets/scenery.json). A matching hash ties the report to the exact game asset. Preview rendering uses studio lights; in-game screenshots are in [the visual quality report](../../docs/visual-quality.md).

The material palette follows this project's tower/barrier concepts. No concept image is presented as a warehouse mesh preview. The source scripts and authored maps belong to this game project; the engine contains no warehouse or racing assets.
