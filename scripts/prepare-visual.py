"""Blender Python: produce scene-linear GGX IBL and data-correct PBR maps from CC0 sources."""
from pathlib import Path
import json, math, hashlib
import bpy
import numpy as np

root=Path(__file__).resolve().parents[1]/'public/visual-assets'
hdr=bpy.data.images.load(str(root/'kloppenheim_06_puresky_1k.hdr'))
w,h=hdr.size
image=np.array(hdr.pixels[:],dtype=np.float32).reshape(h,w,4)[::-1,:,:3]

def sample(d):
    # World direction: +Y up; azimuth atan2(z,x). Texture row zero is north.
    x=(np.arctan2(d[...,2],d[...,0])/(2*np.pi)+.5)*w-.5
    y=np.arccos(np.clip(d[...,1],-1,1))/np.pi*h-.5
    x0=np.floor(x).astype(int);y0=np.floor(y).astype(int)
    tx=(x-x0)[...,None];ty=(y-y0)[...,None]
    a=image[np.clip(y0,0,h-1),x0%w];b=image[np.clip(y0,0,h-1),(x0+1)%w]
    c=image[np.clip(y0+1,0,h-1),x0%w];d=image[np.clip(y0+1,0,h-1),(x0+1)%w]
    return ((a*(1-tx)+b*tx)*(1-ty)+(c*(1-tx)+d*tx)*ty).astype(np.float32)

def face_dirs(face,size):
    v,u=np.mgrid[:size,:size].astype(np.float32);u=(u+.5)/size*2-1;v=(v+.5)/size*2-1
    one=np.ones_like(u)
    # WebGL cube coordinates; Laya mirrors X at lookup.
    xyz=[(one,-v,-u),(-one,-v,u),(u,one,v),(u,-one,-v),(u,-v,one),(-u,-v,-one)][face]
    d=np.stack(xyz,-1);d/=np.linalg.norm(d,axis=-1,keepdims=True);d[...,0]*=-1
    return d.reshape(-1,3)

def radical(i):
    value=0.;factor=.5
    while i: value+=(i&1)*factor;i>>=1;factor*=.5
    return value

size=256;levels=[];chunks=[];offset=0
for mip in range(9):
    side=max(1,size>>mip)
    # Inverse of Laya's perceptual roughness -> mip curve r*(2-r).
    rough=1-math.sqrt(max(0,1-mip/8));alpha=max(.001,rough*rough)
    faces=[]
    for face in range(6):
        normal=face_dirs(face,side)
        if mip==0: color=sample(normal)
        else:
            up=np.tile([0.,1.,0.],(len(normal),1));up[np.abs(normal[:,1])>.99]=[1.,0.,0.]
            tangent=np.cross(up,normal);tangent/=np.linalg.norm(tangent,axis=-1,keepdims=True)
            bitangent=np.cross(normal,tangent)
            color=np.zeros_like(normal);weights=np.zeros((len(normal),1),np.float32)
            for i in range(128):
                phi=2*np.pi*i/128;xi=radical(i)
                cos=math.sqrt((1-xi)/(1+(alpha*alpha-1)*xi));sin=math.sqrt(max(0,1-cos*cos))
                halfway=tangent*(math.cos(phi)*sin)+bitangent*(math.sin(phi)*sin)+normal*cos
                light=2*np.sum(normal*halfway,axis=-1,keepdims=True)*halfway-normal
                weight=np.maximum(0,np.sum(normal*light,axis=-1,keepdims=True))
                color+=sample(light)*weight;weights+=weight
            color/=np.maximum(weights,1e-6)
        rgba=np.concatenate([color,np.ones((len(color),1),np.float32)],-1).astype('<f4')
        faces.append(rgba.ravel())
    data=np.concatenate(faces);levels.append({'size':side,'offset':offset,'elements':len(data)});offset+=len(data);chunks.append(data)
    print('GGX mip',mip,side,flush=True)
pixels=np.concatenate(chunks);pixels.tofile(root/'harbor-ibl.bin')

# Diffuse irradiance / pi: real spherical harmonics packed in Laya's polynomial order.
yy,xx=np.mgrid[:h,:w];theta=(yy+.5)/h*np.pi;phi=((xx+.5)/w-.5)*2*np.pi
x=-np.sin(theta)*np.cos(phi);y=np.cos(theta);z=np.sin(theta)*np.sin(phi)
basis=[np.ones_like(x)*.282095,.488603*y,.488603*z,.488603*x,1.092548*x*y,1.092548*y*z,.315392*(3*z*z-1),1.092548*z*x,.546274*(x*x-y*y)]
factors=[.282095,.488603*2/3,.488603*2/3,.488603*2/3,1.092548/4,1.092548/4,.315392/4,1.092548/4,.546274/4]
weight=np.sin(theta)*(2*np.pi/w)*(np.pi/h)
sh=[np.sum(image*(b*weight)[...,None],axis=(0,1))*f for b,f in zip(basis,factors)]
# Sun direction is metadata for the matching direct shadow light.
lum=image@np.array([.2126,.7152,.0722]);sun=np.unravel_index(np.argmax(lum[:h//2]),(h//2,w));lat=(sun[0]+.5)/h*np.pi;lon=((sun[1]+.5)/w-.5)*2*np.pi
meta={'size':size,'levels':levels,'ambientSH':np.array(sh).ravel().tolist(),'sunDirection':[math.sin(lat)*math.cos(lon),math.cos(lat),math.sin(lat)*math.sin(lon)],'source':'kloppenheim_06_puresky_1k.hdr','method':'128-sample GGX per nonzero mip, irradiance SH9, linear float32 RGBA','bytes':int(pixels.nbytes),'sha256':hashlib.sha256(pixels.tobytes()).hexdigest()}
(root/'harbor-ibl.json').write_text(json.dumps(meta,indent=2)+'\n')

for name in ['asphalt','concrete']:
    rough=bpy.data.images.load(str(root/f'{name}-rough.jpg'));rough.colorspace_settings.name='Non-Color'
    rw,rh=rough.size;data=np.array(rough.pixels[:],dtype=np.float32).reshape(rh,rw,4)
    # Native Laya metallic R and smoothness A. Keep texture linear, not sRGB.
    out=np.zeros_like(data);out[:,:,3]=1-data[:,:,0]
    image_out=bpy.data.images.new(name+'-packed',rw,rh,alpha=True);image_out.colorspace_settings.name='Non-Color'
    image_out.pixels.foreach_set(out.ravel());image_out.filepath_raw=str(root/f'{name}-metallic-smoothness.png');image_out.file_format='PNG';image_out.save()
print('Prepared HDR environment and PBR data maps',flush=True)
