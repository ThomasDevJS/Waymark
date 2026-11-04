export const FX_ATTR: string;
export interface AppOptions {
  seed?: number;
  layoutSeed?: number;
  reorder?: boolean;
  wrap?: boolean;
  changeText?: boolean;
  twin?: string[];
  unlabel?: string[];
  remove?: string[];
  portalOpen?: boolean;
}
export function hashedClass(name: string, seed: number): string;
export function createApp(options?: AppOptions, doc?: Document): { app: HTMLElement; portal: HTMLElement };
export function mountApp(root: HTMLElement, options?: AppOptions): { app: HTMLElement; portal: HTMLElement };
export function takeKeys(doc?: Document): Map<string, Element[]>;
