"""Lay PNG frames side by side on a paper backdrop, with no extra installs
(Blender's Python has numpy). For flower reviews and PR contact sheets.

    blender --background --python scripts/contact-sheet.py -- out.png a.png b.png …
"""

import sys

import bpy
import numpy as np

argv = sys.argv[sys.argv.index("--") + 1 :]
out, paths = argv[0], argv[1:]
PAPER = np.array([0.957, 0.937, 0.902])
frames = []
for p in paths:
    img = bpy.data.images.load(p)
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)
    rgb = px[:, :, :3] * px[:, :, 3:] + PAPER * (1 - px[:, :, 3:])
    frames.append(rgb)
H = max(f.shape[0] for f in frames)
gap = 8
W = sum(f.shape[1] for f in frames) + gap * (len(frames) + 1)
sheet = np.ones((H + 2 * gap, W, 3)) * PAPER
x = gap
for f in frames:
    # Frames are bottom-up in Blender; aligning bottoms keeps pots level.
    sheet[gap : gap + f.shape[0], x : x + f.shape[1]] = f
    x += f.shape[1] + gap
o = bpy.data.images.new("sheet", W, H + 2 * gap, alpha=False)
o.pixels.foreach_set(np.concatenate([sheet, np.ones(sheet.shape[:2] + (1,))], axis=2).astype(np.float32).ravel())
o.filepath_raw = out
o.file_format = "PNG"
o.save()
print("sheet", out, W, H)
