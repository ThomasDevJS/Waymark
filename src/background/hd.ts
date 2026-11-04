/**
 * HD voice, service worker side (D47). The model runs in an offscreen document that this
 * creates on demand and closes when idle. State lives in chrome.storage, never in memory:
 * the status in local storage, the hosts to release in session storage.
 */
import { enqueue } from '../core/storage/queue';
import { HD_HOST_PATTERNS, HD_IDLE_MINUTES, HD_OFF, HD_WAIT_MS, HdStatusSchema, type HdStatus } from '../core/voice/hd';
import { clock, OFFSCREEN_TARGET, type EngineKind, type OffscreenRequest, type SpeakReply } from '../offscreen/protocol';

const STATUS_KEY = 'hdStatus';
/** Download hosts this opt-in granted; released when the download ends. */
const RELEASE_KEY = 'hdReleaseHosts';
export const HD_IDLE_ALARM = 'hd-idle';
const OFFSCREEN_URL = 'offscreen.html';
/** Test builds only: e2e tests log what the stub engine played. */
export const HD_TEST_LOG = 'test:hdPlayed';

export async function getHdStatus(): Promise<HdStatus> {
  const raw = (await chrome.storage.local.get(STATUS_KEY))[STATUS_KEY];
  const parsed = HdStatusSchema.safeParse(raw ?? HD_OFF);
  return parsed.success ? parsed.data : HD_OFF;
}

function setHdStatus(status: HdStatus): Promise<void> {
  return chrome.storage.local.set({ [STATUS_KEY]: status });
}

/** The status for Settings. A download that lost its offscreen document (browser closed) is an error. */
export async function hdStatusForSettings(): Promise<HdStatus> {
  const status = await getHdStatus();
  if ((status.state === 'downloading' || status.state === 'checking') && !(await hasOffscreen())) {
    const failed: HdStatus = { ...HD_OFF, state: 'error', message: 'The download stopped. Try again.' };
    await setHdStatus(failed);
    await releaseHosts();
    return failed;
  }
  return status;
}

async function engineKind(): Promise<EngineKind> {
  if (__WAYMARK_TEST__ && (await chrome.storage.local.get('test:hdStub'))['test:hdStub']) return 'stub';
  return 'kokoro';
}

function hasOffscreen(): Promise<boolean> {
  return chrome.offscreen?.hasDocument?.() ?? Promise.resolve(false);
}

async function ensureOffscreen(): Promise<void> {
  if (await hasOffscreen()) return;
  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      // WORKERS too: with AUDIO_PLAYBACK alone, Chrome closes the document 30 s after audio stops.
      reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK, chrome.offscreen.Reason.WORKERS],
      justification: 'Runs the optional on-device HD voice model (WebAssembly worker threads) and plays its audio.',
    });
  } catch (e) {
    // Two callers raced; one document is all we need.
    if (!(await hasOffscreen())) throw e;
  }
}

async function closeOffscreen(): Promise<void> {
  if (await hasOffscreen()) await chrome.offscreen.closeDocument().catch(() => undefined);
}

type Untargeted<M> = M extends unknown ? Omit<M, 'target'> : never;

function toOffscreen<T>(msg: Untargeted<OffscreenRequest>): Promise<T> {
  return chrome.runtime.sendMessage({ target: OFFSCREEN_TARGET, ...msg }) as Promise<T>;
}

async function releaseHosts(): Promise<void> {
  const hosts = ((await chrome.storage.session.get(RELEASE_KEY))[RELEASE_KEY] as string[] | undefined) ?? [];
  if (!hosts.length) return;
  await chrome.storage.session.remove(RELEASE_KEY);
  await chrome.permissions.remove({ origins: hosts }).catch(() => undefined);
}

/** Settings turned HD voice on: the options page has already asked for the download hosts. */
export async function hdEnable(added: string[]): Promise<HdStatus> {
  const own = added.filter((h) => (HD_HOST_PATTERNS as readonly string[]).includes(h));
  const status: HdStatus = { ...HD_OFF, state: 'downloading' };
  await enqueue(async () => {
    const prev = ((await chrome.storage.session.get(RELEASE_KEY))[RELEASE_KEY] as string[] | undefined) ?? [];
    await chrome.storage.session.set({ [RELEASE_KEY]: [...new Set([...prev, ...own])] });
    await setHdStatus(status);
  });
  await ensureOffscreen();
  await toOffscreen({ type: 'hd.download', engine: await engineKind() });
  return status;
}

/** A report from the offscreen document: progress, the result, or (in tests) what played. */
export async function onHdReport(report: { status?: HdStatus; played?: string }): Promise<void> {
  if (__WAYMARK_TEST__ && report.played !== undefined) {
    const played = report.played;
    await enqueue(async () => {
      const log = ((await chrome.storage.session.get(HD_TEST_LOG))[HD_TEST_LOG] as string[] | undefined) ?? [];
      await chrome.storage.session.set({ [HD_TEST_LOG]: [...log, played] });
    });
  }
  const status = report.status;
  if (!status) return;
  const stored = await enqueue(async () => {
    // A late progress report must not undo Remove.
    if ((await getHdStatus()).state === 'off' && status.state !== 'off') return false;
    await setHdStatus(status);
    return true;
  });
  if (stored && status.state !== 'downloading' && status.state !== 'checking') await releaseHosts();
}

/** Remove HD voice: delete the cached model, close the document, release the hosts. */
export async function hdRemove(): Promise<HdStatus> {
  await enqueue(() => setHdStatus(HD_OFF));
  try {
    await ensureOffscreen();
    await toOffscreen({ type: 'hd.remove', engine: await engineKind() });
  } catch {
    // The cache is deleted next time; nothing reads it while the status is off.
  }
  await closeOffscreen();
  await releaseHosts();
  await chrome.alarms.clear(HD_IDLE_ALARM);
  return HD_OFF;
}

/**
 * Speaks with the HD voice. True when playback started; false (and silence from the HD voice)
 * when the model failed or took longer than HD_WAIT_MS, so the caller uses the system voice.
 */
export async function hdSpeak(token: string, text: string, speed: number, next: string | null): Promise<boolean> {
  const at = clock();
  try {
    await ensureOffscreen();
    void chrome.alarms.create(HD_IDLE_ALARM, { delayInMinutes: HD_IDLE_MINUTES });
    const engine = await engineKind();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<SpeakReply>((resolve) => (timer = setTimeout(() => resolve({ ok: false, error: 'timeout' }), HD_WAIT_MS)));
    const reply = await Promise.race([toOffscreen<SpeakReply>({ type: 'hd.speak', engine, token, text, speed, next, at }), timeout]);
    clearTimeout(timer);
    if (!reply?.ok) {
      // Cancel it, so late HD audio never plays over the system voice.
      await toOffscreen({ type: 'hd.stop', at: clock() }).catch(() => undefined);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function hdStop(): void {
  const at = clock();
  void hasOffscreen().then((has) => {
    if (has) void toOffscreen({ type: 'hd.stop', at }).catch(() => undefined);
  });
}

/** The idle alarm: free the model's memory unless a download is running. */
export async function onHdIdle(): Promise<void> {
  const status = await getHdStatus();
  if (status.state === 'downloading' || status.state === 'checking') return;
  await closeOffscreen();
}
