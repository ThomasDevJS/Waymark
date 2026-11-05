// Summarizes test-results/real/*.json (written by `pnpm test:real`) as a Markdown table.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(process.cwd(), 'test-results', 'real');
const rows = [];
for (const f of readdirSync(dir).sort()) {
  if (!f.endsWith('.json') || f.endsWith('--guide.json')) continue;
  const r = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  const n = (o) => r.outcomes.filter((x) => x === o).length;
  const other = r.outcomes.length - n('found') - n('wrong') - n('not-found');
  const notes = [...r.details, other ? `${other} stuck/aborted` : '', r.done ? '' : 'run not finished'].filter(Boolean).join('; ');
  rows.push(`| ${r.site} | ${r.task} | ${r.variant} | ${r.outcomes.length} | ${n('found')} | ${n('wrong')} | ${n('not-found')} | ${notes.replace(/\|/g, '\\|')} |`);
}
console.log('| Site | Task | Variant | Steps | Found | Wrong | Not found | Notes |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
console.log(rows.join('\n'));
