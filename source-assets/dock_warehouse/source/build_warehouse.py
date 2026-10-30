"""Author a single detailed harbour warehouse; run in Blender background mode.

Internal axes: X width, -Y front, Z height. Export: glTF X/+Y up/+Z front.
No reconstruction mesh, ground plane, text, emission, vehicles or people.
Editable semantic components and all images are packed into the .blend.
"""
import bpy, bmesh, math, json, hashlib
from pathlib import Path
from collections import defaultdict
from mathutils import Vector

OUT = Path(__file__).resolve().parent.parent
bpy.ops.wm.read_factory_settings(use_empty=True)
buckets=defaultdict(lambda:[[],[],[],[]])
materials={}
TILE=2.4

def material(name,color,metal=0,rough=.5,texture=None,normal=.35):
    m=bpy.data.materials.new(name);m.use_nodes=True
    m.diffuse_color=(*color,1)
    bs=m.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value=(*color,1)
    bs.inputs['Metallic'].default_value=metal;bs.inputs['Roughness'].default_value=rough
    bs.inputs['IOR'].default_value=1.48
    if texture:
        nodes=m.node_tree.nodes;links=m.node_tree.links
        for suffix in ('basecolor','orm','normal'):
            t=nodes.new('ShaderNodeTexImage')
            t.image=bpy.data.images.load(str(OUT/'materials'/f'{texture}_{suffix}.png'),check_existing=True)
            t.label=f'{texture} {suffix}: physical repeat 2.4 m'
            if suffix!='basecolor':t.image.colorspace_settings.name='Non-Color'
            if suffix=='basecolor':links.new(t.outputs['Color'],bs.inputs['Base Color'])
            elif suffix=='orm':
                sep=nodes.new('ShaderNodeSeparateColor');links.new(t.outputs['Color'],sep.inputs['Color'])
                links.new(sep.outputs['Green'],bs.inputs['Roughness']);links.new(sep.outputs['Blue'],bs.inputs['Metallic'])
            else:
                n=nodes.new('ShaderNodeNormalMap');n.inputs['Strength'].default_value=normal
                links.new(t.outputs['Color'],n.inputs['Color']);links.new(n.outputs['Normal'],bs.inputs['Normal'])
    materials[name]=m

material('Weathered red-brown brick',(.45,.26,.18),texture='brick',normal=.55)
material('Cast concrete',(.5,.48,.44),texture='concrete',normal=.38)
material('Weathered zinc',(.52,.56,.53),texture='zinc',normal=.22)
material('Painted structural steel',(.10,.15,.15),texture='paint',normal=.3)
material('Door blue-grey enamel',(.23,.30,.32),.08,.48)
material('Door alternate enamel',(.20,.26,.28),.08,.51)
material('Bare galvanized hardware',(.43,.48,.48),.83,.34)
material('Window frame aluminium',(.23,.29,.29),.65,.38)
material('Window glazing muted blue',(.085,.14,.15),.20,.23)
material('Window glazing aged',(.115,.165,.165),.16,.32)
material('Wired skylight glass',(.20,.28,.27),.15,.29)
material('Rubber seals and buffers',(.018,.022,.020),0,.84)
material('Interior shadow lining',(.055,.060,.055),0,.9)
material('Duct dark interior',(.035,.039,.035),0,.92)

def meshpart(group,mat,verts,faces,smooth=False):
    vs,fs,uvs,ss=buckets[(group,mat)];offset=len(vs)
    vs.extend(tuple(v) for v in verts)
    for face in faces:
        fs.append(tuple(offset+i for i in face));ss.append(smooth and len(face)==4)
        q=[Vector(verts[i]) for i in face]
        norm=(q[1]-q[0]).cross(q[2]-q[0])
        axis=max(range(3),key=lambda i:abs(norm[i]));axes=[i for i in range(3) if i!=axis]
        uvs.extend((p[axes[0]]/TILE,p[axes[1]]/TILE) for p in q)

def box(group,center,size,mat='Painted structural steel'):
    c=Vector(center);h=Vector(size)/2
    vs=[c+Vector((x*h.x,y*h.y,z*h.z)) for x,y,z in
        [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]]
    fs=[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]
    meshpart(group,mat,vs,fs)

