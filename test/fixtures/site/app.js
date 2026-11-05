// @ts-check
/**
 * Waymark fixture app: a small page that reproduces what breaks guides (SPEC: Tech stack,
 * "Fixture test app"). Plain ES module so both the static fixture site and Vitest browser
 * tests can import it.
 *
 * Every element a test may target carries `data-fx="<key>"`. Tests collect those elements
 * and then strip the attribute before fingerprinting, so it is never a matching signal.
 *
 * mountApp(root, options) renders one version of the app:
 *   seed        class-hash seed (re-hashed classes when it changes)
 *   layoutSeed  RNG seed for reorder / wrap
 *   reorder     shuffle sibling order (nav, toolbar, fields, cards, rows, tabs)
 *   wrap        insert extra wrapper elements around some elements
 *   changeText  change visible button / link / option text
 *   twin        insert an identical copy before the given keys (ambiguity tests); for the
 *               shadow widget host (`widget#host`), a second widget with the same content
 *   unlabel     drop aria-labels from the given landmark ids
 *   remove      remove the elements with the given keys
 *   portalOpen  render the custom dropdown's options (portal) open
 */

export const FX_ATTR = 'data-fx';

/** @param {number} a */
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** @param {string} s @param {number} seed */
function hashStr(s, seed) {
  let h = 2166136261 ^ seed;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/**
 * Realistic generated class names (emotion, styled-components, CSS modules).
 * @param {string} name @param {number} seed
 */
export function hashedClass(name, seed) {
  const h = hashStr(name, seed);
  const kind = name.length % 3;
  if (kind === 0) return `css-${h.slice(0, 6)}`;
  if (kind === 1) return `sc-${h.slice(0, 6)}`;
  return `${name.replace(/[^a-z]/gi, '') || 'x'}_root__${h.slice(0, 5)}`;
}

/**
 * @typedef {{
 *   seed?: number, layoutSeed?: number, reorder?: boolean, wrap?: boolean, changeText?: boolean,
 *   twin?: string[], unlabel?: string[], remove?: string[], portalOpen?: boolean
 * }} AppOptions
 */

/** @param {AppOptions} [options] @param {Document} [doc] */
export function createApp(options = {}, doc = document) {
  const o = { seed: 1, layoutSeed: 1, reorder: false, wrap: false, changeText: false, twin: [], unlabel: [], remove: [], portalOpen: true, ...options };
  const rnd = mulberry32(o.layoutSeed * 7919 + 13);
  const T = (/** @type {string} */ t) => (o.changeText ? changed(t) : t);

  /**
   * @param {string} tag
   * @param {Record<string, any>} [attrs]
   * @param {(Node|string|null|undefined|false)[]} [children]
   */
  function h(tag, attrs = {}, children = []) {
    const el = doc.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'cls') {
        // hashed class (re-hashed per seed) + optional stable classes
        const [name, ...stable] = String(v).split(' ');
        el.className = [hashedClass(name ?? 'x', o.seed), ...stable].join(' ');
      } else if (k === 'text') el.textContent = String(v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
    return el;
  }

  /** @param {HTMLElement[]} items */
  const order = (items) => {
    if (!o.reorder) return items;
    const a = items.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [a[i], a[j]] = [/** @type {HTMLElement} */ (a[j]), /** @type {HTMLElement} */ (a[i])];
    }
    // guarantee a visible change when shuffling yields the same order
    if (a.length > 1 && a.every((x, i) => x === items[i])) a.push(/** @type {HTMLElement} */ (a.shift()));
    return a;
  };

  /** @param {HTMLElement} el */
  const maybeWrap = (el) => {
    if (!o.wrap || rnd() < 0.5) return el;
    return h('div', { cls: 'wrapper' }, [el]);
  };

  const label = (/** @type {string} */ id, /** @type {string} */ text) => (o.unlabel.includes(id) ? undefined : text);

  // ---------- header ----------
  const navLinks = [
    h('a', { href: '/app/dashboard', cls: 'navlink nav-link', 'data-fx': 'nav-dashboard', text: T('Dashboard') }),
    h('a', { href: '/app/orders', cls: 'navlink nav-link', 'data-fx': 'nav-orders', text: T('Orders') }),
    h('a', { href: '/app/customers/42', cls: 'navlink nav-link', 'data-fx': 'nav-customers', text: T('Customers') }),
    h('a', { href: '/app/settings', cls: 'navlink nav-link', 'data-fx': 'nav-settings', text: T('Settings') }),
  ].map(maybeWrap);
  const header = h('header', { cls: 'header topbar' }, [
    h('a', { href: '/', cls: 'logo', 'data-fx': 'nav-home', 'aria-label': 'Home' }, [h('span', { cls: 'logoicon', 'aria-hidden': 'true', text: '◆' })]),
    h('nav', { 'aria-label': label('main-nav', 'Main'), cls: 'mainnav' }, order(navLinks)),
    h('button', { type: 'button', cls: 'iconbtn icon-btn', 'aria-label': 'Help', 'data-fx': 'btn-help' }, [h('span', { 'aria-hidden': 'true', text: '?' })]),
    h('button', { type: 'button', cls: 'menubtn', 'aria-haspopup': 'menu', 'data-fx': 'btn-account', text: T('Account') }),
  ]);

  // ---------- toolbar ----------
  const toolbar = h('div', { role: 'toolbar', 'aria-label': label('toolbar', 'Actions'), cls: 'toolbar' }, order([
    h('button', { type: 'button', cls: 'tbbtn btn', 'data-fx': 'tb-new', text: T('New order') }),
    h('button', { type: 'button', cls: 'tbbtn btn', 'data-fx': 'tb-import', text: T('Import') }),
    h('button', { type: 'button', cls: 'tbbtn btn', 'data-fx': 'tb-export', text: T('Export') }),
    h('button', { type: 'button', cls: 'tbbtn btn', 'aria-label': 'Refresh', 'data-fx': 'tb-refresh' }, [h('span', { 'aria-hidden': 'true', text: '⟳' })]),
    h('button', { type: 'button', cls: 'tbbtn btn', 'data-testid': 'export-csv', 'data-fx': 'tid-csv', text: T('CSV') }),
    h('button', { type: 'button', cls: 'cta btn btn-primary', 'data-guide-id': 'primary-cta', 'data-fx': 'gid-start', text: T('Get started') }),
  ].map(maybeWrap)));
  const search = h('search', { cls: 'searchbox' }, [
    h('input', { type: 'search', cls: 'searchinput', placeholder: 'Search orders', 'data-fx': 'search' }),
  ]);
  // Enter adds the typed task and clears the field, like TodoMVC: no change event, no blur.
  const quickAdd = h('input', { type: 'text', cls: 'quickadd', 'aria-label': 'New task', placeholder: 'Add a task', 'data-fx': 'quick-add' });
  quickAdd.addEventListener('keydown', (e) => {
    const input = /** @type {HTMLInputElement} */ (e.target);
    if (/** @type {KeyboardEvent} */ (e).key === 'Enter' && input.value) input.value = '';
  });
  search.append(quickAdd);

  // ---------- profile form ----------
  const field = (/** @type {string} */ id, /** @type {string} */ text, /** @type {HTMLElement} */ control) =>
    maybeWrap(h('div', { cls: 'field form-field' }, [h('label', { for: id, cls: 'fieldlabel', text }), control]));
  const profileFields = order([
    field('first-name', 'First name', h('input', { id: 'first-name', name: 'firstName', cls: 'input', 'data-fx': 'pf-first' })),
    field('last-name', 'Last name', h('input', { id: 'last-name', name: 'lastName', cls: 'input', 'data-fx': 'pf-last' })),
    field('email', 'Email', h('input', { id: 'email', type: 'email', name: 'email', cls: 'input', 'data-fx': 'pf-email' })),
    field('country', 'Country', h('select', { id: 'country', name: 'country', cls: 'select', 'data-fx': 'pf-country' }, [
      h('option', { value: 'fr', text: 'France' }),
      h('option', { value: 'de', text: 'Germany' }),
      h('option', { value: 'us', text: 'United States' }),
    ])),
    maybeWrap(h('label', { cls: 'check' }, [h('input', { type: 'checkbox', name: 'newsletter', 'data-fx': 'pf-newsletter' }), ' Send me the newsletter'])),
    maybeWrap(h('textarea', { name: 'bio', cls: 'textarea', placeholder: 'Tell us about you', 'data-fx': 'pf-bio' })),
  ]);
  const profile = h('form', { 'aria-label': label('profile', 'Profile'), cls: 'card profileform', onsubmit: 'return false' }, [
    h('h2', { text: 'Profile' }),
    ...profileFields,
    h('div', { cls: 'actions form-actions' }, [
      h('button', { type: 'submit', cls: 'savebtn btn btn-primary', 'data-fx': 'pf-save', text: T('Save') }),
      h('button', { type: 'button', cls: 'cancelbtn btn', 'data-fx': 'pf-cancel', text: T('Cancel') }),
    ]),
  ]);

  // ---------- billing form (look-alike buttons) ----------
  const billing = h('form', { 'aria-label': label('billing', 'Billing'), cls: 'card billingform', onsubmit: 'return false' }, [
    h('h2', { text: 'Billing' }),
    field('card-holder', 'Card holder', h('input', { id: 'card-holder', name: 'holder', cls: 'input', 'data-fx': 'bl-holder' })),
    h('fieldset', { cls: 'radios' }, [
      h('legend', { text: 'Plan' }),
      h('label', {}, [h('input', { type: 'radio', name: 'plan', value: 'basic', 'data-fx': 'bl-basic' }), ' Basic']),
      h('label', {}, [h('input', { type: 'radio', name: 'plan', value: 'pro', 'data-fx': 'bl-pro' }), ' Pro']),
    ]),
    h('div', { cls: 'actions form-actions' }, [
      h('button', { type: 'submit', cls: 'savebtn btn btn-primary', 'data-fx': 'bl-save', text: T('Save') }),
      h('button', { type: 'button', cls: 'cancelbtn btn', 'data-fx': 'bl-cancel', text: T('Cancel') }),
    ]),
  ]);

  // ---------- preferences: ARIA switches, a field with a generated id ----------
  const sw = (/** @type {string} */ name, /** @type {string} */ key) =>
    h('div', { role: 'switch', 'aria-checked': 'false', tabindex: '0', 'aria-label': name, cls: 'switch', 'data-fx': key }, [h('span', { cls: 'knob' })]);
  const prefs = h('section', { 'aria-labelledby': 'prefs-title', cls: 'card prefs' }, [
    h('h2', { id: 'prefs-title', text: 'Preferences' }),
    ...order([sw('Dark mode', 'sw-dark'), sw('Notifications', 'sw-notify')]),
    h('span', { id: 'nick-label', text: 'Nickname' }),
    h('input', { id: ':r3:', 'aria-labelledby': 'nick-label', cls: 'input', 'data-fx': 'ally-input' }),
    h('details', {}, [h('summary', { cls: 'summary', 'data-fx': 'summary-more', text: T('More options') }), h('p', { text: 'Advanced settings live here.' })]),
    // Custom toggles: the native input is visually hidden, the label is what users see and click.
    ...order([
      h('label', { cls: 'toggle' }, [
        h('input', { type: 'checkbox', name: 'autosave', style: 'opacity:0;width:0;height:0;position:absolute', 'data-fx': 'tg-autosave' }),
        h('span', { cls: 'slider', 'aria-hidden': 'true' }),
        h('span', { text: 'Autosave' }),
      ]),
      h('span', { cls: 'togglewrap' }, [
        h('input', { type: 'checkbox', id: 'beta-features', style: 'display:none', 'data-fx': 'tg-beta' }),
        h('label', { for: 'beta-features', cls: 'toggle', text: 'Beta features' }),
      ]),
    ]),
  ]);

  // ---------- custom dropdown (combobox + portal listbox) and tabs ----------
  const combo = h('div', { role: 'combobox', tabindex: '0', 'aria-expanded': String(o.portalOpen), 'aria-controls': 'status-list', 'aria-label': 'Status', cls: 'combo', 'data-fx': 'dd-status' }, [
    h('span', { text: 'Open' }),
  ]);
  const portal = h('div', { cls: 'portal', id: 'portal-root' }, o.portalOpen ? [
    h('div', { role: 'listbox', id: 'status-list', 'aria-label': 'Status options', cls: 'listbox' }, order([
      h('div', { role: 'option', 'aria-selected': 'true', cls: 'option', 'data-fx': 'dd-open', text: T('Open') }),
      h('div', { role: 'option', 'aria-selected': 'false', cls: 'option', 'data-fx': 'dd-closed', text: T('Closed') }),
      h('div', { role: 'option', 'aria-selected': 'false', cls: 'option', 'data-fx': 'dd-pending', text: T('Pending') }),
    ])),
  ] : []);
  const tabs = h('div', { role: 'tablist', 'aria-label': 'Views', cls: 'tabs' }, order([
    h('button', { role: 'tab', 'aria-selected': 'true', cls: 'tab', 'data-fx': 'tab-overview', text: T('Overview') }),
    h('button', { role: 'tab', 'aria-selected': 'false', cls: 'tab', 'data-fx': 'tab-activity', text: T('Activity') }),
    h('button', { role: 'tab', 'aria-selected': 'false', cls: 'tab', 'data-fx': 'tab-files', text: T('Files') }),
  ]));

  // ---------- orders table: an Edit button on every row ----------
  const rows = [
    ['10234', 'Ada Lovelace', '$12.50'],
    ['10235', 'Grace Hopper', '$99.00'],
    ['10236', 'Alan Turing', '$7.25'],
    ['10237', 'Katherine Johnson', '$310.40'],
    ['10238', 'Edsger Dijkstra', '$45.10'],
  ].map(([id, name, amount]) =>
    h('tr', { cls: 'row' }, [
      h('td', { text: `#${id}` }),
      h('td', { text: name }),
      h('td', { text: amount }),
      h('td', { cls: 'rowactions' }, [
        h('button', { type: 'button', cls: 'rowbtn btn-sm', 'data-fx': 'row-edit', text: T('Edit') }),
        h('button', { type: 'button', cls: 'rowbtn btn-sm', 'aria-label': 'Delete', 'data-fx': 'row-delete' }, [h('span', { 'aria-hidden': 'true', text: '✕' })]),
        h('a', { href: `/app/orders/${id}`, cls: 'rowlink', 'data-fx': 'row-view', text: T('View') }),
      ]),
    ]),
  );
  const table = h('table', { cls: 'orders' }, [
    h('caption', { text: 'Orders' }),
    h('thead', {}, [h('tr', {}, ['Order', 'Customer', 'Amount', ''].map((t) => h('th', { text: t })))]),
    h('tbody', {}, order(rows)),
  ]);

  // ---------- plan cards: look-alike "Choose" buttons ----------
  const card = (/** @type {string} */ id, /** @type {string} */ title, /** @type {string} */ key) =>
    h('section', { 'aria-label': label(id, `${title} plan`), cls: 'card plan' }, [
      h('h3', { text: title }),
      h('button', { type: 'button', cls: 'choosebtn btn', 'data-fx': key, text: T('Choose') }),
    ]);
  const cards = h('div', { cls: 'cards' }, order([card('starter', 'Starter', 'card-starter-choose'), card('team', 'Team', 'card-team-choose')]));

  // ---------- drafts: look-alikes told apart only by title, image alt, input value ----------
  const iconLink = (/** @type {string} */ title, /** @type {string} */ key) =>
    h('a', { href: '#', title: T(title), cls: 'iconlink icon-link', 'data-fx': key }, [h('span', { 'aria-hidden': 'true', text: '•' })]);
  const imageLink = (/** @type {string} */ alt, /** @type {string} */ key) =>
    h('a', { href: '#', cls: 'imglink', 'data-fx': key }, [h('img', { alt: T(alt), width: '16', height: '16' })]);
  const radio = (/** @type {string} */ value, /** @type {string} */ text, /** @type {string} */ key) =>
    h('span', { cls: 'opt' }, [h('input', { type: 'radio', name: 'visibility', value, 'data-fx': key }), h('span', { text })]);
  const drafts = h('section', { 'aria-label': label('drafts', 'Drafts'), cls: 'card drafts' }, [
    h('h2', { text: 'Drafts' }),
    h('div', { cls: 'draftactions' }, order([iconLink('Edit draft', 'dr-edit'), iconLink('Delete draft', 'dr-delete'), imageLink('Archive draft', 'dr-archive'), imageLink('Duplicate draft', 'dr-duplicate')].map(maybeWrap))),
    h('form', { cls: 'draftform', onsubmit: 'return false' }, [
      h('div', { cls: 'visibility' }, order([radio('public', 'Public', 'dr-public'), radio('private', 'Private', 'dr-private')])),
      h('div', { cls: 'actions form-actions' }, order([
        h('input', { type: 'submit', name: 'commit', value: T('Save draft'), cls: 'btn', 'data-fx': 'dr-save' }),
        h('input', { type: 'submit', name: 'commit', value: T('Publish'), cls: 'btn btn-primary', 'data-fx': 'dr-publish' }),
      ])),
    ]),
  ]);

  // ---------- open shadow DOM widget ----------
  const makeWidget = (/** @type {string} */ suffix) => {
    const host = h('fx-widget', { cls: 'widget', [FX_ATTR]: `widget#host${suffix}` });
    const root = host.attachShadow({ mode: 'open' });
    root.append(
      h('div', { cls: 'wpanel' }, [
        h('input', { placeholder: 'Widget name', cls: 'winput', [FX_ATTR]: `sh-input${suffix}` }),
        h('button', { type: 'button', cls: 'wbtn', [FX_ATTR]: `sh-launch${suffix}`, text: T('Launch') }),
      ]),
    );
    return { host, root };
  };
  const { host: widgetHost, root: shadow } = makeWidget('');

  // ---------- pagination, links, footer ----------
  const pagination = h('nav', { 'aria-label': 'Pagination', cls: 'pager' }, [
    h('button', { type: 'button', cls: 'pagebtn', 'data-fx': 'pg-prev', text: T('Previous') }),
    h('button', { type: 'button', cls: 'pagebtn', 'data-fx': 'pg-next', text: T('Next') }),
  ]);
  const docsLink = h('a', { href: 'https://docs.example.com/guide', target: '_blank', cls: 'extlink', 'data-fx': 'link-docs', text: T('Read the docs') });
  const footer = h('footer', { cls: 'footer' }, [
    h('a', { href: '/privacy', cls: 'footlink', 'data-fx': 'ft-privacy', text: T('Privacy') }),
    h('a', { href: '/terms', cls: 'footlink', 'data-fx': 'ft-terms', text: T('Terms') }),
  ]);

  // A select that opens on mousedown behind a full-page backdrop (MUI): the mouseup lands on the
  // backdrop, so the click goes to the common ancestor, <body>, not to the combobox.
  const priority = h('div', { role: 'combobox', tabindex: '0', 'aria-expanded': 'false', 'aria-label': 'Priority', cls: 'combo prio', 'data-fx': 'dd-priority', text: T('Normal') });
  priority.addEventListener('mousedown', () => {
    const backdrop = doc.createElement('div');
    backdrop.className = 'backdrop';
    backdrop.setAttribute('style', 'position:fixed;inset:0;z-index:50;background:transparent');
    backdrop.addEventListener('click', () => {
      backdrop.remove();
      priority.setAttribute('aria-expanded', 'false');
    });
    doc.body.append(backdrop);
    priority.setAttribute('aria-expanded', 'true');
  });
  // An icon "button" that is a span with an id and a title around an <svg> (demoqa): a click
  // lands on the <path>, which has nothing to find it by.
  const svgNs = 'http://www.w3.org/2000/svg';
  const icon = doc.createElementNS(svgNs, 'svg');
  icon.setAttribute('viewBox', '0 0 16 16');
  icon.setAttribute('width', '16');
  icon.setAttribute('height', '16');
  const iconPath = doc.createElementNS(svgNs, 'path');
  iconPath.setAttribute('d', 'M0 0h16v16H0z');
  icon.append(iconPath);
  const printIcon = h('span', { id: 'print-record', title: T('Print'), cls: 'iconspan', 'data-fx': 'icon-print' }, [icon]);

  const mainSections = order([toolbar, search, profile, billing, prefs, h('div', { cls: 'pickers' }, [combo, tabs, priority, printIcon]), table, cards, drafts].map(maybeWrap));
  const main = h('main', { cls: 'main content' }, [...mainSections, widgetHost, pagination, docsLink]);
  const app = h('div', { cls: 'app', id: 'app-root' }, [header, main, footer]);

  // ---------- mutations for ambiguity tests ----------
  const all = () => [...Array.from(app.querySelectorAll(`[${FX_ATTR}]`)), ...Array.from(portal.querySelectorAll(`[${FX_ATTR}]`)), ...Array.from(shadow.querySelectorAll(`[${FX_ATTR}]`))];
  for (const key of o.twin) {
    const el = all().find((e) => e.getAttribute(FX_ATTR) === key);
    if (el) {
      // cloneNode does not copy a shadow root: build a second widget instead.
      const copy = el.shadowRoot ? makeWidget('#twin').host : /** @type {Element} */ (el.cloneNode(true));
      copy.setAttribute(FX_ATTR, `${key}#twin`);
      el.before(copy);
    }
  }
  for (const key of o.remove) all().filter((e) => e.getAttribute(FX_ATTR) === key).forEach((e) => e.remove());

  return { app, portal };
}

