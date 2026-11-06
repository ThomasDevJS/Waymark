/** Frame winner bookkeeping for one step: each frame's matcher reports; one frame draws. */
import { pickWinnerFrame } from '../matcher/frames';
import type { MatchBoard } from './run';
import { newId } from '../model/ids';

export interface MatchReport {
  frameToken: string;
  frameId: number;
  stepToken: string;
  found: boolean;
  score: number;
  margin: number;
  instance: 'unique' | 'any';
  pathMatches: boolean;
  /** Strong signals the match used (D211). */
  strong?: number;
  /** The reporting document (sender.documentId), when the browser gives one (D84). */
  doc?: string;
}

export function emptyBoard(stepToken: string): MatchBoard {
  return { stepToken, reports: {}, winner: null, topGaveUp: false, id: newId() };
}

/** Records a report and recomputes the winner. A report for an older step starts a fresh board for it. */
export function recordReport(board: MatchBoard | undefined, r: MatchReport): MatchBoard {
  const b = board && board.stepToken === r.stepToken ? board : emptyBoard(r.stepToken);
  // One entry per frame: a frame that reloads (new document, new token) replaces its old entry,
  // so a dead document can never win or tie with its own successor.
  b.reports[String(r.frameId)] = { frameId: r.frameId, token: r.frameToken, found: r.found, score: r.score, margin: r.margin, instance: r.instance, pathMatches: r.pathMatches, ...(r.strong !== undefined ? { strong: r.strong } : {}), ...(r.doc ? { doc: r.doc } : {}) };
  if (r.frameId === 0) b.topGaveUp = !r.found;
  return recomputeWinner(b);
}

export function recomputeWinner(b: MatchBoard): MatchBoard {
  const entries = Object.values(b.reports);
  const winnerFrame = pickWinnerFrame(entries);
  b.winner = winnerFrame === null ? null : (entries.find((v) => v.frameId === winnerFrame && v.found)?.token ?? null);
  return b;
}

/** A document is asked again at most this often (D84). */
export const CHECK_GAP_MS = 1000;

/**
 * Frames to ask whether they still exist (D84): two or more frames found the element, so a frame
 * whose iframe was removed and replaced (a new frameId) may tie with its successor, or win alone
 * (instance 'any' ties go to the lower frameId). It never reports again, so its last report would
 * block the live frame for good. Documents asked in the last CHECK_GAP_MS are left out.
 */
export function docsToCheck(b: MatchBoard, now: number): { key: string; doc: string }[] {
  const found = Object.entries(b.reports).filter(([, v]) => v.found && v.doc);
  if (found.length < 2) return [];
  return found.filter(([, v]) => !(b.checked?.[v.doc!] !== undefined && now - b.checked[v.doc!]! < CHECK_GAP_MS)).map(([key, v]) => ({ key, doc: v.doc! }));
}

/** Remembers when documents were asked, so a burst of reports asks each once. */
export function markChecked(b: MatchBoard, docs: { doc: string }[], now: number): void {
  b.checked = { ...(b.checked ?? {}) };
  for (const d of docs) b.checked[d.doc] = now;
}

/** Drops every report of a document that said it is leaving (pagehide). */
export function dropDoc(b: MatchBoard, doc: string): boolean {
  const gone = Object.entries(b.reports).filter(([, v]) => v.doc === doc).map(([key]) => ({ key, doc }));
  return dropGone(b, gone);
}

/** Drops the reports of documents that are gone, if they are still the same documents. */
export function dropGone(b: MatchBoard, gone: { key: string; doc: string }[]): boolean {
  let changed = false;
  for (const g of gone) {
    if (b.reports[g.key]?.doc === g.doc) {
      delete b.reports[g.key];
      changed = true;
    }
  }
  if (changed) recomputeWinner(b);
  return changed;
}
