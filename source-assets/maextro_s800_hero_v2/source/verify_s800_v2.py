"""Verify actual exported GLB coordinates, then independently reimport and render it."""
import bpy, bmesh, math, json, sys, struct, hashlib, argparse
from pathlib import Path
from mathutils import Vector, Matrix, Quaternion
ROOT=Path(__file__).resolve().parent.parent;GLB=ROOT/'maextro_s800_hero_v2.glb'
p=argparse.ArgumentParser();p.add_argument('--preview-only',action='store_true');p.add_argument('--video',action='store_true');p.add_argument('--video-only',action='store_true');p.add_argument('--pathtrace',action='store_true');a=p.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
b=GLB.read_bytes();jn=struct.unpack_from('<I',b,12)[0];d=json.loads(b[20:20+jn]);binoffset=28+jn
# Read raw glTF accessors; checks below do not confuse Blender Z-up with glTF Y-up.
fmt={5126:'f',5125:'I',5123:'H',5121:'B'};ncomp={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}
def accessor(i):
 ac=d['accessors'][i];bv=d['bufferViews'][ac['bufferView']];f='<'+fmt[ac['componentType']]*ncomp[ac['type']];stride=bv.get('byteStride',struct.calcsize(f));off=binoffset+bv.get('byteOffset',0)+ac.get('byteOffset',0)
 return [struct.unpack_from(f,b,off+j*stride) for j in range(ac['count'])]
def transform(node):
 if 'matrix' in node:return Matrix([node['matrix'][i::4] for i in range(4)])
 x,y,z,w=node.get('rotation',[0,0,0,1]);return Matrix.LocRotScale(Vector(node.get('translation',[0,0,0])),Quaternion((w,x,y,z)),Vector(node.get('scale',[1,1,1])))
world={}
def walk(i,mat):
 world[i]=mat@transform(d['nodes'][i])
 for j in d['nodes'][i].get('children',[]):walk(j,world[i])
for i in d['scenes'][d.get('scene',0)]['nodes']:walk(i,Matrix.Identity(4))
names={i:n.get('name','') for i,n in enumerate(d['nodes'])}
def rawverts(filterfn=lambda n:True):
 out=[]
 for i,node in enumerate(d['nodes']):
  if 'mesh' not in node or not filterfn(names[i]):continue
  for pr in d['meshes'][node['mesh']]['primitives']:
   out.extend(world[i]@Vector(v) for v in accessor(pr['attributes']['POSITION']))
 return out
def bounds(v):return [[min(p[i] for p in v) for i in range(3)],[max(p[i] for p in v) for i in range(3)]]
raw_bounds=bounds(rawverts());body_bounds=bounds(rawverts(lambda n: all(k not in n for k in ['Mirror','Tyre','Rim','Hub','Sunrise','Lug','Sidewall','Brake','Caliper'])));wheelreport={}
for code in ['FL','FR','RL','RR']:
 ni=next(i for i,n in names.items() if n=='wheel_'+code);axis=next(i for i,n in names.items() if n=='wheel_'+code+'_axle');ti=next(i for i,n in names.items() if n=='Tyre_'+code);center=world[ni].translation;tv=[world[ti]@Vector(v) for pr in d['meshes'][d['nodes'][ti]['mesh']]['primitives'] for v in accessor(pr['attributes']['POSITION'])];bb=bounds(tv);centroid=Vector([(bb[0][i]+bb[1][i])/2 for i in range(3)]);wheelreport[code]={'center_gltf_m':list(center),'tyre_bounds_gltf_m':bb,'center_matches_tyre':(centroid-center).length<.0002,'tyre_contacts_ground':abs(bb[0][1])<.0002,'axle_at_root':(world[axis].translation-center).length<.00001,'axle_direct_child':axis in d['nodes'][ni].get('children',[])}
# Raw animation samples: require real changing quaternions on each relevant channel.
chan={}
for an in d.get('animations',[]):
 for ch in an.get('channels',[]):
  sm=an['samplers'][ch['sampler']];ts=accessor(sm['input']);qs=accessor(sm['output']);name=names[ch['target']['node']];delta=max(sum((qs[j][k]-qs[0][k])**2 for k in range(len(qs[0])))**.5 for j in range(len(qs)))
  chan[name]={'path':ch['target']['path'],'duration':ts[-1][0]-ts[0][0],'sample_count':len(qs),'changes':delta>.1}
