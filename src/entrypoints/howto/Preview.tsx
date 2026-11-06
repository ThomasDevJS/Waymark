/**
 * The how-to preview (D195): the printable how-to exactly as it will be saved, step by step, with
 * each step's screenshot drawn as it will be (highlight, and blur or zoom when chosen). Per step:
 * Keep or Leave out, Blur, Zoom to the element. Then Save as PDF (the browser's print) or
 * Download HTML (self-contained, images as data URLs). Nothing leaves the device.
 */
import { Fragment, type ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Guide } from '../../core/model/schema';
import type { InlineToken } from '../../core/text/markdown';
import { howtoHtml, howtoImageKey, howtoInline, howtoPlain, PRINT_CSS, startOrigin, stepCount, stepPageLinks, stepsLabel, type HowtoImage } from '../../core/sharing/howto';
import { blobToDataUrl, renderShot } from '../../core/shots/render';
import { isOldShot, type ShotRecord } from '../../core/shots/store';
import { downloadText, safeFileName } from '../../core/sharing/file';
import { Icon } from '../../ui/Icon';

export interface ShotChoice {
  keep: boolean;
  blur: boolean;
  zoom: boolean;
}

/** Every screenshot starts kept, sharp and whole: blur is off by default (D193). */
export const DEFAULT_CHOICE: ShotChoice = { keep: true, blur: false, zoom: false };

interface Rendered {
  /** `${blur}|${zoom}` it was drawn with. */
  opts: string;
  blob: Blob | null;
  url: string | null;
  w: number;
  h: number;
}

const optsKey = (c: ShotChoice, old: boolean) => `${c.blur}|${c.zoom && !old}`;

export function MissingHint() {
  return (
    <>
      No screenshot. To add one: open the page, click the Waymark icon (or press <kbd>Alt+W</kbd>), then use <strong>Capture</strong> on this step in the editor.
    </>
  );
}

function Tokens({ tokens }: { tokens: InlineToken[] }): ComponentChildren {
  return tokens.map((t, i) => {
    switch (t.type) {
      case 'text':
        return <Fragment key={i}>{t.text}</Fragment>;
      case 'br':
        return <br key={i} />;
      case 'bold':
        return (
          <strong key={i}>
            <Tokens tokens={t.children} />
          </strong>
        );
      case 'italic':
        return (
          <em key={i}>
            <Tokens tokens={t.children} />
          </em>
        );
      case 'link':
        // Kept only for addresses on the guide's own sites, path only (D159).
        return /^https?:\/\//.test(t.href) ? (
          <a key={i} href={t.href} target="_blank" rel="noopener noreferrer">
            {t.text}
          </a>
        ) : (
          <Fragment key={i}>{t.text}</Fragment>
        );
    }
  });
}

async function sizeOf(blob: Blob): Promise<{ w: number; h: number }> {
  const bmp = await createImageBitmap(blob);
  const out = { w: bmp.width, h: bmp.height };
  bmp.close();
  return out;
}

export interface PreviewProps {
  guides: Guide[];
  shots: ShotRecord[];
  shotsOn: ReadonlySet<string>;
  name: string;
  /** The date under the title, already formatted. */
  date: string;
  /** Saving the HTML file (a download by default). */
  onDownload?: (fileName: string, html: string) => void;
  /** Printing (window.print by default). */
  onPrint?: () => void;
}

