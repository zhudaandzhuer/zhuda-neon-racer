"""Make a full-color, 60 FPS README preview from the actual captured frames."""
from pathlib import Path
import json
from PIL import Image, features

assert features.check("webp") and features.check("webp_anim"), "Pillow with animated WebP is required"
root = Path(__file__).resolve().parents[1]
work = root / "evidence/harbor-film"
output = root / "docs/media/harbor-preview.webp"
frames = []
for clip, start in [("waterfront", 30), ("bridge", 60), ("dock", 60)]:
    for index in range(start, start + 120):
        with Image.open(work / clip / f"{index:04d}.png") as source:
            frames.append(source.convert("RGB").resize((960, 540), Image.Resampling.LANCZOS))

# WebP stores integer milliseconds: this cadence totals exactly 6 s for 360 frames.
durations = [17, 16, 17] * 120
output.parent.mkdir(parents=True, exist_ok=True)
size = (960, 540)
for width, quality in [(960, 80), (800, 82), (800, 74)]:
    target = (width, width * 9 // 16)
    if target != size:
        frames = [frame.resize(target, Image.Resampling.LANCZOS) for frame in frames]
        size = target
    frames[0].save(output, save_all=True, append_images=frames[1:], duration=durations,
                   loop=0, quality=quality, method=4, allow_mixed=True)
    if output.stat().st_size <= 9_500_000:
        break
assert output.stat().st_size <= 9_500_000, "Preview must fit GitHub's image proxy budget"
with Image.open(output) as check:
    assert check.size == size and check.n_frames == 360
    duration = 0
    for index in range(check.n_frames):
        check.seek(index)
        check.load()
        duration += check.info["duration"]
    assert duration == 6000, duration
print(json.dumps({"file": str(output), "width": size[0], "height": size[1], "quality": quality,
                  "frames": 360, "durationMs": 6000, "fps": 60,
                  "bytes": output.stat().st_size}))
