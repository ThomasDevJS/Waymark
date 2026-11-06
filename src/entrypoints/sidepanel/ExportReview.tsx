/**
 * Export review (SPEC: Sharing, Import rules: "Before export, show a review of everything the
 * pack contains (titles, notes, labels, URLs), so the author can remove business data").
 */
import { signal } from '@preact/signals';
import type { Guide } from '../../core/model/schema';
import { makePack } from '../../core/sharing/pack';
import { applyRemovals, packStrings, type StringKind } from '../../core/sharing/review';
import { howtoHtml, howtoImageKey, howtoMarkdown, howtoStrings, looksLikeData, type HowtoImage } from '../../core/sharing/howto';
import { Icon } from '../../ui/Icon';
import { useEffect } from 'preact/hooks';
import { shotsOf, type ShotRecord } from '../../core/shots/store';
import { blobToDataUrl, renderShot } from '../../core/shots/render';
import { shotFits, stepHashes } from '../../core/shots/lifecycle';
import { send } from '../../core/messaging/client';

const removed = signal<Set<string>>(new Set());
const fileName = signal('guides');
/** What to export (D104): a pack to import elsewhere, or a how-to to read or print. */
export type ExportFormat = 'pack' | 'markdown' | 'html';
const format = signal<ExportFormat>('pack');
/** Screenshots of the selected guides' steps (printable how-to only, D188), and their previews. */
const shotList = signal<ShotRecord[]>([]);
const previews = signal<Record<string, string>>({});
/** Blur everything but the highlighted element: on unless the author turns it off (D188). */
const blurShots = signal(true);
const busy = signal(false);

/** The review key of a step's screenshot: dropped like any removed row (`removed`). */
export const shotRowKey = (guideId: string, stepId: string) => `${guideId}|${stepId}|screenshot`;

/**
 * Screenshots that go into the printable how-to: of steps still in the guide that still point at
 * the element the image shows (D185), and not left out by the author.
 */
export function keptShots(guides: Guide[], shots: ShotRecord[], drop: Set<string>): ShotRecord[] {
  const steps = new Map(guides.map((g) => [g.id, stepHashes(g)]));
  return shots.filter((x) => shotFits(x, steps.get(x.guideId)) && !drop.has(shotRowKey(x.guideId, x.stepId)));
}

/** A guide's screenshots, if screenshots are on for it (an image left from a guide turned off is not offered). */
async function guideShots(g: Guide): Promise<ShotRecord[]> {
  const status = await send('shots.get', { guideId: g.id });
  if (!status.on || !status.stepIds.length) return [];
  const ids = new Set(status.stepIds);
  return (await shotsOf(g.id)).filter((x) => ids.has(x.stepId));
}

