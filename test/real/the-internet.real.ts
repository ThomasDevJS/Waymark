/** the-internet.herokuapp.com: a login across pages, dynamic controls, a table with row actions, an iframe editor. */
import { canGrant, test } from '../e2e/fixtures';
import { clickSpotOr, runTask, type Task } from './harness';

test.skip(!canGrant, 'needs a headed browser under X (xvfb-run) to accept the permission dialog');

const ORIGIN = 'https://the-internet.herokuapp.com/*';
const BASE = 'https://the-internet.herokuapp.com';

const tasks: Task[] = [
  {
    site: 'the-internet',
    task: 'log in and out (form submit, full page loads)',
    origins: [ORIGIN],
    url: `${BASE}/login`,
    steps: [
      {
        act: async (p) => {
          await p.locator('#username').click();
          await p.keyboard.type('tomsmith');
          await p.keyboard.press('Tab');
        },
        target: (p) => p.locator('#username'),
      },
      {
        act: async (p) => {
          await p.locator('#password').click();
          await p.keyboard.type('SuperSecretPassword!');
          await p.keyboard.press('Tab');
        },
        target: (p) => p.locator('#password'),
      },
      {
        act: (p) => p.getByRole('button', { name: 'Login' }).click(),
        target: (p) => p.getByRole('button', { name: 'Login' }),
        settle: (p) => p.waitForURL('**/secure'),
      },
      {
        act: (p) => p.getByRole('link', { name: 'Logout' }).click(),
        target: (p) => p.getByRole('link', { name: 'Logout' }),
        settle: (p) => p.waitForURL('**/login'),
      },
    ],
    variants: [{ name: 'narrow viewport', viewport: { width: 600, height: 700 } }],
  },
  {
    site: 'the-internet',
    task: 'dynamic controls (late, re-labelled and enabled elements)',
    origins: [ORIGIN],
    url: `${BASE}/dynamic_controls`,
    steps: [
      {
        act: (p) => p.getByRole('button', { name: 'Remove' }).click(),
        target: (p) => p.getByRole('button', { name: 'Remove' }),
        settle: (p) => p.getByText("It's gone!").waitFor(),
      },
      {
        act: (p) => p.getByRole('button', { name: 'Add' }).click(),
        target: (p) => p.getByRole('button', { name: 'Add' }),
        settle: (p) => p.getByText("It's back!").waitFor(),
      },
      {
        act: (p) => p.getByRole('button', { name: 'Enable' }).click(),
        target: (p) => p.getByRole('button', { name: 'Enable' }),
        settle: (p) => p.getByText("It's enabled!").waitFor(),
      },
      // Known limit: the text field next to Enable has no label, placeholder or name, so it has
      // no strong signal and is not a step (see docs/RELIABILITY.md).
    ],
    variants: [{ name: 'narrow viewport', viewport: { width: 600, height: 700 } }],
  },
  {
    site: 'the-internet',
    task: 'sortable table with row actions',
    origins: [ORIGIN],
    url: `${BASE}/tables`,
    steps: [
      {
        act: (p) => p.locator('#table2').getByText('Last Name').click(),
        target: (p) => p.locator('#table2 th').filter({ hasText: 'Last Name' }).locator('span, th').or(p.locator('#table2 th').filter({ hasText: 'Last Name' })),
      },
      {
        // every row has an "edit" link: the recorder marks the step instance 'any'
        act: (p) => clickSpotOr(p, p.locator('#table2').getByRole('link', { name: 'edit' }), p.locator('#table2 tr').filter({ hasText: 'Jason' }).getByRole('link', { name: 'edit' })),
        target: (p) => p.locator('#table2').getByRole('link', { name: 'edit' }),
      },
    ],
    variants: [{ name: 'narrow viewport', viewport: { width: 600, height: 700 } }],
  },
  {
    site: 'the-internet',
    task: 'TinyMCE editor in an iframe',
    origins: [ORIGIN],
    url: `${BASE}/iframe`,
    prepare: async (p) => {
      await p.frameLocator('#mce_0_ifr').locator('body').waitFor();
    },
    steps: [
      {
        act: async (p) => {
          await p.frameLocator('#mce_0_ifr').locator('body').click();
          await p.keyboard.type(' More text.');
          await p.keyboard.press('Tab');
        },
        target: (p) => p.frameLocator('#mce_0_ifr').locator('body, body > p'),
      },
      {
        act: (p) => p.getByRole('menuitem', { name: 'Format' }).click(),
        target: (p) => p.getByRole('menuitem', { name: 'Format' }),
      },
      {
        act: (p) => p.getByRole('menuitem', { name: 'Bold' }).click(),
        target: (p) => p.getByRole('menuitem', { name: 'Bold' }),
      },
    ],
  },
];

for (const t of tasks) {
  test(`${t.site}: ${t.task}`, async ({ context, ext }) => {
    await runTask(context, ext, t);
  });
}
