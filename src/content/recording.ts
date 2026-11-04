/** Content side of recording: starts and stops the recorder as the service worker says. */
import { send } from '../core/messaging/client';
import type { ContentPush } from '../core/messaging/protocol';
import { createRecorder, type Recorder } from '../core/recorder/recorder';
import type { RecordingView } from '../core/recorder/session';
import { isOverlayPath } from './overlay/host';
import { hidePill, showPill } from './overlay/pill';
import { testMark } from './test-hooks';

export function startRecordingClient(framePath: () => string[]): { apply(view: RecordingView): void; dispose(): void } {
  let recorder: Recorder | null = null;

  const apply = (view: RecordingView) => {
    const on = view.active && !view.paused;
    if (on && !recorder) {
      recorder = createRecorder({
        emit: (op) => {
          send('rec.step', op).catch(() => undefined);
        },
        isOwnEvent: isOverlayPath,
        framePath,
      });
    } else if (!on && recorder) {
      recorder.stop();
      recorder = null;
    }
    showPill(view);
    testMark('recording', view.active ? (view.paused ? 'paused' : 'on') : 'off');
  };

  const onMessage = (msg: unknown, sender: chrome.runtime.MessageSender) => {
    // Only the service worker (no tab) of this extension may drive the recorder.
    if (sender.id !== chrome.runtime.id || sender.tab) return;
    const m = msg as ContentPush;
    if (m?.type === 'rec.changed' && m.payload && typeof m.payload.active === 'boolean') apply(m.payload);
  };
  chrome.runtime.onMessage.addListener(onMessage);

  return {
    apply,
    dispose() {
      recorder?.stop();
      recorder = null;
      hidePill();
      try {
        chrome.runtime.onMessage.removeListener(onMessage);
      } catch {
        // context gone
      }
    },
  };
}