def beam(group,a,b,width,depth=None,mat='Painted structural steel',isection=False):
    a,b=Vector(a),Vector(b);q=Vector((0,0,1)).rotation_difference((b-a).normalized())
    depth=depth or width
    if isection:
        w,d=width/2,depth/2;t=min(width,depth)*.13;tw=width*.11
        p=[(-w,-d),(w,-d),(w,-d+t),(tw/2,-d+t),(tw/2,d-t),(w,d-t),
           (w,d),(-w,d),(-w,d-t),(-tw/2,d-t),(-tw/2,-d+t),(-w,-d+t)]
    else:p=[(-width/2,-depth/2),(width/2,-depth/2),(width/2,depth/2),(-width/2,depth/2)]
    n=len(p);vs=[a+q@Vector((x,y,z)) for z in (0,(b-a).length) for x,y in p]
    fs=[tuple(reversed(range(n))),tuple(range(n,n*2))]
    fs.extend((i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n))
    meshpart(group,mat,vs,fs)

def cylinder(group,a,b,r,mat='Bare galvanized hardware',segments=12):
    a,b=Vector(a),Vector(b);q=Vector((0,0,1)).rotation_difference((b-a).normalized())
    vs=[a+q@Vector((r*math.cos(i*math.tau/segments),r*math.sin(i*math.tau/segments),z))
        for z in (0,(b-a).length) for i in range(segments)]
    fs=[tuple(reversed(range(segments))),tuple(range(segments,2*segments))]
    fs.extend((i,(i+1)%segments,(i+1)%segments+segments,i+segments) for i in range(segments))
    meshpart(group,mat,vs,fs,True)

def pathpipe(group,points,r,mat='Bare galvanized hardware',sides=12):
    ps=[Vector(p) for p in points];path=[ps[0]]
    for i in range(1,len(ps)-1):
        p=ps[i];radius=min(.22,(ps[i-1]-p).length*.28,(ps[i+1]-p).length*.28)
        a=p+(ps[i-1]-p).normalized()*radius;b=p+(ps[i+1]-p).normalized()*radius
        for j in range(7):
            t=j/6;path.append(a*(1-t)**2+p*2*t*(1-t)+b*t*t)
    path.append(ps[-1]);vs=[]
    for i,p in enumerate(path):
        tangent=(path[min(i+1,len(path)-1)]-path[max(i-1,0)]).normalized()
        ref=Vector((0,0,1)) if abs(tangent.z)<.9 else Vector((0,1,0))
        u=tangent.cross(ref).normalized();v=tangent.cross(u).normalized()
        vs.extend(p+r*(u*math.cos(j*math.tau/sides)+v*math.sin(j*math.tau/sides)) for j in range(sides))
    fs=[tuple(reversed(range(sides))),tuple(range((len(path)-1)*sides,len(path)*sides))]
    for i in range(len(path)-1):
        fs.extend((i*sides+j,i*sides+(j+1)%sides,(i+1)*sides+(j+1)%sides,(i+1)*sides+j) for j in range(sides))
    meshpart(group,mat,vs,fs,True)

def bolt(group,point,normal,r=.025):
    p,n=Vector(point),Vector(normal)
    cylinder(group,p,p+n*.008,r*1.38,segments=12)
    cylinder(group,p+n*.007,p+n*.028,r,segments=6)

def wallbox(group,u,z,w,h,side,pos,depth,mat):
    # All wall helpers use a horizontal facade coordinate u and vertical z.
    if side in ('front','rear'):box(group,(u,pos,z),(w,depth,h),mat)
    else:box(group,(pos,u,z),(depth,w,h),mat)

def corrugated(group,u0,u1,z0,z1,side,pos):
    if u1-u0<.015 or z1-z0<.015:return
    sign=-1 if side in ('front','left') else 1
    profile=[(u0,0)]
    start=math.floor(u0/.24)
    for k in range(start,math.ceil(u1/.24)+1):
        for off,amp in [(0,0),(.065,0),(.095,.038),(.145,.038),(.175,0)]:
            u=k*.24+off
            if u0<u<u1:profile.append((u,amp))
    profile.append((u1,0))
    profile+= [(u,d-.017) for u,d in reversed(profile.copy())]
    def p(u,d,z):return (u,pos+sign*d,z) if side in ('front','rear') else (pos+sign*d,u,z)
    n=len(profile);vs=[p(u,d,z) for z in (z0,z1) for u,d in profile]
    fs=[tuple(reversed(range(n))),tuple(range(n,n*2))]
    fs.extend((i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n))
    meshpart(group,'Weathered zinc',vs,fs)

