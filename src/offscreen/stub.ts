/**
 * A stand-in engine for test builds (never in production): e2e tests and CI must not download
 * the model. It "downloads" in a few steps and makes short silent clips. A text containing
 * STUB-FAIL fails, and STUB-SLOW takes longer than the service worker waits.
 */
import { HD_TOTAL_BYTES } from '../core/voice/hd';
import type { Audio, HdEngine } from './engine';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class StubEngine implements HdEngine {
  async download(onProgress: (loaded: number, total: number) => void): Promise<void> {
    for (let i = 1; i <= 4; i++) {
      await wait(100);
      onProgress((HD_TOTAL_BYTES * i) / 4, HD_TOTAL_BYTES);
    }
  }
  async load(): Promise<void> {}
  async synth(text: string): Promise<Audio> {
    if (text.includes('STUB-FAIL')) throw new Error('stub engine failure');
    await wait(text.includes('STUB-SLOW') ? 6000 : 20);
    return { samples: new Float32Array(Math.max(2400, text.length * 1200)), sampleRate: 24000 };
  }
  async remove(): Promise<void> {}
}
