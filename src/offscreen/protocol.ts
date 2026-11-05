/**
 * Messages from the service worker to the HD voice offscreen document (D47). runtime.sendMessage
 * also reaches extension pages and content scripts can send runtime messages too, so the
 * offscreen document checks the target, the sender (only the service worker) and the shape.
 */
import { z } from 'zod';

export const OFFSCREEN_TARGET = 'waymark-offscreen';

const engine = z.enum(['kokoro', 'stub']);
const text = z.string().min(1).max(5000);
const speed = z.number().min(0.5).max(2);

/**
 * Speak and stop carry the service worker's clock: a stop sent before a speak can arrive after
 * it, and must not cancel the newer step.
 */
export const clock = (): number => performance.timeOrigin + performance.now();

export const OffscreenRequestSchema = z.discriminatedUnion('type', [
  z.object({ target: z.literal(OFFSCREEN_TARGET), type: z.literal('hd.download'), engine }),
  z.object({ target: z.literal(OFFSCREEN_TARGET), type: z.literal('hd.speak'), engine, token: z.string().max(64), text, speed, next: text.nullable(), at: z.number() }),
  z.object({ target: z.literal(OFFSCREEN_TARGET), type: z.literal('hd.stop'), at: z.number() }),
  z.object({ target: z.literal(OFFSCREEN_TARGET), type: z.literal('hd.remove'), engine }),
]);
export type OffscreenRequest = z.infer<typeof OffscreenRequestSchema>;
export type EngineKind = z.infer<typeof engine>;

/** hd.speak answers once playback starts (ok) or the engine fails (the service worker then uses the system voice). */
export type SpeakReply = { ok: true } | { ok: false; error: string };

/** Only the service worker may drive the offscreen document. */
export function fromServiceWorker(sender: { id?: string; url?: string; tab?: unknown }, extensionId: string, workerUrl: string): boolean {
  return sender.id === extensionId && !sender.tab && sender.url === workerUrl;
}
