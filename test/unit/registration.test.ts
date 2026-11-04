import { describe, expect, it } from 'vitest';
import { CONTENT_SCRIPT_ID, grantedSitePatterns, syncRegistrations, type RegistrationApi } from '../../src/core/permissions/registration';

function fakeApi(origins: string[]) {
  const regs = new Map<string, chrome.scripting.RegisteredContentScript>();
  const calls: string[] = [];
  const api: RegistrationApi = {
    permissions: { getAll: async () => ({ origins }) },
    scripting: {
      getRegisteredContentScripts: async (f) => [...regs.values()].filter((r) => !f?.ids || f.ids.includes(r.id)),
      registerContentScripts: async (s) => {
        calls.push('register');
        s.forEach((r) => regs.set(r.id, r));
      },
      updateContentScripts: async (s) => {
        calls.push('update');
        s.forEach((r) => regs.set(r.id, { ...regs.get(r.id)!, ...r }));
      },
      unregisterContentScripts: async (f) => {
        calls.push('unregister');
        (f?.ids ?? [...regs.keys()]).forEach((id) => regs.delete(id));
      },
    },
  };
  return { api, regs, calls, setOrigins: (o: string[]) => (origins = o) };
}

describe('syncRegistrations', () => {
  it('registers only granted sites, with the spec options', async () => {
    const f = fakeApi(['https://b.test/*', 'https://a.test/*', 'chrome://favicon/*']);
    expect(await syncRegistrations(f.api)).toEqual(['https://a.test/*', 'https://b.test/*']);
    expect(f.regs.get(CONTENT_SCRIPT_ID)).toMatchObject({ allFrames: true, matchOriginAsFallback: true, runAt: 'document_start', matches: ['https://a.test/*', 'https://b.test/*'] });
  });
  it('updates on change, does nothing when in sync, unregisters when nothing is granted', async () => {
    const f = fakeApi(['https://a.test/*']);
    await syncRegistrations(f.api);
    await syncRegistrations(f.api);
    expect(f.calls).toEqual(['register']);
    f.setOrigins(['https://a.test/*', 'https://c.test/*']);
    await syncRegistrations(f.api);
    expect(f.calls).toEqual(['register', 'update']);
    expect(f.regs.get(CONTENT_SCRIPT_ID)!.matches).toEqual(['https://a.test/*', 'https://c.test/*']);
    f.setOrigins([]);
    expect(await syncRegistrations(f.api)).toEqual([]);
    expect(f.regs.size).toBe(0);
  });
  it('filters non-site origins', () => {
    expect(grantedSitePatterns(['http://x/*', 'http://x/*', 'file:///*'])).toEqual(['http://x/*']);
  });
});
