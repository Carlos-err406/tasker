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
async function chooseList(page: import("@playwright/test").Page, name: string) {
  await page.getByRole("button", { name: "Choose list", exact: true }).click();
  await page.getByRole("menuitemradio", { name, exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Choose list", exact: true }),
  ).toHaveText(name);
}
async function startCreateList(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Choose list", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Create list", exact: true })
    .click();
}
async function createList(page: import("@playwright/test").Page, name: string) {
  await startCreateList(page);
  await page.getByRole("textbox", { name: "New list name" }).fill(name);
  await page.getByRole("button", { name: "Add list", exact: true }).click();
  await expect(page.getByTestId(`list-section-${name}`)).toBeVisible();
}
async function rpc(
  page: import("@playwright/test").Page,
  channel: string,
  args: unknown[] = [],
) {
  return page.evaluate(
    async ({ channel, args }) => {
      const response = await fetch("/rpc", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-tasker-request": "1",
        },
        body: JSON.stringify({ channel, args }),
      });
      const [error, result] = await response.json();
      if (error) throw new Error(error.message);
      return result;
    },
    { channel, args },
  );
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
  await expect(page.getByText(/^Last backup today/)).toBeVisible();
  await chooseList(page, "tasks");
  await add(page, "Later task");
  await page.getByRole("button", { name: "Backups", exact: true }).click();
  await page.getByRole("button", { name: "Restore…", exact: true }).click();
  await expect(page.locator(".backup-row")).toHaveCount(1);
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await page
    .getByRole("button", { name: "Restore backup", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await chooseList(page, "tasks");
  await expect(page.locator('[data-testid^="task-item-"]')).toHaveCount(1);
  await expect(image).toHaveAttribute("src", source!);
  await page.reload();
  await expect
    .poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBe(1);
  await page.getByRole("button", { name: "Backups", exact: true }).click();
  await page.getByRole("button", { name: "Restore…", exact: true }).click();
  await expect(page.locator(".backup-row")).toHaveCount(2);
  await page
    .locator(".backup-row")
    .filter({ hasText: "safety" })
    .getByRole("button", { name: "Restore", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Restore backup", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await chooseList(page, "tasks");
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
  await chooseList(page, "tasks");
  await expect(names).toHaveCount(2);
});
test("creates a list and moves a task through its nested menu", async ({
  page,
}) => {
  await add(page, "Move me");
  await startCreateList(page);
  await page.getByRole("textbox", { name: "New list name" }).fill("work");
  await page.getByRole("button", { name: "Add list", exact: true }).click();
  await expect(page.getByTestId("list-section-work")).toBeVisible();
  await chooseList(page, "tasks");
  await page.locator('[data-testid^="task-item-"]').click({ button: "right" });
  await page.getByRole("menuitem", { name: /Move to/ }).hover();
  const item = page.getByRole("menuitem", { name: "work", exact: true });
  await expect(item).toBeVisible();
  await item.dispatchEvent("click");
  await expect(page.locator('[data-testid^="task-name-"]')).toHaveCount(0);
  await chooseList(page, "work");
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
  await startCreateList(page);
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

test("top picker manages lists and app controls manage tasks without a list header", async ({
  page,
}) => {
  const picker = page.getByRole("button", { name: "Choose list", exact: true });
  await expect(page.locator('[data-testid^="list-header-"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: /List options/ })).toHaveCount(
    0,
  );
  await picker.click();
  await expect(
    page.getByRole("menuitem", { name: "Rename list", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("menuitem", { name: "Delete list", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("menuitem", { name: "Create list", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await add(page, "From app toolbar");
  await page.locator('[data-testid^="task-checkbox-"]').click();
  await page
    .getByRole("button", { name: "Hide completed tasks", exact: true })
    .click();
  await expect(page.locator('[data-testid^="task-name-"]')).toHaveCount(0);
  await page
    .getByRole("button", { name: "Show completed tasks", exact: true })
    .click();
  await expect(page.locator('[data-testid^="task-name-"]')).toHaveText([
    "From app toolbar",
  ]);
  await createList(page, "work");
  await picker.click();
  await page
    .getByRole("menuitem", { name: "Rename list", exact: true })
    .click();
  const name = page.getByRole("textbox", { name: "List name", exact: true });
  await expect(name).toBeFocused();
  await name.fill("Projects");
  await name.press("Enter");
  await expect(name).toHaveCount(0);
  await expect(picker).toHaveText("Projects");
  await expect(picker).toBeFocused();
  await chooseList(page, "tasks");
  await picker.click();
  await expect(
    page.getByRole("menuitem", { name: "Create list", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("menu")).toHaveCSS("opacity", "1");
  await page.screenshot({ path: "test-results/desktop-list-menu.png" });
});

test("panel headers match and toolbar icons have equal spacing", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  const boxes = await Promise.all(
    [
      "Add task",
      "Hide completed tasks",
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
    page.getByRole("heading", { name: "Backups & Sync", exact: true }),
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

test("picker keeps one list visible, remembers selection and sorts the selected list", async ({
  page,
}) => {
  await add(page, "High priority\np1");
  await add(page, "Low priority\np3");
  const names = page.locator('[data-testid^="task-name-"]');
  await expect(names).toHaveText(["Low priority", "High priority"]);
  await page.getByRole("button", { name: "System sort", exact: true }).click();
  await expect(names).toHaveText(["High priority", "Low priority"]);
  await createList(page, "work");
  await add(page, "Work task");
  await expect(page.locator('[data-testid^="list-section-"]')).toHaveCount(1);
  await expect(names).toHaveText(["Work task"]);
  await page.reload();
  await expect(page.getByRole("button", { name: "Choose list" })).toHaveText(
    "work",
  );
  await expect(names).toHaveText(["Work task"]);
  await page.keyboard.press("Meta+j");
  await expect(page.locator("footer").getByRole("status")).toHaveText(
    "Sorted 1 list",
  );
  await chooseList(page, "tasks");
  await expect(names).toHaveText(["High priority", "Low priority"]);
  await expect(
    page.getByRole("button", { name: /Collapse|Expand/ }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 360, height: 588 });
  await expect(
    page.getByRole("button", { name: "Help", exact: true }),
  ).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    360,
  );
  await page.screenshot({ path: "test-results/list-picker-desktop.png" });
});

test("action tooltips show keycaps and undo shortcuts work outside editors", async ({
  page,
}) => {
  // Keep closed tooltips mounted long enough to expose overlap during transitions.
  await page.addStyleTag({
    content:
      '[data-slot="tooltip-content"][data-state="closed"] { animation-duration: 1s !important; }',
  });
  const tooltip = page.locator('[role="tooltip"]:not([data-state="closed"])');
  const shortcuts = [
    { name: "Hide previews", keys: ["⌘", "P"] },
    { name: "System sort", keys: ["⌘", "J"] },
    { name: "Undo", keys: ["⌘", "Z"] },
    { name: "Redo", keys: ["⌘", "⇧", "Z"] },
    { name: "Help", keys: ["⌘", "/"] },
  ];
  for (const { name, keys } of shortcuts) {
    await page.getByRole("button", { name, exact: true }).hover();
    const tip = tooltip;
    await expect(tip).toBeVisible();
    await expect(tip.locator('[data-slot="kbd"]')).toHaveText(keys);
    await expect(tip).toContainText(name === "Help" ? "View help" : name);
    await page.keyboard.press("Escape");
    await page.mouse.move(10, 300, { steps: 10 });
    await expect(page.getByRole("tooltip")).toHaveCount(0);
  }
  await page.getByRole("button", { name: "Help", exact: true }).hover();
  await expect(tooltip).toContainText("View help");
  await page.screenshot({ path: "test-results/shortcut-tooltip.png" });
  await page.keyboard.press("Escape");
  await page.mouse.move(10, 300, { steps: 10 });
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await page.getByRole("button", { name: "Add task", exact: true }).hover();
  await expect(tooltip).toContainText("Add task");
  await expect(tooltip.locator('[data-slot="kbd"]')).toHaveCount(0);
  await page.keyboard.press("Escape");
  await startCreateList(page);
  const listInput = page.getByRole("textbox", { name: "New list name" });
  await listInput.fill("Draft list");
  for (const [name, key] of [
    ["Add list", "↵"],
    ["Cancel new list", "Esc"],
  ]) {
    await page.mouse.move(10, 300, { steps: 10 });
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await page.getByRole("button", { name, exact: true }).hover();
    await expect(tooltip.locator('[data-slot="kbd"]')).toHaveText([key]);
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

test("ignores old collapsed preferences and falls back after the selected list is deleted", async ({
  page,
}) => {
  await add(page, "Default task");
  await rpc(page, "lists:setCollapsed", ["tasks", true]);
  await createList(page, "work");
  await add(page, "Work task");
  await page.reload();
  await expect(page.getByRole("button", { name: "Choose list" })).toHaveText(
    "work",
  );
  await page.getByRole("button", { name: "Choose list", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Delete list", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "Choose list" })).toHaveText(
    "tasks",
  );
  await expect(page.locator('[data-testid^="task-name-"]')).toHaveText([
    "Default task",
  ]);
  await expect(page.locator('[data-testid^="list-collapse-"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await chooseList(page, "work");
  await expect(page.locator('[data-testid^="task-name-"]')).toHaveText([
    "Work task",
  ]);
  await page.evaluate(() =>
    localStorage.setItem("tasker:selectedList", "missing"),
  );
  await page.reload();
  await expect(page.getByRole("button", { name: "Choose list" })).toHaveText(
    "tasks",
  );
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

test("desktop picker preserves list order without up/down controls", async ({
  page,
}) => {
  await add(page, "Default task");
  await createList(page, "work");
  await createList(page, "books");
  await page.getByRole("button", { name: "Choose list" }).click();
  const items = page.getByRole("menuitemradio");
  const before = await items.allTextContents();
  await expect(
    page.getByRole("menuitem", { name: /Move list (up|down)/ }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await chooseList(page, "work");
  await page.reload();
  await page.getByRole("button", { name: "Choose list" }).click();
  await expect(items).toHaveText(before);
  await page.keyboard.press("Escape");
  await chooseList(page, "tasks");
  await expect(page.locator('[data-testid^="task-name-"]')).toHaveText([
    "Default task",
  ]);
});

for (const content of [
  {
    name: "YouTube video",
    markdown: "[Clip](https://youtu.be/abcdefghijk)",
    selector: '[data-testid="markdown-video-preview"]',
    action: "Open video",
    target: "https://youtu.be/abcdefghijk",
  },
  {
    name: "direct video",
    markdown: "[Clip](https://example.com/clip.mp4)",
    selector: '[data-testid="markdown-video-preview"]',
    action: "Open video",
    target: "https://example.com/clip.mp4",
  },
  {
    name: "image",
    markdown: "![Photo](https://example.com/photo.png)",
    selector: "img",
    action: "Open image",
    target: "https://example.com/photo.png",
  },
  {
    name: "link",
    markdown: "[Website](https://example.com/page)",
    selector: "a",
    action: "Open link",
    target: "https://example.com/page",
  },
  {
    name: "code block",
    markdown: "```js\nconst answer = 42;\n```",
    selector: "pre",
    action: "Copy code",
    target: null,
  },
]) {
  test(`combines ${content.name} actions with its owning task menu`, async ({
    page,
    service,
  }) => {
    const pixel = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1kAAAAASUVORK5CYII=",
      "base64",
    );
    await page.route("https://example.com/**", (route) =>
      route.fulfill({ contentType: "image/png", body: pixel }),
    );
    await page.route("https://i.ytimg.com/**", (route) =>
      route.fulfill({ contentType: "image/png", body: pixel }),
    );
    await page.addInitScript(() => {
      Object.defineProperty(navigator.clipboard, "writeText", {
        value: async (text: string) => {
          Reflect.set(window, "copiedText", text);
        },
      });
    });
    const description = `Media task\n\n${content.markdown}`;
    // Seed exact Markdown without contenteditable.fill's WebKit blank-line conversion.
    await page.evaluate(async (description) => {
      await fetch("/rpc", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-tasker-request": "1",
        },
        body: JSON.stringify({
          channel: "tasks:add",
          args: [description, "tasks"],
        }),
      });
    }, description);
    await page.reload();
    await add(page, "Other task");
    const task = page
      .locator('[data-testid^="task-item-"]')
      .filter({ hasText: "Media task" });
    const media = task.locator(content.selector);
    await media.click({ button: "right" });
    await expect(page.getByRole("menu")).toHaveCount(1);
    for (const action of [
      content.action,
      "Edit",
      "Copy ID",
      "Copy text",
      "Create subtask",
      "Move to...",
      "Set Status",
      "Delete",
    ]) {
      await expect(
        page.getByRole("menuitem", { name: action, exact: true }),
      ).toBeVisible();
    }
    await page
      .getByRole("menuitem", { name: content.action, exact: true })
      .click();
    if (content.target) {
      await expect.poll(() => service.openedTargets).toContain(content.target);
    } else {
      expect(
        await page.evaluate(() => Reflect.get(window, "copiedText")),
      ).toContain("const answer = 42;");
    }
    await media.click({ button: "right" });
    await page
      .getByRole("menuitem", { name: "Copy text", exact: true })
      .click();
    expect(await page.evaluate(() => Reflect.get(window, "copiedText"))).toBe(
      description,
    );
    await media.click({ button: "right" });
    await page
      .getByRole("menuitem", { name: "Set Status", exact: true })
      .hover();
    await expect(
      page.getByRole("menuitem", { name: "In Progress", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("menuitem", { name: "In Progress", exact: true })
      .click();
    await media.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
    const editor = page.getByTestId("task-edit-input");
    await expect(editor).toBeFocused();
    await expect(editor).toHaveText(description, { useInnerText: true });
    await editor.press("Escape");
    await expect(editor).toHaveCount(0);
    await task
      .locator('[data-testid^="task-name-"]')
      .click({ button: "right" });
    await expect(
      page.getByRole("menuitem", { name: content.action, exact: true }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    await media.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
    await expect(task).toHaveCount(0);
    await expect(page.locator('[data-testid^="task-item-"]')).toHaveText(
      /Other task/,
    );
  });
}

test("search stays in the selected list, including empty lists and tag clicks", async ({
  page,
}) => {
  await add(page, "Shared default\n#demo");
  await createList(page, "work");
  await add(page, "Shared work\n#demo");
  const names = page.locator('[data-testid^="task-name-"]');
  const search = page.getByRole("textbox", { name: "Search tasks" });
  await search.fill("Shared");
  await expect(names).toHaveText(["Shared work"]);
  await chooseList(page, "tasks");
  await expect(names).toHaveText(["Shared default"]);
  await page.locator("[data-task-tag]").click();
  await expect(search).toHaveValue("#demo");
  await expect(names).toHaveText(["Shared default"]);
  await createList(page, "empty");
  await expect(names).toHaveCount(0);
  await expect(
    page.getByText("No matching tasks in this list", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(page.getByRole("button", { name: "Choose list" })).toHaveText(
    "empty",
  );
  await expect(page.getByText("No tasks", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Choose list" })).toHaveText(
    "empty",
  );
  await expect(search).toHaveValue("");
});

test("search filter survives closing and reopening the popover", async ({
  page,
}) => {
  await add(page, "Alpha");
  await add(page, "Beta");
  const names = page.locator('[data-testid^="task-name-"]');
  const search = page.getByRole("textbox", { name: "Search tasks" });
  await search.fill("Alpha");
  await expect(names).toHaveText(["Alpha"]);
  await page.reload();
  await expect(search).toHaveValue("Alpha");
  await expect(names).toHaveText(["Alpha"]);
  await search.press("Escape");
  await expect(names).toHaveCount(2);
  await page.reload();
  await expect(search).toHaveValue("");
  await expect(names).toHaveCount(2);
});

test("relationship navigation switches lists and clears search to reveal a hidden completed task", async ({
  page,
}) => {
  const target = (await rpc(page, "tasks:add", ["Destination", "tasks"])).task;
  await rpc(page, "tasks:setStatus", [target.id, 2]);
  await rpc(page, "lists:setHideCompleted", ["tasks", true]);
  await createList(page, "work");
  await add(page, `Source\n~${target.id}`);
  await page.getByRole("textbox", { name: "Search tasks" }).fill("Source");
  await expect(page.locator('[data-testid^="task-name-"]')).toHaveText([
    "Source",
  ]);
  await page.getByRole("button", { name: /^Related to .*Destination/ }).click();
  await expect(page.getByRole("button", { name: "Choose list" })).toHaveText(
    "tasks",
  );
  await expect(page.getByRole("textbox", { name: "Search tasks" })).toHaveValue(
    "",
  );
  await expect(page.locator('[data-testid^="task-name-"]')).toHaveText([
    "Destination",
  ]);
});

test("slow searches cannot overwrite newer results or the selected list", async ({
  page,
}) => {
  await add(page, "Alpha");
  await add(page, "Beta");
  await createList(page, "work");
  await add(page, "Beta work");
  await chooseList(page, "tasks");
  let release!: () => void;
  let requested!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    requested = resolve;
  });
  await page.route("**/rpc", async (route) => {
    const body = route.request().postDataJSON();
    if (body.channel === "tasks:search" && body.args[0] === "Alpha") {
      const response = await route.fetch();
      requested();
      await held;
      await route.fulfill({ response });
    } else await route.continue();
  });
  try {
    const search = page.getByRole("textbox", { name: "Search tasks" });
    await search.fill("Alpha");
    await started;
    await search.fill("Beta");
    await chooseList(page, "work");
    await expect(page.locator('[data-testid^="task-name-"]')).toHaveText([
      "Beta work",
    ]);
  } finally {
    release();
  }
  await page.waitForTimeout(150);
  await expect(page.locator('[data-testid^="task-name-"]')).toHaveText([
    "Beta work",
  ]);
  await expect(page.getByRole("button", { name: "Choose list" })).toHaveText(
    "work",
  );
});

test("picker supports keyboard selection and waits for edits to be saved or cancelled", async ({
  page,
}) => {
  await createList(page, "work");
  await chooseList(page, "tasks");
  const picker = page.getByRole("button", { name: "Choose list", exact: true });
  await picker.focus();
  await picker.press("Enter");
  const work = page.getByRole("menuitemradio", { name: "work", exact: true });
  await work.focus();
  await work.press("Enter");
  await expect(picker).toHaveText("work");
  await expect(picker).toBeFocused();
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  const editor = page.getByTestId("add-task-input-work");
  await editor.fill("Unfinished task");
  await expect(picker).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Add task", exact: true }),
  ).toBeDisabled();
  await editor.press("Escape");
  await expect(picker).toBeEnabled();
  await add(page, "Saved task");
  await page.locator('[data-testid^="task-item-"]').click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  const taskEditor = page.getByTestId("task-edit-input");
  await taskEditor.fill("Still editing");
  await expect(picker).toBeDisabled();
  await taskEditor.press("Meta+Enter");
  await expect(picker).toBeEnabled();
  await chooseList(page, "tasks");
  await chooseList(page, "work");
  await expect(page.locator('[data-testid^="task-name-"]')).toHaveText([
    "Still editing",
  ]);
});

test("desktop toolbar keeps picker top left and app controls top right across panels", async ({
  page,
}) => {
  await createList(page, "A_very_long_list_name_that_must_fit_the_toolbar");
  const picker = page.getByRole("button", { name: "Choose list", exact: true });
  const addTask = page.getByRole("button", { name: "Add task", exact: true });
  for (const width of [420, 360]) {
    await page.setViewportSize({ width, height: 588 });
    const pick = await picker.boundingBox(),
      add = await addTask.boundingBox();
    expect(pick!.x).toBeLessThan(20);
    expect(pick!.y).toBeLessThan(12);
    expect(add!.x - (pick!.x + pick!.width)).toBeGreaterThanOrEqual(12);
    expect(pick!.y).toEqual(add!.y);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
    await expect(
      page.getByRole("button", { name: "Help", exact: true }),
    ).toBeInViewport();
  }
  for (const [label, tooltip] of [
    ["Trash", "View trash"],
    ["Backups", "Backups & sync"],
    ["Help", "View help"],
  ]) {
    const button = page.getByRole("button", { name: label, exact: true });
    await button.hover();
    await expect(page.getByRole("tooltip")).toContainText(tooltip!);
    await page.keyboard.press("Escape");
    await page.mouse.move(10, 300);
    await expect(page.getByRole("tooltip")).toHaveCount(0);
  }
  await page.getByRole("button", { name: "Help", exact: true }).click();
  await addTask.click();
  const editor = page.locator('[contenteditable="true"]');
  await expect(editor).toBeFocused();
  await editor.fill("Added from Help");
  await editor.press("Meta+Enter");
  await expect(page.locator('[data-testid^="task-name-"]')).toHaveText([
    "Added from Help",
  ]);
  await page.getByRole("button", { name: "Trash", exact: true }).click();
  await chooseList(page, "A_very_long_list_name_that_must_fit_the_toolbar");
  await expect(
    page.getByRole("textbox", { name: "Search tasks" }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/desktop-toolbar.png" });
  await page.setViewportSize({ width: 420, height: 588 });
  await createList(page, "finance books to download");
  await expect(picker).toHaveAttribute("title", "finance books to download");
  const name = picker.locator("span");
  expect(
    await name.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await add(page, "Real Estate Investing For Dummies");
  await page.mouse.move(10, 300);
  await page.screenshot({ path: "test-results/desktop-long-list-name.png" });
});

test("opens About from Help without adding a desktop toolbar button", async ({page}) => {
  await page.getByRole('button',{name:'Help',exact:true}).click();
  await page.getByRole('button',{name:'About Tasker',exact:true}).click();
  await expect(page.getByRole('heading',{name:'About',exact:true})).toBeVisible();
  await expect(page.getByText(/Version \d+\.\d+\.\d+ · Mac/)).toBeVisible();
  await expect(page.getByRole('heading',{name:'Credits',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Back to help',exact:true}).click();
  await expect(page.getByTestId('help-panel')).toBeVisible();
});

test("suggests existing tags while typing # and inserts the chosen one", async ({
  page,
}) => {
  await add(page, "Alpha\n#tasker #mobile");
  await add(page, "Beta\n#tasker");
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  const input = page.locator("[contenteditable=true]").first();
  await input.pressSequentially("Gamma");
  await input.press("Enter");
  await input.pressSequentially("#ta");
  const options = page
    .getByTestId("metadata-autocomplete-dropdown")
    .getByRole("button");
  await expect(options).toHaveText(["tasker2 tasks"]);
  await input.press("Enter");
  await expect(options).toHaveCount(0);
  await input.pressSequentially(" #");
  // Tags already on the task are not offered again.
  await expect(options).toHaveText(["mobile1 task"]);
  await options.first().click();
  await input.press("Meta+Enter");
  await expect(input).not.toBeVisible();
  const gamma = page
    .locator('[data-testid^="task-item-"]')
    .filter({ hasText: "Gamma" });
  await expect(gamma.locator("[data-task-tag]")).toHaveText([
    "tasker",
    "mobile",
  ]);
});

test("wide pasted text wraps in the editor and code blocks keep thin scrollbars", async ({
  page,
}) => {
  await add(page, "Wide code\n```\n" + "x".repeat(400) + "\n```");
  const pre = page.locator('[data-testid^="task-item-"] pre').first();
  await expect(pre).toBeVisible();
  // Horizontal scrollbar height: thin, not the 15px default bar.
  expect(
    await pre.evaluate((el: HTMLElement) => el.offsetHeight - el.clientHeight),
  ).toBeLessThanOrEqual(6);
  // The copy icon stays in the corner while the code scrolls sideways.
  const icon = pre.locator("xpath=..").locator("svg").last();
  const before = await icon.boundingBox();
  await pre.evaluate((el) => (el.scrollLeft = 300));
  expect(await pre.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  expect(await icon.boundingBox()).toEqual(before);
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  const input = page.locator("[contenteditable=true]").first();
  await input.focus();
  // Rich-text paste keeps source styles such as white-space: nowrap.
  await input.evaluate(() =>
    document.execCommand(
      "insertHTML",
      false,
      `<span style="white-space: nowrap">${"pasted words ".repeat(40)}</span>`,
    ),
  );
  expect(
    await input.evaluate((el) => el.scrollWidth - el.clientWidth),
  ).toBeLessThanOrEqual(0);
  expect(
    await input.evaluate((el: HTMLElement) => el.offsetHeight - el.clientHeight),
  ).toBeLessThanOrEqual(2);
});

test("All lists shows every list's tasks with a list label only there", async ({
  page,
}) => {
  await add(page, "Default task");
  await createList(page, "work");
  await add(page, "Work task\n#demo");
  const names = page.locator('[data-testid^="task-name-"]');
  const labels = page.locator("[data-task-list]");
  await expect(labels).toHaveCount(0);

  await chooseList(page, "All lists");
  await expect(names).toHaveText(["Work task", "Default task"]);
  await expect(labels).toHaveText(["work", "tasks"]);
  await expect(
    page.getByRole("textbox", { name: "Search tasks" }),
  ).toHaveAttribute("placeholder", "Search All lists…");
  // The All view is not a real list: it cannot be renamed or deleted.
  await page.getByRole("button", { name: "Choose list", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Rename list" })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Delete list" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // New tasks from the All view go to the default list.
  await add(page, "Added from all");
  await expect(names).toHaveText(["Added from all", "Work task", "Default task"]);
  await page.reload();
  await expect(page.getByRole("button", { name: "Choose list" })).toHaveText(
    "All lists",
  );
  await expect(labels).toHaveCount(3);

  // All lists has its own order: dragging there leaves the lists' order alone.
  const rows = page.locator("[data-task-id]");
  await dragVertically(page, rows.nth(2), rows.nth(0));
  await expect(names).toHaveText(["Default task", "Added from all", "Work task"]);
  await page.reload();
  await expect(names).toHaveText(["Default task", "Added from all", "Work task"]);
  await page.keyboard.press("Meta+j");
  await expect(page.locator("footer").getByRole("status")).toHaveText(
    "Sorted All lists",
  );
  await expect(names).toHaveText(["Added from all", "Work task", "Default task"]);

  // Clicking a task's list label opens that list.
  await labels.filter({ hasText: "work" }).click();
  await expect(page.getByRole("button", { name: "Choose list" })).toHaveText(
    "work",
  );
  await expect(names).toHaveText(["Work task"]);
  await expect(labels).toHaveCount(0);

  await chooseList(page, "tasks");
  await expect(names).toHaveText(["Added from all", "Default task"]);
  await expect(labels).toHaveCount(0);
});

test("completes >list and creates or moves the task there, stripping the token", async ({
  page,
}) => {
  await createList(page, "to download");
  await chooseList(page, "tasks");
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  const input = page.locator("[contenteditable=true]").first();
  await input.pressSequentially("Some book");
  await input.press("Enter");
  await input.pressSequentially(">to-d");
  const options = page
    .getByTestId("metadata-autocomplete-dropdown")
    .getByRole("button");
  await expect(options).toHaveText(["to download"]);
  await input.press("Enter");
  await input.pressSequentially(" #book");
  await input.press("Meta+Enter");
  await expect(input).not.toBeVisible();
  const names = page.locator('[data-testid^="task-name-"]');
  // Created in "to download", not the visible list.
  await expect(names).toHaveCount(0);
  await chooseList(page, "to download");
  await expect(names).toHaveText(["Some book"]);
  const row = page.locator('[data-testid^="task-item-"]').first();
  await expect(row.locator("[data-task-tag]")).toHaveText(["book"]);
  await expect(row).not.toContainText(">to-download");

  // Editing with >tasks moves it back.
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  const editor = page.getByTestId("task-edit-input");
  await editor.press("End");
  await editor.pressSequentially(" >tasks");
  await editor.press("Meta+Enter");
  await expect(names).toHaveCount(0);
  await chooseList(page, "tasks");
  await expect(names).toHaveText(["Some book"]);
});