wb=abs(wheelreport['FL']['center_gltf_m'][2]-wheelreport['RL']['center_gltf_m'][2]);track=abs(wheelreport['FL']['center_gltf_m'][0]-wheelreport['FR']['center_gltf_m'][0]);dims=[raw_bounds[1][i]-raw_bounds[0][i] for i in range(3)];bdims=[body_bounds[1][i]-body_bounds[0][i] for i in range(3)]
report={'file':str(GLB),'sha256':hashlib.sha256(b).hexdigest(),'raw_gltf_bounds_xyz':raw_bounds,'body_bounds_xyz':body_bounds,'dimensions_including_mirrors_m':dims,'body_shell_bbox_dimensions_m':bdims,'measured_spec_width_height_length_m':[bdims[0],dims[1],dims[2]],'expected_body_width_m':2,'expected_ground_to_roof_height_m':1.542,'expected_length_m':5.480,'wheelbase_m':wb,'track_estimated_m':track,'wheels':wheelreport,'animation_channels':chan,'extensionsUsed':d.get('extensionsUsed',[]),'extensionsRequired':d.get('extensionsRequired',[]),'raw_gltf_checks':{'body_width':abs(bdims[0]-2)<.006,'height':abs(dims[1]-1.542)<.003,'length':abs(dims[2]-5.480)<.005,'wheelbase':abs(wb-3.37)<.0001,'track':abs(track-1.72)<.0001,'physical_left_right':wheelreport['FL']['center_gltf_m'][0]>0 and wheelreport['FR']['center_gltf_m'][0]<0 and wheelreport['RL']['center_gltf_m'][0]>0 and wheelreport['RR']['center_gltf_m'][0]<0,'ground':abs(raw_bounds[0][1])<.0002,'wheel_centers':all(v['center_matches_tyre'] and v['axle_at_root'] and v['tyre_contacts_ground'] and v['axle_direct_child'] for v in wheelreport.values()),'spin_channels':all(chan.get('wheel_'+c+'_axle',{}).get('changes',False) for c in ['FL','FR','RL','RR']),'steer_channels':all(chan.get('wheel_'+c,{}).get('changes',False) for c in ['FL','FR'])}}
# Verify the actual embedded map payload and normal-map tangent attributes.
report['images']=[{'mimeType':im.get('mimeType'),'embedded':('bufferView' in im and 'uri' not in im),'bytes':d['bufferViews'][im['bufferView']]['byteLength'] if 'bufferView' in im else None} for im in d.get('images',[])]
normalprims=[pr for me in d['meshes'] for pr in me['primitives'] if 'normalTexture' in d['materials'][pr['material']]]
report['raw_gltf_checks']['embedded_maps']=len(report['images'])>=2 and all(im['embedded'] for im in report['images'])
report['raw_gltf_checks']['normal_map_attributes']=all(all(at in pr['attributes'] for at in ['NORMAL','TEXCOORD_0','TANGENT']) for pr in normalprims)
# A genuinely fresh import is the source for all preview images.
bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(GLB));scene=bpy.context.scene;scene.frame_set(1);bpy.context.view_layer.update()
# Clear imported actions temporarily for deterministic verification of neutral and actual rig transforms.
for o in scene.objects:
 if o.animation_data:o.animation_data_clear()
