/**
 * One typed union of runtime messages (SPEC: Architecture, "Messages"; Security).
 * Every request is validated with Zod at the service worker, because content scripts run in
 * pages we do not trust. Each sender type has its own allowlist.
 */
import { z } from 'zod';
import type { Guide } from '../model/schema';

const url = z.string().max(4096);

export const RequestSchemas = {
  // ---- extension pages (side panel, options) ----
  'tab.current': z.object({ windowId: z.number().int().optional() }),
  'site.list': z.object({}),
  'site.sync': z.object({}),
  // ---- content scripts ----
  'route.report': z.object({
    url,
    via: z.enum(['load', 'navigation-api', 'popstate', 'hashchange', 'poll']),
    navigationType: z.string().max(32).optional(),
  }),
  'guide.forPage': z.object({ url }),
  'frame.nonce': z.object({ selector: z.string().max(2000) }),
  'frame.claim': z.object({ nonce: z.string().max(100) }),
  'frame.path': z.object({}),
  'run.advance': z.object({ stepId: z.string().max(64) }),
  'rec.step': z.object({ step: z.unknown() }),
} as const;

export type MessageType = keyof typeof RequestSchemas;
export type RequestOf<T extends MessageType> = z.infer<(typeof RequestSchemas)[T]>;

export interface TabInfo {
  tabId: number | null;
  url: string | null;
  origin: string | null;
  /** True when the origin is an http(s) site Waymark can be granted on. */
  grantable: boolean;
  granted: boolean;
}

export interface ResponseMap {
  'tab.current': TabInfo;
  'site.list': { origins: string[]; registered: string[] };
  'site.sync': { registered: string[] };
  'route.report': { ok: true };
  'guide.forPage': { guides: Guide[] };
  'frame.nonce': { nonce: string };
  'frame.claim': { ok: boolean };
  'frame.path': { framePath: string[] | null };
  'run.advance': { ok: boolean };
  'rec.step': { ok: boolean };
}

export type ResponseOf<T extends MessageType> = ResponseMap[T];

export interface Envelope<T extends MessageType = MessageType> {
  type: T;
  payload: RequestOf<T>;
}

export type Reply<T> = { ok: true; data: T } | { ok: false; error: string };

export type SenderKind = 'extension' | 'content';

/** Content scripts (senders with `sender.tab`) may send only these (SPEC: Security). */
export const CONTENT_ALLOWED: ReadonlySet<MessageType> = new Set<MessageType>([
  'rec.step', // additionally requires the tab to be recording
  'run.advance',
  'route.report',
  'guide.forPage',
  // Frame nonce mapping (SPEC: Recorder, "Frames and shadow DOM"); see docs/DECISIONS.md.
  'frame.nonce',
  'frame.claim',
  'frame.path',
]);

/** Extension pages may send everything except content-only reports. */
export const EXTENSION_ALLOWED: ReadonlySet<MessageType> = new Set<MessageType>(['tab.current', 'site.list', 'site.sync', 'guide.forPage']);

export const ALLOWLIST: Readonly<Record<SenderKind, ReadonlySet<MessageType>>> = {
  extension: EXTENSION_ALLOWED,
  content: CONTENT_ALLOWED,
};

export interface SenderLike {
  id?: string;
  url?: string;
  origin?: string;
  tab?: { id?: number };
  frameId?: number;
}

/**
 * Extension page: same extension id and a URL inside the extension's own origin (works for the
 * side panel and for an options page opened in a tab). Content script: same extension id and a tab.
 */
export function classifySender(sender: SenderLike, extensionId: string): SenderKind | null {
  if (sender.id !== extensionId) return null;
  const extOrigin = `chrome-extension://${extensionId}`;
  if (sender.url && (sender.url === extOrigin || sender.url.startsWith(extOrigin + '/')) && (sender.origin ?? extOrigin) === extOrigin)
    return 'extension';
  if (sender.tab && typeof sender.tab.id === 'number') return 'content';
  return null;
}

export function isMessageType(t: unknown): t is MessageType {
  return typeof t === 'string' && Object.prototype.hasOwnProperty.call(RequestSchemas, t);
}

export type ParsedMessage =
  | { ok: true; kind: SenderKind; envelope: Envelope }
  | { ok: false; error: string };

/** Validates sender, type allowlist and payload. Pure; used by the router and unit tests. */
export function parseMessage(raw: unknown, sender: SenderLike, extensionId: string): ParsedMessage {
  const kind = classifySender(sender, extensionId);
  if (!kind) return { ok: false, error: 'unknown sender' };
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'bad message' };
  const { type, payload } = raw as { type?: unknown; payload?: unknown };
  if (!isMessageType(type)) return { ok: false, error: 'unknown type' };
  if (!ALLOWLIST[kind].has(type)) return { ok: false, error: `${type} not allowed from ${kind}` };
  const parsed = RequestSchemas[type].safeParse(payload ?? {});
  if (!parsed.success) return { ok: false, error: `invalid payload for ${type}` };
  return { ok: true, kind, envelope: { type, payload: parsed.data } as Envelope };
}
