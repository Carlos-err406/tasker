import type { Page, Locator } from '@playwright/test';

/**
 * Wait for the 200ms search debounce + IPC round trip to complete.
 * Call after filling the search input.
 */
export async function waitForSearchDebounce(page: Page): Promise<void> {
  // 200ms debounce + IPC round trip + React re-render
  await page.waitForTimeout(500);
}

/**
 * Drag a task vertically using manual pointer events.
 * Playwright's dragTo() does NOT work with dnd-kit because dnd-kit
 * uses pointermove events (not the HTML5 drag API).
 *
 * The VerticalPointerSensor cancels drag if dx > dy, so movement
 * must be strictly vertical (keep endX === startX).
 */
export async function dragTaskVertical(
  page: Page,
  source: Locator,
  target: Locator,
): Promise<void> {
  const srcBox = await source.boundingBox();
  const tgtBox = await target.boundingBox();
  if (!srcBox || !tgtBox) throw new Error('Cannot get bounding box for drag');

  const startX = srcBox.x + srcBox.width / 2;
  const startY = srcBox.y + srcBox.height / 2;
  const endY = tgtBox.y + tgtBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Initial nudge to activate the 5px threshold
  await page.mouse.move(startX, startY + 6);
  // Move to target with 20 intermediate pointermove events
  await page.mouse.move(startX, endY, { steps: 20 });
  await page.mouse.up();
}

/**
 * Add a task to a list via the UI.
 * Clicks the add button in the list header, types the description,
 * and submits with Cmd+Enter.
 */
export async function addTask(
  page: Page,
  description: string,
  listName = 'tasks',
): Promise<void> {
  // Click the + button in the list header
  const header = page.locator(`[data-testid="list-header-${listName}"]`);
  await header.locator('button', { has: page.locator('svg.lucide-plus') }).click();

  // Fill and submit
  const input = page.locator(`[data-testid="add-task-input-${listName}"]`);
  await input.fill(description);
  // Small delay to ensure React state catches up before submit
  await page.waitForTimeout(50);
  await input.press('Meta+Enter');

  // Wait for the IPC round trip and re-render
  await page.waitForTimeout(200);
}
