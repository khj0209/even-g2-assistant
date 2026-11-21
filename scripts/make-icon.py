#!/usr/bin/env python3
"""Draws store/icon.png: a Maltese face on a 12x12 grid scaled 2x, #F4F4F4 on transparent (Even Hub icon rules)."""
from pathlib import Path
from PIL import Image

ART = [
    "...x....x...",
    "....xxxx....",
    "...x.xx.x...",
    "x.xxxxxxxx.x",
    "x.xx.xx.xx.x",
    "x.xxxxxxxx.x",
    "x.xxx..xxx.x",
    "x.xxxxxxxx.x",
    "xx.xxxxxx.xx",
    "xx..xxxx..xx",
    ".x........x.",
    "............",
]

img = Image.new("RGBA", (24, 24), (0, 0, 0, 0))
for y, row in enumerate(ART):
    assert len(row) == 12
    for x, c in enumerate(row):
        if c == "x":
            for dy in (0, 1):
                for dx in (0, 1):
                    img.putpixel((x * 2 + dx, y * 2 + dy), (0xF4, 0xF4, 0xF4, 255))
out = Path(__file__).resolve().parent.parent / "store" / "icon.png"
img.save(out)
print(f"wrote {out}")
