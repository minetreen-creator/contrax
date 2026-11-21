#!/usr/bin/env python3
"""Wide state job image for Facebook (1200x630).
One JSON argument: {out, tag, big, sub, rows:[[place, "job · due date"] x4], lines:[2], link}
Rows give the JOB and the CITY OR COUNTY only, never the buyer's name."""
import json, sys
from PIL import Image, ImageDraw, ImageFont

F = "/usr/share/fonts/opentype/inter/Inter-%s.otf"
NAVY, PANEL, LINE = (15, 31, 56), (23, 43, 74), (44, 66, 102)
ORANGE, WHITE, MUTED = (245, 158, 11), (255, 255, 255), (168, 184, 210)
W, H, PAD = 1200, 630, 64

def font(weight, size):
    return ImageFont.truetype(F % weight, size)

def fit(d, text, weight, size, maxw, floor=16):
    while size > floor and d.textlength(text, font=font(weight, size)) > maxw:
        size -= 1
    return size

def main():
    a = json.loads(sys.argv[1])
    im = Image.new("RGB", (W, H), NAVY)
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, W, 10], fill=ORANGE)
    y = 44
    d.text((PAD, y), a["tag"].upper(), font=font("Bold", 24), fill=ORANGE)
    y += 40
    s = fit(d, a["big"], "ExtraBold", 62, W - 2 * PAD)
    d.text((PAD, y), a["big"], font=font("ExtraBold", s), fill=WHITE)
    y += s + 18
    s = fit(d, a["sub"], "Regular", 28, W - 2 * PAD)
    d.text((PAD, y), a["sub"], font=font("Regular", s), fill=MUTED)
    y += s + 26
    rows = a["rows"]
    # One size for every row so the four read as a set.
    inner = W - 2 * PAD - 48
    gap = 22
    size = 30
    for place, job in rows:
        while size > 18 and d.textlength(place, font=font("Bold", size)) + gap + d.textlength(job, font=font("Medium", size)) > inner:
            size -= 1
    rh = 62
    d.rounded_rectangle([PAD, y, W - PAD, y + rh * len(rows) + 8], radius=18, fill=PANEL)
    ry = y + 4
    for i, (place, job) in enumerate(rows):
        if i:
            d.line([PAD + 24, ry, W - PAD - 24, ry], fill=LINE, width=1)
        ty = ry + (rh - size) // 2 - 4
        d.text((PAD + 24, ty), place, font=font("Bold", size), fill=WHITE)
        x = PAD + 24 + d.textlength(place, font=font("Bold", size)) + gap
        d.text((x, ty), job, font=font("Medium", size), fill=MUTED)
        ry += rh
    y += rh * len(rows) + 8 + 22
    pill_f = font("Bold", 26)
    pw = d.textlength(a["link"], font=pill_f) + 56
    px = W - PAD - pw
    by = H - 44 - 56
    d.rounded_rectangle([px, by, W - PAD, by + 56], radius=28, fill=ORANGE)
    d.text((px + 28, by + 12), a["link"], font=pill_f, fill=NAVY)
    lines = a.get("lines", [])[:2]
    maxw = px - PAD - 28
    ls = 24
    for t in lines:
        ls = min(ls, fit(d, t, "Medium", 24, maxw))
    ly = by + (56 - (ls + 8) * len(lines)) // 2
    for i, t in enumerate(lines):
        d.text((PAD, ly + i * (ls + 8)), t, font=font("SemiBold" if i == 0 else "Regular", ls), fill=WHITE if i == 0 else MUTED)
    im.save(a["out"])
    print("saved", a["out"], "row size", size)

if __name__ == "__main__":
    main()