export function Preview({ guides, shots, shotsOn, name, date, onDownload, onPrint }: PreviewProps) {
  const byKey = useMemo(() => new Map(shots.map((x) => [howtoImageKey(x.guideId, x.stepId), x])), [shots]);
  const [choices, setChoices] = useState<Record<string, ShotChoice>>({});
  const [rendered, setRendered] = useState<Record<string, Rendered>>({});
  const [busy, setBusy] = useState(false);
  const live = useRef(rendered);
  live.current = rendered;
  const choice = (key: string) => choices[key] ?? DEFAULT_CHOICE;
  const setChoice = (key: string, patch: Partial<ShotChoice>) => setChoices((c) => ({ ...c, [key]: { ...(c[key] ?? DEFAULT_CHOICE), ...patch } }));
  const numberOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of guides) g.steps.forEach((s, i) => m.set(howtoImageKey(g.id, s.id), i + 1));
    return m;
  }, [guides]);

  // Draws each kept screenshot with its choices; a drawing is reused while its choices stay.
  useEffect(() => {
    let on = true;
    void (async () => {
      for (const [key, x] of byKey) {
        const c = choice(key);
        if (!c.keep) continue;
        const want = optsKey(c, isOldShot(x));
        if (live.current[key]?.opts === want) continue;
        let next: Rendered;
        try {
          const blob = await renderShot(x, { blur: c.blur, zoom: c.zoom && !isOldShot(x), n: numberOf.get(key) });
          next = { opts: want, blob, url: URL.createObjectURL(blob), ...(await sizeOf(blob)) };
        } catch {
          // Not drawn (a canvas without blur, a broken image): left out of the file, and said so.
          next = { opts: want, blob: null, url: null, w: 0, h: 0 };
        }
        if (!on) {
          if (next.url) URL.revokeObjectURL(next.url);
          return;
        }
        setRendered((r) => {
          const old = r[key];
          if (old?.url) URL.revokeObjectURL(old.url);
          return { ...r, [key]: next };
        });
      }
    })();
    return () => {
      on = false;
    };
  }, [byKey, choices]);
  useEffect(() => () => Object.values(live.current).forEach((r) => r.url && URL.revokeObjectURL(r.url)), []);

  const kept = [...byKey.keys()].filter((k) => choice(k).keep);
  const ready = kept.every((k) => rendered[k]?.opts === optsKey(choice(k), isOldShot(byKey.get(k)!)));
  const allBlurred = kept.length > 0 && kept.every((k) => choice(k).blur);
  const left = byKey.size - kept.length;
  const fileName = `${safeFileName(name)}.html`;

  /** The images exactly as shown: the same drawings, as data URLs. */
  const images = async (): Promise<Map<string, HowtoImage>> => {
    const out = new Map<string, HowtoImage>();
    for (const key of kept) {
      const r = rendered[key];
      if (!r?.blob) continue;
      out.set(key, { src: await blobToDataUrl(r.blob), w: r.w, h: r.h });
    }
    return out;
  };

  const download = async () => {
    setBusy(true);
    try {
      const html = howtoHtml(guides, await images(), { date });
      (onDownload ?? ((n, t) => downloadText(n, t, 'text/html')))(fileName, html);
    } finally {
      setBusy(false);
    }
  };

  const print = async () => {
    setBusy(true);
    try {
      // No broken or half-loaded image on paper.
      await Promise.all(Array.from(document.querySelectorAll<HTMLImageElement>('.howto-doc img')).map((img) => img.decode().catch(() => undefined)));
    } finally {
      setBusy(false);
    }
    (onPrint ?? (() => window.print()))();
  };

  const many = guides.length > 1;
  const meta = [stepsLabel(stepCount(guides)), date].filter(Boolean).join(' · ');
  return (
    <div class="howto-preview" data-testid="howto-preview" data-ready={ready ? 'yes' : 'no'}>
      <style>{PRINT_CSS}</style>
      <header class="howto-bar no-print" role="region" aria-label="Preview and export">
        <div class="howto-bar-text">
          <strong>Preview of the printable how-to</strong>
          <span class="howto-muted" data-testid="howto-summary">
            {byKey.size === 0
              ? 'No screenshots.'
              : `${byKey.size} ${byKey.size === 1 ? 'screenshot' : 'screenshots'}${left ? `, ${left} left out` : ''}.`}{' '}
            This is exactly what will be saved. Nothing leaves this computer.
          </span>
        </div>
        {byKey.size > 0 && (
          <label class="howto-check">
            <input
              type="checkbox"
              data-testid="howto-blur-all"
              checked={allBlurred}
              disabled={!kept.length}
              onChange={(e) => {
                const on = (e.target as HTMLInputElement).checked;
                setChoices((c) => Object.fromEntries([...byKey.keys()].map((k) => [k, { ...(c[k] ?? DEFAULT_CHOICE), blur: on }])));
              }}
            />
            Blur every screenshot
          </label>
        )}
        <div class="howto-actions">
          <button type="button" class="howto-btn primary" data-testid="howto-print" disabled={!ready || busy} onClick={() => void print()}>
            <Icon name="download" />
            Save as PDF
          </button>
          <button type="button" class="howto-btn" data-testid="howto-download" disabled={!ready || busy} onClick={() => void download()}>
            <Icon name="download" />
            Download HTML
          </button>
        </div>
      </header>
      {byKey.size > 0 && (
        <p class="howto-note no-print">
          Screenshots can show customer data. Check each one: leave it out, blur it (the highlighted element stays sharp), or zoom to the element. Field text was hidden when it was taken.
        </p>
      )}
      <main class="howto-doc">
        {many && (
          <>
            <h1>Guides</h1>
            <p class="meta">{meta}</p>
          </>
        )}
        {guides.map((g) => {
          const origin = startOrigin(g);
          const pages = stepPageLinks(g);
          const H = many ? 'h2' : 'h1';
          return (
            <section key={g.id}>
              <H>{howtoPlain(g.title, origin)}</H>
              {!many && <p class="meta">{meta}</p>}
              {g.description && <p class="desc">{howtoPlain(g.description, origin)}</p>}
              {origin && (
                <p class="start">
                  Start at{' '}
                  <a href={origin} target="_blank" rel="noopener noreferrer">
                    {origin}
                  </a>
                </p>
              )}
              <ol>
                {g.steps.map((s, i) => {
                  const page = pages[i];
                  const key = howtoImageKey(g.id, s.id);
                  const x = byKey.get(key);
                  const c = choice(key);
                  const r = rendered[key];
                  const n = i + 1;
                  const old = !!x && isOldShot(x);
                  return (
                    <li key={s.id} data-testid={`howto-step-${n}`}>
                      <div class="title">
                        <Tokens tokens={howtoInline(s.title, origin, g.appOrigins)} />
                      </div>
                      {page && (
                        <a class="page" href={page} target="_blank" rel="noopener noreferrer" data-testid={`howto-page-${n}`}>
                          Open this page
                        </a>
                      )}
                      {s.note && (
                        <p class="note">
                          <Tokens tokens={howtoInline(s.note, origin, g.appOrigins)} />
                        </p>
                      )}
                      {x && c.keep && r?.url && (
                        <figure class="shot">
                          <img src={r.url} width={r.w} height={r.h} alt={`Screenshot of step ${n}, with the element to use highlighted`} data-testid={`howto-img-${n}`} />
                        </figure>
                      )}
                      {x && c.keep && r && !r.url && (
                        <p class="howto-warn no-print" data-testid={`howto-failed-${n}`}>
                          This screenshot could not be drawn and is left out.
                        </p>
                      )}
                      {x && (
                        <div class="howto-controls no-print" role="group" aria-label={`Screenshot of step ${n}`}>
                          <button type="button" class="howto-btn sm" data-testid={`howto-keep-${n}`} aria-pressed={!c.keep} onClick={() => setChoice(key, { keep: !c.keep })}>
                            {c.keep ? 'Leave out' : 'Keep'}
                          </button>
                          <label class="howto-check">
                            <input type="checkbox" data-testid={`howto-blurstep-${n}`} checked={c.blur} disabled={!c.keep} onChange={(e) => setChoice(key, { blur: (e.target as HTMLInputElement).checked })} />
                            Blur
                          </label>
                          <label class="howto-check">
                            <input type="checkbox" data-testid={`howto-zoom-${n}`} checked={c.zoom && !old} disabled={!c.keep || old} onChange={(e) => setChoice(key, { zoom: (e.target as HTMLInputElement).checked })} />
                            Zoom to the element
                          </label>
                          {!c.keep && <span class="howto-muted">Left out: this step is text only.</span>}
                        </div>
                      )}
                      {old && (
                        <p class="howto-muted no-print" data-testid={`howto-old-${n}`}>
                          A close-up from an older version of Waymark. For the whole page, use <strong>Capture again</strong> on this step in the editor.
                        </p>
                      )}
                      {!x && shotsOn.has(g.id) && !!s.target && (
                        <p class="howto-muted no-print" data-testid={`howto-missing-${n}`}>
                          <MissingHint />
                        </p>
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>
          );
        })}
        {!guides.length && <p data-testid="howto-empty">These guides are gone. Open the export again from the side panel.</p>}
      </main>
    </div>
  );
}
