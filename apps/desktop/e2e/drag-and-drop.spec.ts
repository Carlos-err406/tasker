import { test, expect } from './fixtures.js';
import { addTask, dragTaskVertical } from './helpers.js';

test.describe('Drag and Drop', () => {
  test('reorder tasks via pointer drag', async ({ page }) => {
    // Create 3 tasks (newest appears at top due to sort_order DESC)
    await addTask(page, 'Task A');
    await addTask(page, 'Task B');
    await addTask(page, 'Task C');

    // Verify initial order: C (top), B, A (bottom)
    const getTaskNames = () =>
      page.$$eval('[data-testid^="task-name-"]', (els) =>
        els.map((el) => el.textContent?.trim()),
      );

    let names = await getTaskNames();
    expect(names).toEqual(['Task C', 'Task B', 'Task A']);

    // Drag Task A (bottom) above Task C (top)
    const taskItems = page.locator('[data-task-id]');
    const taskA = taskItems.nth(2); // Task A is at bottom (index 2)
    const taskC = taskItems.nth(0); // Task C is at top (index 0)

    await dragTaskVertical(page, taskA, taskC);
    await page.waitForTimeout(200); // wait for reorder to settle

    names = await getTaskNames();
    expect(names[0]).toBe('Task A');
  });

  test('undo a reorder', async ({ page }) => {
    await addTask(page, 'First');
    await addTask(page, 'Second');
    await addTask(page, 'Third');

    const getTaskNames = () =>
      page.$$eval('[data-testid^="task-name-"]', (els) =>
        els.map((el) => el.textContent?.trim()),
      );

    const originalOrder = await getTaskNames();

    // Drag Third (top) to bottom
    const taskItems = page.locator('[data-task-id]');
    await dragTaskVertical(page, taskItems.nth(0), taskItems.nth(2));
    await page.waitForTimeout(200);

    // Verify order changed
    const newOrder = await getTaskNames();
    expect(newOrder).not.toEqual(originalOrder);

    // Undo
    await page.keyboard.press('Meta+z');
    await page.waitForTimeout(200);

    const undoneOrder = await getTaskNames();
    expect(undoneOrder).toEqual(originalOrder);
  });
});