def clad_wall(side,pos,umin,umax,windows):
    cuts=sorted(set([umin,umax]+[c+s*w/2 for c,z,w,h in windows for s in (-1,1)]))
    zcuts=sorted(set([6.95,14.3]+[z+s*h/2 for c,z,w,h in windows for s in (-1,1)]))
    for a,b in zip(cuts,cuts[1:]):
        for lo,hi in zip(zcuts,zcuts[1:]):
            u,z=(a+b)/2,(lo+hi)/2
            if not any(abs(u-c)<w/2-.001 and abs(z-zz)<h/2-.001 for c,zz,w,h in windows):
                corrugated(f'{side} zinc cladding',a,b,lo,hi,side,pos)

def window(side,pos,u,z,w,h,cols=4,rows=2):
    sign=-1 if side in ('front','left') else 1
    g=f'{side} industrial windows'
    wallbox(g,u,z,w+.16,h+.16,side,pos-.12*sign,.10,'Rubber seals and buffers')
    # Opaque coated/frosted industrial glass; separate panes with physical frames.
    for i in range(cols):
        for j in range(rows):
            glass='Window glazing muted blue' if (i+j)%3 else 'Window glazing aged'
            wallbox(g,u-w/2+(i+.5)*w/cols,z-h/2+(j+.5)*h/rows,
                    w/cols-.055,h/rows-.055,side,pos-.08*sign,.035,glass)
    for i in range(cols+1):
        wallbox(g,u-w/2+i*w/cols,z,.055,h+.10,side,pos+.025*sign,.14,'Window frame aluminium')
    for j in range(rows+1):
        wallbox(g,u,z-h/2+j*h/rows,w+.10,.055,side,pos+.025*sign,.14,'Window frame aluminium')
    wallbox(g,u,z-h/2-.07,w+.24,.10,side,pos+.10*sign,.28,'Bare galvanized hardware')

FRONT=-6.65;BACK=8.6;SIDE=14.0

# Integral wall footings only: no surrounding slab, terrain or apron.
box('Foundation front',(0,FRONT+.14,.22),(28,.42,.44),'Cast concrete')
box('Foundation rear',(0,BACK-.14,.22),(28,.42,.44),'Cast concrete')
for s in (-1,1):box('Foundation sides',(s*13.86,.975,.22),(.42,15.25,.44),'Cast concrete')

# Front wall is constructed AROUND three openings. No solid occluding facade box.
centers=[-9.2,0,9.2];door_w=5.4;door_z0=.48;door_z1=6.55
gaps=[(-14,centers[0]-door_w/2)]
gaps.extend((centers[i]+door_w/2,centers[i+1]-door_w/2) for i in range(2))
gaps.append((centers[-1]+door_w/2,14))
for a,b in gaps:
    # Last pier has a separately inset personnel door.
    if a>10:
        for l,r in [(a,12.25),(13.45,b)]:
            box('Front brick piers',((l+r)/2,FRONT+.20,3.35),(r-l,.4,6.15),'Weathered red-brown brick')
        box('Personnel door lintel',(12.85,FRONT+.2,4.65),(1.2,.4,3.55),'Weathered red-brown brick')
    else:box('Front brick piers',((a+b)/2,FRONT+.20,3.35),(b-a,.4,6.15),'Weathered red-brown brick')
box('Front reinforced lintel',(0,FRONT+.2,6.73),(28,.55,.36),'Cast concrete')

for idx,c in enumerate(centers):
    group=f'Loading bay {idx+1}'
    # True 0.87m deep returns; back shutter plane is at -5.72m.
    for s in (-1,1):
        x=c+s*(door_w/2+.12)
        box(group+' concrete jamb',(x,FRONT+.40,3.47),(.24,.90,6.10),'Cast concrete')
        box(group+' steel jamb',(c+s*(door_w/2-.035),FRONT+.39,3.48),(.11,.87,6.0))
    box(group+' soffit',(c,FRONT+.41,6.48),(door_w,.88,.16),'Cast concrete')
    box(group+' dark reveal backing',(c,-5.59,3.50),(5.36,.06,6.02),'Interior shadow lining')
    box(group+' threshold',(c,-6.14,.43),(5.42,1.02,.18),'Cast concrete')
    box(group+' leveller lip',(c,-6.60,.53),(2.5,.14,.035),'Bare galvanized hardware')
    for s in (-1,1):
        box(group+' rail',(c+s*2.59,-5.76,3.49),(.09,.11,5.90),'Bare galvanized hardware')
        box(group+' outer seal',(c+s*2.70,-6.71,3.45),(.10,.10,5.90),'Rubber seals and buffers')
        box(group+' dock buffer',(c+s*2.35,-6.82,.87),(.22,.29,.68),'Rubber seals and buffers')
        for z in (.67,1.06):bolt(group+' buffer fixings',(c+s*2.35,-6.98,z),(0,-1,0),.023)
    # Separate horizontal insulated shutter leaves, narrow actual joints.
    for j in range(15):
        z=.64+(j+.5)*.383
        mat='Door blue-grey enamel' if j%4 else 'Door alternate enamel'
        box(group+' shutter panels',(c,-5.77,z),(5.07,.09,.368),mat)
        for zz in (z-.12,z+.12):box(group+' pressed ribs',(c,-5.826,zz),(5.04,.025,.024),mat)
    box(group+' bottom seal',(c,-5.83,.62),(5.16,.10,.065),'Rubber seals and buffers')
    for x in (c-1.6,c,c+1.6):
        box(group+' shutter vision seal',(x,-5.837,4.72),(1.07,.025,.40),'Rubber seals and buffers')
        box(group+' shutter vision glass',(x,-5.853,4.72),(.97,.018,.30),'Window glazing aged')
    for x in (c-.2,c+.2):box(group+' pull handle',(x,-5.90,1.25),(.035,.085,.35),'Bare galvanized hardware')
    box(group+' central handle grip',(c,-5.94,1.25),(.40,.035,.035),'Bare galvanized hardware')
    for s in (-1,1):
        for z in (1.55,3.2,5.8):bolt(group+' rail bolts',(c+s*2.60,-5.83,z),(0,-1,0),.02)

