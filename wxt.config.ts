import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// HD voice (D51): onnxruntime-web as transformers.js resolves it. We bundle its WebAssembly-only
// build (no WebGPU) and ship the .wasm inside the extension, so no code ever loads from a CDN.
const fromTransformers = createRequire(createRequire(import.meta.url).resolve('@huggingface/transformers'));
const ortDist = dirname(fromTransformers.resolve('onnxruntime-web/wasm'));
const ORT_FILES = ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs'];

const isTestBuild = process.env.WAYMARK_TEST === '1';

// See docs/SPEC.md "Permissions, privacy and security". The manifest must never
// contain content_scripts or host_permissions (checked by scripts/check-manifest.mjs).
export default defineConfig({
  srcDir: 'src',
  outDir: isTestBuild ? '.output-test' : '.output',
  manifestVersion: 3,
  browser: 'chrome',
  hooks: {
    'build:publicAssets': (_wxt, files) => {
      for (const f of ORT_FILES) files.push({ absoluteSrc: join(ortDist, f), relativeDest: `ort/${f}` });
      files.push({ absoluteSrc: join(import.meta.dirname, 'THIRD_PARTY_NOTICES.md'), relativeDest: 'THIRD_PARTY_NOTICES.md' });
    },
  },
  vite: () => ({
    plugins: [
      preact(),
      {
        // transformers.js defaults ONNX Runtime's WebAssembly location to a CDN. Waymark always
        // sets its own path, but the bundle must not carry a remote code URL at all (D51).
        name: 'waymark-no-cdn',
        transform(code: string, id: string) {
          if (!id.includes('@huggingface/transformers')) return null;
          const out = code.replace(/`https:\/\/cdn\.jsdelivr\.net\/npm\/@huggingface\/transformers@\$\{[^}]+\}\/dist\/`/g, "'/ort/'");
          return out === code ? null : { code: out, map: null };
        },
      },
    ],
    resolve: { alias: { 'onnxruntime-web': join(ortDist, 'ort.wasm.bundle.min.mjs') } },
    define: {
      __WAYMARK_TEST__: JSON.stringify(isTestBuild),
    },
  }),
  manifest: {
    name: 'Waymark',
    description: 'Record click-by-click walkthroughs of web apps and replay them on the live page.',
    minimum_chrome_version: '120',
    permissions: ['storage', 'unlimitedStorage', 'sidePanel', 'scripting', 'activeTab', 'tts', 'alarms', 'offscreen'],
    optional_host_permissions: ['https://*/*', 'http://*/*'],
    action: { default_title: 'Waymark' },
    // HD voice (D51): WebAssembly for the on-device voice model, and cross-origin isolation so
    // it can use threads. Only 'wasm-unsafe-eval' is added; all code is bundled.
    content_security_policy: { extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'" },
    cross_origin_embedder_policy: { value: 'require-corp' },
    cross_origin_opener_policy: { value: 'same-origin' },
    // Users can change these at chrome://extensions/shortcuts. No Alt+Shift combinations,
    // which switch the input language on Windows (SPEC: Accessibility).
    commands: {
      'next-step': { suggested_key: { default: 'Alt+Period' }, description: 'Guide: next step' },
      'previous-step': { suggested_key: { default: 'Alt+Comma' }, description: 'Guide: previous step' },
      'exit-guide': { description: 'Guide: exit' },
      // D105: start or stop recording in the current tab, and open the side panel (the toolbar
      // button's action). Chrome allows four suggested keys; these are the last two.
      'toggle-recording': { suggested_key: { default: 'Alt+R' }, description: 'Start or stop recording in this tab' },
      _execute_action: { suggested_key: { default: 'Alt+W' }, description: 'Open the Waymark side panel' },
    },
  },
});
