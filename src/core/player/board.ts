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

/** Records a report and recomputes the winner. Returns the updated board (or the old one when stale). */
export function recordReport(board: MatchBoard | undefined, r: MatchReport): MatchBoard {
  const b = board && board.stepToken === r.stepToken ? board : emptyBoard(r.stepToken);
  b.reports[r.frameToken] = { frameId: r.frameId, found: r.found, score: r.score, margin: r.margin, instance: r.instance, pathMatches: r.pathMatches };
  if (r.frameId === 0) b.topGaveUp = !r.found;
  const entries = Object.entries(b.reports);
  const winnerFrame = pickWinnerFrame(entries.map(([, v]) => ({ frameId: v.frameId, found: v.found, score: v.score, margin: v.margin, instance: v.instance, pathMatches: v.pathMatches })));
  b.winner = winnerFrame === null ? null : (entries.find(([, v]) => v.frameId === winnerFrame && v.found)?.[0] ?? null);
  return b;
}