/** The printable how-to with its screenshots, marked (and blurred) now. */
export async function exportHowtoHtml(guides: Guide[], drop: Set<string>, shots: ShotRecord[], blur: boolean): Promise<string> {
  const images = new Map<string, HowtoImage>();
  for (const x of keptShots(guides, shots, drop)) {
    try {
      images.set(howtoImageKey(x.guideId, x.stepId), { src: await blobToDataUrl(await renderShot(x, { blur })), w: x.w, h: x.h });
    } catch {
      // an image that can't be drawn is left out; the step stays as text
    }
  }
  return howtoHtml(applyRemovals(guides, drop), images);
}

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
  const guideIds = guides.map((g) => g.id).join(',');
  // The screenshots are read only for the printable how-to (the extension's own IndexedDB).
  useEffect(() => {
    let live = true;
    if (f !== 'html') {
      shotList.value = [];
      return;
    }
    void Promise.all(guides.map((g) => guideShots(g).catch(() => [] as ShotRecord[]))).then((all) => {
      if (live) shotList.value = keptShots(guides, all.flat(), new Set());
    });
    return () => {
      live = false;
    };
  }, [f, guideIds]);
  // Previews show exactly what the file will have: marked, and blurred when blur is on.
  useEffect(() => {
    let live = true;
    const urls: string[] = [];
    void (async () => {
      const next: Record<string, string> = {};
      for (const x of shotList.value) {
        try {
          const url = URL.createObjectURL(await renderShot(x, { blur: blurShots.value }));
          urls.push(url);
          next[shotRowKey(x.guideId, x.stepId)] = url;
        } catch {
          // no preview: the row still shows, and the image is left out of the file
        }
      }
      if (live) previews.value = next;
      else urls.forEach((u) => URL.revokeObjectURL(u));
    })();
    return () => {
      live = false;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [shotList.value, blurShots.value]);
  const shotsShown = f === 'html' ? shotList.value : [];
  const spec = FORMATS.find((x) => x.value === f)!;
  const strings = f === 'pack' ? packStrings(guides) : howtoStrings(guides);
  const keys = new Set([...strings.map((x) => x.key), ...shotsShown.map((x) => shotRowKey(x.guideId, x.stepId))]);
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
    blurShots.value = true;
    shotList.value = [];
    onDone();
  };
  const stepIndex = (g: Guide, stepId: string) => g.steps.findIndex((x) => x.id === stepId);
  const shotRow = (g: Guide, x: ShotRecord) => {
    const key = shotRowKey(x.guideId, x.stepId);
    const gone = removed.value.has(key);
    const n = stepIndex(g, x.stepId) + 1;
    return (
      <li key={key} class={`list-item shot-row${gone ? ' removed' : ''}`} data-testid={`shot-${n}`}>
        {previews.value[key] ? <img class="shot-thumb" src={previews.value[key]} alt={`Screenshot of step ${n}`} /> : <span class="shot-thumb" />}
        <div class="grow">
          <div class="xsmall muted">
            Step {n} · Screenshot{gone && ' · left out'}
          </div>
        </div>
        <button
          type="button"
          class="ghost sm"
          data-testid={`remove-shot-${n}`}
          aria-label={`${gone ? 'Keep' : 'Leave out'} the screenshot of step ${n}`}
          onClick={() => {
            const next = new Set(removed.value);
            if (gone) next.delete(key);
            else next.add(key);
            removed.value = next;
          }}
        >
          {gone ? 'Keep' : 'Leave out'}
        </button>
      </li>
    );
  };
  return (
    <section class="stack export-review" aria-labelledby="export-title" data-testid="export-review">
      <div class="stack-sm">
        <h2 id="export-title">Review before export</h2>
        <p class="small muted">
          This is everything the {f === 'pack' ? 'guide file' : 'how-to'} will contain, word for word{shotsShown.length ? ', and every screenshot' : ''}. Remove anything private, such as customer names, amounts or internal codes. To change a title, edit the guide.
        </p>
      </div>
      <fieldset class="formats" data-testid="export-format">
        <legend class="label">Format</legend>
        {FORMATS.map((x) => (
          <label key={x.value} class={`format lift pressable${f === x.value ? ' on' : ''}`}>
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
      {shotsShown.length > 0 && (
        <label class="check small">
          <input type="checkbox" role="switch" class="switch" data-testid="export-blur" checked={blurShots.value} onChange={(e) => (blurShots.value = (e.target as HTMLInputElement).checked)} />
          <span>
            Blur everything except the highlighted element
            <span class="hint block">On: names, amounts and other text around the element can’t be read in the file. Check each screenshot below either way.</span>
          </span>
        </label>
      )}
      {guides.map((g) => {
        const own = strings.filter((s) => s.guideId === g.id);
        const ownShots = shotsShown.filter((x) => x.guideId === g.id).sort((a, b) => stepIndex(g, a.stepId) - stepIndex(g, b.stepId));
        const words = own.filter((s) => !TECHNICAL.has(s.kind));
        const tech = own.filter((s) => TECHNICAL.has(s.kind));
        return (
          <div key={g.id} class="stack-sm">
            <h3 class="section-label">
              <Icon name="book" />
              {g.title}
            </h3>
            <ul class="list divided review-list">{words.map(row)}</ul>
            {ownShots.length > 0 && (
              <div class="stack-sm" data-testid={`export-shots-${g.id}`}>
                <h4 class="small">Screenshots ({ownShots.length})</h4>
                <ul class="list divided review-list">{ownShots.map((x) => shotRow(g, x))}</ul>
              </div>
            )}
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
            disabled={busy.value}
            onClick={() => {
              if (f === 'html' && shotsShown.length) {
                busy.value = true;
                void exportHowtoHtml(guides, removed.value, shotsShown, blurShots.value)
                  .then((html) => {
                    download(fileName.value, html, f);
                    finish();
                  })
                  .finally(() => (busy.value = false));
                return;
              }
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
