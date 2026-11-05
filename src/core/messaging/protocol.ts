/**
 * One typed union of runtime messages (SPEC: Architecture, "Messages"; Security).
 * Every request is validated with Zod at the service worker, because content scripts run in
 * pages we do not trust. Each sender type has its own allowlist.
 */
import { z } from 'zod';
import { ElementFingerprintSchema, GuideSchema, MAX_STEPS_PER_GUIDE, StepSchema, type Guide, type Step } from '../model/schema';
import type { TrashItem } from '../storage/trash';
import type { RecordingState, RecordingView } from '../recorder/session';
import type { GuideIndexEntry } from '../storage/guides';
import type { RunView } from '../player/run';
import type { Problem } from '../storage/problems';
import type { VoiceSettings } from '../voice/settings';
import { HD_HOST_PATTERNS, HdStatusSchema, type HdStatus } from '../voice/hd';
import type { TestResult } from '../../background/editor';
import type { StartResult } from '../../background/runs';
import type { LibraryState } from '../../background/discovery';
import type { Conflict } from '../sharing/pack';

const url = z.string().max(4096);

/** A record with at most `max` entries (Zod records have no size limit of their own; D53). */
const boundedRecord = <V extends z.ZodType>(key: z.ZodString, value: V, max: number) =>
  z.record(key, value).refine((o) => Object.keys(o).length <= max, `at most ${max} entries`);

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
  // stepIndex: "Start from step N" (D101); omitted means the first step.
  'run.start': z.object({ tabId: z.number().int(), guideId: z.string().max(64), openStart: z.boolean().optional(), stepIndex: z.number().int().min(0).max(MAX_STEPS_PER_GUIDE - 1).optional() }),
  'run.stop': z.object({ tabId: z.number().int() }),
  'run.state': z.object({ tabId: z.number().int() }),
  'problems.list': z.object({}),
  'problems.clear': z.object({}),
  'guide.get': z.object({ id: z.string().max(64) }),
  'guide.many': z.object({ ids: z.array(z.string().max(64)).max(1000) }),
  'guide.delete': z.object({ id: z.string().max(64) }),
  'guide.duplicate': z.object({ id: z.string().max(64) }),
  // Undo for a deleted guide (D100): restores the copy kept in the trash during the undo window.
  'guide.restore': z.object({ id: z.string().max(64) }),
  'trash.list': z.object({}),
  // The library's completed checkmark (D101).
  'completions.list': z.object({}),
  'pack.check': z.object({ text: z.string().max(6 * 1024 * 1024) }),
  'pack.import': z.object({ text: z.string().max(6 * 1024 * 1024), choices: boundedRecord(z.string().max(64), z.enum(['keep', 'replace', 'both']), 10_000) }),
  'allow.pending': z.object({}),
  'allow.dismiss': z.object({}),
  'site.settings.get': z.object({ origin: z.string().max(500) }),
  'site.settings.set': z.object({ origin: z.string().max(500), launcher: z.boolean() }),
  'library.get': z.object({}),
  'library.set': z.object({ url: z.string().max(2000).nullable() }),
  'library.refresh': z.object({}),
  'site.fetchOnly': z.object({ origin: z.string().max(500), on: z.boolean() }),
  'site.allowed': z.object({ origins: z.array(z.string().max(500)).max(50) }),
  'guide.save': z.object({ guide: GuideSchema, baseRevisionId: z.string().max(64) }),
  'step.test': z.object({ tabId: z.number().int(), step: StepSchema, origins: z.array(z.string().max(500)).max(50) }),
  'pick.start': z.object({ tabId: z.number().int(), origins: z.array(z.string().max(500)).max(50) }),
  'pick.cancel': z.object({ tabId: z.number().int() }),
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
        voices: boundedRecord(z.string().max(35), z.string().max(200), 200),
      })
      .partial(),
  }),
  // HD voice (D51). hd.enable names the download hosts this opt-in newly granted, to release later.
  'hd.status': z.object({}),
  'hd.enable': z.object({ added: z.array(z.enum(HD_HOST_PATTERNS)).max(HD_HOST_PATTERNS.length) }),
  'hd.remove': z.object({}),
  'hd.test': z.object({}),
  // From the offscreen document only (checked by URL in the handler).
  'hd.report': z.object({ status: HdStatusSchema.optional(), played: z.string().max(5000).optional() }),
  // ---- content scripts ----
  'route.report': z.object({
    url,
    via: z.enum(['load', 'navigation-api', 'popstate', 'hashchange', 'poll', 'leaving']),
    navigationType: z.string().max(32).optional(),
    title: z.string().max(500).optional(),
    timeOrigin: z.number().optional(),
    /** When the page saw the change (ms since epoch), for the navigation rule (D67). */
    at: z.number().optional(),
  }),
  'guide.forPage': z.object({ url }),
  'launcher.start': z.object({ guideId: z.string().max(64), openStart: z.boolean().optional() }),
  'deeplink.check': z.object({ guideId: z.string().max(64) }),
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
  'pick.result': z.object({ target: ElementFingerprintSchema, title: z.string().max(500) }),
  'pick.abort': z.object({}),
  'rec.step': z.discriminatedUnion('op', [
    // `at`: when the page saw the action (ms since epoch), for the navigation rule (D67).
    z.object({ op: z.literal('add'), step: StepSchema, at: z.number().optional() }),
    z.object({ op: z.literal('replace'), stepId: z.string().max(64), step: StepSchema, at: z.number().optional() }),
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
  'run.start': StartResult;
  'run.stop': { ok: boolean };
  'run.state': RunView;
  'run.match': { ok: boolean };
  'run.problem': { ok: boolean };
  'problems.list': { problems: Problem[] };
  'problems.clear': { ok: boolean };
  'voice.list': { voices: { voiceName: string; lang: string; remote: boolean }[]; available: boolean };
  'voice.test': { ok: boolean };
  'voice.settings.get': VoiceSettings;
  'voice.settings.set': VoiceSettings;
  'hd.status': HdStatus;
  'hd.enable': HdStatus;
  'hd.remove': HdStatus;
  'hd.test': { ok: boolean };
  'hd.report': { ok: true };
  'run.mute': { ok: boolean };
  'guide.get': Guide;
  'guide.save': Guide;
  'step.test': TestResult;
  'pick.start': { ok: boolean };
  'pick.cancel': { ok: boolean };
  'pick.result': { ok: boolean };
  'pick.abort': { ok: boolean };
  'guide.forPage': { guides: { id: string; title: string }[]; launcher: boolean };
  'launcher.start': StartResult;
  'deeplink.check': { guide: { id: string; title: string } | null };
  'guide.many': { guides: Guide[] };
  'guide.delete': { ok: boolean; undoUntil: number | null };
  'guide.duplicate': Guide;
  'guide.restore': { ok: boolean; error?: string };
  'trash.list': { items: TrashItem[] };
  'completions.list': { completed: Record<string, string> };
  'pack.check': { ok: boolean; error?: string; guides: { id: string; title: string; steps: number }[]; conflicts: Conflict[]; origins: string[] };
  'pack.import': { imported: number; skipped: number };
  'allow.pending': { origins: string[] };
  'allow.dismiss': { ok: boolean };
  'site.settings.get': { launcher: boolean };
  'site.settings.set': { launcher: boolean };
  'library.get': LibraryState;
  'library.set': LibraryState;
  'library.refresh': LibraryState;
  'site.fetchOnly': { ok: true };
  'site.allowed': { registered: string[] };
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
  'pick.result', // Re-pick element, only while the panel asked for a pick (D38)
  'pick.abort', // Esc in the page cancels the pick everywhere (D41)
  'launcher.start', // on-page launcher and deep link: only guides of the sender's origin (D42)
  'deeplink.check',
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
  'guide.list',
  'guide.many',
  'guide.delete',
  'guide.duplicate',
  'guide.restore',
  'trash.list',
  'completions.list',
  'pack.check',
  'pack.import',
  'allow.pending',
  'allow.dismiss',
  'site.settings.get',
  'site.settings.set',
  'library.get',
  'library.set',
  'library.refresh',
  'site.fetchOnly',
  'site.allowed',
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
  'problems.clear',
  'guide.get',
  'guide.save',
  'step.test',
  'pick.start',
  'pick.cancel',
  'voice.list',
  'voice.test',
  'voice.settings.get',
  'voice.settings.set',
  'hd.status',
  'hd.enable',
  'hd.remove',
  'hd.test',
  'hd.report',
]);

/** Messages the service worker pushes to content scripts (chrome.tabs.sendMessage). */
export type ContentPush =
  | { type: 'rec.changed'; payload: RecordingView }
  | { type: 'run.changed'; payload: RunView }
  // speechSynthesis fallback where chrome.tts is missing (SPEC: Voiceover)
  | { type: 'tts.content'; payload: { text: string; lang: string; rate: number } }
  | { type: 'tts.stop' }
  // editor: Test step (answered with a TestResult) and Re-pick element
  | { type: 'test.step'; payload: { step: Step } }
  | { type: 'pick.start' }
  | { type: 'pick.stop' };

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
