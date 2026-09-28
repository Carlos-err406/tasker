import { test as base, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startService } from "../../src/service/server.js";
const test = base.extend<{
  service: Awaited<ReturnType<typeof startService>> & {
    openedTargets: string[];
  };
}>({
  service: async ({}, use) => {
    const directory = await mkdtemp(join(tmpdir(), "tasker-popover-"));
    const openedTargets: string[] = [];
    const s = await startService({
      directory,
      assets: resolve("dist"),
      automaticBackups: false,
      openTarget: async (target) => {
        openedTargets.push(target);
      },
    });
    try {
      await use({ ...s, openedTargets });
    } finally {
      await s.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
  page: async ({ page, service }, use) => {
    await page.goto(service.origin + "/#" + service.token);
    await expect(page.getByTestId("tasker-app")).toBeVisible();
    await use(page);
  },
});
async function add(page: import("@playwright/test").Page, text: string) {
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  const input = page.locator("[contenteditable=true]").first();
  await input.fill(text);
  await input.press("Meta+Enter");
  await expect(input).not.toBeVisible();
}
test("creates tasks with metadata, persists exact checkbox line, and undoes it", async ({
  page,
}) => {
  await add(page, "Example\n\n- [ ] same\n- [ ] same\np1 #demo");
  const task = page.locator('[data-testid^="task-item-"]').first();
  await expect(task).toContainText("Example");
  await expect(task).not.toContainText("p1");
  await task.locator("li svg").nth(1).click();
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const r = await fetch("/rpc", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-tasker-request": "1",
          },
          body: JSON.stringify({ channel: "tasks:getAll", args: [] }),
        });
        return (await r.json())[1][0].description;
      }),
    )
    .toContain("- [ ] same\n- [x] same");
  await page.reload();
  await expect(task.locator("li svg")).toHaveCount(2);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const r = await fetch("/rpc", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-tasker-request": "1",
          },
          body: JSON.stringify({ channel: "tasks:getAll", args: [] }),
        });
        return (await r.json())[1][0].description;
      }),
    )
    .toContain("- [ ] same\n- [ ] same");
});
test("edits multiline content and preserves keyboard formatting in WebKit", async ({
  page,
}) => {
  await add(page, "Title\nSecond line");
  await page.locator('[data-testid^="task-item-"]').click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  const editor = page.getByTestId("task-edit-input");
  await expect(editor).toBeVisible();
  await editor.fill("Title\n\nParagraph");
  await editor.press("Meta+End");
  await editor.press("Meta+Shift+ArrowLeft");
  await editor.press("Meta+b");
  await expect(editor).toContainText("**Paragraph**");
  await editor.press("Meta+Enter");
  await expect(page.locator('[data-testid^="task-name-"]')).toHaveText("Title");
  await page.reload();
  await expect(page.locator('[data-testid^="task-item-"] strong')).toHaveText(
    "Paragraph",
  );
});
test("keeps harmless underline but strips executable task HTML", async ({
  page,
}) => {
  await add(
    page,
    'Safe\n<u>Underlined</u><script>window.pwned=true</script><img src="x" onerror="window.pwned=true">',
  );
  await expect(page.locator("u")).toHaveText("Underlined");
  expect(
    await page.evaluate(() => Reflect.get(window, "pwned")),
  ).toBeUndefined();
  await page.screenshot({
    path: "test-results/popover-webkit.png",
    fullPage: true,
  });
});

test("renders table and divider after macOS smart-dash substitution", async ({
  page,
}) => {
  await add(
    page,
    "Hello title\nDescription\n|h1|h2|\n|—|—|\n|d1|d2|\n\n—\n\n> quote\n\np1 #tag",
  );
  const task = page.locator('[data-testid^="task-item-"]').first();
  await expect(task.locator("table")).toBeVisible();
  await expect(task.locator("th")).toHaveText(["h1", "h2"]);
  await expect(task.locator("td")).toHaveText(["d1", "d2"]);
  await expect(task.locator("hr")).toHaveCount(1);
  await expect(task.locator("blockquote")).toContainText("quote");
});

