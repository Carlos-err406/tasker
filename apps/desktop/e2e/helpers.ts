import type { Page, Locator } from '@playwright/test';

/**
 * Wait for the 200ms search debounce + IPC round trip to complete.
 * Playwright's expect assertions retry automatically, so explicit waits
 * are not needed — this function is kept as a no-op for call-site compatibility.
 */
export async function waitForSearchDebounce(_page: Page): Promise<void> {
  // no-op: Playwright retries assertions within the configured expect.timeout
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
 *
 * Uses keyboard typing instead of fill() because the input is a
 * contentEditable div — Playwright's fill() only works on form inputs.
 */
export async function addTask(
  page: Page,
  description: string,
  listName = 'tasks',
): Promise<void> {
  // Click the + button in the list header
  const header = page.locator(`[data-testid="list-header-${listName}"]`);
  await header.locator('button', { has: page.locator('svg.lucide-plus') }).click();

  const input = page.locator(`[data-testid="add-task-input-${listName}"]`);
  await input.waitFor({ state: 'visible' });
  await input.click();

  // Handle multiline: split on \n, type each segment, press Enter between
  const lines = description.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]) await page.keyboard.type(lines[i]);
    if (i < lines.length - 1) await input.press('Enter');
  }

  await input.press('Meta+Enter');

  // Wait for the form to close (IPC round trip + re-render complete)
  await input.waitFor({ state: 'hidden' });
}
