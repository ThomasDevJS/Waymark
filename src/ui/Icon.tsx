import { createElement } from 'preact';
import { ICONS, ICON_ATTRS, type IconName } from './icons';

/** A Lucide icon in Preact (D90). Decorative: label the control it sits in. */
export function Icon({ name, size }: { name: IconName; size?: number }) {
  const s = size ? String(size) : ICON_ATTRS.width;
  return createElement(
    'svg',
    { ...ICON_ATTRS, width: s, height: s, class: `wm-icon wm-icon-${name}` },
    ICONS[name].map(([tag, attrs], i) => createElement(tag, { key: i, ...attrs })),
  );
}
