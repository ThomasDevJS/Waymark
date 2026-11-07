#!/usr/bin/env node
/**
 * README and listing graphics (issue #109, D230). Renders hand-built HTML with the bundled Inter
 * (assets/fonts/inter, OFL) and Lucide icons (ISC) to PNG in artifacts/readme/art/:
 *   - hero banners (light, dark), four feature posters (light, dark), the GitHub social preview
 *     and the Chrome Web Store tiles;
 *   - screenshot frames: the raw shots from test/shots/readme.spec.ts in a drawn browser window,
 *     the page beside the side panel.
 * `scripts/readme-pack.py` then turns them into small palette PNGs in docs/assets/.
 * Nothing is fetched: fonts, icons and the mark are read from the repository.
 *
 * Usage: node scripts/readme-art.mjs   (part of `pnpm shots:readme`; `--art-only` skips the frames)
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import * as lucide from 'lucide';

const ROOT = resolve(import.meta.dirname, '..');
const RAW = join(ROOT, 'artifacts', 'readme', 'raw');
const OUT = join(ROOT, 'artifacts', 'readme', 'art');
const artOnly = process.argv.includes('--art-only');
mkdirSync(OUT, { recursive: true });

/* Colours: src/ui/tokens.css (D90), light and dark. */
const THEMES = {
  light: { bg: '#f6f7f9', surface: '#ffffff', surface2: '#f1f3f6', fg: '#1a1d23', muted: '#5b6270', border: '#dde1e7', accent: '#2a5bd7', accentText: '#2a5bd7', accentSoft: '#e9eefc', ring: '#3d6cf0', rec: '#d93025', success: '#1e7a3c', successSoft: '#e6f4ea' },
  dark: { bg: '#131519', surface: '#1e2128', surface2: '#262a32', fg: '#e8eaee', muted: '#a3a9b5', border: '#343944', accent: '#7ea2ff', accentText: '#9db8ff', accentSoft: '#243256', ring: '#7ea2ff', rec: '#ff6b5e', success: '#7fd19b', successSoft: '#173323' },
};

const fontUrl = (w) => pathToFileURL(join(ROOT, 'assets', 'fonts', 'inter', `inter-latin-${w}-normal.woff2`)).href;
const FONTS = [400, 500, 600, 700].map((w) => `@font-face{font-family:Inter;font-weight:${w};src:url(${fontUrl(w)}) format('woff2')}`).join('');
const MARK = readFileSync(join(ROOT, 'assets', 'brand', 'mark.svg'), 'utf8').replace(/<\?xml[^>]*>/, '');

/** A Lucide icon as inline SVG. */
function icon(name, size = 24, stroke = 2) {
  const node = lucide[name];
  if (!node) throw new Error(`no Lucide icon ${name}`);
  const inner = node.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`).join('');
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}
const mark = (size) => MARK.replace('<svg ', `<svg width="${size}" height="${size}" `);

const page = (t, w, h, body, css = '') => `<!doctype html><html><head><meta charset="utf-8"><style>${FONTS}
*{box-sizing:border-box}html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden}
body{font-family:Inter,sans-serif;color:${t.fg};background:${t.bg};-webkit-font-smoothing:antialiased;font-feature-settings:'cv11','ss01'}
${css}</style></head><body>${body}</body></html>`;

/* The trail: Waymark's dotted path (from the mark), waypoints and the spotlight ring. */
function trail(t, w, h, pts, active, bends = []) {
  const d = [...pts, ...bends].map((p, i) => (i ? `L${p[0]} ${p[1]}` : `M${p[0]} ${p[1]}`)).join(' ');
  const dots = pts
    .map(([x, y], i) => {
      const on = i === active;
      return `${on ? `<circle cx="${x}" cy="${y}" r="26" fill="none" stroke="${t.ring}" stroke-width="3" opacity=".35"/>` : ''}
      <circle cx="${x}" cy="${y}" r="15" fill="${on ? t.accent : t.surface}" stroke="${on ? t.accent : t.border}" stroke-width="2"/>
      <text x="${x}" y="${y + 5}" text-anchor="middle" font-family="Inter" font-weight="700" font-size="14" fill="${on ? (t === THEMES.dark ? '#0b1020' : '#fff') : t.muted}">${i + 1}</text>`;
    })
    .join('');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="position:absolute;inset:0"><path d="${d}" fill="none" stroke="${t.accent}" stroke-opacity=".55" stroke-width="3" stroke-linecap="round" stroke-dasharray="0.1 10"/>${dots}</svg>`;
}

