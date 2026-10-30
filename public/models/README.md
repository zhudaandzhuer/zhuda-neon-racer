# S800 game assets

These two GLB files derive from the user-supplied silver/black Maextro S800 AI reconstruction. Four reference views were generated with `gpt-image-2.5-flare`, then processed by Hunyuan 3D V3.1. The original 89,771,936-byte, 1,498,984-triangle GLB remains in the author's source archive and is not shipped with this game.

The neighbouring JSON files record the original and derived SHA-256 hashes, actual triangle counts, byte sizes, texture limits, dimensions and Blender version. The player uses the detailed mesh; three opponents share a reduced mesh and textures. The body keeps its original silver/black PBR maps. Garage choices select handling/power tunes and accent lights on the same chassis.

The source is a single static reconstructed mesh: wheels are not separately rigged or animated, and local vehicle details retain AI reconstruction errors. Vehicle names, design and trademarks retain their respective owners' rights; this independent game does not imply an official vehicle-brand partnership.

To reproduce the conversion, install Blender 5.2 and run from the game repository:

```sh
blender -b --factory-startup --python scripts/prepare-model.py -- \
  --source /path/to/maextro_s800.glb --output public/models/maextro-s800.glb \
  --triangles 56000 --length 5.48 --texture-size 1024
blender -b --factory-startup --python scripts/prepare-model.py -- \
  --source /path/to/maextro_s800.glb --output public/models/maextro-s800-rival.glb \
  --triangles 18000 --length 5.48 --texture-size 512
npm test
```

The converter welds coincident geometry while retaining UV corner data before decimation, resizes the actual embedded texture payloads, and emits ordinary glTF 2.0 without compression extensions. Ground pivot, forward direction and nitro anchors are checked in the playable renderer.
