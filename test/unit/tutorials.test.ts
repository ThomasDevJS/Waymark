/** Built-in tutorials (D128, D129): the bundled pack, the Practice page's run loop, copies and voice. */
import { describe, expect, it } from 'vitest';
import raw from '../../src/core/tutorials/pack.json';
import { TUTORIALS, TutorialPackSchema, toStep, tutorialAsGuide, tutorialById, tutorialVoiceText } from '../../src/core/tutorials/tutorials';
import { applyOp, startTutorial, tutorialView } from '../../src/core/tutorials/runner';
import { GuideSchema, StepSchema } from '../../src/core/model/schema';
import { CONTENT_ALLOWED, EXTENSION_ALLOWED, parseMessage } from '../../src/core/messaging/protocol';

describe('the bundled pack', () => {
  it('is valid and has the five tutorials, short and in order', () => {
    expect(TutorialPackSchema.safeParse(raw).success).toBe(true);
    expect(TUTORIALS.map((t) => t.id)).toEqual(['tour', 'record', 'edit', 'share', 'warnings']);
    for (const t of TUTORIALS) {
      expect(t.steps.length).toBeGreaterThanOrEqual(5);
      expect(t.steps.length).toBeLessThanOrEqual(8);
      for (const s of t.steps) expect(StepSchema.safeParse(toStep(s)).success).toBe(true);
    }
  });

  it('refuses a pack whose action step has nothing to act on, or with duplicate ids', () => {
    const bad = structuredClone(raw) as { tutorials: { steps: { target?: string; id: string }[] }[] };
    delete bad.tutorials[0]!.steps[1]!.target;
    expect(TutorialPackSchema.safeParse(bad).success).toBe(false);
    const dup = structuredClone(raw) as { tutorials: { steps: { id: string }[] }[] };
    dup.tutorials[1]!.steps[0]!.id = dup.tutorials[0]!.steps[0]!.id;
    expect(TutorialPackSchema.safeParse(dup).success).toBe(false);
  });
});

describe('run loop', () => {
  const tour = tutorialById('tour')!;
  it('moves on, back, finishes and exits; a new rev on every change', () => {
    let r = startTutorial(tour);
    expect(tutorialView(r)).toMatchObject({ status: 'running', stepIndex: 0, total: tour.steps.length, guideTitle: 'How Waymark works' });
    expect(applyOp(r, 'back')).toBe(r); // nothing before step 1
    r = applyOp(r, 'next');
    expect(r.stepIndex).toBe(1);
    const token = tutorialView(r).stepToken;
    r = applyOp(r, 'retry');
    expect(r.stepIndex).toBe(1);
    expect(tutorialView(r).stepToken).not.toBe(token);
    for (let i = 1; i < tour.steps.length; i++) r = applyOp(r, 'skip');
    expect(r.status).toBe('finished');
    expect(tutorialView(r)).toMatchObject({ status: 'finished', step: null });
    expect(applyOp(r, 'next')).toBe(r);
    expect(applyOp(r, 'exit').status).toBe('exited');
    expect(applyOp(r, 'restart')).toMatchObject({ status: 'running', stepIndex: 0 });
  });
  it('note steps always move on with Next', () => {
    expect(toStep({ id: 'x', kind: 'note', title: 'T', advance: 'action' }).advance).toBe('next');
  });
});

describe('copy to my guides', () => {
  it('makes a valid local guide on the page’s site, all note steps, no targets, new ids', () => {
    const t = tutorialById('record')!;
    const g = tutorialAsGuide(t, 'https://app.example.com/invoices/42?x=1#y');
    expect(GuideSchema.safeParse(g).success).toBe(true);
    expect(g).toMatchObject({ appOrigins: ['https://app.example.com'], startUrl: 'https://app.example.com/invoices/42', source: 'local', title: 'Draft: Record your first guide' });
    expect(g.steps.every((s) => s.kind === 'note' && !s.target && s.advance === 'next')).toBe(true);
    // A first note says what the draft is, so practice-page text never reads as instructions for the real app.
    expect(g.steps[0]!.title).toBe('About this draft');
    expect(g.steps.slice(1).map((s) => s.title)).toEqual(t.steps.map((s) => s.title));
    expect(g.steps.some((s) => t.steps.some((x) => x.id === s.id))).toBe(false);
  });
  it('refuses a page that is not a web page', () => {
    expect(() => tutorialAsGuide(TUTORIALS[0]!, 'chrome-extension://abc/practice.html')).toThrow(/web app/);
  });
});

describe('voice text and messages (D129)', () => {
  it('reads only bundled text, by id', () => {
    expect(tutorialVoiceText('tour', 'tour-1')).toMatch(/^Welcome to the tutorial page/);
    expect(tutorialVoiceText('tour', 'tour-2')).toBe('Click New invoice. The bright frame shows where to act. Click it yourself: the guide moves on when you do.');
    expect(tutorialVoiceText('tour', 'nope')).toBeNull();
    expect(tutorialVoiceText('nope', 'tour-1')).toBeNull();
  });
  it('tutorial.* is for extension pages only, and takes ids, never text', () => {
    expect(EXTENSION_ALLOWED.has('tutorial.speak')).toBe(true);
    expect(EXTENSION_ALLOWED.has('tutorial.stop')).toBe(true);
    expect(CONTENT_ALLOWED.has('tutorial.speak')).toBe(false);
    const ext = { id: 'E', url: 'chrome-extension://E/practice.html' };
    const content = { id: 'E', url: 'https://evil.example/', tab: { id: 3 } };
    expect(parseMessage({ type: 'tutorial.speak', payload: { tutorialId: 'tour', stepId: 'tour-1' } }, content, 'E')).toEqual({ ok: false, error: 'tutorial.speak not allowed from content' });
    const ok = parseMessage({ type: 'tutorial.speak', payload: { tutorialId: 'tour', stepId: 'tour-1', text: 'Say this' } }, ext, 'E');
    expect(ok.ok && ok.envelope.payload).toEqual({ tutorialId: 'tour', stepId: 'tour-1' });
    expect(parseMessage({ type: 'tutorial.speak', payload: { tutorialId: '../x', stepId: 'tour-1' } }, ext, 'E').ok).toBe(false);
  });
});
