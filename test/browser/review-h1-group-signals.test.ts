/**
 * Review H1 (docs/DECISIONS.md, "Review fixes (PR #1)"): group-level signals (a shared `name`,
 * a link back to the page) never make look-alikes interchangeable. Every scenario runs on an
 * unchanged page: find the recorded element or say not-found, never spotlight its look-alike.
 */
import { describe, expect, it } from 'vitest';
import { buildFingerprint } from '../../src/core/fingerprint';
import { matchOnce } from '../../src/core/matcher';
import { $, html, recordAndReplay, useRoot } from './markup';

useRoot();

describe('H1: accessible names like browsers compute them', () => {
  it('icon links labelled only by title: recording Edit finds Edit, not Delete', () => {
    html(`<div class="actions">
      <a href="#" class="icon" title="Delete"><span aria-hidden="true">x</span></a>
      <a href="#" class="icon" title="Edit"><span aria-hidden="true">e</span></a>
    </div>`);
    const edit = $('a[title=Edit]');
    const { fp, r } = recordAndReplay(edit);
    expect(r).toMatchObject({ status: 'found', element: edit, tied: [edit] });
    expect(fp.instance).toBe('unique');
    expect(fp.accessibleName).toBe('Edit');
    expect(fp.hrefPath).toBeUndefined(); // "#" points back to the page: no identity
  });

  it('links labelled only by an <img alt>: recording Edit finds Edit, not Delete', () => {
    html(`<div class="actions">
      <a href="#" class="icon"><img alt="Delete" width="16" height="16"></a>
      <a href="#" class="icon"><img alt="Edit" width="16" height="16"></a>
    </div>`);
    const edit = $('a:has(img[alt=Edit])');
    const { fp, r } = recordAndReplay(edit);
    expect(r).toMatchObject({ status: 'found', element: edit, tied: [edit] });
    expect(fp.instance).toBe('unique');
    expect(fp.accessibleName).toBe('Edit');
  });

  it('image inputs and buttons holding only an image are named by alt', () => {
    html(`<input type="image" alt="Zoom in" width="16" height="16"><input type="image" alt="Zoom out" width="16" height="16">
          <button class="b"><img alt="Undo" width="16" height="16"></button><button class="b"><img alt="Redo" width="16" height="16"></button>`);
    for (const el of [$('input[alt="Zoom out"]'), $('button:has(img[alt=Redo])')]) {
      const { fp, r } = recordAndReplay(el);
      expect(r).toMatchObject({ status: 'found', element: el, tied: [el] });
      expect(fp.instance).toBe('unique');
    }
    expect(buildFingerprint($('input[alt="Zoom out"]')).accessibleName).toBe('Zoom out');
    expect(buildFingerprint($('button:has(img[alt=Redo])')).accessibleName).toBe('Redo');
  });

  it('title is the last fallback for any element, and never overrides visible text', () => {
    html(`<button title="Saves the draft">Save</button><div role="button" tabindex="0" title="Close panel">&nbsp;</div>`);
    const save = buildFingerprint($('button'));
    expect(save.accessibleName).toBeUndefined(); // the visible text "Save" is the name: the text signal
    expect(save.text).toBe('Save');
    expect(buildFingerprint($('[role=button]')).accessibleName).toBe('Close panel');
  });
});

describe('H1: name and link path are not identities for a group', () => {
  it('unlabeled radios sharing name="plan": recording Yearly finds Yearly, not Monthly', () => {
    html(`<fieldset class="cycle">
      <input type="radio" name="plan" value="monthly"> <span>Monthly</span>
      <input type="radio" name="plan" value="yearly"> <span>Yearly</span>
    </fieldset>`);
    const yearly = $('input[value=yearly]');
    const { fp, r } = recordAndReplay(yearly);
    expect(r).toMatchObject({ status: 'found', element: yearly, tied: [yearly] });
    expect(fp.instance).toBe('unique');
    expect(fp.name).toBe('plan');
    expect(fp.value).toBe('yearly');
  });

  it('Rails submit inputs sharing name="commit": recording Publish finds Publish, not Delete draft', () => {
    html(`<form class="post"><input type="submit" name="commit" value="Delete draft"><input type="submit" name="commit" value="Publish"></form>`);
    const publish = $('input[value=Publish]');
    const { fp, r } = recordAndReplay(publish);
    expect(r).toMatchObject({ status: 'found', element: publish, tied: [publish] });
    expect(fp.instance).toBe('unique');
    expect(fp.accessibleName).toBe('Publish');
  });

  it("a group that shares only a name or a link path is not instance 'any': not-found, not the first one", () => {
    html(`<div class="row"><input type="checkbox" name="agree"></div><div class="row"><input type="checkbox" name="agree"></div>
          <nav><a href="/help" class="i"><span aria-hidden="true">?</span></a><a href="/help" class="i"><span aria-hidden="true">?</span></a></nav>`);
    for (const el of [$('.row:nth-child(2) input'), $('nav a:nth-child(2)')]) {
      const { fp, r } = recordAndReplay(el);
      expect(r.status).toBe('not-found');
      expect(fp.instance).toBe('unique');
      expect(fp.matchCount).toBe(2);
    }
  });

  it("an imported 'any' fingerprint whose group shares only group-level signals is not spotlighted", () => {
    html(`<fieldset class="cycle">
      <input type="radio" name="plan" value="monthly"> <span>Monthly</span>
      <input type="radio" name="plan" value="yearly"> <span>Yearly</span>
    </fieldset>`);
    const fp = buildFingerprint($('input[value=yearly]'));
    // A crafted or older fingerprint: the shared name only, claiming 'any'.
    const { value: _value, ...rest } = fp;
    const r = matchOnce(document, { ...rest, instance: 'any', matchCount: 2 });
    expect(r.status).toBe('not-found');
  });

  it("repeated elements that share their text still record as 'any', and any of them counts", () => {
    html(`<ul><li><button class="e">Edit</button></li><li><button class="e">Edit</button></li></ul>`);
    const { fp, r } = recordAndReplay($('li:nth-child(2) button'));
    expect(fp.instance).toBe('any');
    expect(r.status === 'found' && r.tied.length).toBe(2);
  });
});
