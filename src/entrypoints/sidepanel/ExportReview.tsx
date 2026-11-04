/**
 * Export review (SPEC: Sharing, Import rules: "Before export, show a review of everything the
 * pack contains (titles, notes, labels, URLs), so the author can remove business data").
 */
import { signal } from '@preact/signals';
import type { Guide } from '../../core/model/schema';
import { makePack } from '../../core/sharing/pack';
import { applyRemovals, packStrings, type StringKind } from '../../core/sharing/review';

const removed = signal<Set<string>>(new Set());
const fileName = signal('guides');

const KIND: Record<StringKind, string> = {
  'guide-title': 'Guide title',
  description: 'Description',
  tag: 'Tag',
  url: 'Page',
  'step-title': 'Step title',
  note: 'Note',
  voice: 'Voice text',
  label: 'Element label',
  link: 'Link path',
  site: 'Site',
  selector: 'Element path',
};

/** Builds the pack JSON for the reviewed copy. */
export function exportJson(guides: Guide[], drop: Set<string>): string {
  return JSON.stringify(makePack(applyRemovals(guides, drop)), null, 2);
}

function download(name: string, json: string) {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name.replace(/[^\w.-]+/g, '-') || 'guides'}.waymark.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function ExportReview({ guides, onDone }: { guides: Guide[]; onDone: () => void }) {
  const strings = packStrings(guides);
  return (
    <section class="site" aria-label="Export review" data-testid="export-review">
      <h2>Review before export</h2>
      <p class="muted">
        This is everything the pack will contain, word for word. Remove anything that is business data (customer names, amounts, internal codes). Titles, sites and pages cannot be removed here; edit the guide to change them.
      </p>
      {guides.map((g) => (
        <div key={g.id} class="review-guide">
          <strong>{g.title}</strong>
          <ul class="review">
            {strings
              .filter((s) => s.guideId === g.id)
              .map((s) => {
                const gone = removed.value.has(s.key);
                return (
                  <li key={s.key} class={gone ? 'removed' : ''}>
                    <span class="muted">
                      {s.stepIndex !== null ? `Step ${s.stepIndex + 1} · ` : ''}
                      {KIND[s.kind]}
                    </span>{' '}
                    <span class="value">{s.value}</span>{' '}
                    {s.removable && (
                      <button
                        type="button"
                        data-testid={`remove-${s.key}`}
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
              })}
          </ul>
        </div>
      ))}
      <label class="grow">
        <span class="muted">File name</span>
        <input value={fileName.value} onInput={(e) => (fileName.value = (e.target as HTMLInputElement).value)} />
      </label>
      <div class="row">
        <button
          type="button"
          class="primary"
          data-testid="download-pack"
          onClick={() => {
            download(fileName.value, exportJson(guides, removed.value));
            removed.value = new Set();
            onDone();
          }}
        >
          Download pack
        </button>
        <button
          type="button"
          onClick={() => {
            removed.value = new Set();
            onDone();
          }}
        >
          Cancel
        </button>
      </div>
    </section>
  );
}
