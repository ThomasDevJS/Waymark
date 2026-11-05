/**
 * Icons (D90): Lucide (ISC), bundled. Only the icons listed here end up in the build. Icons are
 * built with DOM APIs (never innerHTML), so the same nodes work in Preact and in the overlay.
 * Every icon is decorative (aria-hidden); the control it sits in carries the label.
 */
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleCheck,
  CircleQuestionMark,
  CircleX,
  Copy,
  Crosshair,
  Download,
  Flag,
  Globe,
  Info,
  Library,
  Link,
  ListChecks,
  LoaderCircle,
  MapPin,
  Mic,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  ScanSearch,
  Search,
  Settings,
  ShieldCheck,
  Square,
  StickyNote,
  Trash,
  TriangleAlert,
  Undo2,
  Upload,
  Volume2,
  VolumeX,
  X,
  type IconNode,
} from 'lucide';

export const ICONS = {
  'arrow-down': ArrowDown,
  'arrow-left': ArrowLeft,
  'arrow-up': ArrowUp,
  book: BookOpen,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  circle: Circle,
  check: CircleCheck,
  help: CircleQuestionMark,
  error: CircleX,
  copy: Copy,
  crosshair: Crosshair,
  download: Download,
  flag: Flag,
  globe: Globe,
  info: Info,
  library: Library,
  link: Link,
  steps: ListChecks,
  loader: LoaderCircle,
  pin: MapPin,
  mic: Mic,
  pause: Pause,
  edit: Pencil,
  play: Play,
  plus: Plus,
  refresh: RefreshCw,
  test: ScanSearch,
  search: Search,
  settings: Settings,
  shield: ShieldCheck,
  stop: Square,
  note: StickyNote,
  trash: Trash,
  warn: TriangleAlert,
  undo: Undo2,
  upload: Upload,
  volume: Volume2,
  muted: VolumeX,
  close: X,
} satisfies Record<string, IconNode>;

export type IconName = keyof typeof ICONS;

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The attributes every icon shares (Lucide's defaults). */
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

/** An icon as an SVG element, for the overlay (no framework there). */
export function svgIcon(name: IconName, doc: Document = document): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of Object.entries(ICON_ATTRS)) svg.setAttribute(k, v);
  svg.setAttribute('class', `wm-icon wm-icon-${name}`);
  for (const [tag, attrs] of ICONS[name]) {
    const child = doc.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v !== undefined) child.setAttribute(k, String(v));
    svg.append(child);
  }
  return svg;
}