# Front personnel door remains subordinate to the three large loading bays.
box('Front personnel reveal',(12.85,-6.32,1.70),(1.20,.20,2.58),'Rubber seals and buffers')
box('Front personnel door',(12.85,-6.48,1.70),(1.08,.08,2.45),'Door blue-grey enamel')
box('Front personnel glazing',(12.85,-6.528,2.15),(.64,.018,.69),'Window glazing aged')
box('Front personnel handle',(13.23,-6.60,1.45),(.17,.04,.035),'Bare galvanized hardware')
for z in (.85,2.50):box('Front personnel hinges',(12.32,-6.54,z),(.035,.04,.14),'Bare galvanized hardware')

# Side/rear low walls: discrete brick infill and precast columns, not AI relief.
for sign in (-1,1):
    for a,b in zip([-6.65,-2.8,1.0,4.8],[-2.8,1.0,4.8,8.6]):
        box('Side brick infill',(sign*13.82,(a+b)/2,3.57),(.36,b-a,6.54),'Weathered red-brown brick')
    for y in (-6.45,-2.8,1.0,4.8,8.40):
        box('Side precast column',(sign*13.89,y,3.65),(.30,.36,6.8),'Cast concrete')
for a,b in [(-14,-1.2),(1.2,14)]:
    box('Rear brick wall',((a+b)/2,8.40,3.55),(b-a,.40,6.5),'Weathered red-brown brick')
box('Rear door lintel',(0,8.40,4.82),(2.4,.4,4.0),'Weathered red-brown brick')
box('Rear door reveal',(0,8.29,1.78),(2.42,.20,2.70),'Rubber seals and buffers')
for x in (-.57,.57):
    box('Rear service double doors',(x,8.48,1.78),(1.1,.08,2.55),'Door alternate enamel')
    box('Rear door handle',(x/3,8.57,1.55),(.035,.06,.35),'Bare galvanized hardware')
for x in (-8.5,8.5):
    box('Rear ventilation shadow',(x,8.64,3.2),(2.3,.09,1.5),'Duct dark interior')
    for j in range(12):
        beam('Rear ventilation louvers',(x-1.13,8.69,2.52+j*.12),(x+1.13,8.69,2.57+j*.12),.047,.11,'Bare galvanized hardware')

# Real, separately framed clerestory panes on all elevations.
front_windows=[(x,9.65,3.32,2.30) for x in (-11.7,-7.8,-3.9,0,3.9,7.8,11.7)]
side_windows=[(y,9.65,2.60,2.30) for y in (-4.65,-.8,3.05,6.75)]
for side,pos,lo,hi,windows in [('front',FRONT,-14,14,front_windows),('rear',BACK,-14,14,front_windows),
                              ('left',-14,-6.65,8.6,side_windows),('right',14,-6.65,8.6,side_windows)]:
    clad_wall(side,pos,lo,hi,windows)
    if side in ('left','right'):
        corrugated(side+' eave closure',lo,hi,14.28,14.56,side,pos)
    for u,z,w,h in windows:window(side,pos,u,z,w,h)
    for z in (6.96,11.02,13.95):
        wallbox(f'{side} horizontal girts',(lo+hi)/2,z,hi-lo,.12,side,pos,.18,'Painted structural steel')
    # Seated, small exposed fasteners in practical fixing rows.
    sign=-1 if side in ('front','left') else 1
    for i in range(math.ceil((hi-lo)/.96)):
        u=lo+.35+i*.96
        for z in (7.16,11.22,13.72):
            p=(u,pos+sign*.051,z) if side in ('front','rear') else (pos+sign*.051,u,z)
            n=(0,sign,0) if side in ('front','rear') else (sign,0,0)
            bolt(f'{side} cladding screws',p,n,.009)

