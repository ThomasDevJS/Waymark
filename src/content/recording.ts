/** Content side of recording: starts and stops the recorder as the service worker says. */
import { send } from '../core/messaging/client';
import type { ContentPush } from '../core/messaging/protocol';
import { createRecorder, type Recorder, type RecorderOptions } from '../core/recorder/recorder';
import type { ProfileOptions } from '../core/model/profile';
import { fetchProfile } from './profile';
import type { RecordingView } from '../core/recorder/session';
import { isOverlayPath } from './overlay/host';
import { flashPill, hidePill, showPill } from './overlay/pill';
import { testMark } from './test-hooks';
import { dlog } from './debug';
import { createRecHover } from './rec-hover';
import { rememberShotTarget } from './shots';

/** Pill notice for a click the recorder left out (issue #6). */
export const SKIP_NOTICE = 'Not recorded: Waymark could not find this again. Click a button, link or field.';

export function startRecordingClient(framePath: () => string[]): { apply(view: RecordingView): void; dispose(): void } {
  let recorder: Recorder | null = null;
  let skipped = 0;
  // The site's own profile (D213): filled in as soon as the service worker answers; the recorder
  // and the outline read it at each step.
  let profile: ProfileOptions = {};
  const hover = createRecHover(framePath, () => profile);
  let hoverAsk = 0;

  // The recorder starts once the site's profile is in (D213 review): a step recorded before it would
  // miss the profile's stable attribute and URL options. Until then the pill shows recording, and the
  // test marker says "starting". A view that turns recording off meanwhile wins.
  let wanted = false;
  let lastView: RecordingView | null = null;
  let profileAsk = 0;
  const mark = (view: RecordingView) => testMark('recording', view.active ? (view.paused ? 'paused' : recorder ? 'on' : 'starting') : 'off');

  const startRecorder = (p: ProfileOptions) => {
    if (recorder || !wanted) return;
    const opts: RecorderOptions = {
      profile: p,
      emit: (op) => {
        send('rec.step', { ...op, at: op.at ?? Date.now() }).catch(() => undefined);
      },
      isOwnEvent: isOverlayPath,
      // Its screenshot measures the element itself at capture time (D183), in frames too (D191).
      onTarget: rememberShotTarget,
      framePath,
      debug: (ev, data) => dlog('rec', ev, data),
      onSkip: () => {
        skipped++;
        testMark('rec-skipped', String(skipped));
        flashPill(SKIP_NOTICE);
      },
    };
    recorder = createRecorder(opts);
    if (lastView) mark(lastView);
  };

  const apply = (view: RecordingView) => {
    const on = view.active && !view.paused;
    wanted = on;
    lastView = view;
    if (on && !recorder) {
      const ask = ++profileAsk;
      void fetchProfile('record').then((p) => {
        if (ask !== profileAsk) return;
        profile = p;
        startRecorder(p);
      });
    } else if (!on) {
      profileAsk++;
      recorder?.stop();
      recorder = null;
    }
    // The outline of what a click will record (D153), unless turned off in Settings. Asked on every
    // view, so a change in Settings applies at the next step or page; a late reply never revives it.
    if (on) {
      const ask = ++hoverAsk;
      send('recorder.settings.get', {})
        .then((s) => {
          if (ask !== hoverAsk || !wanted) return;
          if (s.hover) hover.start();
          else hover.stop();
        })
        .catch(() => undefined);
    } else {
      hoverAsk++;
      hover.stop();
    }
    showPill(view);
    mark(view);
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
      profileAsk++;
      wanted = false;
      recorder?.stop();
      recorder = null;
      hoverAsk++;
      hover.stop();
      hidePill();
      try {
        chrome.runtime.onMessage.removeListener(onMessage);
      } catch {
        // context gone
      }
    },
  };
}
