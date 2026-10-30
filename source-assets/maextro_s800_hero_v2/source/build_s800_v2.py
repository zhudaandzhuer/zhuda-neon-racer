"""Reference-based, dimensioned S800 reconstruction. Blender Z up, -Y front.
All wheel geometry is authored in axle-local coordinates. No global normalization.
"""
import bpy, bmesh, math, json, hashlib, struct
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent.parent
bpy.ops.wm.read_factory_settings(use_empty=True)
S=bpy.context.scene;S.unit_settings.system='METRIC';S.unit_settings.scale_length=1
M={}
def material(name,col,metal=0,rough=.35,coat=0,trans=0):
 m=bpy.data.materials.new(name);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF')
 p.inputs['Base Color'].default_value=(*col,1);p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough;p.inputs['Coat Weight'].default_value=coat;p.inputs['Coat Roughness'].default_value=.12;p.inputs['Transmission Weight'].default_value=trans;p.inputs['IOR'].default_value=1.46
 M[name]=m;return m
material('Paint_Obsidian',(.006,.008,.011),.20,.19,.65)
material('Paint_Silver',(.57,.60,.64),.82,.25,.55)
material('Glass_Tinted',(.045,.075,.085),.04,.12,.3,.55)
material('Glass_Roof',(.018,.03,.038),.04,.13,.3,.3)
material('Rubber_Tyre',(.009,.011,.014),0,.66)
material('Rubber_Seal',(.009,.012,.015),0,.64)
material('Metal_Polished',(.64,.69,.75),.97,.16)
material('Metal_Satin',(.40,.45,.51),.91,.30)
material('Metal_Brake',(.23,.25,.27),.78,.40)
material('Lamp_Clear',(.74,.83,.88),.05,.12,.3,.7)
material('Lamp_Reflector',(.80,.85,.90),.88,.17)
material('Lamp_Red',(.45,.006,.01),.2,.20,.5,.1)
material('Lamp_Amber',(.65,.16,.006),.2,.26)
material('Fascia_Black',(.006,.008,.012),.35,.29,.3)
material('Interior',(.027,.034,.04),0,.83)
material('Brake_Caliper',(.10,.12,.13),.7,.35)

# Standard tangent normal and linear ORM maps for fine tyre rubber grain.
rm=M['Rubber_Tyre'];bs=rm.node_tree.nodes.get('Principled BSDF');nodes=rm.node_tree.nodes;links=rm.node_tree.links
for suffix in ['normal','orm']:
 tex=nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(ROOT/'materials'/('rubber_'+suffix+'.png')));tex.image.colorspace_settings.name='Non-Color';tex.image.pack()
 if suffix=='normal':
  normal=nodes.new('ShaderNodeNormalMap');normal.inputs['Strength'].default_value=.28;links.new(tex.outputs['Color'],normal.inputs['Color']);links.new(normal.outputs['Normal'],bs.inputs['Normal'])
 else:
  split=nodes.new('ShaderNodeSeparateColor');links.new(tex.outputs['Color'],split.inputs['Color']);links.new(split.outputs['Green'],bs.inputs['Roughness']);links.new(split.outputs['Blue'],bs.inputs['Metallic'])

def mesh(name,v,f,mat,smooth=True,parent=None,mats=None,ids=None):
 me=bpy.data.meshes.new(name);me.from_pydata(v,[],f);me.update();o=bpy.data.objects.new(name,me);S.collection.objects.link(o)
 for m in mats or [mat]:me.materials.append(M[m])
 if ids:
  for p,i in zip(me.polygons,ids):p.material_index=i
 if smooth:
  for p in me.polygons:p.use_smooth=True
 uv=me.uv_layers.new(name='UVMap')
 for p in me.polygons:
  axis=max(range(3),key=lambda a:abs(p.normal[a]));axes=[i for i in range(3) if i!=axis]
  for li in p.loop_indices:
   co=me.vertices[me.loops[li].vertex_index].co;uv.data[li].uv=(co[axes[0]],co[axes[1]])
 if parent:o.parent=parent
 return o

def grid(name,fn,nu,nv,mat,parent=None,flip=False):
 v=[fn(i/nu,j/nv) for i in range(nu+1) for j in range(nv+1)];f=[]
 for i in range(nu):
  for j in range(nv):
   a=i*(nv+1)+j;q=(a,a+nv+1,a+nv+2,a+1);f.append(q[::-1] if flip else q)
 return mesh(name,v,f,mat,parent=parent)

def bevel(o,r=.008,n=3):
 b=o.modifiers.new('Manufactured edge radius','BEVEL');b.width=r;b.segments=n
 b.limit_method='ANGLE';b.angle_limit=.35;bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=b.name)
 return o

