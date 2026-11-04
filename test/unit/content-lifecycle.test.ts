import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('content script lifecycle', () => {
  let runtime: { id: string | undefined; sendMessage: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    vi.useFakeTimers();
    runtime = { id: 'ext', sendMessage: vi.fn(async () => ({ ok: true, data: { ok: true } })) };
    (globalThis as unknown as { chrome: unknown }).chrome = { runtime };
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as unknown as Record<string, unknown>).__waymarkContent;
  });

  it('a newer instance replaces the previous one; a dead extension context disposes the instance', async () => {
    const { startContent } = await import('../../src/content/main');
    startContent();
    const first = document.documentElement.getAttribute('data-waymark-test-instance');
    startContent();
    const second = document.documentElement.getAttribute('data-waymark-test-instance');
    expect(second).not.toBe(first);
    expect(document.documentElement.getAttribute('data-waymark-test-disposed')).toBe(first);
    expect(runtime.sendMessage).toHaveBeenCalledWith({ type: 'route.report', payload: { url: location.href, via: 'load' } });

    runtime.id = undefined; // extension updated or removed
    vi.advanceTimersByTime(2500);
    expect(document.documentElement.getAttribute('data-waymark-test-disposed')).toBe(second);
  });
});
