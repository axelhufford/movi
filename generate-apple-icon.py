#!/usr/bin/env python3
"""Generate apple-touch-icon.png (180x180) matching the favicon design:
a red rounded square with a three-frame film strip (middle frame highlighted)."""
from PIL import Image, ImageDraw
import os

SIZE = 180
BG = (255, 77, 77)      # --accent
WHITE = (255, 255, 255)
RADIUS = 38              # iOS masks with its own rounded corners, but filling
                         # fully also looks good on older devices / Android.

img = Image.new('RGB', (SIZE, SIZE), BG)

# Draw on an RGBA overlay so we can use alpha for the soft outer frames.
overlay = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(overlay)

# Film strip: three frames centered horizontally, slight vertical offsets
# mirroring the inline SVG favicon in index.html.
# Favicon viewBox is 48x48 with a translate(8,14) group; middle frame is
# 10x12 at (11.5,-1), side frames are 9x11 at (0,0) and (23,0).
# Scale those coordinates to 180x180.
scale = SIZE / 48.0
tx, ty = 8 * scale, 14 * scale

def frame(x, y, w, h, color, width, radius):
    x1 = tx + x * scale
    y1 = ty + y * scale
    x2 = x1 + w * scale
    y2 = y1 + h * scale
    draw.rounded_rectangle([x1, y1, x2, y2], radius=radius,
                           outline=color, width=width)

# Left frame (faded)
frame(0, 0, 9, 11, (255, 255, 255, 102), 6, 4)
# Middle frame (solid white)
frame(11.5, -1, 10, 12, (255, 255, 255, 255), 6, 4)
# Right frame (faded)
frame(23, 0, 9, 11, (255, 255, 255, 102), 6, 4)

img = Image.alpha_composite(img.convert('RGBA'), overlay).convert('RGB')

out = os.path.join(os.path.dirname(__file__), "apple-touch-icon.png")
img.save(out, "PNG")
print(f"Saved {out} ({os.path.getsize(out)} bytes)")