def box(name,loc,dim,mat,r=.008,parent=None):
 bpy.ops.mesh.primitive_cube_add(size=1,location=(0,0,0));o=bpy.context.object;o.name=name;o.dimensions=dim;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(M[mat]);o.location=loc
 if parent:o.parent=parent
 if r:bevel(o,r)
 # Keep planar surfaces planar, smooth the bevel faces.
 for p in o.data.polygons:p.use_smooth=len(p.vertices)==4 and p.area<r*max(dim)*2
 return o

def cylinder(name,loc,r,depth,mat,parent=None,axis='X',n=64):
 bpy.ops.mesh.primitive_cylinder_add(vertices=n,radius=r,depth=depth);o=bpy.context.object;o.name=name;o.data.materials.append(M[mat]);o.location=loc
 if axis=='X':o.rotation_euler[1]=math.pi/2
 if axis=='Y':o.rotation_euler[0]=math.pi/2
 if parent:o.parent=parent
 bevel(o,.0015,2)
 for p in o.data.polygons:p.use_smooth=abs(p.normal.z)<.8
 return o

def tube(name,points,r,mat,parent=None,res=3):
 cu=bpy.data.curves.new(name,'CURVE');cu.dimensions='3D';cu.resolution_u=1;cu.use_fill_caps=True;cu.bevel_depth=r;cu.bevel_resolution=res
 sp=cu.splines.new('POLY');sp.points.add(len(points)-1)
 for p,co in zip(sp.points,points):p.co=(*co,1)
 o=bpy.data.objects.new(name,cu);S.collection.objects.link(o);cu.materials.append(M[mat])
 if parent:o.parent=parent
 return o

def sphere(name,loc,dim,mat,parent=None):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=48,ring_count=24);o=bpy.context.object;o.name=name;o.dimensions=dim;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.location=loc;o.data.materials.append(M[mat]);
 if parent:o.parent=parent
 for p in o.data.polygons:p.use_smooth=True
 return o

def empty(name,loc=(0,0,0),parent=None):
 o=bpy.data.objects.new(name,None);S.collection.objects.link(o);o.location=loc
 if parent:o.parent=parent
 return o
ROOTNODE=empty('Maextro_S800_Root');ROOTNODE['units']='metres';ROOTNODE['gltf_front']='+Z';ROOTNODE['authoring_front']='-Y';ROOTNODE['vehicle_left_gltf']='+X';ROOTNODE['vehicle_right_gltf']='-X';ROOTNODE['quality']='Reference reconstruction, not OEM CAD'
# Shape-preserving cubic interpolant. Tables contain physical dimensions, not scale corrections.
def curve(table,x):
 n=len(table);xs=[a for a,b in table];ys=[b for a,b in table];d=[(ys[i+1]-ys[i])/(xs[i+1]-xs[i]) for i in range(n-1)];m=[d[0]]
 for i in range(1,n-1):m.append(0 if d[i-1]*d[i]<=0 else 2*d[i-1]*d[i]/(d[i-1]+d[i]))
 m.append(d[-1]);x=max(xs[0],min(xs[-1],x));i=next((i for i in range(n-1) if x<=xs[i+1]),n-2);h=xs[i+1]-xs[i];t=(x-xs[i])/h
 return (2*t**3-3*t*t+1)*ys[i]+(t**3-2*t*t+t)*h*m[i]+(-2*t**3+3*t*t)*ys[i+1]+(t**3-t*t)*h*m[i+1]
WT=[(-2.67,.98),(-2.3,1),(-1.77,1),(-.9,1),(.3,1),(1.6,1),(2.35,.974),(2.67,.96)]
BT=[(-2.67,1.025),(-2.3,1.035),(-1.6,1.055),(-.9,1.075),(.5,1.080),(1.6,1.068),(2.4,1.045),(2.67,1.025)]
def width(y):return curve(WT,y)
def belt(y):return curve(BT,y)
R=.388;WF=-1.77;WR=1.60;TRACK=1.72;ARCH=.422

def bottom(y):
 z=.205
 for wy in [WF,WR]:
  dy=y-wy
  if abs(dy)<ARCH:z=max(z,R+math.sqrt(max(0,ARCH**2-dy**2)))
 return z

def side_x(y,z):
 t=max(0,min(1,(z-.205)/(belt(y)-.205)))
 # Continuous shoulder and lower door crown, with a subtle lower concavity.
 inward=curve([(0,.085),(.12,.041),(.32,.025),(.58,0),(.78,.008),(.90,.028),(1,.075)],t)
 return width(y)-inward

