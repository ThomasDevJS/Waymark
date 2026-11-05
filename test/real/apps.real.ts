/**
 * Single-page apps: SauceDemo (React, test ids, list of products), the GlobalSQA bank (AngularJS,
 * hash routing, two buttons named Deposit) and demoqa's web table (React, row actions, a modal form).
 */
import type { Page } from '@playwright/test';
import { canGrant, test } from '../e2e/fixtures';
import { clickSpotOr, runTask, type StepSpec, type Task } from './harness';

test.skip(!canGrant, 'needs a headed browser under X (xvfb-run) to accept the permission dialog');

const typeInto = (sel: (p: Page) => ReturnType<Page['locator']>, text: string): StepSpec => ({
  act: async (p) => {
    await sel(p).click();
    await p.keyboard.type(text);
    await p.keyboard.press('Tab');
  },
  target: sel,
});

const sauceLogin: StepSpec[] = [
  typeInto((p) => p.locator('[data-test="username"]'), 'standard_user'),
  typeInto((p) => p.locator('[data-test="password"]'), 'secret_sauce'),
  {
    act: (p) => p.locator('[data-test="login-button"]').click(),
    target: (p) => p.locator('[data-test="login-button"]'),
    settle: (p) => p.waitForURL('**/inventory.html'),
  },
];

const bankUrl = 'https://www.globalsqa.com/angularJs-protractor/BankingProject/#/login';

const tasks: Task[] = [
  {
    site: 'SauceDemo',
    task: 'log in, add a product, check out',
    origins: ['https://www.saucedemo.com/*'],
    url: 'https://www.saucedemo.com/',
    prepare: async (p) => {
      await p.evaluate(() => {
        localStorage.clear();
        document.cookie = 'session-username=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
      });
    },
    steps: [
      ...sauceLogin,
      {
        act: (p) => p.locator('[data-test="add-to-cart-sauce-labs-backpack"]').click(),
        target: (p) => p.locator('[data-test="add-to-cart-sauce-labs-backpack"]'),
      },
      { act: (p) => p.locator('[data-test="shopping-cart-link"]').click(), target: (p) => p.locator('[data-test="shopping-cart-link"]') },
      { act: (p) => p.locator('[data-test="checkout"]').click(), target: (p) => p.locator('[data-test="checkout"]') },
    ],
    variants: [
      { name: 'narrow viewport', viewport: { width: 420, height: 800 } },
    ],
  },
  {
    site: 'GlobalSQA bank (AngularJS, hash routes)',
    task: 'customer login and deposit',
    origins: ['https://www.globalsqa.com/*'],
    url: bankUrl,
    prepare: async (p) => {
      await p.getByRole('button', { name: 'Customer Login' }).waitFor();
    },
    steps: [
      {
        act: (p) => p.getByRole('button', { name: 'Customer Login' }).click(),
        target: (p) => p.getByRole('button', { name: 'Customer Login' }),
        settle: (p) => p.locator('#userSelect').waitFor(),
      },
      {
        // a real learner's keyboard choice (selectOption fires untrusted events, which are ignored)
        act: async (p) => {
          await p.locator('#userSelect').focus();
          await p.keyboard.type('Harry');
          await p.keyboard.press('Tab');
        },
        target: (p) => p.locator('#userSelect'),
      },
      {
        act: (p) => p.getByRole('button', { name: 'Login' }).click(),
        target: (p) => p.getByRole('button', { name: 'Login' }),
        settle: (p) => p.waitForURL('**/#/account'),
      },
      {
        act: (p) => p.getByRole('button', { name: 'Deposit' }).click(),
        target: (p) => p.getByRole('button', { name: 'Deposit' }),
        settle: (p) => p.getByPlaceholder('amount').waitFor(),
      },
      typeInto((p) => p.getByPlaceholder('amount'), '100'),
      {
        act: (p) => p.locator('form').getByRole('button', { name: 'Deposit' }).click(),
        target: (p) => p.locator('form').getByRole('button', { name: 'Deposit' }),
        settle: (p) => p.getByText('Deposit Successful').waitFor(),
      },
    ],
    variants: [{ name: 'narrow viewport', viewport: { width: 600, height: 800 } }],
  },
  {
    site: 'demoqa (React)',
    task: 'web table: add a record, edit a row',
    origins: ['https://demoqa.com/*'],
    url: 'https://demoqa.com/webtables',
    steps: [
      { act: (p) => p.locator('#addNewRecordButton').click(), target: (p) => p.locator('#addNewRecordButton'), settle: (p) => p.locator('#firstName').waitFor() },
      typeInto((p) => p.locator('#firstName'), 'Ada'),
      typeInto((p) => p.locator('#lastName'), 'Lovelace'),
      typeInto((p) => p.locator('#userEmail'), 'ada@example.com'),
      typeInto((p) => p.locator('#age'), '36'),
      typeInto((p) => p.locator('#salary'), '1000'),
      typeInto((p) => p.locator('#department'), 'Math'),
      { act: (p) => p.locator('#submit').click(), target: (p) => p.locator('#submit'), settle: (p) => p.locator('#firstName').waitFor({ state: 'detached' }) },
      {
        act: (p) => clickSpotOr(p, p.locator('[id^="edit-record-"]'), p.locator('#edit-record-2')),
        target: (p) => p.locator('[id^="edit-record-"]'),
        settle: (p) => p.locator('#firstName').waitFor(),
      },
    ],
    variants: [{ name: 'narrow viewport', viewport: { width: 700, height: 800 } }],
  },
];

for (const t of tasks) {
  test(`${t.site}: ${t.task}`, async ({ context, ext }) => {
    await runTask(context, ext, t);
  });
}
