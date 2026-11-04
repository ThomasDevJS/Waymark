import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';

const isTestBuild = process.env.WAYMARK_TEST === '1';

// See docs/SPEC.md "Permissions, privacy and security". The manifest must never
// contain content_scripts or host_permissions (checked by scripts/check-manifest.mjs).
export default defineConfig({
  srcDir: 'src',
  outDir: isTestBuild ? '.output-test' : '.output',
  manifestVersion: 3,
  browser: 'chrome',
  vite: () => ({
    plugins: [preact()],
    define: {
      __WAYMARK_TEST__: JSON.stringify(isTestBuild),
    },
  }),
  manifest: {
    name: 'Waymark',
    description: 'Record click-by-click walkthroughs of web apps and replay them on the live page.',
    minimum_chrome_version: '120',
    permissions: ['storage', 'unlimitedStorage', 'sidePanel', 'scripting', 'activeTab', 'tts', 'alarms'],
    optional_host_permissions: ['https://*/*', 'http://*/*'],
    action: { default_title: 'Waymark' },
    // Users can change these at chrome://extensions/shortcuts. No Alt+Shift combinations,
    // which switch the input language on Windows (SPEC: Accessibility).
    commands: {
      'next-step': { suggested_key: { default: 'Alt+Period' }, description: 'Guide: next step' },
      'previous-step': { suggested_key: { default: 'Alt+Comma' }, description: 'Guide: previous step' },
      'exit-guide': { description: 'Guide: exit' },
    },
  },
});