bpy.context.view_layer.update()
roots={c:bpy.data.objects['wheel_'+c] for c in ['FL','FR','RL','RR']};axles={c:bpy.data.objects['wheel_'+c+'_axle'] for c in roots}
neutral={c:{'root':r.matrix_world.copy(),'tyre':bpy.data.objects['Tyre_'+c].matrix_world.copy(),'axle':axles[c].matrix_world.copy()} for c,r in roots.items()}
rigchecks={}
for c in roots:
 ax=axles[c];wheel=bpy.data.objects['Tyre_'+c];start=wheel.matrix_world@wheel.data.vertices[len(wheel.data.vertices)//3].co;center=roots[c].matrix_world.translation.copy();ax.rotation_mode='XYZ';ax.rotation_euler.x=math.pi/2;bpy.context.view_layer.update();end=wheel.matrix_world@wheel.data.vertices[len(wheel.data.vertices)//3].co;centernow=ax.matrix_world.translation.copy();rigchecks[c]={'ninety_degree_spin_moves_vertex_m':(end-start).length,'spin_keeps_pivot_m':(centernow-center).length,'radius_preserved_m':abs((end-center).length-(start-center).length)};ax.rotation_euler.x=0
for c in ['FL','FR']:roots[c].rotation_mode='XYZ';roots[c].rotation_euler.z=.28
bpy.context.view_layer.update()
steer=[]
for c in ['FL','FR']:
 direc=roots[c].matrix_world.to_3x3()@Vector((0,-1,0));steer.append(list(direc))
report['fresh_import_rig_motion']=rigchecks;report['front_steer_directions_blender_xyz']=steer;report['fresh_import_checks']={'spin':all(v['ninety_degree_spin_moves_vertex_m']>.1 and v['spin_keeps_pivot_m']<1e-5 and v['radius_preserved_m']<1e-5 for v in rigchecks.values()),'same_direction_steering':Vector(steer[0]).dot(Vector(steer[1]))>.9999}
for c in ['FL','FR']:roots[c].rotation_euler.z=0
bpy.context.view_layer.update()
# Compare fresh-import Blender world vertices converted into glTF coordinates.
vv=[o.matrix_world@v.co for o in scene.objects if o.type=='MESH' for v in o.data.vertices];importbounds=bounds([Vector((v.x,v.z,-v.y)) for v in vv]);report['fresh_import_bounds_as_gltf_xyz']=importbounds;report['fresh_import_checks']['bounds_equal_raw']=max(abs(importbounds[j][i]-raw_bounds[j][i]) for j in range(2) for i in range(3))<.0001
# Watertight panel / tyre checks after welding only UV-split duplicate vertices.
closed={}
for name in ['Front_door_L','Front_door_R','Rear_door_L','Rear_door_R','Hood','Windshield','Roof_panel','Tyre_FL','Tyre_FR','Tyre_RL','Tyre_RR']:
 o=bpy.data.objects[name];bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.000001);closed[name]={'boundary_edges':sum(e.is_boundary for e in bm.edges),'nonmanifold_edges':sum(not e.is_manifold for e in bm.edges),'shell_thickness_m':o.get('shell_thickness_m',None)};bm.free()
report['fresh_import_closed_panels']=closed;report['fresh_import_checks']['physical_closed_shells']=all(v['nonmanifold_edges']==0 for v in closed.values())
normalchecks={}
for name,direction in [('Hood',(0,0,1)),('Roof_panel',(0,0,1)),('Front_door_R',(-1,0,0)),('Front_door_L',(1,0,0)),('Windshield',(0,-.5,.5))]:
 o=bpy.data.objects[name];v=Vector(direction).normalized();areas=[(p.area,p.normal.dot(v)) for p in o.data.polygons];normalchecks[name]={'outward_surface_area_m2':sum(ar for ar,dot in areas if dot>.6),'inward_back_surface_area_m2':sum(ar for ar,dot in areas if dot<-.6)}
report['fresh_import_surface_normals']=normalchecks
used={m.name for o in scene.objects if o.type=='MESH' for m in o.data.materials};report['used_materials']=sorted(used);report['material_count']=len(used);report['triangles']=sum(len(o.data.polygons) if all(len(p.vertices)==3 for p in o.data.polygons) else sum(len(p.vertices)-2 for p in o.data.polygons) for o in scene.objects if o.type=='MESH');report['passed']=all(report['raw_gltf_checks'].values()) and all(report['fresh_import_checks'].values());(ROOT/'validation.json').write_text(json.dumps(report,indent=2));print('VALIDATION '+json.dumps(report),flush=True)
report['material_parameters']=[{'name':m.get('name'),'pbrMetallicRoughness':m.get('pbrMetallicRoughness',{}),'extensions':m.get('extensions',{}),'normalTexture':m.get('normalTexture'),'emissiveFactor':m.get('emissiveFactor',[0,0,0])} for m in d['materials']]
(ROOT/'validation.json').write_text(json.dumps(report,indent=2))
scene.render.engine='CYCLES' if a.pathtrace else 'BLENDER_EEVEE'
if a.pathtrace:scene.cycles.device='CPU';scene.cycles.samples=24;scene.cycles.use_denoising=True
scene.render.resolution_x=1440;scene.render.resolution_y=900;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG';scene.world=bpy.data.worlds.new('Neutral studio');scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs['Color'].default_value=(.18,.21,.25,1);scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.25
scene.view_settings.view_transform='AgX'
def point(o,t):o.rotation_euler=(Vector(t)-o.location).to_track_quat('-Z','Y').to_euler()
def area(name,loc,power,sx,sy,target):
 ld=bpy.data.lights.new(name,'AREA');ld.energy=power*.28;ld.shape='RECTANGLE';ld.size=sx;ld.size_y=sy;o=bpy.data.objects.new(name,ld);scene.collection.objects.link(o);o.location=loc;point(o,target)