def sidepoint(s,y,z,offset=0):return (s*(side_x(y,z)+offset),y,z)
# Actual apertures: side panel bottoms follow wheel arches. No solid slab behind wheels.
for s,label in [(-1,'R'),(1,'L')]:
 for name,a,b in [('Front_fender',-2.59,-.951),('Front_door',-.946,.305),('Rear_door',.310,1.800),('Rear_quarter',1.805,2.625)]:
  ob=grid(f'{name}_{label}',lambda u,v:(lambda y:(sidepoint(s,y,bottom(y)+(belt(y)-bottom(y))*v)))(a+(b-a)*u),max(40,int((b-a)*135)),40,'Paint_Obsidian',flip=s<0)
  ob.parent=ROOTNODE;ob['panel_gap_m']=.005
 # True dark seam backs are recessed 6 mm.
 for y in [-.9485,.3075,1.8025]:
  tube('Panel_gap_'+label,[sidepoint(s,y,bottom(y)+.002+(belt(y)-bottom(y)-.002)*i/60,-.006) for i in range(61)],.0024,'Rubber_Seal',ROOTNODE)
 # Arch lip, return flange and opaque wheel well liner.
 for wy,tag in [(WF,'F'),(WR,'R')]:
  pts=[]
  for i in range(101):
   a=math.pi*i/100;y=wy+ARCH*math.cos(a);z=R+ARCH*math.sin(a);pts.append(sidepoint(s,y,z,-.005))
  tube('Arch_edge_'+tag+label,pts,.005,'Paint_Obsidian',ROOTNODE)
  grid('Arch_return_'+tag+label,lambda u,v:(lambda a:(s*(side_x(wy+ARCH*math.cos(a),R+ARCH*math.sin(a))-.09*v),wy+ARCH*math.cos(a),R+ARCH*math.sin(a)))(math.pi*u),100,5,'Rubber_Seal',ROOTNODE,flip=s>0)
  grid('Wheelwell_'+tag+label,lambda u,v:(s*(.71+.23*v),wy+.432*math.cos(math.pi*u),R+.432*math.sin(math.pi*u)),100,8,'Rubber_Seal',ROOTNODE)
 # Upper silver belt, chrome rocker and flush door handles.
 tube('Rocker_chrome_'+label,[sidepoint(s,-1.30+2.45*i/100,.239,.004) for i in range(101)],.009,'Metal_Polished',ROOTNODE)
 for cy in [.00,1.27]:
  p=sidepoint(s,cy,.976,.006);box('Handle_recess_'+label,p,(.012,.237,.041),'Rubber_Seal',.012,ROOTNODE)
  p=sidepoint(s,cy,.978,.013);box('Flush_handle_'+label,p,(.014,.219,.026),'Metal_Polished',.010,ROOTNODE)
 # Side cameras / decorated fender badge (emblem is intentionally approximate).
 box('Fender_badge_mount_'+label,sidepoint(s,-1.10,.91,-.012),(.019,.115,.16),'Rubber_Seal',.018,ROOTNODE)
 box('Fender_badge_'+label,sidepoint(s,-1.10,.915,.000),(.012,.047,.116),'Metal_Polished',.01,ROOTNODE)
 for z in [.879,.92,.961]:cylinder('Fender_sensor_'+label,sidepoint(s,-1.10,z,-.005),.012,.005,'Fascia_Black',ROOTNODE)
# Silver top surfaces: separate hood and fenders, then shoulder rails and trunk.
def top_z(y,x):
 w=width(y);a=abs(x)/(w*.925)
 return belt(y)+.072*(1-a*a)-.006*math.exp(-((a-.69)/.08)**2)
for s,label in [(-1,'R'),(1,'L')]:
 grid('Hood_outer_fender_'+label,lambda u,v:(lambda y:(lambda x:(x,y,top_z(y,x)))(s*width(y)*(.802+.123*v)))(-2.55+1.45*u),100,16,'Paint_Silver',ROOTNODE,flip=s>0)
 grid('Silver_shoulder_'+label,lambda u,v:(lambda y:(lambda x:(x,y,top_z(y,x)))(s*width(y)*(.900+.025*v)))(-1.095+3.245*u),150,12,'Paint_Silver',ROOTNODE,flip=s>0)
 tube('Belt_chrome_'+label,[(s*(width(y)*.925-.003),y,belt(y)+.003) for y in [-2.60+5.20*i/240 for i in range(241)]],.0035,'Metal_Polished',ROOTNODE)
grid('Hood',lambda u,v:(lambda y:(lambda x:(x,y,top_z(y,x)+.001))((v*2-1)*(width(y)*.800-.002)))(-2.55+1.446*u),120,80,'Paint_Silver',ROOTNODE,flip=True)
for s in [-1,1]:tube('Hood_panel_gap',[(s*width(y)*.801,y,top_z(y,width(y)*.801)-.003) for y in [-2.55+1.446*i/140 for i in range(141)]],.002,'Rubber_Seal',ROOTNODE)
grid('Trunk_lid',lambda u,v:(lambda y:(lambda x:(x,y,top_z(y,x)))(width(y)*(2*v-1)*.92))(2.13+.51*u),50,80,'Paint_Silver',ROOTNODE,flip=True)
for s in [-1,1]:tube('Trunk_seam',[(s*width(y)*.922,y,top_z(y,width(y)*.922)-.003) for y in [2.13+.51*i/40 for i in range(41)]],.002,'Rubber_Seal',ROOTNODE)
# Cabin: glass replaces side surfaces, with a silver perimeter and real black pillars.
CT=[(-1.08,1.104),(-.92,1.16),(-.50,1.36),(-.20,1.453),(.35,1.496),(.85,1.486),(1.20,1.445),(1.65,1.27),(2.12,1.105)]
def roofedge(y):return curve(CT,y)
def cab(s,y,t,off=0):
 base=1.103;z=base+(roofedge(y)-base)*t
 x=.925-.155*t+.009*math.sin(math.pi*t)
 return (s*(x+off),y,z)
