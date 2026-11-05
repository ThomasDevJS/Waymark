/** Service worker side of the message bus. */
import { ZodError } from 'zod';
import {
  parseMessage,
  type MessageType,
  type Reply,
  type RequestOf,
  type ResponseOf,
  type SenderKind,
} from './protocol';

export interface HandlerContext {
  kind: SenderKind;
  sender: chrome.runtime.MessageSender;
  tabId: number | undefined;
  frameId: number | undefined;
}

export type Handlers = {
  [T in MessageType]?: (payload: RequestOf<T>, ctx: HandlerContext) => Promise<ResponseOf<T>> | ResponseOf<T>;
};

/**
 * The text a failed request shows in the panel. Handlers throw sentences meant for the user;
 * a schema failure (a guide that does not validate) becomes one sentence too, never Zod's
 * JSON issue list (D49).
 */
export function errorText(err: unknown): string {
  if (err instanceof ZodError) {
    const where = err.issues[0]?.path.join('.');
    return `Waymark could not use this data${where ? ` (${where} is not valid)` : ''}.`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

export function createRouter(handlers: Handlers, extensionId: string) {
  return (raw: unknown, sender: chrome.runtime.MessageSender, sendResponse: (r: Reply<unknown>) => void): boolean => {
    const parsed = parseMessage(raw, sender, extensionId);
    if (!parsed.ok) {
      sendResponse({ ok: false, error: parsed.error });
      return false;
    }
    const { type, payload } = parsed.envelope;
    const handler = handlers[type] as ((p: unknown, c: HandlerContext) => unknown) | undefined;
    if (!handler) {
      sendResponse({ ok: false, error: `${type} not implemented` });
      return false;
    }
    const ctx: HandlerContext = { kind: parsed.kind, sender, tabId: sender.tab?.id, frameId: sender.frameId };
    Promise.resolve()
      .then(() => handler(payload, ctx))
      .then(
        (data) => sendResponse({ ok: true, data }),
        (err: unknown) => sendResponse({ ok: false, error: errorText(err) }),
      );
    return true; // async response
  };
}
