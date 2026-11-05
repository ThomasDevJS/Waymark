#!/usr/bin/env python3
"""Copies chosen screenshots from artifacts/screens/<set>/ into docs/screenshots/<dest>/ as
256-colour PNGs (small enough to commit), each light/dark pair side by side (D90).

Needs Pillow (pip install pillow).

Usage: python3 scripts/shots.py <set> <dest> <name> [<name> ...]
       e.g. python3 scripts/shots.py before pr-a/before panel-05-library page-02-tooltip
"""
import sys
from pathlib import Path
from PIL import Image

src, dest, *names = sys.argv[1:]
root = Path(__file__).resolve().parent.parent
out = root / 'docs' / 'screenshots' / dest
out.mkdir(parents=True, exist_ok=True)
for name in names:
    ims = [Image.open(root / 'artifacts' / 'screens' / src / f'{name}-{s}.png').convert('RGB') for s in ('light', 'dark')]
    h = max(i.height for i in ims)
    sheet = Image.new('RGB', (sum(i.width for i in ims) + 8, h), '#808080')
    sheet.paste(ims[0], (0, 0))
    sheet.paste(ims[1], (ims[0].width + 8, 0))
    if sheet.width > 1600:
        sheet = sheet.resize((1600, round(h * 1600 / sheet.width)), Image.LANCZOS)
    sheet.quantize(256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(out / f'{name}.png', optimize=True)
    print(out / f'{name}.png')
