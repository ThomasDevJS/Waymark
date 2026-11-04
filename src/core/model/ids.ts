import { ulid } from 'ulid';

/** New ULID. Used for guide ids, revision ids and step ids. */
export function newId(): string {
  return ulid();
}