# Structural portals, visible flange profiles and bolted connection plates.
for y in (-6.73,8.67):
    for x in (-13.72,-4.6,4.6,13.72):
        beam('Exterior I section columns',(x,y,.35),(x,y,14.42),.27,.40,isection=True)
        box('Column base plates',(x,y,.38),(.46,.60,.07),'Bare galvanized hardware')
        for dx in (-.15,.15):
            for dy in (-.21,.21):bolt('Base anchors',(x+dx,y+dy,.42),(0,0,1),.027)
        for z in (6.90,13.85):
            s=-1 if y<0 else 1
            box('Column connection plates',(x,y+s*.22,z),(.42,.038,.48))
            for dx in (-.13,.13):
                for dz in (-.16,.16):bolt('Portal structural bolts',(x+dx,y+s*.244,z+dz),(0,s,0),.027)

def roof_z(x):return 16.80-abs(x)*(2.4/15)

# Closed zinc gable infill follows the actual pitched roof.
for side,pos in [('front',FRONT),('rear',BACK)]:
    sign=-1 if side=='front' else 1
    for i in range(59):
        a=-14+i*28/59;b=-14+(i+1)*28/59
        h=roof_z((a+b)/2)-.18
        corrugated(side+' gable infill',a,b,14.28,h,side,pos)
    for a,b in [((-14,pos,roof_z(14)-.12),(0,pos,16.69)),((0,pos,16.69),(14,pos,roof_z(14)-.12))]:
        beam(side+' exposed rake beam',a,b,.18,.22,isection=True)

# Long-span roof structure, kept as editable closed structural parts.
for y in (-6.35,-2.60,1.15,4.90,8.3):
    for s in (-1,1):
        beam('Roof portal top chords',(s*13.70,y,14.30),(0,y,16.53),.22,.34,isection=True)
    beam('Roof truss tie',(-13.7,y,14.05),(13.7,y,14.05),.14,.22)
    for i in range(8):
        xa=-13.7+i*3.425;xb=xa+3.425
        a=(xa,y,14.09) if i%2==0 else (xa,y,roof_z(xa)-.29)
        b=(xb,y,roof_z(xb)-.29) if i%2==0 else (xb,y,14.09)
        beam('Roof truss diagonal webs',a,b,.075,.09)

skylights=[(-7.2,-2.20,4.0,3.0),(7.2,-2.20,4.0,3.0),(-7.2,4.25,4.0,3.0),(7.2,4.25,4.0,3.0)]

def roof_patch(group,x0,x1,y0,y1,mat='Weathered zinc',lift=0,thick=.055):
    p=[(x0,y0,roof_z(x0)+lift),(x1,y0,roof_z(x1)+lift),
       (x1,y1,roof_z(x1)+lift),(x0,y1,roof_z(x0)+lift)]
    vs=p+[(x,y,z-thick) for x,y,z in p]
    meshpart(group,mat,vs,[(0,1,2,3),(7,6,5,4),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)])

# Roof patches omit the true skylight openings; glass is not placed over solid roof.
xcuts=sorted(set([-15,0,15]+[x+s*w/2 for x,y,w,h in skylights for s in (-1,1)]))
ycuts=sorted(set([-7.1,9]+[y+s*h/2 for x,y,w,h in skylights for s in (-1,1)]))
for a,b in zip(xcuts,xcuts[1:]):
    for c,d in zip(ycuts,ycuts[1:]):
        if any(abs((a+b)/2-x)<w/2-.001 and abs((c+d)/2-y)<h/2-.001 for x,y,w,h in skylights):continue
        roof_patch('Pitched roof zinc sheets',a,b,c,d)
for i in range(41):
    x=-15+i*.75
    segments=[(-7.10,9.0)]
    for sx,sy,w,h in skylights:
        if abs(x-sx)<w/2+.02:
            new=[]
            for a,b in segments:
                if b<=sy-h/2 or a>=sy+h/2:new.append((a,b))
                else:
                    if a<sy-h/2:new.append((a,sy-h/2))
                    if b>sy+h/2:new.append((sy+h/2,b))
            segments=new
    for a,b in segments:
        beam('Standing roof seams',(x,a,roof_z(x)+.027),(x,b,roof_z(x)+.027),.028,.050,'Weathered zinc')
