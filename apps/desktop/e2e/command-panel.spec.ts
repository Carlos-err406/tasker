import { test, expect } from './fixtures.js';
import { addTask } from './helpers.js';

/** Open the command panel in task mode (Cmd+P) */
async function openTaskPanel(page: Parameters<typeof addTask>[0]) {
  await page.keyboard.press('Meta+p');
  await page.waitForSelector('[data-testid="command-panel"]', { timeout: 3000 });
}

/** Open the command panel in command mode (Cmd+Shift+P) */
async function openCommandPanel(page: Parameters<typeof addTask>[0]) {
  await page.keyboard.press('Meta+Shift+p');
  await page.waitForSelector('[data-testid="command-panel"]', { timeout: 3000 });
}

test.describe('Command Panel', () => {
  test('opens in task mode with Cmd+P', async ({ page }) => {
    await openTaskPanel(page);

    const panel = page.locator('[data-testid="command-panel"]');
    await expect(panel).toBeVisible();

    // Input should be empty in task mode
    const input = page.locator('[data-testid="command-panel-input"]');
    await expect(input).toBeVisible();
    await expect(input).toHaveValue('');
  });

  test('opens in command mode with Cmd+Shift+P', async ({ page }) => {
    await openCommandPanel(page);

    const input = page.locator('[data-testid="command-panel-input"]');
    await expect(input).toBeVisible();
    // Input should start with '>' for command mode
    await expect(input).toHaveValue('>');
  });

  test('closes with Escape', async ({ page }) => {
    await openTaskPanel(page);
    await expect(page.locator('[data-testid="command-panel"]')).toBeVisible();

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await expect(page.locator('[data-testid="command-panel"]')).not.toBeVisible();
  });

  test('task mode: shows tasks and filters by query', async ({ page }) => {
    await addTask(page, 'Buy groceries');
    await addTask(page, 'Write report');
    await addTask(page, 'Buy a book');

    await openTaskPanel(page);
    const input = page.locator('[data-testid="command-panel-input"]');

    // All tasks should be shown initially
    const taskGroup = page.locator('[data-testid="command-panel-tasks-group"]');
    await expect(taskGroup).toBeVisible();

    // Filter by 'Buy'
    await input.fill('Buy');
    await page.waitForTimeout(100);

    const taskItems = page.locator('[data-testid^="command-panel-task-"]');
    await expect(taskItems).toHaveCount(2);
  });

  test('task mode: navigates to task on selection', async ({ page }) => {
    await addTask(page, 'Navigate to me');

    await openTaskPanel(page);

    // Click the task in the panel
    const taskItem = page.locator('[data-testid^="command-panel-task-"]').first();
    await taskItem.click();
    await page.waitForTimeout(300);

    // Panel should close
    await expect(page.locator('[data-testid="command-panel"]')).not.toBeVisible();
  });

  test('typing > switches to command mode', async ({ page }) => {
    await openTaskPanel(page);

    const input = page.locator('[data-testid="command-panel-input"]');
    await input.fill('>');
    await page.waitForTimeout(100);

    // Command mode commands should now be visible
    const undoCmd = page.locator('[data-testid="command-panel-cmd-undo"]');
    await expect(undoCmd).toBeVisible();
  });

  test('command mode: shows immediate commands', async ({ page }) => {
    await openCommandPanel(page);

    // Undo/Redo should be present
    await expect(page.locator('[data-testid="command-panel-cmd-undo"]')).toBeVisible();
    await expect(page.locator('[data-testid="command-panel-cmd-redo"]')).toBeVisible();
    await expect(page.locator('[data-testid="command-panel-cmd-refresh"]')).toBeVisible();
  });

  test('command mode: filters commands by query', async ({ page }) => {
    await openCommandPanel(page);

    const input = page.locator('[data-testid="command-panel-input"]');
    await input.fill('> undo');
    await page.waitForTimeout(100);

    // Only undo should be visible (redo doesn't match 'undo')
    await expect(page.locator('[data-testid="command-panel-cmd-undo"]')).toBeVisible();
    await expect(page.locator('[data-testid="command-panel-cmd-redo"]')).not.toBeVisible();
  });

  test('command mode: set status transitions to task select then sub-pick', async ({ page }) => {
    await addTask(page, 'Status target task');
    await openCommandPanel(page);

    // Click 'Set status'
    const setStatus = page.locator('[data-testid="command-panel-cmd-set-status"]');
    await setStatus.click();
    await page.waitForTimeout(100);

    // Should now show task select step
    const taskSelect = page.locator('[data-testid="command-panel-step-task-select"]');
    await expect(taskSelect).toBeVisible();

    // Select the task
    const taskItem = page.locator('[data-testid^="command-panel-task-"]').first();
    await taskItem.click();
    await page.waitForTimeout(100);

    // Should now show sub-pick (status options)
    const subPick = page.locator('[data-testid="command-panel-step-sub-pick"]');
    await expect(subPick).toBeVisible();

    // Status options should be visible
    await expect(page.locator('[data-testid^="command-panel-subopt-"]')).toHaveCount(3);
  });

  test('task mode: long title renders without overflowing dialog width', async ({ page }) => {
    const longTitle = 'git-aware task linking — auto-detect task IDs in commits and branches for automated workflows';
    await addTask(page, longTitle);

    await openTaskPanel(page);

    const taskItem = page.locator('[data-testid^="command-panel-task-"]').first();
    await expect(taskItem).toBeVisible();

    // Use page.evaluate() to get getBoundingClientRect in CSS pixels (unaffected by DPR)
    const { itemRight, dialogRight } = await page.evaluate(() => {
      const item = document.querySelector('[data-testid^="command-panel-task-"]');
      const dialog = document.querySelector('[data-slot="dialog-content"]');
      return {
        itemRight: item?.getBoundingClientRect().right ?? 0,
        dialogRight: dialog?.getBoundingClientRect().right ?? 0,
      };
    });

    expect(dialogRight).toBeGreaterThan(0);
    expect(itemRight).toBeLessThanOrEqual(dialogRight + 1);
  });

  test('task mode: filters by tag: syntax', async ({ page }) => {
    await addTask(page, 'Buy milk\n#shopping');
    await addTask(page, 'Read a book\n#learning');

    await openTaskPanel(page);
    const input = page.locator('[data-testid="command-panel-input"]');

    await input.fill('tag:shopping');
    await page.waitForTimeout(100);

    const taskItems = page.locator('[data-testid^="command-panel-task-"]');
    await expect(taskItems).toHaveCount(1);
  });

  test('task mode: filters by has:tags syntax', async ({ page }) => {
    await addTask(page, 'Task without tag');
    await addTask(page, 'Task with tag\n#mytag');

    await openTaskPanel(page);
    const input = page.locator('[data-testid="command-panel-input"]');

    await input.fill('has:tags');
    await page.waitForTimeout(100);

    // Only the tagged task should appear
    const taskItems = page.locator('[data-testid^="command-panel-task-"]');
    await expect(taskItems).toHaveCount(1);
  });

  test('task mode: filters by status:done syntax', async ({ page }) => {
    await addTask(page, 'Pending task');
    await addTask(page, 'Done task');

    // Complete the first task via checkbox click
    const checkbox = page.locator('[data-testid^="task-checkbox-"]').first();
    await checkbox.click();
    await page.waitForTimeout(200);

    await openTaskPanel(page);
    const input = page.locator('[data-testid="command-panel-input"]');

    await input.fill('status:done');
    await page.waitForTimeout(100);

    const panelItems = page.locator('[data-testid^="command-panel-task-"]');
    await expect(panelItems).toHaveCount(1);
  });

  test('command mode: undo executes and closes panel', async ({ page }) => {
    await addTask(page, 'Task to undo');
    await expect(page.locator('[data-testid^="task-item-"]')).toHaveCount(1);

    await openCommandPanel(page);
    await page.locator('[data-testid="command-panel-cmd-undo"]').click();
    await page.waitForTimeout(300);

    // Panel should close
    await expect(page.locator('[data-testid="command-panel"]')).not.toBeVisible();

    // Task should be gone (undo removed the creation)
    await expect(page.locator('[data-testid^="task-item-"]')).toHaveCount(0);
  });

  test('command mode: set priority shows 4 options and closes panel after selection', async ({ page }) => {
    await addTask(page, 'Priority target task');
    await openCommandPanel(page);

    // Click 'Set priority'
    const setPriority = page.locator('[data-testid="command-panel-cmd-set-priority"]');
    await setPriority.click();

    // Should show task select step
    await expect(page.locator('[data-testid="command-panel-step-task-select"]')).toBeVisible();

    // Select the task
    await page.locator('[data-testid^="command-panel-task-"]').first().click();

    // Should show sub-pick with 4 priority options (High, Medium, Low, None)
    const subPick = page.locator('[data-testid="command-panel-step-sub-pick"]');
    await expect(subPick).toBeVisible();
    await expect(page.locator('[data-testid^="command-panel-subopt-"]')).toHaveCount(4);

    // Select 'High' (value = Priority.High = 1)
    await page.locator('[data-testid="command-panel-subopt-1"]').click();

    // Panel should close after selection
    await expect(page.locator('[data-testid="command-panel"]')).not.toBeVisible();
  });

  test('command mode: set priority applies priority to task', async ({ page }) => {
    await addTask(page, 'Needs priority');
    await openCommandPanel(page);

    await page.locator('[data-testid="command-panel-cmd-set-priority"]').click();
    await page.locator('[data-testid^="command-panel-task-"]').first().click();
    // Select 'High' (value = 1)
    await page.locator('[data-testid="command-panel-subopt-1"]').click();

    // Panel closed; the task item should now show the high-priority indicator
    await expect(page.locator('[data-testid="command-panel"]')).not.toBeVisible();
    const taskItem = page.locator('[data-testid^="task-item-"]').first();
    // High priority renders '>>>' in the priority indicator span
    await expect(taskItem).toContainText('>>>');
  });
});