for s,label in [(-1,'R'),(1,'L')]:
 intervals=[(-1.08,-.985,'Paint_Silver'),(-.985,.282,'Glass_Tinted'),(.282,.365,'Rubber_Seal'),(.365,1.305,'Glass_Tinted'),(1.305,1.345,'Rubber_Seal'),(1.345,1.545,'Glass_Tinted'),(1.545,2.12,'Paint_Silver')]
 for k,(a,b,inner) in enumerate(intervals):
  for j,(t0,t1,mat) in enumerate([(0,.055,'Paint_Silver'),(.055,.071,'Metal_Polished'),(.071,.087,'Rubber_Seal'),(.087,.925,inner),(.925,.945,'Rubber_Seal'),(.945,.962,'Metal_Polished'),(.962,1,'Paint_Silver')]):
   grid(f'Cabin_{label}_{k}_{j}',lambda u,v:cab(s,a+(b-a)*u,t0+(t1-t0)*v),max(3,int((b-a)*55)),max(2,int((t1-t0)*25)),mat,ROOTNODE,flip=s<0)
 # A pillar and C pillar chrome follows the apertures.
 for y in [-.985,1.545]:tube('Window_end_trim_'+label,[cab(s,y,.065+.89*i/50,.001) for i in range(51)],.0045,'Metal_Polished',ROOTNODE)
# Silver shoulder bridge closes the belt from the body loft to the cabin sill.
for sign in [-1,1]:
 grid('Silver_belt_bridge',lambda u,v:(lambda y:(sign*((width(y)*.925)*(1-v)+.925*v),y,belt(y)*(1-v)+1.103*v))(-1.08+3.20*u),160,8,'Paint_Silver',ROOTNODE,flip=sign<0)
# Narrow cowl and rear deck returns close the screen-to-panel seams.
for rear in [False,True]:
 ya,yb=(-1.104,-1.08) if not rear else (2.12,2.13)
 grid('Cowl_return',lambda u,v:(lambda y:(lambda x:(x,y,top_z(y,x)))(width(y)*.925*(2*v-1)))(ya+(yb-ya)*u),5,64,'Paint_Silver',ROOTNODE,flip=True)
# Windshield, roof and rear screen have a gentle transverse crown.
def screen(t,v,rear=False):
 a=2*v-1
 if rear:
  y=1.20+.92*t;z=curve([(0,1.490),(.35,1.390),(.75,1.205),(1,1.116)],t);w=.770+.155*t
 else:
  y=-1.08+.88*t;z=curve([(0,1.117),(.3,1.265),(.7,1.440),(1,1.498)],t);w=.925-.155*t
 return (a*w,y,z-.045*a*a)
for rear,label in [(False,'Windshield'),(True,'Rear_screen')]:
 grid(label,lambda u,v:screen(u,v,rear),64,64,'Glass_Tinted',ROOTNODE,flip=True)
 for t in [0,1]:tube(label+'_seal',[screen(t,i/100,rear) for i in range(101)],.009,'Rubber_Seal',ROOTNODE)
 for v in [0,1]:tube(label+'_pillar',[screen(i/100,v,rear) for i in range(101)],.026,'Paint_Silver',ROOTNODE)
def roof(u,v):
 y=-.20+1.40*u;a=2*v-1
 center=curve([(-.2,1.498),(.28,1.542),(.70,1.539),(1.2,1.490)],y)
 return (a*.770,y,center-.045*a*a)
grid('Roof_panel',roof,80,64,'Glass_Roof',ROOTNODE,flip=True)
for v in [0,1]:tube('Roof_silver_rail',[roof(i/100,v) for i in range(101)],.022,'Paint_Silver',ROOTNODE)
# Low lidar unit is below the measured roof height.
box('Lidar_housing',(0,-.20,1.469),(.30,.17,.045),'Fascia_Black',.03,ROOTNODE)
# Mirror arms, smooth housings, separate reflective glass and indicator.
for s,label in [(-1,'R'),(1,'L')]:
 tube('Mirror_arm_'+label,[(s*.91,-.85,1.105),(s*1.01,-.88,1.115),(s*1.055,-.91,1.15)],.026,'Paint_Obsidian',ROOTNODE)
 sphere('Mirror_housing_'+label,(s*1.045,-.93,1.174),(.245,.25,.132),'Paint_Silver',ROOTNODE)
 # The mirror faces rearward (+authoring Y).
 grid('Mirror_glass_'+label,lambda u,v:(s*(1.045+(2*u-1)*.098),-.814+.016*(2*u-1)**2,1.174+(2*v-1)*.046),30,14,'Metal_Polished',ROOTNODE)
 tube('Mirror_indicator_'+label,[(s*(.935+.24*i/40),-.99-.047*math.sin(math.pi*i/40),1.164) for i in range(41)],.0035,'Lamp_Clear',ROOTNODE)
