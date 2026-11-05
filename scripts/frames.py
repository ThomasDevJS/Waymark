#!/usr/bin/env python3
"""Turns motion frame sequences from `pnpm screens` (artifacts/screens/<set>/motion-<name>-<ms>.png)
into a labelled strip (PNG) and a looping GIF in docs/screenshots/<dest>/ (D130).

Needs Pillow (pip install pillow).

Usage: python3 scripts/frames.py <set> <dest> <name> [<name> ...]
       e.g. python3 scripts/frames.py current motion-1 fold toast
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw

src, dest, *names = sys.argv[1:]
root = Path(__file__).resolve().parent.parent
out = root / 'docs' / 'screenshots' / dest
out.mkdir(parents=True, exist_ok=True)
for name in names:
    paths = sorted((root / 'artifacts' / 'screens' / src).glob(f'motion-{name}-*.png'))
    if not paths:
        sys.exit(f'no frames for {name}')
    ims = [Image.open(p).convert('RGB') for p in paths]
    labels = [f"{int(p.stem.rsplit('-', 1)[1])} ms" for p in paths]
    w, h = max(i.width for i in ims), max(i.height for i in ims)
    # Strip: frames side by side, each labelled with its time.
    strip = Image.new('RGB', (len(ims) * (w + 8) - 8, h + 22), '#ffffff')
    draw = ImageDraw.Draw(strip)
    for n, (im, label) in enumerate(zip(ims, labels)):
        x = n * (w + 8)
        strip.paste(im, (x, 22))
        draw.text((x + 4, 4), label, fill='#5b6270')
    if strip.width > 1600:
        strip = strip.resize((1600, round(strip.height * 1600 / strip.width)), Image.LANCZOS)
    strip.quantize(256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(out / f'{name}-frames.png', optimize=True)
    # GIF: the frames at their real spacing, then a pause on the last one.
    times = [int(p.stem.rsplit('-', 1)[1]) for p in paths]
    durations = [max(20, b - a) for a, b in zip(times, times[1:])] + [900]
    pal = [im.quantize(128, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE) for im in ims]
    pal[0].save(out / f'{name}.gif', save_all=True, append_images=pal[1:], duration=durations, loop=0, optimize=True)
    print(out / f'{name}-frames.png', out / f'{name}.gif')
