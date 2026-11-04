// @ts-check
import { mountApp } from './app.js';
import { enhance } from './live.js';

const q = new URLSearchParams(location.search);
const num = (/** @type {string} */ k, /** @type {number} */ d) => (q.has(k) ? Number(q.get(k)) : d);
// Class names are re-hashed on every load unless a seed is given.
mountApp(/** @type {HTMLElement} */ (document.getElementById('root')), {
  seed: num('seed', Math.floor(Math.random() * 1e9)),
  layoutSeed: num('layout', 1),
  reorder: q.has('reorder'),
  wrap: q.has('wrap'),
  changeText: q.has('changeText'),
  portalOpen: true,
});
enhance(document, { live: !q.has('static') });
