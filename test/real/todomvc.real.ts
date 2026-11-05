/** TodoMVC in React, Vue and Angular: an input step, a list item toggle, hash-routed filters. */
import type { Page } from '@playwright/test';
import { canGrant } from '../e2e/fixtures';
import { clickSpotOr, runTask, type Task, test } from './harness';

test.skip(!canGrant, 'needs a headed browser under X (xvfb-run) to accept the permission dialog');

async function addTodos(p: Page, items: string[]) {
  // start from an empty list (some versions keep todos in localStorage)
  await p.evaluate(() => localStorage.clear());
  await p.reload();
  await p.locator('input.new-todo').waitFor();
  const input = p.locator('input.new-todo');
  for (const t of items) {
    await input.fill(t);
    await input.press('Enter');
  }
  await p.locator('.todo-list li').nth(items.length - 1).waitFor();
}

const item = (p: Page, text: string) => p.locator('.todo-list li').filter({ hasText: text });
const anyToggle = (p: Page) => p.locator('.todo-list li').locator('input.toggle, label');

function todoTask(framework: string, url: string): Task {
  return {
    site: `TodoMVC ${framework}`,
    task: 'add, complete, filter, clear',
    origins: ['https://todomvc.com/*'],
    url,
    prepare: (p) => addTodos(p, ['Buy milk', 'Walk the dog', 'Pay rent']),
    steps: [
      {
        act: async (p) => {
          await p.locator('input.new-todo').click();
          await p.keyboard.type('Call mom');
          await p.keyboard.press('Enter');
        },
        target: (p) => p.locator('input.new-todo'),
      },
      {
        // The toggles have no name and share their attributes, so the recorder marks the step
        // instance 'any' (SPEC: playback step 5): any todo's toggle is a right answer.
        act: (p) => clickSpotOr(p, anyToggle(p), item(p, 'Walk the dog').locator('input.toggle')),
        target: anyToggle,
      },
      { act: (p) => p.getByRole('link', { name: 'Active' }).click(), target: (p) => p.getByRole('link', { name: 'Active' }) },
      { act: (p) => p.getByRole('link', { name: 'All' }).click(), target: (p) => p.getByRole('link', { name: 'All' }) },
      { act: (p) => p.getByRole('button', { name: 'Clear completed' }).click(), target: (p) => p.getByRole('button', { name: 'Clear completed' }) },
    ],
    variants: [
      { name: 'narrow viewport', viewport: { width: 520, height: 640 } },
      {
        name: 'different items',
        prepare: async (p) => {
          // a different list: the recorded item is gone, another one is completed instead
          await addTodos(p, ['Feed the cat', 'Water plants']);
        },
        steps: [
          {},
          {
            act: (p) => clickSpotOr(p, anyToggle(p), item(p, 'Water plants').locator('input.toggle')),
            target: anyToggle,
          },
        ],
      },
    ],
  };
}

const tasks = [
  todoTask('React', 'https://todomvc.com/examples/react/dist/'),
  todoTask('Vue', 'https://todomvc.com/examples/vue/dist/'),
  todoTask('Angular', 'https://todomvc.com/examples/angular/dist/browser/'),
];

for (const t of tasks) {
  test(`${t.site}: ${t.task}`, async ({ context, ext }) => {
    await runTask(context, ext, t);
  });
}
