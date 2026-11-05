/** Frame winner bookkeeping for one step: each frame's matcher reports; one frame draws. */
import { pickWinnerFrame } from '../matcher/frames';
import type { MatchBoard } from './run';

export interface MatchReport {
  frameToken: string;
  frameId: number;
  stepToken: string;
  found: boolean;
  score: number;
  margin: number;
  instance: 'unique' | 'any';
  pathMatches: boolean;
  /** The reporting document (sender.documentId), when the browser gives one (D84). */
  doc?: string;
}

export function emptyBoard(stepToken: string): MatchBoard {
  return { stepToken, reports: {}, winner: null, topGaveUp: false };
}

/** Records a report and recomputes the winner. A report for an older step starts a fresh board for it. */
export function recordReport(board: MatchBoard | undefined, r: MatchReport): MatchBoard {
  const b = board && board.stepToken === r.stepToken ? board : emptyBoard(r.stepToken);
  // One entry per frame: a frame that reloads (new document, new token) replaces its old entry,
  // so a dead document can never win or tie with its own successor.
  b.reports[String(r.frameId)] = { frameId: r.frameId, token: r.frameToken, found: r.found, score: r.score, margin: r.margin, instance: r.instance, pathMatches: r.pathMatches, ...(r.doc ? { doc: r.doc } : {}) };
  if (r.frameId === 0) b.topGaveUp = !r.found;
  return recomputeWinner(b);
}

export function recomputeWinner(b: MatchBoard): MatchBoard {
  const entries = Object.values(b.reports);
  const winnerFrame = pickWinnerFrame(entries);
  b.winner = winnerFrame === null ? null : (entries.find((v) => v.frameId === winnerFrame && v.found)?.token ?? null);
  return b;
}

/**
 * Frames to ask whether they still exist (D84): with no winner, two or more frames that found the
 * element tie. A frame whose element (iframe) was removed and replaced by a new one (a new frameId)
 * never reports again, so its last report would block the new frame for good.
 */
export function tiedDocs(b: MatchBoard): { key: string; doc: string }[] {
  if (b.winner) return [];
  const found = Object.entries(b.reports).filter(([, v]) => v.found && v.doc);
  return found.length < 2 ? [] : found.map(([key, v]) => ({ key, doc: v.doc! }));
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
