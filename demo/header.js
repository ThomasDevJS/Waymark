// Shared header so every page has the same navigation.
const pages = [
  ['index.html', 'Dashboard'],
  ['invoices.html', 'Invoices'],
  ['new-invoice.html', 'New invoice'],
  ['settings.html', 'Settings'],
];
const here = location.pathname.split('/').pop() || 'index.html';
const header = document.createElement('header');
const brand = document.createElement('div');
brand.className = 'brand';
brand.textContent = 'Demo Invoices';
const nav = document.createElement('nav');
nav.setAttribute('aria-label', 'Main');
for (const [href, label] of pages) {
  const a = document.createElement('a');
  a.href = href;
  a.textContent = label;
  if (href === here) a.setAttribute('aria-current', 'page');
  nav.append(a);
}
const help = document.createElement('a');
help.href = 'unrelated.html';
help.textContent = 'Unrelated page';
help.style.color = '#ffd28a';
header.append(brand, nav, help);
document.body.prepend(header);

export function toast(text) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.textContent = text;
  document.body.append(t);
  setTimeout(() => t.remove(), 2000);
}

// Simple switches: <button class="switch" role="switch" aria-checked="false">
for (const sw of document.querySelectorAll('.switch')) {
  sw.addEventListener('click', () => sw.setAttribute('aria-checked', String(sw.getAttribute('aria-checked') !== 'true')));
}
