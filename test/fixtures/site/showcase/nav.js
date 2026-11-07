// Sidebar for the showcase pages: a made-up app for the README screenshots (D231). Built with DOM
// APIs (no HTML strings). Icon nodes are copied from Lucide 1.59.0 (ISC).
const ICONS = {
  home: [['path', { d: 'M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8' }], ['path', { d: 'M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' }]],
  file: [['path', { d: 'M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z' }], ['path', { d: 'M14 2v5a1 1 0 0 0 1 1h5' }], ['path', { d: 'M10 9H8' }], ['path', { d: 'M16 13H8' }], ['path', { d: 'M16 17H8' }]],
  users: [['path', { d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' }], ['path', { d: 'M16 3.128a4 4 0 0 1 0 7.744' }], ['path', { d: 'M22 21v-2a4 4 0 0 0-3-3.87' }], ['circle', { cx: '9', cy: '7', r: '4' }]],
  chart: [['path', { d: 'M3 3v16a2 2 0 0 0 2 2h16' }], ['path', { d: 'm19 9-5 5-4-4-3 3' }]],
  settings: [['path', { d: 'M10 5H3' }], ['path', { d: 'M12 19H3' }], ['path', { d: 'M14 3v4' }], ['path', { d: 'M16 17v4' }], ['path', { d: 'M21 12h-9' }], ['path', { d: 'M21 19h-5' }], ['path', { d: 'M21 5h-7' }], ['path', { d: 'M8 10v4' }], ['path', { d: 'M8 12H3' }]],
  plus: [['path', { d: 'M5 12h14' }], ['path', { d: 'M12 5v14' }]],
};
const NS = 'http://www.w3.org/2000/svg';

/** @param {keyof typeof ICONS} name */
function icon(name) {
  const svg = document.createElementNS(NS, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
  for (const [tag, attrs] of ICONS[name]) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.append(el);
  }
  return svg;
}

/** @param {string} tag @param {string} [cls] @param {string} [text] */
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

const here = location.pathname.split('/').pop() || 'index.html';
const current = here === 'new-invoice.html' ? 'invoices.html' : here;
/** @type {[string, keyof typeof ICONS, string][]} */
const LINKS = [
  ['index.html', 'home', 'Dashboard'],
  ['invoices.html', 'file', 'Invoices'],
  ['customers.html', 'users', 'Customers'],
  ['reports.html', 'chart', 'Reports'],
  ['settings.html', 'settings', 'Settings'],
];
const aside = document.querySelector('aside');
if (aside) {
  const brand = el('div', 'brand');
  brand.append(el('i', '', 'D'), 'Demo Books');
  const nav = el('nav');
  nav.setAttribute('aria-label', 'Main');
  for (const [href, name, label] of LINKS) {
    const a = el('a');
    a.href = href;
    if (href === current) a.setAttribute('aria-current', 'page');
    a.append(icon(name), label);
    nav.append(a);
  }
  const ws = el('div', 'workspace', 'Workspace');
  ws.append(el('br'), el('b', '', 'Example Co.'));
  aside.append(brand, nav, ws);
}
for (const b of document.querySelectorAll('[data-icon]')) {
  const name = /** @type {keyof typeof ICONS} */ (b.getAttribute('data-icon'));
  if (name in ICONS) b.prepend(icon(name));
}