/* A small drawn app page with the spotlight on one field and the tooltip under it. */
function miniApp(t, x, y, scale = 1) {
  const dark = t === THEMES.dark;
  const line = (w, c = t.border) => `<div style="height:8px;width:${w}px;border-radius:4px;background:${c}"></div>`;
  return `<div style="position:absolute;left:${x}px;top:${y}px;width:420px;transform:scale(${scale});transform-origin:0 0">
  <div style="background:${t.surface};border:1px solid ${t.border};border-radius:14px;overflow:hidden">
    <div style="height:30px;border-bottom:1px solid ${t.border};display:flex;align-items:center;gap:6px;padding:0 12px">
      ${['#c9ced6', '#c9ced6', '#c9ced6'].map((c) => `<i style="width:8px;height:8px;border-radius:50%;background:${dark ? '#3a404b' : c}"></i>`).join('')}
    </div>
    <div style="padding:20px 22px 26px;display:grid;gap:14px;position:relative">
      ${line(120, t.fg)}${line(180)}
      <div style="display:grid;gap:7px;margin-top:6px">${line(70, t.muted)}<div style="height:34px;border:1px solid ${t.border};border-radius:8px"></div></div>
      <div style="display:grid;gap:7px">${line(60, t.muted)}
        <div style="height:34px;border:1px solid ${t.border};border-radius:8px;background:${t.surface};box-shadow:0 0 0 4px ${t.surface},0 0 0 7px ${t.ring}"></div></div>
      <div style="display:grid;gap:7px">${line(80, t.muted)}<div style="height:34px;border:1px solid ${t.border};border-radius:8px"></div></div>
      <div style="display:flex;justify-content:flex-end"><div style="width:110px;height:34px;border-radius:8px;background:${dark ? '#2b6f68' : '#0f766e'}"></div></div>
      <div style="position:absolute;left:60px;top:190px;width:250px;background:${t.surface};border:1px solid ${t.border};border-radius:12px;padding:14px 16px;box-shadow:0 3px 0 ${dark ? 'rgba(0,0,0,.35)' : 'rgba(16,24,40,.06)'}">
        <div style="font-size:12px;font-weight:600;color:${t.muted}">Step 2 of 6</div>
        <div style="height:3px;background:${t.surface2};border-radius:2px;margin:8px 0 10px"><div style="height:3px;width:33%;background:${t.accent};border-radius:2px"></div></div>
        <div style="font-size:15px;font-weight:600">Choose the customer</div>
        <div style="font-size:12px;color:${t.accentText};margin-top:4px">Choose an option to continue.</div>
      </div>
    </div>
  </div></div>`;
}

function hero(t) {
  const W = 1280;
  const H = 400;
  return page(
    t,
    W,
    H,
    `<div style="position:absolute;inset:0;background:${t.bg}"></div>
    <div style="position:absolute;left:72px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center;width:640px">
      <div style="display:flex;align-items:center;gap:22px">${mark(80)}<div style="font-size:72px;font-weight:700;letter-spacing:-.03em">Waymark</div></div>
      <div style="font-size:40px;font-weight:600;line-height:1.22;margin-top:26px;letter-spacing:-.015em">Record a walkthrough once.<br>Replay it on the live page.</div>
    </div>
    ${trail(t, W, H, [[690, 330]], -1, [[750, 280], [730, 210], [846, 199]])}
    ${miniApp(t, 840, 54, 0.74)}`,
  );
}

const POSTERS = [
  { key: 'record', icon: 'CircleDot', title: 'Record', line: 'Do the task once. Every click, choice and field becomes a step. What you type is never stored.' },
  { key: 'play', icon: 'MousePointerClick', title: 'Play', line: 'Learners follow a spotlight on the real page, across pages, tabs, dialogs and frames.' },
  { key: 'share', icon: 'Share2', title: 'Share', line: 'Send a guide file, copy a link that starts it, or subscribe a team to a library URL.' },
  { key: 'private', icon: 'ShieldCheck', title: 'Private', line: 'No backend, no account, no keys. It runs only on the sites you allow, one at a time.' },
];

