/** True in builds made with `pnpm build:test` (open overlay shadow roots, test hooks). */
declare const __WAYMARK_TEST__: boolean;

/** A stylesheet's text, for the overlay's shadow root (Vite `?inline`). */
declare module '*.css?inline' {
  const css: string;
  export default css;
}
