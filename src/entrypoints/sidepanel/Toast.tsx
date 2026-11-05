/**
 * Undo toast (D100): one message with an action that stays for a few seconds. One toast at a
 * time; a new one replaces the old. It is a polite live region, and the action is a real button
 * that keyboard users reach with Tab (focus moves to it when the deleted control disappears).
 */
import { signal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { Icon } from '../../ui/Icon';

export interface ToastSpec {
  /** Which part of the panel shows it: the editor's bar or the library. */
  scope: 'editor' | 'library';
  text: string;
  action: { label: string; run: () => void | Promise<void> };
  /** Epoch ms when it disappears. */
  until: number;
  /** Move focus to the action button (the control that was used has gone). */
  focus?: boolean;
  /** Where focus goes if it is on the toast when the toast disappears. */
  fallbackFocus?: () => HTMLElement | null;
  testid?: string;
}

export const toast = signal<(ToastSpec & { key: number }) | null>(null);
let seq = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

/** Shows a toast, replacing any other. */
export function showToast(spec: ToastSpec): void {
  clearTimeout(timer);
  const key = ++seq;
  toast.value = { ...spec, key };
  timer = setTimeout(() => dismissToast(key), Math.max(0, spec.until - Date.now()));
}

/** Hides the toast (only the given one, when a key is passed). */
export function dismissToast(key?: number): void {
  const t = toast.value;
  if (!t || (key !== undefined && t.key !== key)) return;
  clearTimeout(timer);
  const hadFocus = !!document.activeElement?.closest('.toast');
  toast.value = null;
  if (hadFocus) t.fallbackFocus?.()?.focus();
}

/** Hides a toast of this scope (the editor closed, so its Undo no longer applies). */
export function dismissScope(scope: ToastSpec['scope']): void {
  if (toast.value?.scope === scope) dismissToast();
}

export function ToastSlot({ scope }: { scope: ToastSpec['scope'] }) {
  const t = toast.value?.scope === scope ? toast.value : null;
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (t?.focus) btn.current?.focus();
  }, [t?.key]);
  return (
    <div class={`toast-slot ${scope}`} role="status" aria-live="polite">
      {t && (
        <div class="toast" key={t.key} data-testid={t.testid ?? 'toast'}>
          <Icon name="trash" />
          <span class="grow">{t.text}</span>
          <button
            type="button"
            class="sm"
            ref={btn}
            data-testid="toast-undo"
            onClick={() => {
              const run = t.action.run;
              dismissToast(t.key);
              void run();
            }}
          >
            <Icon name="undo" />
            {t.action.label}
          </button>
          <button type="button" class="ghost icon sm" aria-label="Dismiss" title="Dismiss" onClick={() => dismissToast(t.key)}>
            <Icon name="close" />
          </button>
        </div>
      )}
    </div>
  );
}
