// @ts-check
/**
 * Interactive parts of the fixture site: history and hash routing, a div modal, a native
 * <dialog>, a popover, the custom dropdown, ARIA switches, a re-rendering list, a virtualized
 * list, a canvas, content that appears after 2 seconds, and same/cross-origin iframes.
 */

/** @param {string} tag @param {Record<string,string>} [attrs] @param {(Node|string)[]} [kids] */
function h(tag, attrs = {}, kids = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v);
  }
  el.append(...kids);
  return el;
}

function routeLabel() {
  const r = /** @type {HTMLElement} */ (document.getElementById('route'));
  const hash = location.hash.startsWith('#/') ? ` hash=${location.hash.slice(1)}` : '';
  r.textContent = `Route: ${location.pathname}${hash}`;
}

/** @param {Document} doc @param {{live?: boolean}} [opts] */
export function enhance(doc, opts = {}) {
  routeLabel();
  // History routing: in-app links under /app/ use pushState.
  doc.addEventListener('click', (e) => {
    const a = /** @type {Element} */ (e.target).closest?.('a[href^="/app/"]:not([target])');
    if (!a || e.defaultPrevented) return;
    e.preventDefault();
    history.pushState({}, '', /** @type {string} */ (a.getAttribute('href')));
    routeLabel();
  });
  window.addEventListener('popstate', routeLabel);
  window.addEventListener('hashchange', routeLabel);

  // Custom dropdown: options live in a portal at the end of <body>.
  const portal = /** @type {HTMLElement} */ (doc.getElementById('portal-root'));
  const combo = doc.querySelector('[role=combobox]');
  portal.hidden = true;
  combo?.addEventListener('click', () => {
    portal.hidden = !portal.hidden;
    combo.setAttribute('aria-expanded', String(!portal.hidden));
  });
  portal.addEventListener('click', (e) => {
    const opt = /** @type {Element} */ (e.target).closest('[role=option]');
    if (!opt || !combo) return;
    portal.querySelectorAll('[role=option]').forEach((o) => o.setAttribute('aria-selected', String(o === opt)));
    /** @type {HTMLElement} */ (combo.firstElementChild).textContent = opt.textContent;
    portal.hidden = true;
  });

  // ARIA switches fire no change event.
  doc.querySelectorAll('[role=switch]').forEach((s) =>
    s.addEventListener('click', () => s.setAttribute('aria-checked', String(s.getAttribute('aria-checked') !== 'true'))),
  );

  const live = /** @type {HTMLElement} */ (doc.getElementById('live'));

  // Routing controls (used by Navigation API tests).
  live.append(
    h('section', { 'aria-label': 'Routing', class: 'card' }, [
      h('button', { type: 'button', id: 'push-route', text: 'Push route' }),
      h('button', { type: 'button', id: 'replace-route', text: 'Replace route' }),
      h('button', { type: 'button', id: 'hash-route', text: 'Hash route' }),
      h('button', { type: 'button', id: 'query-route', text: 'Query only' }),
      h('a', { href: '/app/reports', target: '_blank', id: 'new-tab-link', text: 'Open reports' }),
      h('a', { href: '/slow/invoices?static', id: 'slow-link', text: 'Invoices (slow)' }),
    ]),
  );
  doc.getElementById('push-route')?.addEventListener('click', () => (history.pushState({}, '', '/app/orders/77'), routeLabel()));
  doc.getElementById('replace-route')?.addEventListener('click', () => (history.replaceState({}, '', '/app/orders/78'), routeLabel()));
  doc.getElementById('hash-route')?.addEventListener('click', () => (location.hash = '#/inbox/3'));
  doc.getElementById('query-route')?.addEventListener('click', () => (history.pushState({}, '', `${location.pathname}?page=2`), routeLabel()));

  // Div modal.
  const modal = h('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Invite teammate', class: 'modal', hidden: '' }, [
    h('label', { for: 'invite-email', text: 'Teammate email' }),
    h('input', { id: 'invite-email', type: 'email' }),
    h('button', { type: 'button', id: 'invite-send', text: 'Send invite' }),
    h('button', { type: 'button', id: 'invite-close', text: 'Close' }),
  ]);
  // Native modal <dialog>.
  const dialog = h('dialog', { 'aria-label': 'Confirm delete', id: 'confirm-dialog' }, [
    h('p', { text: 'Delete this order?' }),
    h('button', { type: 'button', id: 'dialog-confirm', text: 'Confirm' }),
    h('button', { type: 'button', id: 'dialog-cancel', text: 'Keep' }),
  ]);
  // Popover.
  const pop = h('div', { popover: 'auto', id: 'tips', class: 'card' }, [h('button', { type: 'button', text: 'Got it' })]);
  live.append(
    h('section', { 'aria-label': 'Overlays', class: 'card' }, [
      h('button', { type: 'button', id: 'open-modal', text: 'Invite' }),
      h('button', { type: 'button', id: 'open-dialog', text: 'Delete order' }),
      h('button', { type: 'button', popovertarget: 'tips', text: 'Tips' }),
    ]),
    modal,
    dialog,
    pop,
  );
  doc.getElementById('open-modal')?.addEventListener('click', () => (modal.hidden = false));
  doc.getElementById('invite-close')?.addEventListener('click', () => (modal.hidden = true));
  doc.getElementById('open-dialog')?.addEventListener('click', () => /** @type {HTMLDialogElement} */ (dialog).showModal());
  doc.getElementById('dialog-confirm')?.addEventListener('click', () => /** @type {HTMLDialogElement} */ (dialog).close());
  doc.getElementById('dialog-cancel')?.addEventListener('click', () => /** @type {HTMLDialogElement} */ (dialog).close());

  // A list that re-renders and replaces its nodes.
  const list = h('ul', { 'aria-label': 'Tasks', class: 'tasks' });
  let tasks = ['Write report', 'Call supplier', 'Review invoice'];
  const renderTasks = () =>
    list.replaceChildren(...tasks.map((t) => h('li', {}, [h('span', { text: t }), h('button', { type: 'button', text: 'Done' })])));
  renderTasks();
  live.append(h('section', { 'aria-label': 'Task list', class: 'card' }, [h('button', { type: 'button', id: 'rerender', text: 'Re-render list' }), list]));
  doc.getElementById('rerender')?.addEventListener('click', () => {
    tasks = [...tasks.slice(1), /** @type {string} */ (tasks[0])];
    renderTasks();
  });

  // Virtualized list: only visible rows exist in the DOM.
  const ROW = 24;
  const vlist = h('div', { class: 'vlist', 'aria-label': 'Virtual list', role: 'region', tabindex: '0' });
  const inner = h('div', { style: `height:${1000 * ROW}px;position:relative` });
  vlist.append(inner);
  const renderRows = () => {
    const first = Math.floor(vlist.scrollTop / ROW);
    inner.replaceChildren(
      ...Array.from({ length: 10 }, (_, i) => first + i).map((n) =>
        h('div', { style: `position:absolute;top:${n * ROW}px;height:${ROW}px`, class: 'vrow' }, [`Item ${n} `, h('button', { type: 'button', text: 'Open' })]),
      ),
    );
  };
  vlist.addEventListener('scroll', renderRows);
  renderRows();

  // Canvas area: nothing to target.
  const canvas = /** @type {HTMLCanvasElement} */ (h('canvas', { width: '200', height: '80', 'aria-label': 'Chart' }));
  canvas.getContext('2d')?.fillRect(10, 10, 60, 40);
  live.append(h('section', { 'aria-label': 'Data', class: 'card' }, [vlist, canvas]));

  // Content that appears after 2 seconds.
  const late = h('section', { 'aria-label': 'Late content', class: 'card' });
  live.append(late);
  if (opts.live !== false) setTimeout(() => late.append(h('button', { type: 'button', id: 'late-button', text: 'Load more' })), 2000);

  // Same-origin and cross-origin iframes.
  const other = location.hostname === 'localhost' ? '127.0.0.1' : 'localhost';
  live.append(
    h('section', { 'aria-label': 'Frames', class: 'card' }, [
      h('iframe', { src: '/frame.html?name=same', title: 'Same-origin frame', class: 'frame-same', width: '320', height: '120' }),
      h('iframe', { src: `${location.protocol}//${other}:${location.port}/frame.html?name=cross`, title: 'Cross-origin frame', class: 'frame-cross', width: '320', height: '120' }),
    ]),
  );
}
