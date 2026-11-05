/**
 * The on-page UI's share of the design system (D90): the same tokens as the extension pages,
 * scoped to the overlay layer (class `wm-theme`) inside the closed shadow root, so host page
 * styles can neither read nor override them.
 */
import tokens from '../../ui/tokens.css?inline';

export const THEME_CSS = tokens;