for sx,sy,w,h in skylights:
    # Open kerbs: separate glass panes and perimeter profiles, no buried roof panel.
    for xx in (sx-w/2,sx+w/2):
        beam('Skylight perimeter frames',(xx,sy-h/2,roof_z(xx)+.15),(xx,sy+h/2,roof_z(xx)+.15),.105,.13,'Window frame aluminium')
    for yy in (sy-h/2,sy+h/2):
        beam('Skylight perimeter frames',(sx-w/2,yy,roof_z(sx-w/2)+.15),(sx+w/2,yy,roof_z(sx+w/2)+.15),.105,.13,'Window frame aluminium')
    for i in range(4):
        x0=sx-w/2+i*w/4+.04;x1=sx-w/2+(i+1)*w/4-.04
        roof_patch('Individual skylight glass',x0,x1,sy-h/2+.05,sy+h/2-.05,'Wired skylight glass',.15,.03)
    for i in range(1,4):
        xx=sx-w/2+i*w/4
        beam('Skylight intermediate bars',(xx,sy-h/2,roof_z(xx)+.17),(xx,sy+h/2,roof_z(xx)+.17),.075,.085,'Window frame aluminium')
    beam('Skylight cross bars',(sx-w/2,sy,roof_z(sx-w/2)+.17),(sx+w/2,sy,roof_z(sx+w/2)+.17),.065,.08,'Window frame aluminium')

# Ridge capping and three functional louvered extraction monitors, 18m maximum.
for side in (-1,1):
    beam('Folded ridge cap',(side*.16,-7.10,16.86),(side*.16,9,16.86),.32,.06,'Bare galvanized hardware')
for y in (-3.75,1.00,5.75):
    box('Ridge extraction dark chamber',(0,y,17.36),(1.25,2.05,.97),'Duct dark interior')
    for s in (-1,1):
        for j in range(7):
            box('Ridge monitor louvers',(s*.66,y,16.98+j*.115),(.15,2.12,.055),'Bare galvanized hardware')
        box('Ridge monitor end cheeks',(0,y+s*1.08,17.38),(1.45,.07,1.0),'Weathered zinc')
    box('Ridge monitor weather hood',(0,y,17.96),(1.76,2.45,.08),'Weathered zinc')

# Two roof-mounted HVAC units with grilles, fan rings and separate blades.
for x,y in [(-11.2,5.8),(10.7,6.25)]:
    z=roof_z(x)
    for dx in (-.65,.65):box('HVAC support curb',(x+dx,y,z+.22),(.14,2.1,.4))
    box('Roof HVAC cabinet',(x,y,z+.68),(1.8,1.8,.70),'Weathered zinc')
    box('HVAC grille shadow',(x,y-.92,z+.65),(1.54,.025,.48),'Duct dark interior')
    for j in range(9):box('HVAC grille slats',(x,y-.95,z+.45+j*.05),(1.57,.07,.017),'Bare galvanized hardware')
    cylinder('HVAC fan opening',(x,y,z+1.03),(x,y,z+1.055),.61,'Duct dark interior',32)
    for rr in (.25,.41,.59):
        ps=[(x+rr*math.cos(i*math.tau/48),y+rr*math.sin(i*math.tau/48),z+1.09) for i in range(49)]
        pathpipe('HVAC fan wire guard',ps,.008,sides=6)
    for i in range(8):
        angle=i*math.tau/8
        beam('HVAC fan guard spokes',(x,y,z+1.09),(x+.59*math.cos(angle),y+.59*math.sin(angle),z+1.09),.012,.012,'Bare galvanized hardware')

# Suspended canopy: pitched zinc skin, exposed I-beams and triangulated brackets.
def canopy_z(y):return 7.36+(y-FRONT)*.13
for a,b in zip([-14.4,-9.6,-4.8,0,4.8,9.6],[-9.6,-4.8,0,4.8,9.6,14.4]):
    vs=[(a,-9,canopy_z(-9)),(b,-9,canopy_z(-9)),(b,FRONT,canopy_z(FRONT)),(a,FRONT,canopy_z(FRONT))]
    p=vs+[(x,y,z-.07) for x,y,z in vs]
    meshpart('Canopy zinc roof','Weathered zinc',p,[(0,1,2,3),(7,6,5,4),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)])