# Fascia surfaces are swept back at their corners, not rectangular blocks.
def face_y(x,front):return (-2.708+.118*(abs(x)/.97)**4) if front else (2.727-.102*(abs(x)/.97)**4)
for front,label in [(True,'Front'),(False,'Rear')]:
 endy=-2.59 if front else 2.625
 def end_surface(u,v):
  z=.235+.790*v;half=side_x(endy,z);x=(2*u-1)*half
  y=(-2.708+.118*abs(2*u-1)**4) if front else (2.727-.102*abs(2*u-1)**4)
  return (x,y,z)
 grid(label+'_body_face',end_surface,100,54,'Paint_Obsidian',ROOTNODE,flip=not front)
 # Top return continuously joins the sculpted hood / rear deck to the face.
 def top_return(u,v):
  a=2*u-1;xx=a*side_x(endy,1.025);yy=(-2.708+.118*abs(a)**4) if front else (2.727-.102*abs(a)**4)
  join=-2.55 if front else 2.64
  x=xx*(1-v)+a*width(join)*.925*v;y=yy*(1-v)+join*v
  z=1.025*(1-v)+top_z(join,a*width(join)*.925)*v
  return (x,y,z+.005*math.sin(math.pi*v))
 grid(label+'_upper_return',top_return,100,16,'Paint_Silver',ROOTNODE,flip=not front)
 tube(label+'_lower_chrome',[(x,(-2.713 if front else 2.728)+(.115 if front else -.10)*(abs(x)/.88)**4,.242+.015*(abs(x)/.88)**3) for x in [-.88+1.76*i/160 for i in range(161)]],.007,'Metal_Polished',ROOTNODE)
# Closed center front and actual lower grille with separated horizontal louvres.
box('Front_center_fascia',(0,-2.722,.665),(1.36,.018,.439),'Fascia_Black',.035,ROOTNODE)
box('Lower_grille_cavity',(0,-2.721,.365),(1.61,.018,.132),'Rubber_Seal',.016,ROOTNODE)
for z in [.315,.359,.404]:
 tube('Lower_grille_chrome',[(x,-2.731+.12*(abs(x)/.91)**4,z) for x in [-.88+1.76*i/100 for i in range(101)]],.004,'Metal_Polished',ROOTNODE)
for x in [-.66,-.44,-.22,0,.22,.44,.66]:box('Grille_fin',(x,-2.730,.358),(.012,.009,.106),'Fascia_Black',.002,ROOTNODE)
for s,label in [(-1,'R'),(1,'L')]:
 x=s*.815;y=face_y(x,True)-.014
 box('Lamp_chamber_'+label,(x,y,.663),(.156,.049,.441),'Fascia_Black',.028,ROOTNODE)
 for z in [.53,.665,.80]:
  box('Lamp_reflector_'+label,(x,y-.032,z),(.111,.012,.105),'Metal_Polished',.024,ROOTNODE)
  cylinder('Lamp_projector_'+label,(x,y-.043,z),.034,.023,'Lamp_Reflector',ROOTNODE,axis='Y',n=48)
  sphere('Lamp_lens_'+label,(x,y-.061,z),(.067,.021,.067),'Lamp_Clear',ROOTNODE)
 # Faceted peripheral crystal elements are actual pieces.
 for i in range(22):
  z=.461+i*.018
  for dx in [-.064,.064]:
   ob=box('Crystal_'+label,(x+dx,y-.036,z),(.012,.013,.011),'Lamp_Reflector',.001,ROOTNODE);ob.rotation_euler[1]=.35*(1 if i%2 else -1)
 tube('DRL_'+label,[(s*(.51+.375*i/70),face_y(s*(.51+.375*i/70),True)-.027,.913+.009*math.sin(math.pi*i/70)) for i in range(71)],.014,'Lamp_Reflector',ROOTNODE)
 tube('DRL_upper_chrome_'+label,[(s*(.50+.39*i/70),face_y(s*(.50+.39*i/70),True)-.025,.939) for i in range(71)],.005,'Metal_Polished',ROOTNODE)
 tube('Lamp_lower_signature_'+label,[(s*(.68+.21*i/40),face_y(s*(.68+.21*i/40),True)-.025,.433) for i in range(41)],.010,'Lamp_Reflector',ROOTNODE)
