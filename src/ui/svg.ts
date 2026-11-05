/**
 * Builds a Lucide icon as an SVG element with DOM APIs (never innerHTML), for the overlay. Kept
 * apart from icons.ts so the content script bundles only the icons it imports itself (D93).
 */
import type { IconNode } from 'lucide';

const SVG_NS = 'http://www.w3.org/2000/svg';

export const ICON_ATTRS = {
  xmlns: SVG_NS,
  width: '16',
  height: '16',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': '2',
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
  'aria-hidden': 'true',
  focusable: 'false',
} as const;

export function buildSvg(node: IconNode, cls = 'wm-icon', doc: Document = document): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of Object.entries(ICON_ATTRS)) svg.setAttribute(k, v);
  svg.setAttribute('class', cls);
  for (const [tag, attrs] of node) {
    const child = doc.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v !== undefined) child.setAttribute(k, String(v));
    svg.append(child);
  }
  return svg;
}
