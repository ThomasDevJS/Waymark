/** Sender side of the message bus (side panel and content scripts). */
import type { MessageType, Reply, RequestOf, ResponseOf } from './protocol';

export class MessageError extends Error {}

export async function send<T extends MessageType>(type: T, payload: RequestOf<T>): Promise<ResponseOf<T>> {
  const reply = (await chrome.runtime.sendMessage({ type, payload })) as Reply<ResponseOf<T>> | undefined;
  if (!reply) throw new MessageError(`no reply to ${type}`);
  if (!reply.ok) throw new MessageError(reply.error);
  return reply.data;
}