# Approximate diamond emblem, not a false high-resolution OEM logo.
mesh('Emblem_approximation',[(0,-2.734,.984),(.023,-2.734,.951),(0,-2.734,.919),(-.023,-2.734,.951),(0,-2.740,.951)],[(0,1,4),(1,2,4),(2,3,4),(3,0,4)],'Metal_Polished',False,ROOTNODE)
# Tail-light wrap, inset plate, rear bumper lower polished trim.
for z,r in [(1.002,.014),(.975,.006)]:tube('Tail_light_bar',[(x,face_y(x,False)-.001,z-.055*(abs(x)/.94)**5) for x in [-.94+1.88*i/180 for i in range(181)]],r,'Lamp_Red',ROOTNODE)
for s in [-1,1]:
 tube('Tail_wrap',[(s*(.94+.028*math.sin(math.pi*i/60)),2.62-.29*i/60,.955+.027*i/60) for i in range(61)],.018,'Lamp_Red',ROOTNODE)
 box('Rear_reflector',(s*.69,2.735-.08,.367),(.24,.023,.027),'Lamp_Red',.009,ROOTNODE)
box('Rear_plate_recess',(0,2.730,.620),(.50,.012,.145),'Rubber_Seal',.016,ROOTNODE)
box('Rear_plate_blank',(0,2.737,.620),(.43,.006,.10),'Metal_Satin',.004,ROOTNODE)
# Undertray is narrow enough to leave actual wheel cavities open.
box('Undertray',(0,0,.208),(1.44,4.75,.035),'Rubber_Seal',.035,ROOTNODE)
# Simple dark cabin interior is visible through real glass; no textured fake occupants.
box('Cabin_floor',(0,.43,.62),(1.65,2.56,.08),'Interior',.04,ROOTNODE)
box('Dashboard',(0,-.82,1.045),(1.53,.35,.14),'Interior',.055,ROOTNODE)
for y in [-.28,.94]:
 for x in [-.46,.46]:
  box('Seat_base',(x,y,.77),(.57,.54,.16),'Interior',.065,ROOTNODE)
  ob=box('Seat_back',(x,y+.20,1.055),(.53,.14,.54),'Interior',.065,ROOTNODE);ob.rotation_euler.x=math.radians(-9)
  box('Head_restraint',(x,y+.24,1.35),(.29,.13,.17),'Interior',.055,ROOTNODE)
# Steering wheel is circular in the dashboard plane.
tube('Steering_wheel',[( -.46+.165*math.cos(a),-.53,1.04+.165*math.sin(a)) for a in [math.tau*i/96 for i in range(97)]],.018,'Rubber_Seal',ROOTNODE)
# Wheels: local axle X, circular YZ plane. Fixed centres are independent of body shape.
def lathe(name,profile,mat,parent,n=160):
 v=[];f=[]
 for i in range(n):
  a=math.tau*i/n
  for x,r in profile:v.append((x,r*math.sin(a),r*math.cos(a)))
 m=len(profile)
 for i in range(n):
  for j in range(m-1):f.append((i*m+j,((i+1)%n)*m+j,((i+1)%n)*m+j+1,i*m+j+1))
 return mesh(name,v,f,mat,parent=parent)
