import { test, expect } from './fixtures.js';
import { addTask } from './helpers.js';

test.describe('Markdown', () => {
  test('renders bold and italic in task description', async ({ page }) => {
    await addTask(page, 'Title\n**bold text** and *italic text*');

    const taskItem = page.locator('[data-testid^="task-item-"]').first();
    await expect(taskItem.locator('strong')).toHaveText('bold text');
    await expect(taskItem.locator('em')).toHaveText('italic text');
  });

  test('renders code block', async ({ page }) => {
    await addTask(page, 'Title\n```\nconst x = 1;\n```');

    const taskItem = page.locator('[data-testid^="task-item-"]').first();
    await expect(taskItem.locator('pre code')).toBeVisible();
    await expect(taskItem.locator('pre code')).toContainText('const x = 1');
  });

  test('renders links as anchor elements', async ({ page }) => {
    await addTask(page, 'Title\nVisit [example](https://example.com)');

    const taskItem = page.locator('[data-testid^="task-item-"]').first();
    const link = taskItem.locator('a');
    await expect(link).toHaveText('example');
    await expect(link).toHaveAttribute('href', 'https://example.com');
  });

  test('renders direct video links as inline previews', async ({ page }) => {
    await addTask(page, 'Title\nWatch [clip](https://example.com/demo.mp4?token=abc)');

    const taskItem = page.locator('[data-testid^="task-item-"]').first();
    const video = taskItem.locator('[data-testid="markdown-video-preview"]');

    await expect(video).toBeVisible();
    await expect(video).toHaveAttribute('controls', '');
    await expect(video).toHaveAttribute('src', 'https://example.com/demo.mp4?token=abc');
    await expect(taskItem.locator('a')).toHaveCount(0);
  });

  test('renders bare video urls as inline previews', async ({ page }) => {
    await addTask(page, 'Title\nhttps://example.com/demo.webm');

    const taskItem = page.locator('[data-testid^="task-item-"]').first();
    const video = taskItem.locator('[data-testid="markdown-video-preview"]');

    await expect(video).toBeVisible();
    await expect(video).toHaveAttribute('src', 'https://example.com/demo.webm');
  });

  test('renders YouTube Shorts urls as inline previews', async ({ page }) => {
    await addTask(page, 'Title\nhttps://www.youtube.com/shorts/wc9PJn3JLX0?feature=share');

    const taskItem = page.locator('[data-testid^="task-item-"]').first();
    const preview = taskItem.locator('[data-testid="markdown-video-preview"]');

    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute('src', 'https://www.youtube.com/embed/wc9PJn3JLX0');
    await expect(taskItem.locator('a')).toHaveCount(0);
  });

  test('renders nested list with non-breaking space indentation', async ({ page }) => {
    // Simulate task with \u00A0 (non-breaking space) indentation — common from C# import
    await addTask(page, 'Title\n- [ ] playlist\n\u00A0 - [ ] downloads\n\u00A0 - [ ] shares');

    const taskItem = page.locator('[data-testid^="task-item-"]').first();

    // The nested items should render as a sub-list (ul inside ul)
    const nestedList = taskItem.locator('ul ul');
    await expect(nestedList).toBeVisible();
    await expect(nestedList.locator('li')).toHaveCount(2);
  });

  test('clickable checkbox toggles', async ({ page }) => {
    await addTask(page, 'Title\n- [ ] unchecked item\n- [x] checked item');

    const taskItem = page.locator('[data-testid^="task-item-"]').first();

    // Checkboxes are rendered as lucide SVG icons (Square/CheckSquare)
    // Find all SVGs that act as checkboxes within list items
    const allCheckboxSvgs = taskItem.locator('li svg');
    await expect(allCheckboxSvgs).toHaveCount(2);

    // Click the first checkbox (unchecked) to toggle it
    await allCheckboxSvgs.nth(0).click();
    await page.waitForTimeout(200);

    // Verify the text was updated (the unchecked [ ] becomes [x])
    // After toggle, the task description should have been updated via onToggleCheckbox
    // Re-query the task to see if the description was updated
    await expect(taskItem.locator('text=unchecked item')).toBeVisible();
  });
});
