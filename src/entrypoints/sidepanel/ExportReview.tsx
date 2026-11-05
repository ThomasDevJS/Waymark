/**
 * Export review (SPEC: Sharing, Import rules: "Before export, show a review of everything the
 * pack contains (titles, notes, labels, URLs), so the author can remove business data").
 */
import { signal } from '@preact/signals';
import type { Guide } from '../../core/model/schema';
import { makePack } from '../../core/sharing/pack';
import { applyRemovals, packStrings, type StringKind } from '../../core/sharing/review';
import { Icon } from '../../ui/Icon';

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
  const removedCount = removed.value.size;
  return (
    <section class="stack export-review" aria-labelledby="export-title" data-testid="export-review">
      <div class="stack-sm">
        <h2 id="export-title">Review before export</h2>
        <p class="small muted">
          This is everything the pack will contain, word for word. Remove business data such as customer names, amounts and internal codes. To change titles, sites or pages, edit the guide.
        </p>
      </div>
      {guides.map((g) => (
        <div key={g.id} class="stack-sm">
          <h3 class="section-label">
            <Icon name="book" />
            {g.title}
          </h3>
          <ul class="list divided review-list">
            {strings
              .filter((s) => s.guideId === g.id)
              .map((s) => {
                const gone = removed.value.has(s.key);
                return (
                  <li key={s.key} class={`list-item${gone ? ' removed' : ''}`}>
                    <div class="grow">
                      <div class="xsmall muted">
                        {s.stepIndex !== null ? `Step ${s.stepIndex + 1} · ` : ''}
                        {KIND[s.kind]}
                        {gone && ' · removed'}
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
              })}
          </ul>
        </div>
      ))}
      <div class="editor-bar stack-sm">
        <label class="field">
          <span class="label">File name</span>
          <input value={fileName.value} aria-describedby="export-file-hint" onInput={(e) => (fileName.value = (e.target as HTMLInputElement).value)} />
          <span class="hint" id="export-file-hint">
            Saved as {(fileName.value.replace(/[^\w.-]+/g, '-') || 'guides') + '.waymark.json'}
            {removedCount ? ` · ${removedCount} ${removedCount === 1 ? 'item' : 'items'} removed` : ''}
          </span>
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
            <Icon name="download" />
            Download pack
          </button>
          <button
            type="button"
            class="ghost"
            onClick={() => {
              removed.value = new Set();
              onDone();
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </section>
  );
}
