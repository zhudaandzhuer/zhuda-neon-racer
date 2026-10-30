"""Fresh-import geometry checks and actual final-GLB previews, never concept renders."""
import bpy, sys, json, math, hashlib, argparse
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree

parser=argparse.ArgumentParser()
parser.add_argument('--views',nargs='*',default=['preview','front','loading_detail'])
parser.add_argument('--samples',type=int,default=48)
parser.add_argument('--device',choices=['CPU','GPU'],default='CPU')
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
OUT=Path(__file__).resolve().parent.parent
path=OUT/'dock_warehouse.glb'
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(path))
bpy.context.view_layer.update()
objects=[o for o in bpy.context.scene.objects if o.type=='MESH']
vertices=[];triangles=[];owners=[]
for ob in objects:
    offset=len(vertices)
    vertices.extend(ob.matrix_world@v.co for v in ob.data.vertices)
    ob.data.calc_loop_triangles()
    for tri in ob.data.loop_triangles:
        triangles.append(tuple(offset+i for i in tri.vertices))
        owners.append({'object':ob.name,'material':ob.data.materials[tri.material_index].name})
lo=Vector(tuple(min(v[i] for v in vertices) for i in range(3)))
hi=Vector(tuple(max(v[i] for v in vertices) for i in range(3)))
dims=[hi.x-lo.x,hi.z-lo.z,hi.y-lo.y]
dimensions_ok=all(abs(a-b)<.005 for a,b in zip(dims,[30,18,18]))
pivot_ok=abs(lo.z)<.001 and abs(lo.x+hi.x)<.001 and abs(lo.y+hi.y)<.001
finite=all(math.isfinite(c) for v in vertices for c in v)
bvh=BVHTree.FromPolygons(vertices,triangles,all_triangles=True)
stats=json.loads((OUT/'stats.json').read_text())
oldlo,oldhi=map(Vector,stats['pre_normalization_bounds_blender'])
center=Vector(((oldlo.x+oldhi.x)/2,(oldlo.y+oldhi.y)/2,oldlo.z))
factor=Vector(stats['normalization_factors_xyz'])
def ap(point):return Vector(tuple((point[i]-center[i])*factor[i] for i in range(3)))
def cast(origin,direction,limit):
    p,n,idx,dist=bvh.ray_cast(origin,Vector(direction),limit)
    return None if p is None else {'point_blender':list(p),'distance':dist,**owners[idx]}
bay_checks=[]
for c in (-9.2,0,9.2):
    probes=[]
    for dx in (-1.5,0,1.5):
        for z in (1.5,3.0,5.5):
            hit=cast(ap((c+dx,-10,z)),(0,1,0),7)
            depth=None if hit is None else hit['point_blender'][1]-ap((0,-6.65,0)).y
            probes.append({'offset_x_m':dx,'height_m':z,'recess_depth_m':depth,'hit':hit,
                           'passed':depth is not None and .70<depth<1.05})
    returns=[]
    for sign in (-1,1):
        hit=cast(ap((c,-6.10,3.1)),(sign,0,0),3.1)
        returns.append({'side':sign,'hit':hit,'passed':hit is not None and 2.4<hit['distance']<2.85})
    bay_checks.append({'center_x_m':c,'front_ray_samples':probes,'side_returns':returns,
                       'passed':all(p['passed'] for p in probes+returns)})
window_checks=[]
for c in (-11.7,-7.8,-3.9,0,3.9,7.8,11.7):
    hit=cast(ap((c+3.32/8,-10,9.92)),(0,1,0),5)
    window_checks.append({'center_x_m':c,'hit':hit,'passed':hit is not None and hit['material'].startswith('Window glazing')})
skylight_checks=[]
for x,y in [(-7.2,-2.2),(7.2,-2.2),(-7.2,4.25),(7.2,4.25)]:
    hit=cast(ap((x+.25,y+.4,20)),(0,0,-1),8)
    skylight_checks.append({'center_xy_m':[x,y],'hit':hit,'passed':hit is not None and hit['material']=='Wired skylight glass'})
