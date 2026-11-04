#!/usr/bin/env node
// CI guard (SPEC: Tech stack, "CI guards"): the built manifest must have no content_scripts
// and no host_permissions, and must not request broad permissions at install.
import { readFileSync } from 'node:fs';

const file = process.argv[2] ?? '.output/chrome-mv3/manifest.json';
const m = JSON.parse(readFileSync(file, 'utf8'));
const errors = [];
if ('content_scripts' in m) errors.push('manifest has content_scripts');
if ('host_permissions' in m) errors.push('manifest has host_permissions');
const forbidden = ['tabs', 'webNavigation', 'history', '<all_urls>'];
for (const p of m.permissions ?? []) if (forbidden.includes(p) || p.includes('://')) errors.push(`forbidden permission: ${p}`);
if (m.manifest_version !== 3) errors.push('not Manifest V3');
if (m.action?.default_popup) errors.push('manifest popup would block action.onClicked');
const csp = JSON.stringify(m.content_security_policy ?? '');
if (/https?:/.test(csp)) errors.push('CSP allows remote code');
// The only CSP change allowed is 'wasm-unsafe-eval' for the HD voice's WebAssembly (D47).
const ALLOWED_CSP = "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'";
if (m.content_security_policy) {
  const keys = Object.keys(m.content_security_policy);
  if (keys.join() !== 'extension_pages' || m.content_security_policy.extension_pages !== ALLOWED_CSP) errors.push(`CSP must be exactly extension_pages: ${ALLOWED_CSP}`);
}
if (errors.length) {
  console.error(`Manifest guard FAILED for ${file}:\n - ` + errors.join('\n - '));
  process.exit(1);
}
console.log(`Manifest guard passed: ${file}`);