/** @param {string} t */
function changed(t) {
  const map = /** @type {Record<string,string>} */ ({ Save: 'Save changes', Cancel: 'Discard', Edit: 'Modify', Choose: 'Select plan', Next: 'Forward', Previous: 'Back' });
  return map[t] ?? `${t} now`;
}

/**
 * Renders the app into `root` (and the portal at the end of the body).
 * @param {HTMLElement} root @param {AppOptions} [options]
 */
export function mountApp(root, options = {}) {
  const { app, portal } = createApp(options, root.ownerDocument);
  root.replaceChildren(app);
  root.ownerDocument.getElementById('portal-root')?.remove();
  root.ownerDocument.body.append(portal);
  return { app, portal };
}

/**
 * Collects fixture keys (including inside open shadow roots), then removes the attributes.
 * @param {Document} doc
 * @returns {Map<string, Element[]>}
 */
export function takeKeys(doc = document) {
  /** @type {Map<string, Element[]>} */
  const map = new Map();
  /** @param {Document|ShadowRoot} root */
  const visit = (root) => {
    for (const el of Array.from(root.querySelectorAll('*'))) {
      const k = el.getAttribute(FX_ATTR);
      if (k) {
        const list = map.get(k) ?? [];
        list.push(el);
        map.set(k, list);
        el.removeAttribute(FX_ATTR);
      }
      if (el.shadowRoot) visit(el.shadowRoot);
    }
  };
  visit(doc);
  return map;
}
