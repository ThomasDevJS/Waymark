import type { KV } from '../frames/registry';

/** chrome.storage.session as a KV. */
export const sessionKV: KV = {
  async get<T>(key: string) {
    const r = await chrome.storage.session.get(key);
    return r[key] as T | undefined;
  },
  async set(key, value) {
    await chrome.storage.session.set({ [key]: value });
  },
  async remove(key) {
    await chrome.storage.session.remove(key);
  },
};
