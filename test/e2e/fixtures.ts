import { test as base, chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
// @ts-expect-error plain JS module without types
import { startFixtureServer } from '../fixtures/server.mjs';

export const EXT_PATH = join(process.cwd(), '.output-test', 'chrome-mv3-test');
const KEYS_SCRIPT = join(process.cwd(), 'test', 'e2e', 'helpers', 'x11-keys.py');

/** Chrome's permission prompt is a native dialog; it can only be accepted in a headed browser under X. */
export const canGrant = process.platform === 'linux' && !!process.env.DISPLAY;

export async function launch(userDataDir: string): Promise<BrowserContext> {
  if (!existsSync(join(EXT_PATH, 'manifest.json'))) throw new Error('Run `pnpm build:test` first');
  const executablePath = process.env.WAYMARK_CHROMIUM ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  return chromium.launchPersistentContext(userDataDir, {
    channel: executablePath ? undefined : 'chromium',
    executablePath,
    headless: !canGrant,
    viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`, '--no-first-run', '--no-default-browser-check'],
  });
}

export async function serviceWorker(context: BrowserContext): Promise<Worker> {
  const [sw] = context.serviceWorkers();
  return sw ?? context.waitForEvent('serviceworker');
}

export interface Fixtures {
  userDataDir: string;
  context: BrowserContext;
  sw: Worker;
  extensionId: string;
  ext: ExtensionHelper;
}

export interface WorkerFixtures {
  site: { port: number; main: string; other: string };
}

export class ExtensionHelper {
  constructor(
    readonly context: BrowserContext,
    readonly extensionId: string,
    readonly sw: () => Promise<Worker>,
  ) {}

  /**
   * Sends a runtime message from an extension page in a separate, unfocused popup window, so the
   * app tab stays the active tab of the last-focused normal window (as with the side panel, D39).
   *
   * The popup is opened by the service worker, and Playwright can attach to it after its `load`
   * event, so waiting for a load state could hang until the test timed out (found under CPU load,
   * D50). The page is polled instead: it is ready once it is the extension page and complete.
   */
  async message<T>(type: string, payload: object): Promise<T> {
    const sw = await this.sw();
    const url = `chrome-extension://${this.extensionId}/sidepanel.html`;
    const [page] = await Promise.all([
      this.context.waitForEvent('page'),
      sw.evaluate((u) => chrome.windows.create({ url: u, type: 'popup', focused: false }), url),
    ]);
    await page.waitForFunction((u) => location.href.startsWith(u) && document.readyState === 'complete', url, { polling: 50 });
    const r = await page.evaluate(([t, p]) => chrome.runtime.sendMessage({ type: t, payload: p }), [type, payload] as const);
    await page.close();
    if (!r.ok) throw new Error(r.error);
    return r.data as T;
  }

  async extensionPage(): Promise<Page> {
    const page = await this.context.newPage();
    await page.goto(`chrome-extension://${this.extensionId}/sidepanel.html`);
    return page;
  }

  /**
   * Requests a site permission from an extension page with a real click, then accepts Chrome's
   * native dialog with the keyboard (Tab to "Allow", Enter).
   */
  async grant(pattern: string): Promise<void> {
    const page = await this.extensionPage();
    await page.bringToFront();
    await page.evaluate((p) => {
      const b = document.createElement('button');
      b.id = 'grant-test';
      b.textContent = 'grant';
      b.onclick = () => {
        (window as unknown as { grantResult: Promise<boolean> }).grantResult = chrome.permissions.request({ origins: [p] });
      };
      document.body.prepend(b);
    }, pattern);
    await page.click('#grant-test');
    await page.waitForTimeout(1200);
    execFileSync('python3', [KEYS_SCRIPT, 'Tab,Return']);
    const ok = await page.evaluate(() => (window as unknown as { grantResult: Promise<boolean> }).grantResult);
    await page.close();
    if (!ok) throw new Error(`permission dialog for ${pattern} was not accepted`);
    // onAdded handler: sync + inject run asynchronously in the service worker.
    await this.waitFor(async () => (await this.registeredMatches()).includes(pattern));
  }

  async revoke(pattern: string): Promise<void> {
    const page = await this.extensionPage();
    await page.evaluate((p) => chrome.permissions.remove({ origins: [p] }), pattern);
    await page.close();
    await this.waitFor(async () => !(await this.registeredMatches()).includes(pattern));
  }

  async registeredMatches(): Promise<string[]> {
    const sw = await this.sw();
    return sw.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).flatMap((s) => s.matches ?? []));
  }

  async waitFor(cond: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (await cond()) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('timed out waiting for condition');
  }
}

/** Reads a test-build marker the content script writes on <html>. */
export async function marker(page: Page | import('@playwright/test').Frame, name: string): Promise<string | null> {
  try {
    return await page.evaluate((n) => document.documentElement.getAttribute(`data-waymark-test-${n}`), name);
  } catch {
    return null; // the page is navigating; pollers try again
  }
}

export const test = base.extend<Fixtures, WorkerFixtures>({
  site: [
    async ({}, use) => {
      const server: Server = await startFixtureServer(0);
      const { port } = server.address() as AddressInfo;
      await use({ port, main: `http://127.0.0.1:${port}`, other: `http://localhost:${port}` });
      server.close();
    },
    { scope: 'worker' },
  ],
  userDataDir: async ({}, use) => {
    const dir = mkdtempSync(join(tmpdir(), 'waymark-e2e-'));
    await use(dir);
    rmSync(dir, { recursive: true, force: true });
  },
  context: async ({ userDataDir }, use) => {
    const context = await launch(userDataDir);
    await use(context);
    await context.close();
  },
  sw: async ({ context }, use) => {
    await use(await serviceWorker(context));
  },
  extensionId: async ({ sw }, use) => {
    await use(new URL(sw.url()).host);
  },
  ext: async ({ context, extensionId }, use) => {
    await use(new ExtensionHelper(context, extensionId, () => serviceWorker(context)));
  },
});

export const expect = test.expect;