for x in (-13.7,-4.6,4.6,13.7):
    beam('Canopy cantilever I beams',(x,-6.50,7.19),(x,-8.90,6.88),.16,.27,isection=True)
    beam('Canopy diagonal brackets',(x,-6.58,5.84),(x,-8.75,6.79),.11,.13)
    box('Canopy wall anchor plates',(x,-6.79,6.15),(.46,.07,.74))
    for dx in (-.14,.14):
        for z in (5.90,6.4):bolt('Canopy anchor bolts',(x+dx,-6.84,z),(0,-1,0),.027)
for y in (-8.92,-7.8,-6.65):beam('Canopy transverse purlins',(-14.4,y,canopy_z(y)-.12),(14.4,y,canopy_z(y)-.12),.12,.12)
for i in range(37):
    x=-14.4+i*.8
    beam('Canopy standing seams',(x,-8.99,canopy_z(-9)+.022),(x,-6.65,canopy_z(-6.65)+.022),.018,.035,'Weathered zinc')
box('Canopy front folded gutter',(0,-8.94,6.99),(28.80,.12,.18),'Bare galvanized hardware')

# Eave gutters/drain pipes. Small service conduits follow the wall, not floating.
for s in (-1,1):
    x=s*14.76
    box('Eave box gutter',(x,.95,14.34),(.28,16.10,.23),'Bare galvanized hardware')
    for y in (-6.15,8.05):
        pathpipe('Rainwater downpipes',[(x,y,14.29),(s*14.22,y,13.93),(s*14.20,y,.75),(s*14.42,y,.48)],.072)
        for z in (1.2,4.2,7.2,10.2,13.2):
            box('Pipe wall clips',(s*14.11,y,z),(.20,.18,.045),'Bare galvanized hardware')
            cylinder('Downpipe collars',(s*14.20,y,z-.025),(s*14.20,y,z+.025),.087,segments=16)
    pathpipe('Canopy drainage',[(s*14.20,-8.84,7.02),(s*14.2,-8.84,6.67),(s*14.2,-6.95,6.4),(s*14.16,-6.95,.50)],.055)
pathpipe('Front electrical conduit',[(-13.5,-6.79,7.74),(13.40,-6.79,7.74),(13.4,-6.79,4.0)],.026,'Painted structural steel')
for x in (-12.9,-4.6,4.6,13.4):box('Conduit junction boxes',(x,-6.84,7.74),(.22,.12,.20),'Bare galvanized hardware')
box('Front service cabinet',(13.38,-6.82,3.82),(.48,.19,.67),'Door alternate enamel')
for z in (3.6,3.9,4.1):box('Service cabinet cooling slots',(13.38,-6.925,z),(.34,.02,.025),'Duct dark interior')

# A real maintenance ladder, standoffs and half-round safety cage on the right.
LY=3.8;LX=14.30
for y in (LY-.27,LY+.27):
    beam('Maintenance ladder rails',(LX,y,.60),(LX,y,15.85),.055,.070,'Bare galvanized hardware')
for i in range(50):
    z=.72+i*.29
    cylinder('Maintenance ladder rungs',(LX,LY-.30,z),(LX,LY+.30,z),.022,segments=12)
for z in (1.3,4.3,7.3,10.3,13.3):
    for y in (LY-.27,LY+.27):beam('Ladder wall standoffs',(14.02,y,z),(LX,y,z),.045,.055,'Bare galvanized hardware')
for i in range(14):
    z=3.0+i*.90
    ps=[(LX+.44*math.cos(-math.pi/2+j*math.pi/24),LY+.44*math.sin(-math.pi/2+j*math.pi/24),z) for j in range(25)]
    pathpipe('Ladder safety cage hoops',ps,.018,sides=8)
for angle in (-70,-35,0,35,70):
    theta=math.radians(angle);x=LX+.44*math.cos(theta);y=LY+.44*math.sin(theta)
    beam('Ladder safety cage uprights',(x,y,3.0),(x,y,14.7),.026,.04,'Bare galvanized hardware')
roof_patch('Roof access hatch frame',12.27,13.57,LY-.675,LY+.675,'Rubber seals and buffers',.15,.20)
roof_patch('Roof access hatch',12.34,13.5,LY-.59,LY+.59,'Weathered zinc',.29,.09)
for y in (LY-.45,LY+.45):
    cylinder('Roof hatch lifting handles',(12.7,y,roof_z(12.7)+.38),(13.1,y,roof_z(13.1)+.38),.02)

