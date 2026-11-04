/**
 * Export review (SPEC: Sharing, "Before export, show a review of everything the pack contains
 * (titles, notes, labels, URLs), so the author can remove business data").
 */
import type { Guide, Step } from '../model/schema';

export type StringKind = 'guide-title' | 'description' | 'tag' | 'url' | 'step-title' | 'note' | 'voice' | 'label' | 'link';

export interface PackString {
  /** Stable key: guideId|stepId|field */
  key: string;
  guideId: string;
  stepIndex: number | null;
  kind: StringKind;
  field: string;
  value: string;
  /** Can be removed from the exported copy without breaking it (titles and URLs cannot). */
  removable: boolean;
}

const LABEL_FIELDS = ['accessibleName', 'text', 'placeholder', 'name', 'value', 'id'] as const;

export function packStrings(guides: Guide[]): PackString[] {
  const out: PackString[] = [];
  const push = (g: Guide, stepIndex: number | null, kind: StringKind, field: string, value: string | undefined, removable: boolean, stepId = '') => {
    if (value) out.push({ key: `${g.id}|${stepId}|${field}`, guideId: g.id, stepIndex, kind, field, value, removable });
  };
  for (const g of guides) {
    push(g, null, 'guide-title', 'title', g.title, false);
    push(g, null, 'description', 'description', g.description, true);
    g.tags.forEach((t, i) => push(g, null, 'tag', `tags.${i}`, t, true));
    push(g, null, 'url', 'startUrl', g.startUrl, false);
    g.steps.forEach((s: Step, i) => {
      push(g, i, 'step-title', 'title', s.title, false, s.id);
      push(g, i, 'url', 'url', s.url.value, false, s.id);
      push(g, i, 'note', 'note', s.note, true, s.id);
      push(g, i, 'voice', 'voiceText', s.voiceText, true, s.id);
      const t = s.target as Record<string, unknown> | undefined;
      if (t) {
        for (const f of LABEL_FIELDS) push(g, i, 'label', `target.${f}`, typeof t[f] === 'string' ? (t[f] as string) : undefined, true, s.id);
        push(g, i, 'link', 'target.hrefPath', s.target?.hrefPath, true, s.id);
        s.target?.ancestors.forEach((a, j) => push(g, i, 'label', `target.ancestors.${j}.label`, a.label, true, s.id));
      }
    });
  }
  return out;
}

/** The exported copy with the chosen strings removed. The local guides are not changed. */
export function applyRemovals(guides: Guide[], removed: Set<string>): Guide[] {
  return guides.map((g) => {
    const copy = structuredClone(g);
    const has = (stepId: string, field: string) => removed.has(`${g.id}|${stepId}|${field}`);
    if (has('', 'description')) delete copy.description;
    copy.tags = copy.tags.filter((_, i) => !has('', `tags.${i}`));
    for (const s of copy.steps) {
      if (has(s.id, 'note')) delete s.note;
      if (has(s.id, 'voiceText')) delete s.voiceText;
      const t = s.target as (Record<string, unknown> & NonNullable<Step['target']>) | undefined;
      if (!t) continue;
      for (const f of LABEL_FIELDS) if (has(s.id, `target.${f}`)) delete t[f];
      if (has(s.id, 'target.hrefPath')) delete t.hrefPath;
      t.ancestors = t.ancestors.map((a, j) => {
        if (!has(s.id, `target.ancestors.${j}.label`)) return a;
        const { label: _label, ...rest } = a;
        return rest;
      });
    }
    return copy;
  });
}
