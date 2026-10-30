"""Package evidence from the final unchanged GLB, without modifying the model."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, PngImagePlugin, ImageChops
import json, hashlib, subprocess, struct
R=Path(__file__).resolve().parent.parent
load=lambda n:json.loads((R/n).read_text())
stats=load('stats.json');val=load('validation.json');vid=load('wheel_spin_metadata.json');ref=load('reference_sources.json')
sha=hashlib.sha256((R/'maextro_s800_hero_v2.glb').read_bytes()).hexdigest()
assert sha==stats['sha256']==val['sha256']==vid['source_glb_sha256']
assert val['passed']
probe=json.loads(subprocess.check_output(['/opt/homebrew/bin/ffprobe','-v','error','-show_streams','-show_format','-of','json',str(R/'wheel_spin.mp4')]))
vs=next(s for s in probe['streams'] if s['codec_type']=='video');assert int(vs['nb_frames'])==48 and int(vs['width'])==960 and abs(float(probe['format']['duration'])-2)<.01
views=[('model_preview','FRONT THREE-QUARTER'),('model_front','FRONT ORTHOGRAPHIC'),('model_side','SIDE ORTHOGRAPHIC'),('model_rear','REAR THREE-QUARTER'),('model_surface_detail','SURFACE HIGHLIGHT'),('model_wheel_detail','FRONT-LEFT WHEEL')]
try:font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',24)
except OSError:font=ImageFont.load_default()
canvas=Image.new('RGB',(1800,1870),(25,30,37));draw=ImageDraw.Draw(canvas)
draw.text((22,16),'S800 v2 | Actual reimported GLB | Reference reconstruction',fill='white',font=font)
draw.text((22,49),'SHA-256 '+sha,fill=(175,190,203),font=font)
for i,(name,title) in enumerate(views):
 im=Image.open(R/(name+'.png'));assert im.size==(1440,900)
 meta=PngImagePlugin.PngInfo();meta.add_text('SourceGLB_SHA256',sha);meta.add_text('Source','Fresh Blender import of maextro_s800_hero_v2.glb; Cycles CPU, 24 samples; no AI image generation.');im.save(R/(name+'.png'),pnginfo=meta)
 tile=im.convert('RGB').resize((900,562),Image.Resampling.LANCZOS);x=(i%2)*900;y=104+(i//2)*588;canvas.paste(tile,(x,y));draw.text((x+15,y+562),title,fill=(220,230,240),font=font)
canvas.save(R/'model_contact_sheet.jpg',quality=94,subsampling=0)
orig=R.parent/'maextro_s800.glb';original_sha=hashlib.sha256(orig.read_bytes()).hexdigest();assert original_sha=='dc2c6049f17ef63f520f2a2295d75a26ed4391968fe240bff9750cb0125825a2'
limitations=[
 '參考圖重建；車身斷面、車尾、前保桿與窗框過渡仍較簡化，未達實車近景精度。',
 '燈具內部光學、星雲尾燈紋理、輪圈截面和徽記為近似造型。',
 '輪距 1.720 m、輪胎半徑 0.388 m、胎寬 0.268 m、前後懸分配與含後視鏡寬度是估算值。',
 '內裝、底盤、煞車細節簡化；無車門開啟或懸吊行程；前輪為等角轉向，未實作 Ackermann。',
 '官方現行頁高度為 1542 mm，沒有確認特定事故車輛的年式、配置或損傷。',
 '尚未在遊戲引擎重新驗收 HDR／透明玻璃／反射或做 LOD、draw-call 與效能優化。'
]
manifest={'asset':'Maextro S800 reference reconstruction v2','status':'reviewable_reconstruction','technical_validation_passed':True,'visual_fidelity_target_met':False,'sha256':sha,'bytes':stats['bytes'],'triangles':stats['triangles'],'mesh_count':stats['mesh_count'],'materials':stats['material_count'],'embedded_images':val['images'],'measured_spec_width_height_length_m':val['measured_spec_width_height_length_m'],'dimensions_including_mirrors_m':val['dimensions_including_mirrors_m'],'manufacturer_nominal_width_height_length_m':[2,1.542,5.480],'wheelbase_m':val['wheelbase_m'],'axis_contract':{'units':'metres','up':'+Y','front':'+Z','vehicle_left':'+X','vehicle_right':'-X','root_pivot':[0,0,0],'ground_Y':0},'wheel_nodes':val['wheels'],'animations':['WheelSpin','FrontSteer'],'extensionsUsed':stats['extensionsUsed'],'extensionsRequired':stats['extensionsRequired'],'original_preserved_sha256':original_sha,'limitations':limitations,'source':'reference_sources.json','verification':'validation.json','files':{},'preview_source_sha256':sha,'video':{'file':'wheel_spin.mp4','frames':48,'fps':24,'duration_s':2,'render_engine':'BLENDER_EEVEE','source':'Actual GLB quaternion tracks replayed on fresh imported nodes.','metadata':'wheel_spin_metadata.json'}}
for name in ['maextro_s800_hero_v2.glb','maextro_s800_hero_v2.blend','validation.json','editable_validation.json','reference_sources.json','wheel_spec.json','wheel_spin.mp4','wheel_spin_metadata.json','model_contact_sheet.jpg']+[n+'.png' for n,t in views]:
 p=R/name;manifest['files'][name]={'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
(R/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
w,h,l=val['measured_spec_width_height_length_m'];mir=val['dimensions_including_mirrors_m'][0]
text=f'''# 尊界 S800 v2 — 可檢查的參考重建資產

GLB 已完成分件、厚度、PBR 與可動四輪，技術驗證通過。造型仍需美術精修，**不代表已達實車近景或 AAA 品質**。原始混元 S800 GLB 保留在上一層，未修改；遊戲和引擎程式未修改。

- 模型：`maextro_s800_hero_v2.glb`
- 可編輯原檔：`maextro_s800_hero_v2.blend`，兩張材質圖片已打包。
- 實際模型六視圖：`model_contact_sheet.jpg`，各單張為 `model_*.png`。
- 轉輪短片：`wheel_spin.mp4`，960 × 600、24 fps、48 幀、2 秒。
- 完整機器可讀資料：`manifest.json`、`validation.json`、`reference_sources.json`。

GLB 為 **{stats['bytes']:,} bytes**，**{stats['triangles']:,} 三角面**、{stats['mesh_count']} 個 mesh、{stats['material_count']} 種實際使用材質。

```text
SHA-256 {sha}
```

## 尺寸與座標

直接讀取 GLB accessor 和節點矩陣量測，再以 fresh Blender import 的世界座標交叉核對。未使用全車拉伸校正。

| 項目 | 官方現行名義尺寸 | 實際 GLB |
|---|---:|---:|
| 車寬，不含後視鏡 | 2.000 m | {w:.6f} m |
| 接地面至車頂 | 1.542 m | {h:.6f} m |
| 車長 | 5.480 m | {l:.6f} m |
| 軸距 | 3.370 m | {val['wheelbase_m']:.6f} m |
| 含後視鏡寬 | 未取得可靠尺寸 | {mir:.6f} m，造型估算 |

長度比名義尺寸多約 3 mm，包含面板封邊。尺寸檢查容許值：寬 6 mm、高 3 mm、長 5 mm；這只驗證包圍盒，無法證明原廠每一斷面精度。輪距與胎型亦未經量車確認。

GLB：米制、Y up、**+Z 車頭**、**+X 為車輛行進方向的左側**。root 位置為地面中心設計原點 `(0,0,0)`；輪胎最低點 Y≈0。Blender 原檔使用 Z up、-Y 車頭。GLB 原始 bounds 在 `validation.json`，未把 Blender 的 Z-up 誤當成 glTF Y-up。

| 輪組 root | GLB 輪心 X,Y,Z（m） |
|---|---|
| wheel_FL | +0.860, 0.388, +1.770 |
| wheel_FR | -0.860, 0.388, +1.770 |
| wheel_RL | +0.860, 0.388, -1.600 |
| wheel_RR | -0.860, 0.388, -1.600 |

每個 wheel root 下有同名 `_axle`。root 繞 glTF local Y 轉向；axle 繞 local X 自轉。輪胎、輪圈跟 axle，煞車卡鉗跟 root，避免卡鉗一起自轉。播放 `WheelSpin` 可轉動四輪；`FrontSteer` 作用於兩個前輪。兩 clip 均約 2 秒，兩側前輪同方向／等角轉向。

## 材質與幾何

車漆、玻璃、輪胎、密封條、金屬、燈具、內裝分開使用標準 metallic-roughness PBR。車漆與玻璃使用數值 baseColor／roughness／metallic；沒有烘死的高光、陰影或 AO 圖。輪胎使用 1024² 線性 ORM（G roughness、B metallic）和 tangent normal；兩張 PNG 內嵌，normal-map primitives 均包含 NORMAL／UV／TANGENT。

使用的可選擴展：`KHR_materials_clearcoat`、`KHR_materials_transmission`、`KHR_materials_ior`。`extensionsRequired` 為空，無 Draco、KTX2 或外部圖片依賴；未支援擴展的載入器會失去相應的清漆／透射／IOR 表現。

車身與引擎蓋面板為 3 mm 封口薄殼，玻璃為 4 mm。輪拱有開口、翻邊與輪拱襯層。門縫約 5 mm；並非能開啟的車門總成。11 個主要門板／引擎蓋／玻璃／輪胎在 fresh import 後焊接 UV 分裂頂點檢查，boundary 與 nonmanifold edges 均為零。此檢查不等於完整 CAD 拓撲認證。

## 驗證與預覽來源

`validation.json` 記錄原始 glTF 世界 bounds、fresh import 比對、四個輪心與輪胎包圍盒一致、輪胎接地、axle 與 root 同心、90° 自轉維持 pivot／半徑，以及同向前輪轉向。

六張 PNG 都由最終 GLB fresh import 後，以 Cycles CPU 24 samples 渲染；圖中地面、相機與燈光僅存在於驗收場景。PNG metadata 含來源 GLB SHA。影片由同一 GLB 的 `WheelSpin`／`FrontSteer` quaternion keyframes 解碼後，施加於 fresh import 節點，再以 EEVEE 渲染。沒有將 AI 圖片變形冒充模型轉動。

## 來源與準確度限制

官方尺寸來源：https://hima.auto/zunjie/s800/ ，頁面存檔為 `references/official_page.html`；其註腳將尺寸資料來源標為江淮汽車。取用日期 2026-10-30。現行頁高度為 1542 mm，並未確認使用者所指事故車的年式／配置。

`references/front.png`、`rear.png`、`left45.png`、`left90.png` 是先前 **gpt-image-2.5-flare** 的一致性 AI 參考圖，**不是模型渲染或原廠工程圖**。`references/user_vehicle.png` 是使用者提供的車款外觀參考，原四視圖產製紀錄在專案 generated_images/maextro_s800_provenance.json。

''' + '\n'.join('- '+x for x in limitations) + '''

如需更精準的還原，缺少的是同年式／同輪圈版本的實車正交尺寸圖、輪距／輪胎規格、燈具及車尾近照，或經授權的 CAD／掃描資料；增加三角面本身不能補足這些精度。

## 重建

在本資產資料夾執行，需 Python numpy／Pillow 及 Blender 5.2：

```sh
python3 source/make_surface_maps.py
blender -b --python source/build_s800_v2.py
blender -b --python source/verify_s800_v2.py -- --pathtrace
blender -b --python source/verify_s800_v2.py -- --video-only --video
ffmpeg -framerate 24 -i spin_frames/frame_%04d.png -c:v libx264 -crf 18 -pix_fmt yuv420p -movflags +faststart wheel_spin.mp4
python3 source/finalize_delivery.py
```

`failed_candidate/` 為先前未通過的歷史候選，不屬於這份交付。應使用本資料夾最上層檔案與 manifest 的 SHA。
'''
(R/'README.md').write_text(text)
print(json.dumps({'sha256':sha,'bytes':stats['bytes'],'triangles':stats['triangles'],'technical_passed':val['passed'],'visual_fidelity_target_met':False,'video':{'frames':vs['nb_frames'],'duration':probe['format']['duration']}},ensure_ascii=False))