report={
 'file':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
 'method':'Fresh final-GLB import in Blender; world-space bounds, actual imported triangles and material-aware BVH rays.',
 'triangles':len(triangles),'vertices_after_import':len(vertices),
 'world_bounds_gltf_xyz':[[lo.x,lo.z,-hi.y],[hi.x,hi.z,-lo.y]],
 'dimensions_m':dims,'expected_dimensions_m':[30,18,18],
 'dimensions_passed':dimensions_ok,'bottom_centre_pivot_passed':pivot_ok,'finite_vertices_passed':finite,
 'loading_bays':bay_checks,'front_glazing':window_checks,'roof_skylights':skylight_checks,
 'passed':dimensions_ok and pivot_ok and finite and all(x['passed'] for x in bay_checks+window_checks+skylight_checks)
}
(OUT/'validation.json').write_text(json.dumps(report,indent=2)+'\n')
print('FRESH_IMPORT_CHECKS '+json.dumps({k:report[k] for k in ['triangles','dimensions_m','dimensions_passed','bottom_centre_pivot_passed','passed']}),flush=True)
if not report['passed']:raise RuntimeError('Warehouse fresh-import verification failed; see validation.json')

scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=args.samples
scene.cycles.use_denoising=True;scene.cycles.adaptive_threshold=.035
if args.device=='GPU':
    try:
        prefs=bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type='METAL';prefs.get_devices()
        gpu=False
        for device in prefs.devices:
            device.use=device.type=='METAL';gpu=gpu or device.use
        if gpu:scene.cycles.device='GPU'
    except Exception as ex:print('CYCLES_CPU',str(ex),flush=True)
print('CYCLES_DEVICE',scene.cycles.device,flush=True)
scene.render.resolution_x=1600;scene.render.resolution_y=1200;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.film_transparent=False
scene.world=bpy.data.worlds.new('Neutral studio environment');scene.world.use_nodes=True
bg=scene.world.node_tree.nodes['Background'];bg.inputs['Color'].default_value=(.17,.20,.23,1);bg.inputs['Strength'].default_value=.65
scene.view_settings.view_transform='AgX'
focus=Vector((0,0,7.9))
def point_at(ob,target):ob.rotation_euler=(Vector(target)-ob.location).to_track_quat('-Z','Y').to_euler()
def light(name,position,energy,size):
    data=bpy.data.lights.new(name,'AREA');data.energy=energy;data.shape='DISK';data.size=size
    ob=bpy.data.objects.new(name,data);scene.collection.objects.link(ob);ob.location=position;point_at(ob,focus)
light('Large daylight key',(12,-20,38),55000,22)
light('Soft facade fill',(-26,-12,23),24000,26)
light('Roof and rear fill',(7,27,33),40000,24)
camera_data=bpy.data.cameras.new('Actual GLB camera');camera_data.type='ORTHO'
camera=bpy.data.objects.new('Actual GLB camera',camera_data);scene.collection.objects.link(camera);scene.camera=camera

def fit_camera(position,target,margin=1.10,subset=None):
    camera.location=position;point_at(camera,target)
    inverse=camera.rotation_euler.to_quaternion().inverted()
    points=[inverse@(v-Vector(target)) for v in (subset or vertices)]
    xs=[v.x for v in points];ys=[v.y for v in points]
    aspect=scene.render.resolution_x/scene.render.resolution_y
    camera_data.ortho_scale=max(max(xs)-min(xs),(max(ys)-min(ys))*aspect)*margin
    # Recenter by projection: all views contain the whole actual export.
    local=Vector(((max(xs)+min(xs))/2,(max(ys)+min(ys))/2,0))
    camera.location+=camera.rotation_euler.to_quaternion()@local

for view in args.views:
    if view=='preview':fit_camera((45,-45,31),focus,1.09)
    elif view=='front':fit_camera((0,-65,9),Vector((0,0,9)),1.08)
    elif view=='rear':fit_camera((0,65,9),Vector((0,0,9)),1.08)
    elif view=='left90':fit_camera((-65,0,9),Vector((0,0,9)),1.10)
    elif view=='loading_detail':
        camera.location=(9,-22,8.6);point_at(camera,ap((.2,-6.2,3.8)));camera_data.ortho_scale=13.2
    elif view=='roof_detail':
        camera.location=(33,-22,38);point_at(camera,Vector((3,1,14.8)));camera_data.ortho_scale=28
    else:raise ValueError(view)
    scene.render.filepath=str(OUT/f'model_{view}.png')
    print('RENDER_START',view,flush=True)
    bpy.ops.render.render(write_still=True)
    print('RENDER_DONE',view,flush=True)
(OUT/'preview_metadata.json').write_text(json.dumps({
 'glb_sha256':report['sha256'],'method':'Fresh import of the final GLB. Actual mesh, UVs and embedded PBR materials.',
 'views':args.views,'resolution':[1600,1200],'samples':args.samples,'lighting':'Neutral studio area lights; no game scene or ground plane.',
 'front_direction':'+Z glTF','front45_azimuth_degrees':45,'left90_azimuth_degrees':90,
 'concept_reference_images_used_as_model_previews':False
},indent=2)+'\n')
