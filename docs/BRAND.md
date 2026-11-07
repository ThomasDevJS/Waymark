# Waymark brand note

One page for anyone making graphics for Waymark: the logo, colours, type, and how to re-shoot the README pictures (D230–D233).

## Logo

- The mark is `assets/brand/mark.svg` (a flag on a pole, with the dotted trail it marks). `assets/brand/mark-16.svg` is the drawing for 16 and 32 px.
- Use it as it is: blue tile, white flag. Don't recolour, outline, rotate or stretch it, and don't add effects.
- Leave space around it of at least a quarter of its width. Smallest size: 16 px (with `mark-16.svg`).
- The wordmark is "Waymark" in Inter Bold, tracking −2.5 %, next to the mark at about 0.85 × its height.
- `node scripts/icons.mjs` renders the extension icons from the SVGs.

## Colours

From `src/ui/tokens.css` (D90). The graphics use the same values, light and dark.

| Role | Light | Dark |
| --- | --- | --- |
| Background | `#f6f7f9` | `#131519` |
| Surface | `#ffffff` | `#1e2128` |
| Text | `#1a1d23` | `#e8eaee` |
| Muted text | `#5b6270` | `#a3a9b5` |
| Border | `#dde1e7` | `#343944` |
| Accent | `#2a5bd7` | `#7ea2ff` |
| Accent, soft | `#e9eefc` | `#243256` |
| Spotlight ring | `#3d6cf0` | `#7ea2ff` |
| Recording | `#d93025` | `#ff6b5e` |

Flat colours only. The one gradient is the mark's tile. No photos, no stock images, no generated imagery.

## Type and icons

- **Inter** (SIL Open Font License 1.1), bundled in `assets/fonts/inter/` with its licence. Weights 400, 500, 600 and 700. Headings 600–700 with slightly tight tracking; body 400.
- **Lucide** icons (ISC), from the `lucide` package the extension already uses. Stroke 2, round caps.
- The recurring motif is the mark's dotted trail: a dotted line from a numbered waypoint to a spotlit element.

## The graphics

All in `docs/assets/`, each under 300 KB (`test/unit/readme-assets.test.ts` checks the sizes and that the README's links are relative and exist).

| File | What |
| --- | --- |
| `hero-light.png`, `hero-dark.png` | README banner, 1280 × 400 at 2× |
| `poster-{record,play,share,private}-{light,dark}.png` | Feature cards, 640 × 400 at 2×: a title and a picture; the README's bullets carry the words |
| `shot-record.png`, `shot-play.png`, `shot-editor.png`, `shot-launcher.png`, `shot-howto.png` | Screenshots in a drawn browser window |
| `clip-play.gif` | A guide playing, three steps on the form, 0.85× |
| `social-preview.png` | GitHub social preview, 1280 × 640 (upload it in the repository's Settings → General → Social preview) |
| `store/store-small-440x280.png`, `store/store-marquee-1400x560.png` | Chrome Web Store tiles, for a later listing (D58) |

## Re-shooting

```sh
pnpm shots:readme
```

1. `test/shots/readme.spec.ts` builds the test extension, then records, edits and plays a guide on the made-up "Demo Books" pages (`test/fixtures/site/showcase/`) in Chromium at device scale 2 under Xvfb. Raw PNGs go to `artifacts/readme/raw/` (git-ignored).
2. `scripts/readme-art.mjs` renders the hero, posters, social preview and store tiles from HTML, and frames the raw shots, into `artifacts/readme/art/`. `--art-only` skips the frames.
3. `scripts/readme-pack.py` writes 256-colour PNGs and the GIF to `docs/assets/` and fails if a file is over 300 KB. Needs Pillow (`pip install pillow`).

Needs: Node 22, pnpm, Python 3 with Pillow, `xvfb-run`, and Chromium at `/opt/pw-browsers/chromium` (or `WAYMARK_CHROMIUM`). The extension's own pages use the system UI font; shots taken where that is not Inter look slightly different. Nothing is fetched while rendering.

Rules: only the fixture app with made-up data. No real sites, customers, people or logos.
