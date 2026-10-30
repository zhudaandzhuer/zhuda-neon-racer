"""Deterministic material microstructure only: no highlights, shadows or AO."""
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter
root=Path(__file__).resolve().parent.parent/'materials';root.mkdir(exist_ok=True)
n=1024;rng=np.random.default_rng(800)
height=Image.fromarray(rng.integers(0,256,(n,n),dtype=np.uint8)).filter(ImageFilter.GaussianBlur(.8))
h=np.asarray(height,dtype=np.float32)/255
dx=(np.roll(h,1,axis=1)-np.roll(h,-1,axis=1))*.32;dy=(np.roll(h,1,axis=0)-np.roll(h,-1,axis=0))*.32
v=np.stack([dx,dy,np.ones_like(dx)],axis=-1);v/=np.linalg.norm(v,axis=-1,keepdims=True)
Image.fromarray(np.uint8(np.clip(v*.5+.5,0,1)*255)).save(root/'rubber_normal.png')
rough=np.clip(.72+(h-.5)*.10,.66,.78)
orm=np.stack([np.ones_like(h),rough,np.zeros_like(h)],axis=-1)
Image.fromarray(np.uint8(orm*255)).save(root/'rubber_orm.png')
print('Material-only 1024 normal + ORM maps created; no baked light.')