area('Key softbox',(-3,-2,6),1550,5,2,(0,0,.7));area('Fill softbox',(4,-1,4),1450,4,3,(0,0,.7));area('Rear rim',(-1,5,4),1900,4,2,(0,0,.7));area('Side reflection',(-5,0,2.6),1100,5,.7,(0,0,.7));area('Front softbox',(0,-6,3),900,3,2,(0,0,.7))
m=bpy.data.materials.new('Studio_floor');m.diffuse_color=(.055,.065,.08,1);bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.004));ground=bpy.context.object;ground.name='RENDER_ONLY_ground';ground.data.materials.append(m)
ca=bpy.data.cameras.new('RENDER_ONLY_camera');cam=bpy.data.objects.new('RENDER_ONLY_camera',ca);scene.collection.objects.link(cam);scene.camera=cam;ca.type='ORTHO'
def render(name,pos,target,scale):
 cam.location=pos;point(cam,target);ca.ortho_scale=scale;scene.render.filepath=str(ROOT/(name+'.png'));bpy.ops.render.render(write_still=True)
if not a.video_only:render('model_preview',(-5.8,-8,3.4),(0,0,.74),6.9)
if not a.preview_only and not a.video_only:
 render('model_front',(0,-9,.76),(0,-.25,.76),3.7)
 render('model_side',(-9,0,.77),(0,0,.77),6.4)
 render('model_rear',(5,8,2.7),(0,.20,.76),6.7)
 render('model_surface_detail',(-3.6,-3.4,2.4),(-.30,-.58,1.0),3.05)
 render('model_wheel_detail',(3.6,-2.5,1.0),(.86,-1.77,.45),1.18)
if a.video:
 scene.render.resolution_x=960;scene.render.resolution_y=600;scene.render.resolution_percentage=100;cam.location=(3.8,-2.9,1.32);point(cam,(.86,-1.77,.55));ca.ortho_scale=1.7;scene.render.fps=24;(ROOT/'spin_frames').mkdir(exist_ok=True)
 transforms=[]
 clipdata={}
 for clip in d['animations']:
  for ch in clip['channels']:
   sm=clip['samplers'][ch['sampler']];clipdata[names[ch['target']['node']]]=(accessor(sm['input']),accessor(sm['output']))
 convert=Quaternion((1,0,0),math.pi/2)
 def evalclip(name,t):
  times,values=clipdata[name];i=next((k for k in range(len(times)-1) if times[k+1][0]>=t),len(times)-2);u=max(0,min(1,(t-times[i][0])/(times[i+1][0]-times[i][0])))
  def q(j):x,y,z,w=values[j];return Quaternion((w,x,y,z))
  out=q(i).slerp(q(i+1),u);return convert@out@convert.conjugated()
 for fr in range(1,49):
  t=(fr-1)/24
  for c in axles:axles[c].rotation_mode='QUATERNION';axles[c].rotation_quaternion=evalclip('wheel_'+c+'_axle',t)
  for c in ['FL','FR']:roots[c].rotation_mode='QUATERNION';roots[c].rotation_quaternion=evalclip('wheel_'+c,t)
  bpy.context.view_layer.update();transforms.append({'frame':fr,'time_seconds':t,'FL_axle_quaternion_blender':list(axles['FL'].rotation_quaternion),'FL_steer_quaternion_blender':list(roots['FL'].rotation_quaternion)});scene.render.filepath=str(ROOT/'spin_frames'/f'frame_{fr:04d}.png');bpy.ops.render.render(write_still=True)
 (ROOT/'wheel_spin_metadata.json').write_text(json.dumps({'source_glb_sha256':report['sha256'],'method':'Fresh import, actual exported axle hierarchy, decoded and replayed WheelSpin and FrontSteer quaternion tracks from this GLB. Actual local-X spin and same-direction steering; no image warping.','render_engine':scene.render.engine,'frames':48,'fps':24,'transforms':transforms},indent=2))
print('RENDER_DONE',flush=True)