# Semantic components remain separately editable, modest bevels on manufactured edges.
objects=[]
for (group,mat),(vertices,faces,uvs,smooth) in buckets.items():
    if not faces:continue
    me=bpy.data.meshes.new(group);me.from_pydata(vertices,[],faces);me.materials.append(materials[mat]);me.update()
    uv=me.uv_layers.new(name='Physical repeat 2.4m')
    for loop,value in zip(uv.data,uvs):loop.uv=value
    for poly,s in zip(me.polygons,smooth):poly.use_smooth=s
    bm=bmesh.new();bm.from_mesh(me);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(me);bm.free()
    ob=bpy.data.objects.new(group+' | '+mat,me);bpy.context.collection.objects.link(ob);objects.append(ob)
    ob['component']=group;ob['surface']=mat
    # Sheet ribs/cylinders retain their analytic profiles; load-bearing steel/frames get rounded edges.
    skip=any(word in group.lower() for word in ('screw','bolt','anchor','rung','pipe','collar','cage','wire guard','fan opening','glazing','glass','cladding','gable infill','standing','roof zinc','zinc roof'))
    if not skip and mat not in ('Rubber seals and buffers','Interior shadow lining','Duct dark interior'):
        bevel=ob.modifiers.new('Manufactured edge radius','BEVEL')
        bevel.width=.012 if mat=='Cast concrete' else .007 if mat=='Painted structural steel' else .003
        bevel.segments=3;bevel.limit_method='ANGLE';bevel.angle_limit=math.radians(40)
        bpy.context.view_layer.objects.active=ob
        bpy.ops.object.modifier_apply(modifier=bevel.name)
    # Explicitly triangulate concave I-section/corrugated caps before tangent export.
    bpy.context.view_layer.objects.active=ob
    tri=ob.modifiers.new('Explicit export triangulation','TRIANGULATE')
    bpy.ops.object.modifier_apply(modifier=tri.name)

# Exact assembly envelope. The sole correction removes tiny bevel/export tolerances;
# primary geometry was designed to this envelope, so proportions remain unchanged.
bpy.context.view_layer.update()
points=[ob.matrix_world@v.co for ob in objects for v in ob.data.vertices]
lo=Vector(tuple(min(p[i] for p in points) for i in range(3)));hi=Vector(tuple(max(p[i] for p in points) for i in range(3)))
center=Vector(((lo.x+hi.x)/2,(lo.y+hi.y)/2,lo.z))
factor=Vector((30/(hi.x-lo.x),18/(hi.y-lo.y),18/(hi.z-lo.z)))
for ob in objects:
    for v in ob.data.vertices:v.co=Vector(tuple((v.co[i]-center[i])*factor[i] for i in range(3)))
    ob.data.update()
bpy.context.scene.unit_settings.system='METRIC';bpy.context.scene.unit_settings.scale_length=1
bpy.context.scene['asset']='dock_warehouse'
bpy.context.scene['coordinate_note']='Blender -Y front / Z up; export glTF +Z front / +Y up. Bottom centre pivot.'
bpy.context.scene['design_note']='One 30m W x18m H x18m D harbour warehouse, including canopy, roof and service equipment. No ground plane.'
bpy.context.scene['placement_note']='Bottom-centre origin Y=0 in the asset. Game places this origin at dock Y=-5. Front glTF +Z toward road.'
for image in bpy.data.images:
    if image.source=='FILE':image.pack()
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'dock_warehouse.blend'))
glb=OUT/'dock_warehouse_full.glb'
bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',export_yup=True,export_apply=True,export_image_format='AUTO',export_tangents=True)
triangles=0
for ob in objects:ob.data.calc_loop_triangles();triangles+=len(ob.data.loop_triangles)
stats={
 'asset':'dock_warehouse','game_file':str(glb),'game_triangles':triangles,'game_bytes':glb.stat().st_size,
 'game_dimensions_m':[30,18,18],'units':'metres','up':'+Y','front':'+Z','pivot':'bottom centre',
 'method':'Authored hard-surface warehouse. Existing project concepts informed material palette; no warehouse AI reconstruction or new generated concept is claimed.',
 'material_count':len(materials),'embedded_texture_target':[2048,2048],
 'geometry_components':len(objects),'normalization_factors_xyz':list(factor),'pre_normalization_bounds_blender':[list(lo),list(hi)],
 'game_sha256':hashlib.sha256(glb.read_bytes()).hexdigest(),'blender_version':bpy.app.version_string,
 'emission_policy':'All materials zero emission. No text, neon or emissive strips.',
 'original_retained':'dock_warehouse.blend; editable named components with packed images; no decimation.'
}
(OUT/'full_stats.json').write_text(json.dumps(stats,indent=2)+'\n')
print('WAREHOUSE_STATS '+json.dumps(stats))
