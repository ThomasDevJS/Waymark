/**
 * Where step screenshots live (D184): an IndexedDB database of the extension's own origin, one
 * record per guide and step. Never in the guide JSON, never in storage.local or sync, never in a
 * guide file, a pack or the team library. Content scripts cannot open it (it belongs to the
 * extension's origin, not the page's). The service worker writes; the side panel reads it for
 * the export.
 */
import type { Box } from './place';
import type { ShotRef } from './lifecycle';

export const DB_NAME = 'waymark-shots';
export const STORE = 'shots';

/**
 * Records from 0.5.0 have no `v`: a close-up crop around the element (D182). Since D190 (`v: 2`)
 * a record is the whole visible tab. Both render; an old one is marked in the preview and the
 * editor, with Capture again (D196).
 */
export const SHOT_VERSION = 2;

export interface ShotRecord {
  /** `${guideId}/${stepId}` (ids never contain a slash). */
  key: string;
  guideId: string;
  stepId: string;
  /** 2: the whole visible tab (D190); missing: a 0.5.0 crop around the element. */
  v?: number;
  /** WebP, without any highlight drawn on it. */
  blob: Blob;
  w: number;
  h: number;
  /** The element within the image, for the highlight drawn at export time. */
  box: Box;
  /** Image pixels per CSS pixel (D190; sets the light blur's strength, D193). */
  px?: number;
  /** Which element it shows: targetHash of the step's target when it was taken (D185). */
  t: string;
  at: number;
}

export const shotKey = (guideId: string, stepId: string) => `${guideId}/${stepId}`;

export function parseShotKey(key: unknown): { guideId: string; stepId: string } | null {
  if (typeof key !== 'string') return null;
  const i = key.indexOf('/');
  if (i < 1 || i === key.length - 1) return null;
  return { guideId: key.slice(0, i), stepId: key.slice(i + 1) };
}

let opening: Promise<IDBDatabase> | null = null;

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
  });
}

export function openShots(): Promise<IDBDatabase> {
  if (opening) return opening;
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      const store = r.result.createObjectStore(STORE, { keyPath: 'key' });
      store.createIndex('guideId', 'guideId');
    };
    r.onsuccess = () => {
      const db = r.result;
      // Another context deleting or upgrading the database, or the browser closing it (storage
      // pressure, site data cleared): open again next time.
      db.onversionchange = () => {
        db.close();
        opening = null;
      };
      db.onclose = () => {
        opening = null;
      };
      resolve(db);
    };
    r.onerror = () => {
      opening = null;
      reject(r.error ?? new Error('IndexedDB is not available'));
    };
  });
  return opening;
}

export async function putShot(rec: ShotRecord): Promise<void> {
  const db = await openShots();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).put(rec);
  await done(tx);
}

/** A guide's screenshots. */
export async function shotsOf(guideId: string): Promise<ShotRecord[]> {
  const db = await openShots();
  const tx = db.transaction(STORE, 'readonly');
  return req(tx.objectStore(STORE).index('guideId').getAll(guideId) as IDBRequest<ShotRecord[]>);
}

/** A 0.5.0 close-up (D196). */
export const isOldShot = (r: Pick<Partial<ShotRecord>, 'v'>) => r.v !== SHOT_VERSION;

const refOf = (r: Partial<ShotRecord>): ShotRef | null => {
  const k = parseShotKey(r.key);
  return k ? { ...k, ...(typeof r.t === 'string' ? { t: r.t } : {}), ...(isOldShot(r) ? { old: true } : {}) } : null;
};

/** A guide's images as references (the image data itself is never read). */
export async function shotRefsOf(guideId: string): Promise<ShotRef[]> {
  return (await shotsOf(guideId)).map(refOf).filter((x): x is ShotRef => !!x);
}

/** Every stored image as a reference. */
export async function allShotRefs(): Promise<ShotRef[]> {
  const db = await openShots();
  const tx = db.transaction(STORE, 'readonly');
  const all = await req(tx.objectStore(STORE).getAll() as IDBRequest<Partial<ShotRecord>[]>);
  return all.map(refOf).filter((x): x is ShotRef => !!x);
}

export async function deleteShots(keys: { guideId: string; stepId: string }[]): Promise<void> {
  if (!keys.length) return;
  const db = await openShots();
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  for (const k of keys) store.delete(shotKey(k.guideId, k.stepId));
  await done(tx);
}

export async function deleteGuideShots(guideIds: string[]): Promise<void> {
  if (!guideIds.length) return;
  const db = await openShots();
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  const index = store.index('guideId');
  for (const id of guideIds) {
    const keys = await req(index.getAllKeys(id));
    for (const k of keys) store.delete(k);
  }
  await done(tx);
}

export async function clearShots(): Promise<void> {
  const db = await openShots();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).clear();
  await done(tx);
}
