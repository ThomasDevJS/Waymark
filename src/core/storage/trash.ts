/**
 * Undo for deleted guides (D100). A delete removes the guide at once and keeps a copy in
 * storage.local under TRASH_KEY, so Undo works from any panel, even one opened after the panel
 * that deleted it closed. Entries are dropped once the undo window is over.
 */
import { GuideSchema, type Guide } from '../model/schema';

export const TRASH_KEY = 'guides:trash';
/** How long the Undo toast shows, and how long a deleted guide can be restored. */
export const UNDO_MS = 8000;
/** A little slack for a panel whose toast started late (a slow message round trip). */
export const RESTORE_GRACE_MS = 2000;
/** Deleting many guides quickly never grows the trash without bound. */
export const MAX_TRASH = 20;

export interface TrashEntry {
  guide: Guide;
  deletedAt: number;
}

/** What the panel needs to show the toast again: never the whole guide. */
export interface TrashItem {
  id: string;
  title: string;
  deletedAt: number;
  undoUntil: number;
}

/** Entries still inside the undo window (plus grace), newest last, valid guides only. */
export function liveTrash(raw: unknown, now: number): TrashEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: TrashEntry[] = [];
  for (const e of raw as Partial<TrashEntry>[]) {
    if (!e || typeof e.deletedAt !== 'number' || now - e.deletedAt > UNDO_MS + RESTORE_GRACE_MS || e.deletedAt > now + 60_000) continue;
    const g = GuideSchema.safeParse(e.guide);
    if (g.success) out.push({ guide: g.data, deletedAt: e.deletedAt });
  }
  return out.slice(-MAX_TRASH);
}

/** The trash after deleting `guides` now. A guide deleted again replaces its older entry. */
export function addToTrash(entries: TrashEntry[], guides: Guide[], now: number): TrashEntry[] {
  const ids = new Set(guides.map((g) => g.id));
  return [...entries.filter((e) => !ids.has(e.guide.id)), ...guides.map((guide) => ({ guide, deletedAt: now }))].slice(-MAX_TRASH);
}

/** True when the stored trash holds entries that are over (or junk): it should be rewritten. */
export function trashIsStale(raw: unknown, now: number): boolean {
  return Array.isArray(raw) && liveTrash(raw, now).length !== raw.length;
}

export function trashItems(entries: TrashEntry[]): TrashItem[] {
  return entries.map((e) => ({ id: e.guide.id, title: e.guide.title, deletedAt: e.deletedAt, undoUntil: e.deletedAt + UNDO_MS }));
}
