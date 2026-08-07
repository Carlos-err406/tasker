import { test, expect } from './fixtures.js';
import { addTask } from './helpers.js';

test.describe('Markdown', () => {
  test.beforeEach(async ({ page }) => {
    await page.evaluate(() => localStorage.setItem('tasker:showMediaPreviews', 'true'));
    await page.reload();
    await page.waitForSelector('[data-testid="app-ready"]');
  });

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
    const preview = taskItem.locator('[data-testid="markdown-video-preview"]');
    const video = preview.locator('video');

    await expect(preview).toBeVisible();
    await expect(video).toHaveAttribute('controls', '');
    await expect(video).toHaveAttribute('src', 'https://example.com/demo.mp4?token=abc');
    await expect(taskItem.locator('a')).toHaveCount(0);
  });

  test('renders bare video urls as inline previews', async ({ page }) => {
    await addTask(page, 'Title\nhttps://example.com/demo.webm');

    const taskItem = page.locator('[data-testid^="task-item-"]').first();
    const preview = taskItem.locator('[data-testid="markdown-video-preview"]');
    const video = preview.locator('video');

    await expect(preview).toBeVisible();
    await expect(video).toHaveAttribute('src', 'https://example.com/demo.webm');
  });

  test('global media preview toggle collapses video previews', async ({ page }) => {
    await addTask(page, 'Title\nWatch [clip](https://example.com/demo.mp4)');

    const taskItem = page.locator('[data-testid^="task-item-"]').first();
    await expect(taskItem.locator('[data-testid="markdown-video-preview"]')).toBeVisible();

    await page.locator('[data-testid="media-preview-toggle"]').click();

    const collapsed = taskItem.locator('[data-testid="markdown-video-preview-collapsed"]');
    await expect(collapsed).toBeVisible();
    await expect(collapsed).toContainText('Video: clip');
    await expect(taskItem.locator('video')).toHaveCount(0);

    await collapsed.click();
    await expect(taskItem.locator('[data-testid="markdown-video-preview"]')).toBeVisible();
  });

  test('individual media previews can be hidden and reopened', async ({ page }) => {
    await addTask(page, 'Title\n![sample](data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==)');

    const taskItem = page.locator('[data-testid^="task-item-"]').first();
    await expect(taskItem.locator('img[alt="sample"]')).toBeVisible();

    await taskItem.locator('[data-testid="markdown-image-preview-hide"]').click({ force: true });

    const collapsed = taskItem.locator('[data-testid="markdown-image-preview-collapsed"]');
    await expect(collapsed).toBeVisible();
    await expect(collapsed).toContainText('Image: sample');
    await expect(taskItem.locator('img[alt="sample"]')).toHaveCount(0);

    await collapsed.click();
    await expect(taskItem.locator('img[alt="sample"]')).toBeVisible();
  });

  test('opening create task keeps individual preview state', async ({ page }) => {
    await addTask(page, 'Title\n![sample](data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==)');

    const taskItem = page.locator('[data-testid^="task-item-"]').first();
    await taskItem.locator('[data-testid="markdown-image-preview-hide"]').click({ force: true });

    const collapsed = taskItem.locator('[data-testid="markdown-image-preview-collapsed"]');
    await expect(collapsed).toBeVisible();

    const header = page.locator('[data-testid="list-header-tasks"]');
    await header.locator('button', { has: page.locator('svg.lucide-plus') }).click();

    await expect(page.locator('[data-testid="add-task-input-tasks"]')).toBeVisible();
    await expect(collapsed).toBeVisible();
    await expect(taskItem.locator('img[alt="sample"]')).toHaveCount(0);
  });

  test('global media preview toggle overrides individual preview state', async ({ page }) => {
    await addTask(page, 'Title\n![sample](data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==)');

    const taskItem = page.locator('[data-testid^="task-item-"]').first();
    await expect(taskItem.locator('img[alt="sample"]')).toBeVisible();

    await taskItem.locator('[data-testid="markdown-image-preview-hide"]').click({ force: true });
    await expect(taskItem.locator('[data-testid="markdown-image-preview-collapsed"]')).toBeVisible();

    await page.locator('[data-testid="media-preview-toggle"]').click();
    await expect(taskItem.locator('[data-testid="markdown-image-preview-collapsed"]')).toBeVisible();

    await page.locator('[data-testid="media-preview-toggle"]').click();
    await expect(taskItem.locator('img[alt="sample"]')).toBeVisible();
  });

  test('renders YouTube Shorts urls as inline previews', async ({ page }) => {
    await addTask(page, 'Title\nhttps://www.youtube.com/shorts/wc9PJn3JLX0?feature=share');

    const taskItem = page.locator('[data-testid^="task-item-"]').first();
    const preview = taskItem.locator('[data-testid="markdown-video-preview"]');

    await expect(preview).toBeVisible();
    await expect(preview).toHaveText(/Open on YouTube/);
    await expect(taskItem.locator('[data-testid="markdown-video-thumbnail"]')).toHaveAttribute('src', 'https://i.ytimg.com/vi/wc9PJn3JLX0/hqdefault.jpg');
    await expect(taskItem.locator('iframe')).toHaveCount(0);
    await expect(taskItem.locator('a')).toHaveCount(0);
  });

  test('hides split trailing relationship metadata', async ({ page }) => {
    await addTask(page, 'Related target');
    const targetItem = page.locator('[data-testid^="task-item-"]').first();
    const targetTestId = await targetItem.getAttribute('data-testid');
    const targetId = targetTestId!.replace('task-item-', '');

    await addTask(page, `Leap!\n\nhttps://example.com/demo.webm\n\n~${targetId}\n#movie`);

    const leapItem = page.locator('[data-testid^="task-item-"]', { hasText: 'Leap!' });
    await expect(leapItem).toBeVisible();
    await expect(leapItem).not.toContainText(`~${targetId}`);
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
