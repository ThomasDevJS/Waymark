/**
 * One typed union of runtime messages (SPEC: Architecture, "Messages"; Security).
 * Every request is validated with Zod at the service worker, because content scripts run in
 * pages we do not trust. Each sender type has its own allowlist.
 */
import { z } from 'zod';
import { StepSchema, type Guide, type Step } from '../model/schema';
import type { RecordingState, RecordingView } from '../recorder/session';
import type { GuideIndexEntry } from '../storage/guides';
import type { RunView } from '../player/run';
import type { Problem } from '../storage/problems';
import type { VoiceSettings } from '../voice/voice';

const url = z.string().max(4096);

export const RequestSchemas = {
  // ---- extension pages (side panel, options) ----
  'tab.current': z.object({ windowId: z.number().int().optional(), tabId: z.number().int().optional() }),
  'site.list': z.object({}),
  'site.sync': z.object({}),
  'rec.start': z.object({ tabId: z.number().int(), title: z.string().max(500) }),
  'rec.pause': z.object({}),
  'rec.resume': z.object({}),
  'rec.undo': z.object({}),
  'rec.note': z.object({ title: z.string().max(500), note: z.string().max(5000).optional() }),
  'rec.stop': z.object({}),
  'rec.state': z.object({}),
  'guide.list': z.object({}),
  'run.start': z.object({ tabId: z.number().int(), guideId: z.string().max(64), openStart: z.boolean().optional() }),
  'run.stop': z.object({ tabId: z.number().int() }),
  'run.state': z.object({ tabId: z.number().int() }),
  'problems.list': z.object({}),
  'voice.list': z.object({}),
  'voice.test': z.object({ lang: z.string().max(35).optional() }),
  'voice.settings.get': z.object({}),
  'voice.settings.set': z.object({
    patch: z
      .object({
        autoPlay: z.boolean(),
        rate: z.number().min(0.5).max(2),
        allowOnlineVoices: z.boolean(),
        muted: z.boolean(),
        voices: z.record(z.string().max(35), z.string().max(200)),
      })
      .partial(),
  }),
  // ---- content scripts ----
  'route.report': z.object({
    url,
    via: z.enum(['load', 'navigation-api', 'popstate', 'hashchange', 'poll', 'leaving']),
    navigationType: z.string().max(32).optional(),
    title: z.string().max(500).optional(),
    timeOrigin: z.number().optional(),
  }),
  'guide.forPage': z.object({ url }),
  'frame.nonce': z.object({ selector: z.string().max(2000) }),
  'frame.claim': z.object({ nonce: z.string().max(100) }),
  'frame.path': z.object({}),
  'run.advance': z.object({ stepId: z.string().max(64), op: z.enum(['done', 'next', 'back', 'skip', 'exit']) }),
  'run.match': z.object({
    stepToken: z.string().max(64),
    frameToken: z.string().max(64),
    found: z.boolean(),
    score: z.number().min(0).max(100),
    margin: z.number().min(-100).max(100),
    instance: z.enum(['unique', 'any']),
    pathMatches: z.boolean(),
  }),
  'run.problem': z.object({ stepId: z.string().max(64) }),
  'run.mute': z.object({ muted: z.boolean() }),
  'rec.step': z.discriminatedUnion('op', [
    z.object({ op: z.literal('add'), step: StepSchema }),
    z.object({ op: z.literal('replace'), stepId: z.string().max(64), step: StepSchema }),
  ]),
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
  'rec.start': RecordingState;
  'rec.pause': RecordingState | null;
  'rec.resume': RecordingState | null;
  'rec.undo': RecordingState | null;
  'rec.note': RecordingState | null;
  'rec.stop': { guideId: string; title: string; steps: Step[] } | null;
  'rec.state': RecordingState | null;
  'guide.list': { guides: GuideIndexEntry[] };
  'route.report': { ok: true; recording: RecordingView; run: RunView };
  'run.start': { status: 'started' } | { status: 'needs-start'; startUrl: string; reachable: boolean; pattern: string };
  'run.stop': { ok: boolean };
  'run.state': RunView;
  'run.match': { ok: boolean };
  'run.problem': { ok: boolean };
  'problems.list': { problems: Problem[] };
  'voice.list': { voices: { voiceName: string; lang: string; remote: boolean }[]; available: boolean };
  'voice.test': { ok: boolean };
  'voice.settings.get': VoiceSettings;
  'voice.settings.set': VoiceSettings;
  'run.mute': { ok: boolean };
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
  // Frame winner reports and Report broken step (see docs/DECISIONS.md D26).
  'run.match',
  'run.problem',
  'run.mute', // the tooltip's mute toggle (D38)
  'route.report',
  'guide.forPage',
  // Frame nonce mapping (SPEC: Recorder, "Frames and shadow DOM"); see docs/DECISIONS.md.
  'frame.nonce',
  'frame.claim',
  'frame.path',
]);

/** Extension pages may send everything except content-only reports. */
export const EXTENSION_ALLOWED: ReadonlySet<MessageType> = new Set<MessageType>([
  'tab.current',
  'site.list',
  'site.sync',
  'guide.forPage',
  'guide.list',
  'rec.start',
  'rec.pause',
  'rec.resume',
  'rec.undo',
  'rec.note',
  'rec.stop',
  'rec.state',
  'run.start',
  'run.stop',
  'run.state',
  'problems.list',
  'voice.list',
  'voice.test',
  'voice.settings.get',
  'voice.settings.set',
]);

/** Messages the service worker pushes to content scripts (chrome.tabs.sendMessage). */
export type ContentPush =
  | { type: 'rec.changed'; payload: RecordingView }
  | { type: 'run.changed'; payload: RunView }
  // speechSynthesis fallback where chrome.tts is missing (SPEC: Voiceover)
  | { type: 'tts.content'; payload: { text: string; lang: string; rate: number } }
  | { type: 'tts.stop' };

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