wheelinfo={}
for s,label in [(-1,'R'),(1,'L')]:
 for y,tag in [(WF,'F'),(WR,'R')]:
  code=tag+label;w=empty('wheel_'+code,(s*TRACK/2,y,R),ROOTNODE);w['steering_axis']='local Z in Blender / local Y in glTF';w['spin_child']='wheel_'+code+'_axle';w['radius_m']=R;w['position_source']='wheelbase official; track and tyre radius estimated from references'
  ax=empty('wheel_'+code+'_axle',parent=w);ax['spin_axis']='local X'
  # Smooth tyre cross-section with modeled circumferential and shoulder tread grooves.
  profile=[(-.128,.2667),(-.134,.300),(-.128,.344),(-.108,.377),(-.084,R),(.084,R),(.108,.377),(.128,.344),(.134,.300),(.128,.2667)]
  ps=[]
  for j in range(60):
   x=-.134+.268*j/59
   # ellipsoidal rounded shoulders, flat tread top
   r=R if abs(x)<.086 else .300+.088*math.sqrt(max(0,1-((abs(x)-.086)/.049)**2))
   ps.append((x,r))
  ps=[(-.128,.2667),(-.134,.293)]+ps+[(.134,.293),(.128,.2667)]
  nv=384;v=[];f=[]
  for i in range(nv):
   a=math.tau*i/nv
   for x,r in ps:
    groove=0
    if abs(x)<.09:
     groove+=sum(.0022*math.exp(-((x-c)/.004)**6) for c in [-.052,0,.052])
    if abs(x)>.065 and abs(math.sin(64*a+9*x))<.17:groove+=.0023
    v.append((x,(r-groove)*math.sin(a),(r-groove)*math.cos(a)))
  np=len(ps)
  for i in range(nv):
   for j in range(np):f.append((i*np+j,((i+1)%nv)*np+j,((i+1)%nv)*np+(j+1)%np,i*np+(j+1)%np))
  tire=mesh('Tyre_'+code,v,[q[::-1] for q in f],'Rubber_Tyre',parent=ax)
  uv=tire.data.uv_layers.active
  for face in tire.data.polygons:
   coords=[]
   for li in face.loop_indices:
    co=tire.data.vertices[tire.data.loops[li].vertex_index].co;uu=(math.atan2(co.y,co.z)/math.tau)%1;coords.append((li,uu,(co.x/.268)+.5))
   seam=max(q[1] for q in coords)-min(q[1] for q in coords)>.5
   for li,uu,vv in coords:uv.data[li].uv=((uu+(1 if seam and uu<.5 else 0))*4,vv)

  lathe('Rim_barrel_'+code,[(-.122,.252),(-.120,.2667),(.120,.2667),(.128,.261),(.128,.250),(-.122,.250)],'Metal_Polished',ax)
  # outward-facing wheel dish and fine radial sunrise fins, 40 slots.
  outer=s*.139
  lathe('Rim_dish_'+code,[(s*.123,.070),(s*.116,.160),(s*.108,.216),(s*.105,.216),(s*.113,.160),(s*.120,.070),(s*.123,.070)],'Metal_Satin',ax)
  lathe('Rim_outer_lip_'+code,[(s*.125,.249),(s*.137,.256),(s*.135,.267),(s*.119,.270)],'Metal_Polished',ax)
  for i in range(40):
   a=math.tau*i/40;rs=[.105,.15,.211,.255];vv=[]
   for j,r in enumerate(rs):
    da=(.079 if j<2 else .052);twist=(r-.105)*.15
    for edge in [-1,1]:
     ang=a+edge*da+twist;xx=s*(.132-.022*(r/.255)**1.4 +(.004 if edge==1 else 0));vv.append((xx,r*math.sin(ang),r*math.cos(ang)))
   ob=mesh('Sunrise_fin_'+code+'_'+str(i),vv,[(j*2,j*2+1,j*2+3,j*2+2) for j in range(3)],'Metal_Polished',parent=ax)
  cylinder('Hub_'+code,(s*.124,0,0),.069,.020,'Metal_Polished',ax)
  cylinder('Hub_inlay_'+code,(s*.136,0,0),.049,.003,'Fascia_Black',ax)
  # restrained geometric hub mark
  tube('Hub_mark_'+code,[(s*.138,0,.031),(s*.138,.016,0),(s*.138,0,-.031),(s*.138,-.016,0),(s*.138,0,.031)],.002,'Metal_Polished',ax)
  for k in range(5):
   a=math.tau*k/5;cylinder('Lug_'+code,(s*.15,.082*math.sin(a),.082*math.cos(a)),.008,.009,'Metal_Polished',ax,n=12)
  lathe('Brake_disc_'+code,[(s*.07,.071),(s*.07,.232),(s*.05,.232),(s*.05,.071)],'Metal_Brake',ax)
  # Caliper steers with wheel root, does not spin.
  box('Caliper_'+code,(s*.067,-.175,.03),(.073,.078,.20),'Brake_Caliper',.018,w)
  for i in range(2):
   rr=.303+i*.022
   lathe('Sidewall_bead_'+code,[(s*.129,rr),(s*.131,rr+.001),(s*.129,rr+.002)],'Rubber_Tyre',ax)
  wheelinfo[code]={'center_blender_m':[s*TRACK/2,y,R],'center_gltf_m':[s*TRACK/2,R,-y],'radius_m':R,'rim_diameter_m':.5334,'track_estimated_m':TRACK}
  # Actual editable action; shared frame range exports as one SCENE animation.
  ax.rotation_mode='XYZ'
  for fr,a in [(1,0),(13,math.pi/2),(25,math.pi),(37,math.pi*1.5),(49,math.tau)]:
   ax.rotation_euler.x=a;ax.keyframe_insert('rotation_euler',index=0,frame=fr)
  if tag=='F':
   w.rotation_mode='XYZ'
   for fr,a in [(1,0),(13,.28),(25,0),(37,-.28),(49,0)]:w.rotation_euler.z=a;w.keyframe_insert('rotation_euler',index=2,frame=fr)
# Convert curves to real exportable meshes and correct outward normals consistently.
for o in list(S.objects):
 if o.type=='CURVE':
  bpy.context.view_layer.objects.active=o;o.select_set(True);bpy.ops.object.convert(target='MESH');o.select_set(False)
for o in list(S.objects):
 if o.type=='MESH':
  bpy.context.view_layer.objects.active=o;o.select_set(True)
  # Two-sided sheets and glTF doubleSided avoid depending on guessed loft winding.
  for m in o.data.materials:m.use_backface_culling=False
  o.select_set(False)
