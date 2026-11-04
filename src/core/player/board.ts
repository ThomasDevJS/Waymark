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
}

export function emptyBoard(stepToken: string): MatchBoard {
  return { stepToken, reports: {}, winner: null, topGaveUp: false };
}

/** Records a report and recomputes the winner. A report for an older step starts a fresh board for it. */
export function recordReport(board: MatchBoard | undefined, r: MatchReport): MatchBoard {
  const b = board && board.stepToken === r.stepToken ? board : emptyBoard(r.stepToken);
  // One entry per frame: a frame that reloads (new document, new token) replaces its old entry,
  // so a dead document can never win or tie with its own successor.
  b.reports[String(r.frameId)] = { frameId: r.frameId, token: r.frameToken, found: r.found, score: r.score, margin: r.margin, instance: r.instance, pathMatches: r.pathMatches };
  if (r.frameId === 0) b.topGaveUp = !r.found;
  const entries = Object.values(b.reports);
  const winnerFrame = pickWinnerFrame(entries);
  b.winner = winnerFrame === null ? null : (entries.find((v) => v.frameId === winnerFrame && v.found)?.token ?? null);
  return b;
}
