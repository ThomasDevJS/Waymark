/**
 * Component libraries: portaled select menus, modal dialogs and a date picker in MUI (React),
 * Ant Design (React) and Angular Material.
 */
import { canGrant } from '../e2e/fixtures';
import type { Page } from '@playwright/test';
import { runTask, type Task, test } from './harness';

/** The alert dialog demo (another demo on the page is an always-open inline dialog). */
const alertDialog = (p: Page) => p.locator('.MuiDialog-container').filter({ hasText: 'location service' });

/** mui.com asks about cookies in a non-modal dialog: answer it so it is not in the way. */
async function muiReady(p: Page, ready: () => Promise<void>) {
  const consent = p.getByRole('button', { name: 'Essential only' });
  await consent.click({ timeout: 5000 }).catch(() => undefined);
  await ready();
}

test.skip(!canGrant, 'needs a headed browser under X (xvfb-run) to accept the permission dialog');

const tasks: Task[] = [
  {
    site: 'MUI (React)',
    task: 'portaled select',
    origins: ['https://mui.com/*'],
    url: 'https://mui.com/material-ui/react-select/',
    prepare: (p) => muiReady(p, () => p.locator('#demo-simple-select').waitFor()),
    steps: [
      { act: (p) => p.locator('#demo-simple-select').click(), target: (p) => p.locator('#demo-simple-select') },
      { act: (p) => p.getByRole('option', { name: 'Twenty' }).click(), target: (p) => p.getByRole('option', { name: 'Twenty' }) },
    ],
    variants: [{ name: 'narrow viewport', viewport: { width: 600, height: 800 } }],
  },
  {
    site: 'MUI (React)',
    task: 'modal dialog',
    origins: ['https://mui.com/*'],
    url: 'https://mui.com/material-ui/react-dialog/',
    prepare: (p) => muiReady(p, () => p.getByRole('button', { name: 'Open alert dialog', exact: true }).waitFor()),
    steps: [
      {
        act: (p) => p.getByRole('button', { name: 'Open alert dialog', exact: true }).click(),
        target: (p) => p.getByRole('button', { name: 'Open alert dialog', exact: true }),
        settle: (p) => alertDialog(p).waitFor(),
      },
      {
        act: (p) => alertDialog(p).getByRole('button', { name: 'Agree', exact: true }).click(),
        target: (p) => alertDialog(p).getByRole('button', { name: 'Agree', exact: true }),
        settle: (p) => alertDialog(p).waitFor({ state: 'detached' }),
      },
    ],
    variants: [{ name: 'narrow viewport', viewport: { width: 600, height: 800 } }],
  },
  {
    site: 'MUI X (React)',
    task: 'date picker',
    origins: ['https://mui.com/*'],
    url: 'https://mui.com/x/react-date-pickers/date-picker/',
    prepare: (p) => muiReady(p, () => p.getByRole('button', { name: /Choose date/ }).first().waitFor()),
    steps: [
      {
        act: (p) => p.getByRole('button', { name: /Choose date/ }).first().click(),
        target: (p) => p.getByRole('button', { name: /Choose date/ }).first(),
        settle: (p) => p.getByRole('dialog').waitFor(),
      },
      {
        act: (p) => p.locator('.MuiPickerPopper-root').getByRole('gridcell', { name: '15', exact: true }).click(),
        target: (p) => p.locator('.MuiPickerPopper-root').getByRole('gridcell', { name: '15', exact: true }),
      },
    ],
  },
  {
    // A labelled select from the Form demo. The Select demo's own selects have no label at all
    // (only their current value), so their open step is not recorded (docs/RELIABILITY.md).
    site: 'Ant Design (React)',
    task: 'portaled select in a form',
    origins: ['https://ant.design/*'],
    url: 'https://ant.design/components/form',
    prepare: async (p) => {
      await p.locator('#form-demo-control-hooks .ant-select').first().waitFor();
      await p.waitForLoadState('networkidle').catch(() => undefined);
      // ant.design remounts the whole page a few seconds after load, closing an open dropdown.
      await p.waitForTimeout(5000);
    },
    steps: [
      {
        act: (p) => p.locator('#form-demo-control-hooks .ant-select').first().click(),
        target: (p) => {
          const sel = p.locator('#form-demo-control-hooks .ant-select').first();
          return sel.or(sel.locator('input, .ant-select-content'));
        },
      },
      {
        act: (p) => p.locator('.ant-select-dropdown:not(.semantic-mark-popup-root):visible .ant-select-item-option[title="male"]').click(),
        target: (p) => {
          const o = p.locator('.ant-select-dropdown:not(.semantic-mark-popup-root) .ant-select-item-option[title="male"]');
          return o.or(o.locator('.ant-select-item-option-content'));
        },
      },
    ],
    variants: [{ name: 'narrow viewport', viewport: { width: 600, height: 800 } }],
  },
  {
    site: 'Ant Design (React)',
    task: 'date picker',
    origins: ['https://ant.design/*'],
    url: 'https://ant.design/components/date-picker',
    prepare: async (p) => {
      await p.locator('#date-picker-demo-basic input').first().waitFor();
      await p.waitForLoadState('networkidle').catch(() => undefined);
      // ant.design remounts the page a few seconds after load and closes an open calendar. The
      // look-alike this remount exposed (D55) is covered by test/browser/lookalikes.test.ts.
      await p.waitForTimeout(5000);
    },
    steps: [
      {
        act: (p) => p.locator('#date-picker-demo-basic input').first().click(),
        target: (p) => p.locator('#date-picker-demo-basic input').first(),
      },
      {
        act: (p) => p.locator('.ant-picker-dropdown:visible td.ant-picker-cell-in-view:not(.semantic-mark-popup-item)').filter({ hasText: /^15$/ }).click(),
        target: (p) => {
          const cell = p.locator('.ant-picker-dropdown td.ant-picker-cell-in-view:not(.semantic-mark-popup-item)').filter({ hasText: /^15$/ });
          return cell.or(cell.locator('.ant-picker-cell-inner'));
        },
      },
    ],
  },
  {
    site: 'Angular Material',
    task: 'portaled select',
    origins: ['https://material.angular.dev/*'],
    url: 'https://material.angular.dev/components/select/overview',
    prepare: (p) => p.locator('mat-select').first().waitFor(),
    steps: [
      { act: (p) => p.locator('mat-select').first().click(), target: (p) => p.locator('mat-select').first() },
      { act: (p) => p.getByRole('option', { name: 'Pizza' }).click(), target: (p) => p.getByRole('option', { name: 'Pizza' }) },
    ],
    variants: [{ name: 'narrow viewport', viewport: { width: 600, height: 800 } }],
  },
];

for (const t of tasks) {
  test(`${t.site}: ${t.task}`, async ({ context, ext }) => {
    await runTask(context, ext, t);
  });
}