# Give every open sheet an actual inward shell, edge caps and consistent volume normals.
# Export uses this same applied geometry; no two-sided zero-thickness body panels.
for o in list(S.objects):
 if o.type!='MESH':continue
 bm=bmesh.new();bm.from_mesh(o.data);isopen=any(e.is_boundary for e in bm.edges);bm.free()
 if isopen:
  bpy.context.view_layer.objects.active=o;mod=o.modifiers.new('Physical inward thickness','SOLIDIFY');mod.thickness=.004 if any('Glass' in m.name for m in o.data.materials) else .003;mod.offset=-1;mod.use_even_offset=True;mod.use_quality_normals=True;mod.use_rim=True;o['shell_thickness_m']=mod.thickness;bpy.ops.object.modifier_apply(modifier=mod.name)
 bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free();o.data.update()
S.frame_start=1;S.frame_end=49;S.render.fps=24;S.frame_set(1);bpy.context.view_layer.update()
(ROOT/'wheel_spec.json').write_text(json.dumps(wheelinfo,indent=2))
source={'official_url':'https://hima.auto/zunjie/s800/','retrieved_date':'2026-10-30','official_dimensions_m':{'length':5.480,'width_body':2.000,'height':1.542,'wheelbase':3.370},'height_note':'Current manufacturer page: 1542 mm. Does not assert exact incident vehicle trim/year.','estimated':{'track_m':TRACK,'tyre_radius_m':R,'tyre_width_m':.268,'wheel_center_longitudinal_blender_Y_m':[WF,WR]},'reference_images':'AI four views from gpt-image-2.5-flare plus manufacturer design page; no CAD/scan or measured orthographic blueprints.','construction':'Analytical body lofts with independent arch apertures, separate cabin/glass, actual panel gaps and axle-local wheel geometry. No whole-model stretch.','materials':'Standard PBR factors for paint/glass/metals/lamps, 1024 linear ORM and tangent normal for rubber, explicit mesh normals. No baked lighting or shadows. Glass uses transmission; paint uses clearcoat.','limitations':['Silhouette and detailed lamp/wheel design are reference approximations, not OEM CAD.','Track, tyre outer diameter, overhang split and glass curvature are estimated.','Incident-specific vehicle identity and accident damage are not reconstructed.','Interior and underbody are simplified; doors do not open.','Fine logos are geometric approximations.']}
(ROOT/'reference_sources.json').write_text(json.dumps(source,ensure_ascii=False,indent=2))
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'maextro_s800_hero_v2.blend'))
bpy.ops.export_scene.gltf(filepath=str(ROOT/'maextro_s800_hero_v2.glb'),export_format='GLB',export_tangents=True,export_yup=True,export_apply=True,export_animations=True,export_animation_mode='SCENE',export_frame_range=True,export_frame_step=1,export_force_sampling=True,export_skins=False,export_morph=False,export_extras=True,export_cameras=False,export_lights=False)
raw=(ROOT/'maextro_s800_hero_v2.glb').read_bytes();n=struct.unpack_from('<I',raw,12)[0];d=json.loads(raw[20:20+n]);original_animations=d.get('animations',[]);merged=[]
for title,kind in [('WheelSpin','axle'),('FrontSteer','steer')]:
 samplers=[];channels=[]
 for an in original_animations:
  for ch in an.get('channels',[]):
   name=d['nodes'][ch['target']['node']].get('name','')
   if (kind=='axle' and name.endswith('_axle')) or (kind=='steer' and name in ['wheel_FL','wheel_FR']):
    out=dict(ch);out['sampler']=len(samplers);samplers.append(an['samplers'][ch['sampler']]);channels.append(out)
 merged.append({'name':title,'samplers':samplers,'channels':channels})
d['animations']=merged
js=json.dumps(d,separators=(',',':')).encode();js+=b' '*((-len(js))%4);binarychunk=raw[20+n:];raw=struct.pack('<4sII',b'glTF',2,20+len(js)+len(binarychunk))+struct.pack('<II',len(js),0x4E4F534A)+js+binarychunk
(ROOT/'maextro_s800_hero_v2.glb').write_bytes(raw)
stats={'file':'maextro_s800_hero_v2.glb','bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'mesh_count':len(d.get('meshes',[])),'material_count':len(d.get('materials',[])),'triangles':sum(d['accessors'][p['indices']]['count']//3 for m in d['meshes'] for p in m['primitives']),'extensionsUsed':d.get('extensionsUsed',[]),'extensionsRequired':d.get('extensionsRequired',[]),'animations':[a.get('name') for a in d.get('animations',[])]};(ROOT/'stats.json').write_text(json.dumps(stats,indent=2));print('BUILD_DONE '+json.dumps(stats),flush=True)
