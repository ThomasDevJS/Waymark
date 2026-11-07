#!/usr/bin/env python3
"""Turns the rendered README graphics (artifacts/readme/art/) into the committed files in
docs/assets/ (D230): 256-colour PNGs, and the playing clip as a GIF. Every file must stay under
300 KB; test/unit/readme-assets.test.ts checks the committed ones.

Needs Pillow (pip install pillow). Part of `pnpm shots:readme`; `--art-only` skips the
screenshots and the clip.
"""
import sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / 'artifacts' / 'readme' / 'art'
OUT = ROOT / 'docs' / 'assets'
LIMIT = 300_000
art_only = '--art-only' in sys.argv

STORE = ['social-preview', 'store-small-440x280', 'store-marquee-1400x560']
ART_NAMES = [f'hero-{s}' for s in ('light', 'dark')] + [f'poster-{k}-{s}' for k in ('record', 'play', 'share', 'private') for s in ('light', 'dark')]
SHOTS = ['shot-record', 'shot-play', 'shot-editor', 'shot-launcher', 'shot-howto']


def pack(name: str, dest: Path, dither: bool = False) -> None:
    im = Image.open(ART / f'{name}.png').convert('RGBA')
    if dither:
        # Screenshots: 255 dithered colours (Pillow only dithers RGB), so shadows and the spotlight's
        # shade don't band; index 255 is the transparent outside of the window's rounded corners.
        q = im.convert('RGB').quantize(255, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG)
        pal = q.getpalette()[: 255 * 3]
        q.putpalette(pal + [0] * (768 - len(pal)))
        q.paste(255, mask=im.getchannel('A').point(lambda v: 255 if v < 128 else 0))
        q.info['transparency'] = 255
    else:
        # Drawn art: flat colours, no dithering; fast octree keeps the alpha of the rounded corners.
        q = im.quantize(256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
    dest.parent.mkdir(parents=True, exist_ok=True)
    q.save(dest, optimize=True, **({'transparency': 255} if dither else {}))
    report(dest)


def report(path: Path) -> None:
    size = path.stat().st_size
    flag = '' if size <= LIMIT else '  OVER 300 KB'
    print(f'{path.relative_to(ROOT)}  {size // 1024} KB{flag}')
    if size > LIMIT:
        sys.exit(1)


for n in ART_NAMES:
    pack(n, OUT / f'{n}.png')
for n in STORE:
    pack(n, OUT / ('' if n == 'social-preview' else 'store') / f'{n}.png')
if not art_only:
    for n in SHOTS:
        pack(n, OUT / f'{n}.png', dither=True)
    # The clip: four steps of a guide playing, each held long enough to read.
    frames = [Image.open(ART / f'clip-{i}.png').convert('RGB') for i in range(4)]
    strip = Image.new('RGB', (frames[0].width, frames[0].height * len(frames)))
    for i, f in enumerate(frames):
        strip.paste(f, (0, i * f.height))
    pal = strip.quantize(255, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    out = [f.quantize(palette=pal, dither=Image.Dither.FLOYDSTEINBERG) for f in frames]
    gif = OUT / 'clip-play.gif'
    out[0].save(gif, save_all=True, append_images=out[1:], duration=[1800, 2200, 2200, 2600], loop=0, optimize=True, disposal=1)
    report(gif)
