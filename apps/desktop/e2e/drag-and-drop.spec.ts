import { test, expect } from './fixtures.js';
import { addTask, dragTaskVertical } from './helpers.js';

test.describe('Drag and Drop', () => {
  test('reorder tasks via pointer drag', async ({ page }) => {
    // Create 3 tasks (newest appears at top due to sort_order DESC)
    await addTask(page, 'Task A');
    await addTask(page, 'Task B');
    await addTask(page, 'Task C');

    // Verify initial order: C (top), B, A (bottom)
    const taskNames = page.locator('[data-testid^="task-name-"]');
    await expect(taskNames.nth(0)).toHaveText('Task C');
    await expect(taskNames.nth(1)).toHaveText('Task B');
    await expect(taskNames.nth(2)).toHaveText('Task A');

    // Drag Task A (bottom) above Task C (top)
    const taskItems = page.locator('[data-task-id]');
    const taskA = taskItems.nth(2); // Task A is at bottom (index 2)
    const taskC = taskItems.nth(0); // Task C is at top (index 0)

    await dragTaskVertical(page, taskA, taskC);

    // Wait for reorder to settle by asserting the new first item
    await expect(taskNames.nth(0)).toHaveText('Task A');
  });

  test('undo a reorder', async ({ page }) => {
    await addTask(page, 'First');
    await addTask(page, 'Second');
    await addTask(page, 'Third');

    const taskNames = page.locator('[data-testid^="task-name-"]');

    // Initial order: Third (top), Second, First (bottom)
    await expect(taskNames.nth(0)).toHaveText('Third');

    // Drag Third (top) to bottom
    const taskItems = page.locator('[data-task-id]');
    await dragTaskVertical(page, taskItems.nth(0), taskItems.nth(2));

    // Verify order changed: Third moved to bottom
    await expect(taskNames.nth(2)).toHaveText('Third');

    // Undo
    await page.keyboard.press('Meta+z');

    // Third should be back at top
    await expect(taskNames.nth(0)).toHaveText('Third');
  });
});
