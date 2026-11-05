/** The Waymark mark (D94): a flag on a blue tile, the 16 px drawing from assets/brand/mark-16.svg. */
export function Mark({ size = 20 }: { size?: number }) {
  return (
    <svg class="wm-mark" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <rect width="16" height="16" rx="3.5" fill="#2a5bd7" />
      <path d="M6 13 V 3.2" stroke="#fff" stroke-width="1.6" stroke-linecap="round" />
      <path d="M6.6 3 H 12.2 L 10.8 5.2 L 12.2 7.4 H 6.6 Z" fill="#fff" />
    </svg>
  );
}