test("keeps a failed creation draft for retry", async ({ page }) => {
  await page.route("**/rpc", async (route) => {
    if (route.request().postDataJSON()?.channel === "tasks:add")
      await route.fulfill({ status: 400, body: "Save failed for test" });
    else await route.continue();
  });
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  await page.locator("[contenteditable=true]").first().fill("Draft to keep");
  await page.locator("[contenteditable=true]").first().press("Meta+Enter");
  const editor = page.locator("[contenteditable=true]").first();
  await expect(editor).toHaveText("Draft to keep");
  await expect(page.locator(".status")).toContainText("Save failed for test");
  await page.unroute("**/rpc");
  await editor.press("Meta+Enter");
  await expect(page.locator('[data-testid^="task-name-"]')).toHaveText(
    "Draft to keep",
  );
});
test("pastes an image, restores its bytes, and recovers the safety snapshot", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  const editor = page.locator("[contenteditable=true]").first();
  await editor.fill("Image task\n");
  await editor.evaluate((element) => {
    const bytes = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1kAAAAASUVORK5CYII=",
      ),
      (c) => c.charCodeAt(0),
    );
    const clipboardData = new DataTransfer();
    clipboardData.items.add(
      new File([bytes], "pixel.png", { type: "image/png" }),
    );
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(editor).toContainText("/attachments/");
  await editor.press("Meta+Enter");
  const image = page.locator('[data-testid^="task-item-"] img');
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBe(1);
  const source = await image.getAttribute("src");
  await page.getByRole("button", { name: "Backups", exact: true }).click();
  await page.getByRole("button", { name: "Back up now", exact: true }).click();
  await expect(page.locator(".backup-row")).toHaveCount(1);
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await add(page, "Later task");
  await page.getByRole("button", { name: "Backups", exact: true }).click();
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await page
    .getByRole("button", { name: "Restore backup", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.locator(".backup-row")).toHaveCount(2);
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(page.locator('[data-testid^="task-item-"]')).toHaveCount(1);
  await expect(image).toHaveAttribute("src", source!);
  await page.reload();
  await expect
    .poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBe(1);
  await page.getByRole("button", { name: "Backups", exact: true }).click();
  await page
    .locator(".backup-row")
    .filter({ hasText: "safety" })
    .getByRole("button", { name: "Restore", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Restore backup", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(page.locator('[data-testid^="task-item-"]')).toHaveCount(2);
});

test("keeps status order, searches tags, and restores from trash", async ({
  page,
}) => {
  await add(page, "First task\n#first");
  await add(page, "Second task\n#second");
  const names = page.locator('[data-testid^="task-name-"]');
  await expect(names).toHaveText(["Second task", "First task"]);
  await page.locator('[data-testid^="task-checkbox-"]').first().click();
  await expect(names).toHaveText(["Second task", "First task"]);
  await page.getByRole("textbox", { name: "Search tasks" }).fill("#first");
  await expect(names).toHaveText(["First task"]);
  await page.getByRole("textbox", { name: "Search tasks" }).fill("");
  await expect(names).toHaveCount(2);
  await page
    .locator('[data-testid^="task-item-"]')
    .filter({ hasText: "First task" })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await expect(names).toHaveCount(1);
  await page.getByRole("button", { name: "Trash", exact: true }).click();
  await expect(page.locator('[data-testid^="trash-item-"]')).toContainText(
    "First task",
  );
  await page.getByTitle("Restore", { exact: true }).click();
  await expect(page.locator('[data-testid^="trash-item-"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(names).toHaveCount(2);
});
test("creates a list and moves a task through its nested menu", async ({
  page,
}) => {
  await add(page, "Move me");
  await page.getByRole("button", { name: "Create list", exact: true }).click();
  await page.getByRole("textbox", { name: "New list name" }).fill("work");
  await page.getByRole("button", { name: "Add list", exact: true }).click();
  await expect(page.getByTestId("list-section-work")).toBeVisible();
  await page.locator('[data-testid^="task-item-"]').click({ button: "right" });
  await page.getByRole("menuitem", { name: /Move to/ }).hover();
  const item = page.getByRole("menuitem", { name: "work", exact: true });
  await expect(item).toBeVisible();
  await item.dispatchEvent("click");
  await expect(
    page
      .getByTestId("list-section-work")
      .locator('[data-testid^="task-name-"]'),
  ).toHaveText("Move me");
  await page.reload();
  await expect(
    page
      .getByTestId("list-section-work")
      .locator('[data-testid^="task-name-"]'),
  ).toHaveText("Move me");
});

test("uses the system palette before JavaScript starts", async ({
  browser,
  service,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    colorScheme: "dark",
  });
  try {
    const page = await context.newPage();
    await page.goto(service.origin);
    await expect
      .poll(() =>
        page.evaluate(() =>
          (() => {
            const value = getComputedStyle(
              document.documentElement,
            ).getPropertyValue("--background");
            const lightness = Number(value.match(/oklch\(([\d.]+)/)?.[1]);
            return value.includes("%") ? lightness / 100 : lightness;
          })(),
        ),
      )
      .toBeCloseTo(0.141);
    await expect(page.locator("html")).toHaveCSS("color-scheme", "light dark");
  } finally {
    await context.close();
  }
});
test("follows live system theme changes", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await expect
    .poll(() =>
      page.evaluate(() =>
        (() => {
          const value = getComputedStyle(
            document.documentElement,
          ).getPropertyValue("--background");
          const lightness = Number(value.match(/oklch\(([\d.]+)/)?.[1]);
          return value.includes("%") ? lightness / 100 : lightness;
        })(),
      ),
    )
    .toBeCloseTo(0.141);
  await page.emulateMedia({ colorScheme: "light" });
  await expect
    .poll(() =>
      page.evaluate(() =>
        (() => {
          const value = getComputedStyle(
            document.documentElement,
          ).getPropertyValue("--background");
          const lightness = Number(value.match(/oklch\(([\d.]+)/)?.[1]);
          return value.includes("%") ? lightness / 100 : lightness;
        })(),
      ),
    )
    .toBeCloseTo(1);
});

test("keeps compact tools and footer visible while tasks scroll", async ({
  page,
}) => {
  await add(
    page,
    "Hello title\nDescription\n|h1|h2|\n|—|—|\n|d1|d2|\n\n—\n\n> quote\n\np1 #tag #tag2 @tomorrow",
  );
  await expect(
    page.getByRole("textbox", { name: "New list name" }),
  ).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Search tasks" })).toHaveCSS(
    "font-size",
    "12px",
  );
  for (const theme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect
      .poll(() =>
        page
          .locator('[data-testid^="task-name-"]')
          .evaluate((el) => getComputedStyle(el).color),
      )
      .toBe(
        await page
          .locator("#root")
          .evaluate((el) => getComputedStyle(el).color),
      );
    await expect(page.locator("footer").getByRole("status")).toHaveText(
      "1 pending",
    );
    await page.screenshot({
      path: `test-results/popover-${theme}.png`,
    });
  }
  // A narrow host must keep the contextual list form on one row.
  await page.setViewportSize({ width: 360, height: 500 });
  await page.getByRole("button", { name: "Create list", exact: true }).click();
  const input = page.getByRole("textbox", { name: "New list name" });
  await expect(input).toBeFocused();
  const field = await input.boundingBox();
  const submit = await page
    .getByRole("button", { name: "Add list", exact: true })
    .boundingBox();
  expect(Math.abs(field!.y - submit!.y)).toBeLessThan(3);
  await input.press("Escape");
  await expect(input).toHaveCount(0);
  await page.setViewportSize({ width: 420, height: 588 });
  await add(
    page,
    "Long task\n" +
      Array.from({ length: 40 }, (_, i) => `Paragraph ${i}`).join("\n\n"),
  );
  const workspace = page.getByTestId("task-workspace");
  const footerBefore = await page.locator("footer").boundingBox();
  await workspace.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  expect(await workspace.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(await page.locator("footer").boundingBox()).toEqual(footerBefore);
  expect(footerBefore!.y + footerBefore!.height).toBe(588);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    420,
  );
  await expect(
    page.getByRole("button", { name: "Backups", exact: true }),
  ).toBeInViewport();
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeInViewport();
});

test("list options work for default and custom lists", async ({ page }) => {
  const options = page.getByRole("button", {
    name: "List options for tasks",
    exact: true,
  });
  await options.click();
  await expect(
    page.getByRole("menuitem", { name: "Rename", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("menuitem", { name: "Delete", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Add task", exact: true }).click();
  const editor = page.getByTestId("add-task-input-tasks");
  await expect(editor).toBeFocused();
  await editor.fill("From list menu");
  await editor.press("Meta+Enter");
  await expect(editor).not.toBeVisible();
  await page.locator('[data-testid^="task-checkbox-"]').click();
  await options.click();
  await page
    .getByRole("menuitem", { name: "Hide completed tasks", exact: true })
    .click();
  await expect(page.locator('[data-testid^="task-name-"]')).toHaveCount(0);
  await options.click();
  await page
    .getByRole("menuitem", { name: "Show completed tasks", exact: true })
    .click();
  await expect(page.locator('[data-testid^="task-name-"]')).toHaveText(
    "From list menu",
  );
  await options.click();
  await page
    .getByRole("menuitem", { name: "Collapse list", exact: true })
    .click();
  await expect(
    page.locator('[data-testid^="task-name-"]'),
  ).not.toBeInViewport();
  await options.focus();
  await options.press("Enter");
  await page
    .getByRole("menuitem", { name: "Expand list", exact: true })
    .click();
  await expect(page.locator('[data-testid^="task-name-"]')).toHaveText(
    "From list menu",
  );
  await page.getByRole("button", { name: "Create list", exact: true }).click();
  await page.getByRole("textbox", { name: "New list name" }).fill("work");
  await page.getByRole("button", { name: "Add list", exact: true }).click();
  await page
    .getByRole("button", { name: "List options for work", exact: true })
    .click();
  await expect(
    page.getByRole("menuitem", { name: "Delete", exact: true }),
  ).toBeVisible();
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  const name = page.getByTestId("list-name-input-work");
  await expect(name).toBeFocused();
  await name.fill("Projects");
  await name.press("Enter");
  await expect(page.getByTestId("list-section-Projects")).toBeVisible();
  await options.click();
  await expect(
    page.getByRole("menuitem", { name: "Add task", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("menu")).toHaveCSS("opacity", "1");
  await page.screenshot({ path: "test-results/list-options.png" });
});

test("panel headers match and toolbar icons have equal spacing", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  const boxes = await Promise.all(
    [
      "Create list",
      "Collapse all lists",
      "Hide previews",
      "System sort",
      "Trash",
      "Backups",
      "Help",
    ].map((name) =>
      page.getByRole("button", { name, exact: true }).boundingBox(),
    ),
  );
  const gaps = boxes
    .slice(1)
    .map((box, i) => box!.x - boxes[i]!.x - boxes[i]!.width);
  expect(new Set(gaps).size).toBe(1);
  await page.getByRole("button", { name: "Trash", exact: true }).click();
  const trash = await page.getByTestId("panel-header").boundingBox();
  await page.screenshot({ path: "test-results/trash-header.png" });
  await page
    .getByRole("button", { name: "Back to tasks", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Search tasks" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Backups", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Backups", exact: true }),
  ).toBeVisible();
  expect(await page.getByTestId("panel-header").boundingBox()).toEqual(trash);
  await page.screenshot({ path: "test-results/backups-header.png" });
  await page
    .getByRole("button", { name: "Back to tasks", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Search tasks" }),
  ).toBeVisible();
});

test("opens the original help reference, scrolls it, and returns by keyboard", async ({
  page,
}) => {
  await add(page, "Keep this task\n#reference");
  const help = page.getByRole("button", { name: "Help", exact: true });
  await help.click();
  const panel = page.getByTestId("help-panel");
  await expect(panel).toBeFocused();
  for (const section of [
    "Metadata Prefixes",
    "Date Formats",
    "Search Filters",
    "Keyboard Shortcuts",
    "Editing Shortcuts",
  ]) {
    await expect(
      panel.getByRole("heading", { name: section, exact: true }),
    ).toHaveCount(1);
  }
  await expect(panel).toContainText("-!abc");
  await expect(panel).toContainText("status:!done");
  await expect(panel).toContainText("Paste image from clipboard");
  await expect(panel).not.toContainText("Command palette");
  const header = page.getByTestId("panel-header");
  const initialHeader = await header.boundingBox();
  await panel
    .getByText("Paste image from clipboard", { exact: true })
    .scrollIntoViewIfNeeded();
  await expect(panel.getByText("Save task", { exact: true })).toBeInViewport();
  expect(await header.boundingBox()).toEqual(initialHeader);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(help).toBeFocused();
  await expect(page.locator('[data-testid^="task-name-"]')).toHaveText(
    "Keep this task",
  );
  await page.keyboard.press("Meta+/");
  await expect(panel).toBeVisible();
  await page.keyboard.press("Meta+/");
  await expect(panel).toHaveCount(0);
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await help.click();
    await expect(
      panel.getByRole("heading", { name: "Metadata Prefixes" }),
    ).toBeInViewport();
    await page.screenshot({ path: `test-results/help-${theme}.png` });
    await page
      .getByRole("button", { name: "Back to tasks", exact: true })
      .click();
    await expect(help).toBeFocused();
  }
});

test("toolbar sorts tasks and collapses all lists with persistent results", async ({
  page,
}) => {
  await add(page, "High priority\np1");
  await add(page, "Low priority\np3");
  const names = page
    .getByTestId("list-section-tasks")
    .locator('[data-testid^="task-name-"]');
  await expect(names).toHaveText(["Low priority", "High priority"]);
  await page.getByRole("button", { name: "System sort", exact: true }).click();
  await expect(names).toHaveText(["High priority", "Low priority"]);
  await page.reload();
  await expect(names).toHaveText(["High priority", "Low priority"]);
  await page.getByRole("button", { name: "Create list", exact: true }).click();
  await page.getByRole("textbox", { name: "New list name" }).fill("work");
  await page.getByRole("button", { name: "Add list", exact: true }).click();
  const work = page.getByTestId("list-section-work");
  await work.getByRole("button", { name: "Add task", exact: true }).click();
  const editor = page.getByTestId("add-task-input-work");
  await editor.fill("Work task");
  await editor.press("Meta+Enter");
  await expect(editor).not.toBeVisible();
  const workName = work.locator('[data-testid^="task-name-"]');
  await page.getByTestId("list-collapse-work").click();
  await page
    .getByRole("button", { name: "Collapse all lists", exact: true })
    .click();
  await expect(names.first()).not.toBeInViewport();
  await expect(workName).not.toBeInViewport();
  await expect(
    page.getByRole("button", { name: "Expand all lists", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Expand all lists", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Expand all lists", exact: true })
    .click();
  await expect(names.first()).toBeInViewport();
  await expect(workName).toBeInViewport();
  await page.keyboard.press("Meta+e");
  await expect(
    page.getByRole("button", { name: "Expand all lists", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Meta+e");
  await expect(
    page.getByRole("button", { name: "Collapse all lists", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Meta+j");
  await expect(page.locator("footer").getByRole("status")).toHaveText(
    "Sorted 2 lists",
  );
  await page.setViewportSize({ width: 360, height: 588 });
  await expect(
    page.getByRole("button", { name: "Help", exact: true }),
  ).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    360,
  );
  await page.screenshot({ path: "test-results/complete-toolbar.png" });
});

test("action tooltips show keycaps and undo shortcuts work outside editors", async ({
  page,
}) => {
  const shortcuts = [
    { name: "Collapse all lists", keys: ["⌘", "E"] },
    { name: "Hide previews", keys: ["⌘", "P"] },
    { name: "System sort", keys: ["⌘", "J"] },
    { name: "Undo", keys: ["⌘", "Z"] },
    { name: "Redo", keys: ["⌘", "⇧", "Z"] },
    { name: "Help", keys: ["⌘", "/"] },
  ];
  for (const { name, keys } of shortcuts) {
    await page.getByRole("button", { name, exact: true }).hover();
    const tip = page.getByRole("tooltip");
    await expect(tip).toBeVisible();
    await expect(tip.locator('[data-slot="kbd"]')).toHaveText(keys);
    await expect(tip).toContainText(name === "Help" ? "Toggle help" : name);
    await page.keyboard.press("Escape");
    await page.mouse.move(10, 300, { steps: 10 });
    await expect(tip).toHaveCount(0);
  }
  await page.getByRole("button", { name: "Help", exact: true }).hover();
  await expect(page.getByRole("tooltip")).toContainText("Toggle help");
  await page.screenshot({ path: "test-results/shortcut-tooltip.png" });
  await page.keyboard.press("Escape");
  await page.mouse.move(10, 300, { steps: 10 });
  await page.getByRole("button", { name: "Create list", exact: true }).hover();
  await expect(page.getByRole("tooltip")).toContainText("Create list");
  await expect(
    page.getByRole("tooltip").locator('[data-slot="kbd"]'),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Create list", exact: true }).click();
  const listInput = page.getByRole("textbox", { name: "New list name" });
  await listInput.fill("Draft list");
  for (const [name, key] of [
    ["Add list", "↵"],
    ["Cancel new list", "Esc"],
  ]) {
    await page.mouse.move(10, 300, { steps: 10 });
    await page.getByRole("button", { name, exact: true }).hover();
    await expect(
      page.getByRole("tooltip").locator('[data-slot="kbd"]'),
    ).toHaveText([key]);
  }
  await listInput.press("Escape");
  await expect(listInput).toHaveCount(0);
  await add(page, "Undo shortcut task");
  const names = page.locator('[data-testid^="task-name-"]');
  await page.keyboard.press("Meta+z");
  await expect(names).toHaveCount(0);
  await page.keyboard.press("Meta+Shift+z");
  await expect(names).toHaveText("Undo shortcut task");
  const search = page.getByRole("textbox", { name: "Search tasks" });
  await search.focus();
  await search.press("Meta+z");
  await expect(names).toHaveText("Undo shortcut task");
  await page.reload();
  await expect(names).toHaveText("Undo shortcut task");
});

test("Command-P toggles media previews and persists the preference", async ({
  page,
}) => {
  await page.route("https://example.test/diagram.png", (route) =>
    route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
        "base64",
      ),
    }),
  );
  await add(page, "Preview task\n![diagram](https://example.test/diagram.png)");
  await expect(page.getByTestId("markdown-image-preview-hide")).toBeVisible();
  await page.keyboard.press("Meta+p");
  await expect(
    page.getByRole("button", { name: "Show previews", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByTestId("markdown-image-preview-collapsed"),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByTestId("markdown-image-preview-collapsed"),
  ).toBeVisible();
  await page.keyboard.press("Meta+p");
  await expect(
    page.getByRole("button", { name: "Hide previews", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("markdown-image-preview-hide")).toBeVisible();
  await page
    .getByRole("button", { name: "Hide previews", exact: true })
    .click();
  await expect(
    page.getByTestId("markdown-image-preview-collapsed"),
  ).toBeVisible();
  await page.keyboard.press("Meta+p");
  await expect(page.getByTestId("markdown-image-preview-hide")).toBeVisible();
});

test("copying a task ID preserves mounted media while status appears and clears", async ({
  page,
}) => {
  const pixel = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1kAAAAASUVORK5CYII=",
    "base64",
  );
  await page.route("https://example.com/image.png", (route) =>
    route.fulfill({ contentType: "image/png", body: pixel }),
  );
  await page.route("https://i.ytimg.com/**", (route) =>
    route.fulfill({ contentType: "image/png", body: pixel }),
  );
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, "writeText", {
      value: async (text: string) => {
        Reflect.set(window, "copiedText", text);
      },
    });
  });
  await add(
    page,
    "Media\n\n![image](https://example.com/image.png)\n\n[Video](https://youtu.be/abcdefghijk)",
  );
  const task = page.locator('[data-testid^="task-item-"]');
  await expect(task.locator("img")).toHaveCount(2);
  await expect(task.locator("img").first()).toBeVisible();
  await expect(task.getByTestId("markdown-video-loading")).toHaveCount(0);
  const media = await task.locator("img").elementHandles();
  const id = (await task.getAttribute("data-testid"))!.replace(
    "task-item-",
    "",
  );
  await task.getByRole("button", { name: id, exact: true }).click();
  await expect(page.locator(".status")).toContainText(`Copied: ${id}`);
  expect(await page.evaluate(() => Reflect.get(window, "copiedText"))).toBe(id);
  for (const node of media)
    expect(await node.evaluate((img) => img.isConnected)).toBe(true);
  await expect(page.locator(".status")).not.toContainText("Copied:", {
    timeout: 5000,
  });
  for (const node of media)
    expect(await node.evaluate((img) => img.isConnected)).toBe(true);
});

test("opens pasted images from both click and context menu without exposing a database path", async ({
  page,
  service,
}) => {
  const reference = await page.evaluate(async () => {
    const bytes = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1kAAAAASUVORK5CYII=",
      ),
      (c) => c.charCodeAt(0),
    );
    const result = await fetch("/attachments", {
      method: "POST",
      headers: { "content-type": "image/png", "x-tasker-request": "1" },
      body: bytes,
    });
    return (await result.json()).reference;
  });
  await add(page, `Stored image\n\n![photo](${reference})`);
  const image = page.locator('[data-testid^="task-item-"] img');
  await expect(image).toBeVisible();
  await image.click();
  await expect.poll(() => service.openedTargets.length).toBe(1);
  await image.click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "Copy image path", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("menuitem", { name: "Copy image", exact: true }),
  ).toBeVisible();
  await page.getByRole("menuitem", { name: "Open image", exact: true }).click();
  await expect.poll(() => service.openedTargets.length).toBe(2);
  expect(service.openedTargets[1]).toBe(service.openedTargets[0]);
  expect(service.openedTargets[0]).toMatch(/\.png$/);
  await page.route("**/manage", (route) =>
    route.fulfill({ status: 400, body: "Native open failed" }),
  );
  await image.click();
  await expect(page.getByRole("alert")).toHaveText(
    "Could not open image. Try again.",
  );
});

for (const richText of [false, true, "claude-list"]) {
  for (const breakKey of ["Enter", "Shift+Enter"]) {
    test(`preserves line breaks inserted into pasted ${richText === "claude-list" ? "Claude list" : richText ? "paragraph" : "plain text"} with ${breakKey} when creating a task`, async ({
      page,
    }) => {
      const text =
        "The E-Myth Revisited (El mito del emprendedor), Michael Gerber. It explains why skilled workers who start businesses often end up just giving themselves a harder job, and how to build systems instead. As a developer you'll probably love it.";
      await page.getByRole("button", { name: "Add task", exact: true }).click();
      const editor = page.getByTestId("add-task-input-tasks");
      await editor.focus();
      await editor.evaluate(
        (_, { text, richText }) => {
          // Insert the DOM produced by pasting a browser paragraph, then use real Enter keys.
          document.execCommand(
            richText ? "insertHTML" : "insertText",
            false,
            richText === "claude-list"
              ? `<ul dir="ltr"><li><em><strong>${text}</strong></em></li></ul>`
              : richText
                ? `<p>${text}</p>`
                : text,
          );
        },
        { text, richText },
      );
      for (const nextLine of ["Michael Gerber.", "It explains why"]) {
        await editor.evaluate((el, nextLine) => {
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          let node: Node | null;
          while ((node = walker.nextNode())) {
            const offset = node.textContent!.indexOf(nextLine);
            if (offset < 0) continue;
            const range = document.createRange();
            range.setStart(node, offset);
            range.collapse(true);
            const selection = window.getSelection()!;
            selection.removeAllRanges();
            selection.addRange(range);
            return;
          }
          throw new Error("Text for caret not found");
        }, nextLine);
        await editor.press(breakKey);
      }
      const html = await editor.innerHTML();
      await editor.press("Meta+Enter");
      await expect(editor).not.toBeVisible();
      const stored = await page.evaluate(async () => {
        const response = await fetch("/rpc", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-tasker-request": "1",
          },
          body: JSON.stringify({ channel: "tasks:getAll", args: [] }),
        });
        return (await response.json())[1][0].description as string;
      });
      expect(stored.replace(/\u00a0/g, " "), html).toBe(
        text
          .replace("Michael Gerber.", "\nMichael Gerber.")
          .replace("It explains why", "\nIt explains why"),
      );
      await page.reload();
      const task = page.locator('[data-testid^="task-item-"]');
      await expect(task.locator('[data-testid^="task-name-"]')).toHaveText(
        "The E-Myth Revisited (El mito del emprendedor),",
      );
      await task.click({ button: "right" });
      await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
      const edit = page.getByTestId("task-edit-input");
      await expect(edit).toHaveText(stored, { useInnerText: true });
      await edit.press("Meta+End");
      await edit.press("Enter");
      await edit.pressSequentially("Extra line");
      await edit.press("Meta+Enter");
      await expect(edit).not.toBeVisible();
      await page.reload();
      await task.click({ button: "right" });
      await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
      await expect(edit).toHaveText(stored + "\nExtra line", {
        useInnerText: true,
      });
    });
  }
}

test("keeps a bottom-of-list task focused when its context menu opens Edit", async ({
  page,
}) => {
  const description =
    "Rich Dad Poor Dad (Padre rico, padre pobre)\nRobert Kiyosaki.\nWorth reading for the mindset shift from employee to owner, and it's a quick read. Take it as motivation rather than a manual, though. The actual advice is vague and some of it is questionable.";
  const id = await page.evaluate(async (description) => {
    const add = async (text: string) => {
      const response = await fetch("/rpc", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-tasker-request": "1",
        },
        body: JSON.stringify({ channel: "tasks:add", args: [text, "tasks"] }),
      });
      return (await response.json())[1].task.id;
    };
    const id = await add(description);
    for (let i = 0; i < 8; i++)
      await add(
        `Book ${i}\nAuthor\n${"A long description of this book. ".repeat(5)}`,
      );
    return id;
  }, description);
  await page.reload();
  const task = page.getByTestId(`task-item-${id}`);
  await task.scrollIntoViewIfNeeded();
  const workspace = page.locator(".task-workspace");
  const scrollBefore = await workspace.evaluate((el) => el.scrollTop);
  await task.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  const editor = page.getByTestId("task-edit-input");
  // Let context-menu focus restoration and the editor's deferred initialization finish.
  await page.waitForTimeout(250);
  await expect(editor).toBeFocused();
  await expect(editor).toHaveText(description, { useInnerText: true });
  expect(await workspace.evaluate((el) => el.scrollTop)).toBeGreaterThanOrEqual(
    scrollBefore - 2,
  );
  await editor.press("Meta+End");
  await editor.pressSequentially(" Updated");
  await editor.press("Meta+Enter");
  await expect(editor).toHaveCount(0);
  await page.reload();
  await expect(task).toContainText("questionable. Updated");
});

test("Escape cancels editing and consumes the native dismissal key", async ({
  page,
}) => {
  await add(page, "Original task\nOriginal body");
  const task = page.locator('[data-testid^="task-item-"]');
  await task.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  const editor = page.getByTestId("task-edit-input");
  await expect(editor).toBeFocused();
  await editor.fill("Unsaved changes");
  const consumed = await editor.evaluate(
    (el) =>
      !el.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          code: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      ),
  );
  await expect(editor).toHaveCount(0);
  expect(consumed).toBe(true);
  await expect(task).toContainText("Original body");
  await page.reload();
  await expect(task).toContainText("Original task");
  await expect(task).not.toContainText("Unsaved changes");
  await task.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  await expect(editor).toBeFocused();
  await editor.fill("Another unsaved change");
  await editor.press("Escape");
  await expect(editor).toHaveCount(0);
  await expect(task).not.toContainText("Another unsaved change");
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  const draft = page.getByTestId("add-task-input-tasks");
  await draft.fill("Canceled draft");
  await draft.press("Escape");
  await expect(draft).toHaveCount(0);
  await expect(page.locator('[data-testid^="task-item-"]')).toHaveCount(1);
});

test("reopens saved collapsed lists without an initial collapse animation", async ({
  page,
}) => {
  await add(page, "Remember this collapse\nTask body");
  const saved = page.waitForResponse(
    (response) =>
      response.request().postDataJSON()?.channel === "lists:setCollapsed",
  );
  await page.getByTestId("list-collapse-tasks").click();
  await saved;
  let release!: () => void;
  let requested!: () => void;
  const preferencesHeld = new Promise<void>((resolve) => {
    release = resolve;
  });
  const preferencesRequested = new Promise<void>((resolve) => {
    requested = resolve;
  });
  await page.route("**/rpc", async (route) => {
    if (route.request().postDataJSON()?.channel === "lists:isCollapsed") {
      const response = await route.fetch();
      requested();
      await preferencesHeld;
      await route.fulfill({ response });
    } else await route.continue();
  });
  await page.addInitScript(() => {
    const observations = {
      expandedBeforeClick: false,
      transitions: [] as string[],
    };
    Reflect.set(window, "collapseStartup", observations);
    new MutationObserver(() => {
      const button = document.querySelector<HTMLElement>(
        '[data-testid="list-collapse-tasks"]',
      );
      if (button?.style.transform === "rotate(0deg)")
        observations.expandedBeforeClick = true;
    }).observe(document, { childList: true, subtree: true, attributes: true });
    document.addEventListener("transitionrun", (event) => {
      const transition = event as TransitionEvent;
      if (
        transition.propertyName === "grid-template-rows" ||
        transition.propertyName === "transform"
      )
        observations.transitions.push(transition.propertyName);
    });
  });
  try {
    await page.reload();
    await preferencesRequested;
    // Give the browser a paint while the persisted preferences are still unavailable.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    expect(
      await page.evaluate(
        () => Reflect.get(window, "collapseStartup").expandedBeforeClick,
      ),
    ).toBe(false);
  } finally {
    release();
  }
  const collapse = page.getByTestId("list-collapse-tasks");
  await expect(collapse).toHaveAttribute("style", "transform: rotate(-90deg);");
  await expect(
    page.locator('[data-testid^="task-name-"]'),
  ).not.toBeInViewport();
  await page.waitForTimeout(250);
  expect(
    await page.evaluate(() => Reflect.get(window, "collapseStartup")),
  ).toEqual({ expandedBeforeClick: false, transitions: [] });
  await collapse.click();
  await expect(page.locator('[data-testid^="task-name-"]')).toBeInViewport();
  await expect
    .poll(() =>
      page.evaluate(() => Reflect.get(window, "collapseStartup").transitions),
    )
    .toContain("grid-template-rows");
});

test("search shortcuts focus across panels, clear pending searches, and refresh without navigation", async ({
  page,
}) => {
  await add(page, "Alpha");
  await add(page, "Beta");
  await page.getByRole("button", { name: "Help", exact: true }).click();
  await page.keyboard.press("Meta+k");
  const search = page.getByRole("textbox", { name: "Search tasks" });
  await expect(search).toBeFocused();
  await search.fill("Alpha");
  await search.press("Escape");
  await expect(search).toHaveValue("");
  await expect(search).toBeFocused();
  await page.waitForTimeout(250);
  await expect(page.locator('[data-testid^="task-name-"]')).toHaveText([
    "Beta",
    "Alpha",
  ]);
  await search.fill("Alpha");
  await expect(page.locator('[data-testid^="task-name-"]')).toHaveText([
    "Alpha",
  ]);
  await search.press("Meta+k");
  expect(
    await search.evaluate((el: HTMLInputElement) => [
      el.selectionStart,
      el.selectionEnd,
    ]),
  ).toEqual([0, 5]);
  await page.evaluate(async () => {
    Reflect.set(window, "refreshSentinel", true);
    await fetch("/rpc", {
      method: "POST",
      headers: { "content-type": "application/json", "x-tasker-request": "1" },
      body: JSON.stringify({
        channel: "tasks:add",
        args: ["Alpha external", "tasks"],
      }),
    });
  });
  await search.press("Meta+r");
  await expect(page.locator('[data-testid^="task-name-"]')).toHaveText([
    "Alpha external",
    "Alpha",
  ]);
  expect(
    await page.evaluate(() => Reflect.get(window, "refreshSentinel")),
  ).toBe(true);
  await expect(search).toHaveValue("Alpha");
  await page
    .locator('[data-testid^="task-item-"]')
    .first()
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  const editor = page.getByTestId("task-edit-input");
  await expect(editor).toBeFocused();
  await editor.press("Meta+k");
  await expect(editor).toBeFocused();
  await expect(editor).toContainText("[text](url)");
  await editor.press("Escape");
});

async function dragVertically(
  page: import("@playwright/test").Page,
  source: import("@playwright/test").Locator,
  target: import("@playwright/test").Locator,
) {
  const from = await source.boundingBox(),
    to = await target.boundingBox();
  if (!from || !to) throw new Error("Missing drag bounds");
  const x = from.x + from.width * 0.65,
    y = from.y + from.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 6);
  await page.mouse.move(x, to.y + to.height / 2, { steps: 20 });
  await page.mouse.up();
}

test("pointer task reorder persists and supports undo, redo, and drag cancellation", async ({
  page,
}) => {
  for (const name of ["First", "Second", "Third"]) await add(page, name);
  const names = page.locator('[data-testid^="task-name-"]');
  const rows = page.locator("[data-task-id]");
  await dragVertically(page, rows.nth(2), rows.nth(0));
  await expect(names).toHaveText(["First", "Third", "Second"]);
  await page.reload();
  await expect(names).toHaveText(["First", "Third", "Second"]);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(names).toHaveText(["Third", "Second", "First"]);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(names).toHaveText(["First", "Third", "Second"]);
  const box = (await rows.first().boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.65, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.65, box.y + box.height + 15, {
    steps: 10,
  });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(names).toHaveText(["First", "Third", "Second"]);
  await page.reload();
  await expect(names).toHaveText(["First", "Third", "Second"]);
});

test("pointer list reorder persists and does not move its tasks into another list", async ({
  page,
}) => {
  await add(page, "Default task");
  for (const name of ["work", "books"]) {
    await page
      .getByRole("button", { name: "Create list", exact: true })
      .click();
    await page.getByRole("textbox", { name: "New list name" }).fill(name);
    await page.getByRole("button", { name: "Add list", exact: true }).click();
  }
  const headers = page.locator('[data-testid^="list-header-"]');
  const before = await headers.evaluateAll((els) =>
    els.map((el) => el.getAttribute("data-testid")),
  );
  await dragVertically(page, headers.last(), headers.first());
  const expected = [before[2]!, before[0]!, before[1]!];
  await expect
    .poll(() =>
      headers.evaluateAll((els) =>
        els.map((el) => el.getAttribute("data-testid")),
      ),
    )
    .toEqual(expected);
  await page.reload();
  await expect
    .poll(() =>
      headers.evaluateAll((els) =>
        els.map((el) => el.getAttribute("data-testid")),
      ),
    )
    .toEqual(expected);
  await expect(page.getByTestId("list-section-tasks")).toContainText(
    "Default task",
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect
    .poll(() =>
      headers.evaluateAll((els) =>
        els.map((el) => el.getAttribute("data-testid")),
      ),
    )
    .toEqual(before);
});
