/**
 * Content script: unlisted (no manifest entry), registered at runtime for granted sites only,
 * in all frames, at document_start. See src/content/main.ts.
 */
import { startContent } from '../content/main';

export default defineUnlistedScript(() => {
  startContent();
});
