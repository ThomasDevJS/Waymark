/**
 * Export review (SPEC: Sharing, Import rules: "Before export, show a review of everything the
 * pack contains (titles, notes, labels, URLs), so the author can remove business data").
 */
import { signal } from '@preact/signals';
import type { Guide } from '../../core/model/schema';
import { makePack } from '../../core/sharing/pack';
import { applyRemovals, packStrings, type StringKind } from '../../core/sharing/review';
import { howtoHtml, howtoMarkdown, howtoStrings, looksLikeData } from '../../core/sharing/howto';
import { Icon } from '../../ui/Icon';

const removed = signal<Set<string>>(new Set());
const fileName = signal('guides');
/** What to export (D104): a pack to import elsewhere, or a how-to to read or print. */
export type ExportFormat = 'pack' | 'markdown' | 'html';
const format = signal<ExportFormat>('pack');

const FORMATS: { value: ExportFormat; label: string; hint: string; ext: string; type: string }[] = [
  { value: 'pack', label: 'Waymark guide file', hint: 'Someone imports it into their Waymark, or your team publishes it as a team library.', ext: '.waymark.json', type: 'application/json' },
  { value: 'markdown', label: 'How-to text (Markdown)', hint: 'Numbered steps to paste into a wiki or document.', ext: '.md', type: 'text/markdown' },
  { value: 'html', label: 'Printable how-to', hint: 'A page to print or save as PDF.', ext: '.html', type: 'text/html' },
];

const KIND: Record<StringKind, string> = {
  'guide-title': 'Guide title',
  description: 'Description',
  tag: 'Tag',
  url: 'Page',
  'step-title': 'Step title',
  note: 'Note',
  voice: 'Spoken text',
  label: 'Element label',
  link: 'Link path',
  site: 'Site',
  selector: 'Element path',
};

/** Rows that are how Waymark finds elements, not words people read: folded under "Technical details" (D126). */
export const TECHNICAL: ReadonlySet<StringKind> = new Set<StringKind>(['selector', 'link']);

/** Builds the pack JSON for the reviewed copy. */
export function exportJson(guides: Guide[], drop: Set<string>): string {
  return JSON.stringify(makePack(applyRemovals(guides, drop)), null, 2);
}

/** The file for a format, built from the reviewed copy (the same removals for every format). */
export function exportText(guides: Guide[], drop: Set<string>, f: ExportFormat): string {
  if (f === 'pack') return exportJson(guides, drop);
  const copy = applyRemovals(guides, drop);
  return f === 'markdown' ? howtoMarkdown(copy) : howtoHtml(copy);
}

export const safeFileName = (name: string) => name.replace(/[^\w.-]+/g, '-') || 'guides';

