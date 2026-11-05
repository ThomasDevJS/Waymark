/**
 * The HD voice offscreen document (D51): runs the on-device model and plays its audio. The
 * service worker creates it when HD voice is used and closes it when idle. It talks only to
 * the service worker: requests are checked for target, sender and shape.
 */
import { send } from '../../core/messaging/client';
import type { HdStatus } from '../../core/voice/hd';
import type { Audio, HdEngine } from '../../offscreen/engine';
import { HdPlayer, type AudioSink } from '../../offscreen/player';
import { fromServiceWorker, OffscreenRequestSchema, OFFSCREEN_TARGET, type EngineKind } from '../../offscreen/protocol';

class WebAudioSink implements AudioSink {
  private ctx: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;

  play(audio: Audio, text: string): void {
    this.stop();
    this.ctx ??= new AudioContext();
    if (audio.samples.length) {
      const buffer = this.ctx.createBuffer(1, audio.samples.length, audio.sampleRate);
      buffer.copyToChannel(audio.samples as Float32Array<ArrayBuffer>, 0);
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.ctx.destination);
      source.start();
      this.source = source;
    }
    if (__WAYMARK_TEST__) void send('hd.report', { played: text }).catch(() => undefined);
  }

  stop(): void {
    try {
      this.source?.stop();
    } catch {
      // already stopped
    }
    this.source = null;
  }
}

const sink = new WebAudioSink();
const report = (status: HdStatus) => void send('hd.report', { status }).catch(() => undefined);
const players = new Map<EngineKind, Promise<HdPlayer>>();

async function makeEngine(kind: EngineKind): Promise<HdEngine> {
  if (__WAYMARK_TEST__ && kind === 'stub') {
    const { StubEngine } = await import('../../offscreen/stub');
    return new StubEngine();
  }
  const [{ KokoroEngine }, { loadMisaki }] = await Promise.all([import('../../offscreen/kokoro'), import('../../offscreen/misaki')]);
  return new KokoroEngine(loadMisaki, chrome.runtime.getURL('/ort/'));
}

function player(kind: EngineKind): Promise<HdPlayer> {
  let p = players.get(kind);
  if (!p) {
    p = makeEngine(kind).then((engine) => new HdPlayer(engine, sink, report));
    players.set(kind, p);
  }
  return p;
}

chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
  if ((raw as { target?: unknown } | null)?.target !== OFFSCREEN_TARGET) return false;
  if (!fromServiceWorker(sender, chrome.runtime.id, chrome.runtime.getURL('/background.js'))) return false;
  const parsed = OffscreenRequestSchema.safeParse(raw);
  if (!parsed.success) {
    sendResponse({ ok: false, error: 'bad request' });
    return false;
  }
  const m = parsed.data;
  const reply = (p: Promise<unknown>) => {
    p.then(
      (r) => sendResponse(r ?? { ok: true }),
      (e: unknown) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }),
    );
    return true;
  };
  switch (m.type) {
    case 'hd.download':
      // Progress and the result arrive as hd.report messages.
      void player(m.engine).then((p) => p.download());
      sendResponse({ ok: true });
      return false;
    case 'hd.speak':
      return reply(player(m.engine).then((p) => p.speak(m.token, m.text, m.speed, m.next, m.at)));
    case 'hd.stop':
      for (const p of players.values()) void p.then((pl) => pl.stop(m.at));
      sendResponse({ ok: true });
      return false;
    case 'hd.remove':
      return reply(player(m.engine).then((p) => p.remove()));
  }
});
