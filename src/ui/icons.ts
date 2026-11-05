/**
 * Icons (D91): Lucide (ISC), bundled. Only the icons listed here end up in the build. Icons are
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
import { buildSvg } from './svg';

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

export { ICON_ATTRS } from './svg';

/** An icon by name as an SVG element. */
export function svgIcon(name: IconName, doc: Document = document): SVGSVGElement {
  return buildSvg(ICONS[name], `wm-icon wm-icon-${name}`, doc);
}
