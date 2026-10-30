"""Run with Blender: blender -b --python scripts/prepare-model.py -- --help.

Create a separate, uncompressed glTF 2.0 game asset from an authoring model.
UVs and PBR textures are retained; the original file is never modified.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys
import tempfile

import bpy
import bmesh
from mathutils import Vector

parser = argparse.ArgumentParser()
parser.add_argument("--source", required=True)
parser.add_argument("--output", required=True)
parser.add_argument("--triangles", type=int, default=60000)
parser.add_argument("--length", type=float, default=5.48)
parser.add_argument("--texture-size", type=int, default=1024)
parser.add_argument("--yaw", type=float, default=0)
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
source, output = Path(args.source).resolve(), Path(args.output).resolve()
assert source != output
output.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(source))
objects = [o for o in bpy.context.scene.objects if o.type == "MESH"]
bpy.ops.object.select_all(action="DESELECT")
for obj in objects:
    obj.select_set(True)
bpy.context.view_layer.objects.active = objects[0]
bpy.ops.object.join()
obj = bpy.context.object
obj.name = "maextro-s800"
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
source_faces = sum(len(p.vertices) - 2 for p in obj.data.polygons)
if args.yaw:
    obj.rotation_euler.z = math.radians(args.yaw)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
bounds = [obj.matrix_world @ Vector(p) for p in obj.bound_box]
low = Vector([min(p[i] for p in bounds) for i in range(3)])
high = Vector([max(p[i] for p in bounds) for i in range(3)])
center = Vector(((low.x + high.x) / 2, (low.y + high.y) / 2, low.z))
scale = args.length / (high.y - low.y)
for vertex in obj.data.vertices:
    vertex.co = (vertex.co - center) * scale
obj.data.update()
# glTF duplicates vertices at UV/normal seams. Weld geometric duplicates before
# collapse so each UV island cannot shrink into an independent floating sheet.
topology = bmesh.new()
topology.from_mesh(obj.data)
bmesh.ops.remove_doubles(topology, verts=list(topology.verts), dist=0.0001)
bmesh.ops.recalc_face_normals(topology, faces=list(topology.faces))
topology.to_mesh(obj.data)
topology.free()
obj.data.update()
if source_faces > args.triangles:
    decimate = obj.modifiers.new("game-silhouette", "DECIMATE")
    decimate.ratio = args.triangles / source_faces
    decimate.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=decimate.name)
for polygon in obj.data.polygons:
    polygon.use_smooth = True

# glTF permits only specular factors in [0,1]. The generated source had 2.0.
# Preserve the original PBR maps while avoiding unsupported extension reliance.
for material in obj.data.materials:
    material.use_backface_culling = False
    for node in material.node_tree.nodes:
        if node.type == "BSDF_PRINCIPLED":
            node.inputs["Specular IOR Level"].default_value = 0.5
            node.inputs["Specular Tint"].default_value = (1, 1, 1, 1)

with tempfile.TemporaryDirectory(prefix="neon-model-textures-") as temporary:
    for index, image in enumerate(bpy.data.images):
        if image.name in {"Render Result", "Viewer Node"} or not max(image.size):
            continue
        # Imported GLB images are lazy. Load before detaching the packed source,
        # otherwise an exporter may silently reuse the original 4K image bytes.
        image.pixels[0]
        if image.packed_file:
            image.unpack(method="REMOVE")
        size = max(image.size)
        if size > args.texture_size:
            factor = args.texture_size / size
            image.scale(round(image.size[0] * factor), round(image.size[1] * factor))
        color = "normal" not in image.name and "metallic" not in image.name and "roughness" not in image.name
        image.file_format = "JPEG" if color else "PNG"
        image.filepath_raw = str(Path(temporary) / f"map-{index}.{'jpg' if color else 'png'}")
        image.save()
        image.reload()
    bpy.ops.export_scene.gltf(
        filepath=str(output),
        export_format="GLB",
        use_selection=True,
        export_image_format="AUTO",
        export_jpeg_quality=90,
        export_animations=False,
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        export_draco_mesh_compression_enable=False,
    )

faces = sum(len(p.vertices) - 2 for p in obj.data.polygons)
report = {
    "sourceFile": source.name,
    "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
    "sourceBytes": source.stat().st_size,
    "sourceTriangles": source_faces,
    "file": output.name,
    "bytes": output.stat().st_size,
    "triangles": faces,
    "textureMaxSize": args.texture_size,
    "dimensionsMetres": {"width": obj.dimensions.x, "height": obj.dimensions.z, "length": obj.dimensions.y},
    "gltfCoordinates": "Y up, ground pivot, longitudinal Z axis; runtime orientation verified visually",
    "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
    "tools": {"blender": bpy.app.version_string},
    "notes": "AI reconstruction; single static mesh, no wheel rig. Original source retained separately.",
}
output.with_suffix(".json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report))