function posterArt(t, key) {
  const dark = t === THEMES.dark;
  const row = (inner, extra = '') => `<div style="display:flex;align-items:center;gap:14px;height:58px;padding:0 18px;border:1px solid ${t.border};border-radius:12px;background:${t.surface};font-size:21px;${extra}">${inner}</div>`;
  const num = (n, on) => `<span style="width:32px;height:32px;flex:none;border-radius:50%;display:grid;place-items:center;font-size:16px;font-weight:700;border:1px solid ${on ? t.accent : t.border};background:${on ? t.accent : t.surface2};color:${on ? (dark ? '#0b1020' : '#fff') : t.muted}">${n}</span>`;
  if (key === 'record')
    return `<div style="display:grid;gap:8px">
       ${row(`${num(1)}<span>Click <b>New invoice</b></span>`)}${row(`${num(2)}<span>Choose <b>Tansy Bakehouse</b></span>`)}${row(`${num(3, true)}<span>Enter <b>Item</b></span>`, `border-color:${t.ring};box-shadow:0 0 0 3px ${t.accentSoft}`)}</div>`;
  if (key === 'play')
    return `<div style="position:relative;height:222px">
      <div style="position:absolute;left:8px;right:8px;top:10px;height:58px;border:1px solid ${t.border};border-radius:10px;background:${t.surface};box-shadow:0 0 0 5px ${t.surface},0 0 0 9px ${t.ring};display:flex;align-items:center;padding:0 18px;color:${t.muted};font-size:21px">Choose a customer</div>
      <div style="position:absolute;left:36px;top:96px;width:400px;background:${t.surface};border:1px solid ${t.border};border-radius:12px;padding:16px 20px;box-shadow:0 3px 0 ${dark ? 'rgba(0,0,0,.35)' : 'rgba(16,24,40,.06)'}">
        <div style="font-size:16px;font-weight:600;color:${t.muted}">Step 2 of 6</div>
        <div style="height:4px;background:${t.surface2};border-radius:2px;margin:9px 0 12px"><div style="height:4px;width:33%;background:${t.accent};border-radius:2px"></div></div>
        <div style="font-size:22px;font-weight:600">Choose the customer</div></div></div>`;
  if (key === 'share')
    return `<div style="display:grid;gap:8px">${row(`<span style="color:${t.accentText}">${icon('FileJson', 24)}</span>Guide file`)}${row(`<span style="color:${t.accentText}">${icon('Link', 24)}</span>Link that starts it`)}${row(`<span style="color:${t.accentText}">${icon('Library', 24)}</span>Team library`)}</div>`;
  return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">${['No server', 'No account', 'No keys', 'No telemetry', 'Sites you allow', '$0 to run']
    .map((s) => row(`<span style="color:${t.success}">${icon('Check', 24, 2.5)}</span>${s}`))
    .join('')}</div>`;
}

function poster(t, p) {
  return page(
    t,
    640,
    400,
    `<div style="position:absolute;inset:0;background:${t.surface};border:1px solid ${t.border};border-radius:20px;padding:34px 36px;display:grid;grid-template-rows:auto 1fr;gap:0">
      <div style="display:flex;align-items:center;gap:14px">
        <span style="width:60px;height:60px;border-radius:15px;background:${t.accentSoft};color:${t.accentText};display:grid;place-items:center">${icon(p.icon, 32)}</span>
        <span style="font-size:48px;font-weight:700;letter-spacing:-.025em">${p.title}</span></div>
      <div style="align-self:center">${posterArt(t, p.key)}</div></div>`,
    'body{background:transparent}',
  );
}

function social(t, W, H, { markSize, name, pitch, sub, appX, appY, appScale, padX }) {
  return page(
    t,
    W,
    H,
    `<div style="position:absolute;left:${padX}px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center;width:${W * 0.52}px">
      <div style="display:flex;align-items:center;gap:${markSize / 3.5}px">${mark(markSize)}<div style="font-size:${name}px;font-weight:700;letter-spacing:-.025em">Waymark</div></div>
      ${pitch ? `<div style="font-size:${pitch}px;font-weight:600;line-height:1.3;margin-top:${pitch * 0.8}px;letter-spacing:-.01em">Record a walkthrough once.<br>Replay it on the live page.</div>` : ''}
      ${sub ? `<div style="font-size:${sub}px;color:${t.muted};margin-top:${sub * 0.8}px">No server, no account, no keys.</div>` : ''}
    </div>
    ${appScale ? miniApp(t, appX, appY, appScale) : ''}`,
  );
}

/* A drawn browser window around the raw shots: page, and the side panel when given. */
function frame(name, { page: pg, panel, url, crop, square }) {
  const PW = 1040;
  // The page's CSS height: the raw shot is at device scale 2 (PNG height at byte 20).
  const PH = crop ?? readFileSync(join(RAW, `${pg}.png`)).readUInt32BE(20) / 2;
  const SW = panel ? 400 : 0;
  const W = PW + SW + 2;
  const BAR = 44;
  const H = PH + BAR + 2;
  const img = (f, w, h) => `<div style="width:${w}px;height:${h}px;overflow:hidden"><img src="${pathToFileURL(join(RAW, `${f}.png`)).href}" style="width:${w}px;display:block"></div>`;
  return {
    name,
    w: W,
    h: H,
    html: page(
      THEMES.light,
      W,
      H,
      `<div style="width:${W}px;height:${H}px;border:1px solid #c9ced6;border-radius:${square ? 0 : 12}px;overflow:hidden;background:#fff">
        <div style="height:${BAR}px;background:#eef0f3;border-bottom:1px solid #dde1e7;display:flex;align-items:center;gap:8px;padding:0 16px">
          ${['#c4c9d1', '#c4c9d1', '#c4c9d1'].map((c) => `<i style="width:11px;height:11px;border-radius:50%;background:${c}"></i>`).join('')}
          <div style="margin-left:18px;flex:0 1 560px;height:28px;border-radius:14px;background:#fff;border:1px solid #dde1e7;display:flex;align-items:center;padding:0 14px;font-size:13px;color:#5b6270">${url}</div>
        </div>
        <div style="display:flex">${img(pg, PW, PH)}${panel ? `<div style="border-left:1px solid #dde1e7">${img(panel, SW - 1, PH)}</div>` : ''}</div>
      </div>`,
      'body{background:transparent}',
    ),
  };
}

const executablePath = process.env.WAYMARK_CHROMIUM ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch(executablePath ? { executablePath } : {});
async function render(name, html, w, h, scale = 2) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
  const p = await ctx.newPage();
  // From a file, so the page may load the fonts and the raw shots (file URLs).
  const src = join(OUT, `.${name}.html`);
  writeFileSync(src, html);
  await p.goto(pathToFileURL(src).href, { waitUntil: 'load' });
  rmSync(src);
  await p.evaluate(() => document.fonts.ready);
  const ok = await p.evaluate(() => document.fonts.check('600 16px Inter'));
  if (!ok) throw new Error('Inter did not load');
  await p.screenshot({ path: join(OUT, `${name}.png`), omitBackground: true });
  await ctx.close();
  console.log(`${name}.png`);
}

for (const [scheme, t] of Object.entries(THEMES)) {
  await render(`hero-${scheme}`, hero(t), 1280, 360);
  for (const p of POSTERS) await render(`poster-${p.key}-${scheme}`, poster(t, p), 640, 400);
}
const L = THEMES.light;
await render('social-preview', social(L, 1280, 640, { markSize: 84, name: 70, pitch: 34, sub: 22, appX: 760, appY: 120, appScale: 1, padX: 88 }), 1280, 640, 1);
await render('store-small-440x280', social(L, 440, 280, { markSize: 44, name: 34, pitch: 0, sub: 0, appX: 0, appY: 0, appScale: 0, padX: 112 }), 440, 280, 1);
await render('store-marquee-1400x560', social(L, 1400, 560, { markSize: 80, name: 66, pitch: 32, sub: 21, appX: 830, appY: 80, appScale: 1, padX: 100 }), 1400, 560, 1);

if (!artOnly) {
  if (!existsSync(join(RAW, 'done.txt'))) throw new Error('No raw shots: run the shots spec first (pnpm shots:readme)');
  const base = '127.0.0.1:4173/showcase';
  const frames = [
    frame('shot-record', { page: 'record-page', panel: 'record-panel', url: `${base}/new-invoice.html` }),
    frame('shot-play', { page: 'play-page', panel: 'play-panel', url: `${base}/new-invoice.html` }),
    frame('shot-editor', { page: 'editor-page', panel: 'editor-panel', url: `${base}/new-invoice.html` }),
    frame('shot-launcher', { page: 'launcher-page', url: `${base}/index.html` }),
    frame('shot-howto', { page: 'howto-page', url: 'Printable how-to (preview)' }),
    ...[1, 2, 3].map((i) => frame(`clip-${i}`, { square: true, page: `clip-${i}`, url: `${base}/new-invoice.html` })),
  ];
  // About 1.4 px per CSS px: sharp at GitHub's ~900 px column on a 2× screen, and small.
  for (const f of frames) await render(f.name, f.html, f.w, f.h, f.name.startsWith('clip') ? 0.85 : 1.4);
}
await browser.close();
