#!/usr/bin/env python3
"""Generate OG image as PNG by creating it with pure Python (Pillow)"""
from PIL import Image, ImageDraw, ImageFont
import os

W, H = 1200, 630
bg = (10, 10, 12)

img = Image.new('RGB', (W, H), bg)
draw = ImageDraw.Draw(img)

# Try to load Outfit font, fall back to system font
font_paths = [
    "/System/Library/Fonts/Helvetica.ttc",
    "/System/Library/Fonts/SFNSDisplay.ttf",
    "/Library/Fonts/Arial.ttf",
]
def get_font(size, bold=False):
    for fp in font_paths:
        try:
            return ImageFont.truetype(fp, size)
        except:
            continue
    return ImageFont.load_default()

font_big = get_font(56)
font_med = get_font(20)
font_sm = get_font(16)

# Draw film strip frames
cx, cy = W // 2, 200
fw, fh = 50, 60  # frame width/height
gap = 4

# Frame positions
frames = [
    (cx - fw - gap - fw//2, cy, False, "3"),
    (cx - fw//2, cy - 6, True, "1"),
    (cx + gap + fw//2, cy, False, "2"),
]

for (fx, fy, active, num) in frames:
    x1 = fx - fw//2
    y1 = fy - fh//2
    x2 = fx + fw//2
    y2 = fy + fh//2

    if active:
        # Active frame - red border, slight glow
        # Glow
        for r in range(20, 0, -1):
            alpha = int(8 * (20 - r) / 20)
            glow_color = (255, 77, 77)
            draw.rounded_rectangle([x1-r, y1-r, x2+r, y2+r], radius=4,
                                   outline=(*glow_color, alpha) if alpha > 0 else glow_color)

        draw.rounded_rectangle([x1, y1, x2, y2], radius=3,
                               fill=(255, 77, 77, 18), outline=(255, 77, 77), width=2)
        # Number
        bbox = draw.textbbox((0, 0), num, font=font_med)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        draw.text((fx - tw//2, fy - th//2 - 2), num, fill=(255, 77, 77), font=font_med)
        # Sprockets
        sw, sh = 12, 3
        draw.rounded_rectangle([fx-sw//2, y1+3, fx+sw//2, y1+3+sh], radius=1, fill=(255, 77, 77, 72))
        draw.rounded_rectangle([fx-sw//2, y2-3-sh, fx+sw//2, y2-3], radius=1, fill=(255, 77, 77, 72))
    else:
        draw.rounded_rectangle([x1, y1, x2, y2], radius=3,
                               fill=(255, 255, 255, 6), outline=(255, 255, 255, 33), width=2)
        bbox = draw.textbbox((0, 0), num, font=font_med)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        draw.text((fx - tw//2, fy - th//2 - 2), num, fill=(255, 255, 255, 40), font=font_med)
        sw, sh = 12, 3
        draw.rounded_rectangle([fx-sw//2, y1+3, fx+sw//2, y1+3+sh], radius=1, fill=(255, 255, 255, 20))
        draw.rounded_rectangle([fx-sw//2, y2-3-sh, fx+sw//2, y2-3], radius=1, fill=(255, 255, 255, 20))

# MOVI wordmark
text = "M O V I"
bbox = draw.textbbox((0, 0), text, font=font_big)
tw = bbox[2] - bbox[0]
draw.text((cx - tw//2, 270), text, fill=(255, 255, 255), font=font_big)

# Tagline
tagline = "Every movie ranked, one matchup at a time."
bbox = draw.textbbox((0, 0), tagline, font=font_med)
tw = bbox[2] - bbox[0]
draw.text((cx - tw//2, 350), tagline, fill=(110, 110, 122), font=font_med)

# URL
url = "AXELHUFFORD.COM"
bbox = draw.textbbox((0, 0), url, font=font_sm)
tw = bbox[2] - bbox[0]
draw.text((cx - tw//2, 530), url, fill=(110, 110, 122), font=font_sm)

out = os.path.join(os.path.dirname(__file__), "og-image.png")
img.save(out, "PNG")
print(f"Saved {out} ({os.path.getsize(out)} bytes)")
