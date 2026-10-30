"""Deterministic seamless warehouse PBR maps, authored without baked lighting.

Run with host Python (numpy, Pillow). Four physical surfaces, 2K base colour,
packed roughness/metallic and tangent normal maps. UV repeat is 2.4 metres.
"""
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter

OUT = Path(__file__).resolve().parent.parent / 'materials'
OUT.mkdir(exist_ok=True)
N = 2048
rng = np.random.default_rng(3081818)

def noise(kx, ky=None):
    ky = ky or kx
    a = rng.random((ky, kx), dtype=np.float32)
    ux = np.arange(N, dtype=np.float32)*kx/N
    uy = np.arange(N, dtype=np.float32)*ky/N
    ix, iy = ux.astype(int), uy.astype(int)
    fx, fy = ux-ix, uy-iy
    fx, fy = fx*fx*(3-2*fx), fy*fy*(3-2*fy)
    b = a[iy[:,None]%ky,ix[None,:]%kx]*(1-fx[None,:])+a[iy[:,None]%ky,(ix[None,:]+1)%kx]*fx[None,:]
    c = a[(iy[:,None]+1)%ky,ix[None,:]%kx]*(1-fx[None,:])+a[(iy[:,None]+1)%ky,(ix[None,:]+1)%kx]*fx[None,:]
    return b*(1-fy[:,None])+c*fy[:,None]-.5

fine, grain, patch = noise(1024), noise(256), noise(12)
streak = noise(170, 7)

def write(name, colour, rough, metal, height, strength):
    colour = np.clip(colour, 0, 255).astype('uint8')
    Image.fromarray(colour).save(OUT/f'{name}_basecolor.png')
    packed = np.ones((N,N,3),np.float32)
    packed[:,:,1] = np.clip(rough,0,1)
    packed[:,:,2] = np.clip(metal,0,1)
    Image.fromarray((packed*255).astype('uint8')).save(OUT/f'{name}_orm.png')
    dx = (np.roll(height,-1,1)-np.roll(height,1,1))*strength
    dy = (np.roll(height,-1,0)-np.roll(height,1,0))*strength
    normal = np.stack((-dx,dy,np.ones_like(dx)),axis=-1)
    normal /= np.linalg.norm(normal,axis=-1,keepdims=True)
    Image.fromarray(np.clip((normal*.5+.5)*255,0,255).astype('uint8')).save(OUT/f'{name}_normal.png')

# Running bond: 240 x75 mm brick modules, 9 mm mortar joints.
yy,xx = np.mgrid[:N,:N].astype(np.float32)/N*2.4
course = np.floor(yy/.075).astype(int)
bx = (xx + (course%2)*.12) % 2.4
brick = np.floor(bx/.24).astype(int)%10
fx,fy = bx%.24, yy%.075
edge = np.minimum(np.minimum(fx,.24-fx),np.minimum(fy,.075-fy))
joint = np.clip((.006-edge)/.003,0,1)
brick_variation = rng.normal(0,1,(32,10))[course%32,brick]
brick_tone = np.array([122,79,60])[None,None,:] + brick_variation[:,:,None]*np.array([10,8,6])
brick_tone += (fine*14+grain*10+patch*11)[:,:,None]
mortar = np.array([137,132,119])[None,None,:]+(fine*12+patch*10)[:,:,None]
colour = brick_tone*(1-joint[:,:,None])+mortar*joint[:,:,None]
height = (1-joint)*.75+fine*.08+grain*.16
write('brick', colour, .83+fine*.07+joint*.06, np.zeros((N,N)), height, 1.5)

# Weathered zinc, fine crystalline mottling with restrained rain streaks.
spangle = noise(96)+noise(160)*.4
grime = np.clip(streak+.12,0,.65)
tone = fine*9+spangle*23+patch*20-grime*16
colour = np.array([149,156,151])[None,None,:]+tone[:,:,None]
write('zinc',colour,.52+spangle*.11+grime*.18,.84-grime*.52,fine*.05+spangle*.025, .7)

# Dielectric painted structural steel; sparse exposed-metal scratches.
scratch_noise = noise(540,90)
chips = np.clip((scratch_noise-.29)*8,0,1)
colour = np.array([58,72,72])[None,None,:]+(fine*8+patch*17+streak*10)[:,:,None]
colour = colour*(1-chips[:,:,None])+np.array([114,110,98])[None,None,:]*chips[:,:,None]
write('paint',colour,.49+patch*.09+chips*.12,chips*.78,fine*.045-chips*.14,.6)

# Cast-concrete frames and thresholds: small pores/aggregate, no large waves.
pores = np.zeros((N,N),np.float32)
for radius,count in [(1,4200),(2,800),(3,90)]:
    centers=rng.integers(0,N,(count,2)); value=rng.uniform(.3,1,count)
    for dy in range(-radius,radius+1):
        for dx in range(-radius,radius+1):
            rr=(dx*dx+dy*dy)/(radius*radius)
            if rr<=1:
                y=(centers[:,0]+dy)%N;x=(centers[:,1]+dx)%N
                pores[y,x]=np.maximum(pores[y,x],value*(1-.45*rr))
tone=fine*14+grain*13+patch*21-pores*33
colour=np.array([153,148,135])[None,None,:]+tone[:,:,None]
write('concrete',colour,.79+fine*.07+pores*.09,np.zeros((N,N)),fine*.12+grain*.16-pores*.4,.9)
print('Wrote 12 seamless 2048-square warehouse maps to',OUT)
