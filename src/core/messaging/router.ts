/** Service worker side of the message bus. */
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
        (err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
      );
    return true; // async response
  };
}