function download(name: string, text: string, f: ExportFormat) {
  const spec = FORMATS.find((x) => x.value === f)!;
  const blob = new Blob([text], { type: `${spec.type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeFileName(name)}${spec.ext}`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function ExportReview({ guides, onDone }: { guides: Guide[]; onDone: () => void }) {
  const f = format.value;
  const spec = FORMATS.find((x) => x.value === f)!;
  const strings = f === 'pack' ? packStrings(guides) : howtoStrings(guides);
  const keys = new Set(strings.map((x) => x.key));
  const removedCount = [...removed.value].filter((k) => keys.has(k)).length;
  const flagged = strings.filter((x) => !removed.value.has(x.key) && looksLikeData(x)).length;
  const row = (s: (typeof strings)[number]) => {
    const gone = removed.value.has(s.key);
    const data = !gone && looksLikeData(s);
    return (
      <li key={s.key} class={`list-item${gone ? ' removed' : ''}`} data-testid={data ? `data-like-${s.key}` : undefined}>
        <div class="grow">
          <div class="xsmall muted">
            {s.stepIndex !== null ? `Step ${s.stepIndex + 1} · ` : ''}
            {KIND[s.kind]}
            {gone && ' · removed'}
            {data && (
              <span class="badge warn">
                <Icon name="warn" />
                Looks like data
              </span>
            )}
          </div>
          <div class="value">{s.value}</div>
        </div>
        {s.removable && (
          <button
            type="button"
            class="ghost sm"
            data-testid={`remove-${s.key}`}
            aria-label={`${gone ? 'Keep' : 'Remove'} ${KIND[s.kind].toLowerCase()}${s.stepIndex !== null ? ` of step ${s.stepIndex + 1}` : ''}`}
            onClick={() => {
              const next = new Set(removed.value);
              if (gone) next.delete(s.key);
              else next.add(s.key);
              removed.value = next;
            }}
          >
            {gone ? 'Keep' : 'Remove'}
          </button>
        )}
      </li>
    );
  };
  const finish = () => {
    removed.value = new Set();
    format.value = 'pack';
    onDone();
  };
  return (
    <section class="stack export-review" aria-labelledby="export-title" data-testid="export-review">
      <div class="stack-sm">
        <h2 id="export-title">Review before export</h2>
        <p class="small muted">
          This is everything the {f === 'pack' ? 'guide file' : 'how-to'} will contain, word for word. Remove anything private, such as customer names, amounts or internal codes. To change a title, edit the guide.
        </p>
      </div>
      <fieldset class="formats" data-testid="export-format">
        <legend class="label">Format</legend>
        {FORMATS.map((x) => (
          <label key={x.value} class={`format${f === x.value ? ' on' : ''}`}>
            <input type="radio" name="export-format" value={x.value} checked={f === x.value} data-testid={`format-${x.value}`} onChange={() => (format.value = x.value)} />
            <span class="stack-sm">
              <strong>{x.label}</strong>
              <span class="xsmall muted">{x.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {flagged > 0 && (
        <p class="banner warn" role="status" data-testid="data-like-warning">
          <Icon name="warn" />
          <span>
            {flagged === 1 ? '1 item looks' : `${flagged} items look`} like data (an email, an amount, a date or a code). Check {flagged === 1 ? 'it' : 'them'} below.
          </span>
        </p>
      )}
      {guides.map((g) => {
        const own = strings.filter((s) => s.guideId === g.id);
        const words = own.filter((s) => !TECHNICAL.has(s.kind));
        const tech = own.filter((s) => TECHNICAL.has(s.kind));
        return (
          <div key={g.id} class="stack-sm">
            <h3 class="section-label">
              <Icon name="book" />
              {g.title}
            </h3>
            <ul class="list divided review-list">{words.map(row)}</ul>
            {tech.length > 0 && (
              <details class="technical" data-testid={`export-technical-${g.id}`}>
                <summary class="small">
                  Technical details ({tech.length}): how Waymark finds each element
                </summary>
                <p class="xsmall muted">These rarely hold private data. Remove one only if you see a name, number or code in it; that step may then be harder to find.</p>
                <ul class="list divided review-list">{tech.map(row)}</ul>
              </details>
            )}
          </div>
        );
      })}
      <div class="editor-bar stack-sm">
        <label class="field">
          <span class="label">File name</span>
          <input value={fileName.value} aria-describedby="export-file-hint" onInput={(e) => (fileName.value = (e.target as HTMLInputElement).value)} />
          <span class="hint" id="export-file-hint">
            Saved as {safeFileName(fileName.value) + spec.ext}
            {removedCount ? ` · ${removedCount} ${removedCount === 1 ? 'item' : 'items'} removed` : ''}
          </span>
        </label>
        <div class="row">
          <button
            type="button"
            class="primary"
            data-testid={f === 'pack' ? 'download-pack' : 'download-howto'}
            onClick={() => {
              download(fileName.value, exportText(guides, removed.value, f), f);
              finish();
            }}
          >
            <Icon name="download" />
            {f === 'pack' ? 'Download guide file' : 'Download how-to'}
          </button>
          <button type="button" class="ghost" onClick={finish}>
            Cancel
          </button>
        </div>
      </div>
    </section>
  );
}
