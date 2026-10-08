import { test, expect, type Locator } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

async function taskFixture(page: import("@playwright/test").Page) {
  await page.goto(page.url() + "?task");
  await expect(page.getByTestId("task-item-abc")).toBeVisible();
}
async function openTaskActions(page: import("@playwright/test").Page) {
  await page
    .getByRole("button", { name: "Task actions abc", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Task actions", exact: true }),
  ).toBeVisible();
}

let server: ViteDevServer;
test.beforeAll(async () => {
  server = await createServer({
    configFile: false,
    root: resolve("."),
    plugins: [react(), tailwindcss()],
    server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen();
});
test.afterAll(async () => {
  await server?.close();
});
test.beforeEach(async ({ page }) => {
  await page.goto(
    server.resolvedUrls!.local[0] + "tests/fixtures/touch-actions.html",
  );
  await expect(page.getByTestId("text")).toBeVisible();
});

// Synthetic pointer events cover routing and tap arbitration in WebKit. The
// Android host gate additionally exercises trusted touch input on the device.
async function gesture(target: Locator, dx: number, dy = 0, cancel = false) {
  await target.evaluate(
    (element, { dx, dy, cancel }) => {
      const options = {
        bubbles: true,
        pointerId: 1,
        pointerType: "touch",
        isPrimary: true,
      };
      // Synthetic pointers cannot be captured by the browser.
      const row = element.closest(".touch-task-row");
      if (row) row.setPointerCapture = () => {};
      element.dispatchEvent(
        new PointerEvent("pointerdown", {
          ...options,
          clientX: 150,
          clientY: 100,
        }),
      );
      element.dispatchEvent(
        new PointerEvent("pointermove", {
          ...options,
          clientX: 150 + dx,
          clientY: 100 + dy,
        }),
      );
      element.dispatchEvent(
        new PointerEvent(cancel ? "pointercancel" : "pointerup", {
          ...options,
          clientX: 150 + dx,
          clientY: 100 + dy,
        }),
      );
      if (!cancel && !dy)
        element.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
    },
    { dx, dy, cancel },
  );
}

for (const id of [
  "text",
  "button",
  "link",
  "checkbox",
  "image",
  "video",
  "markdown-image-preview-collapsed",
]) {
  test(`swipes from ${id} reveal actions in both directions without activating the target`, async ({
    page,
  }) => {
    const target =
      id === "button"
        ? page.getByTestId(id).locator("span")
        : page.getByTestId(id);
    for (const direction of [-1, 1]) {
      await gesture(target, direction * 90);
      await expect(
        page.getByRole("dialog", { name: "Task actions", exact: true }),
      ).toBeVisible();
      await expect(page.getByTestId("click-count")).toHaveText("0");
      await expect(page.getByTestId("checkbox")).not.toBeChecked();
      await expect(
        page.getByTestId("markdown-image-preview-collapsed"),
      ).toBeVisible();
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(page.locator('[data-slot="dialog-overlay"]')).toHaveCount(0);
    }
  });
}

test("short horizontal drags suppress taps; ordinary taps still work", async ({
  page,
}) => {
  const button = page.getByTestId("button");
  await gesture(button, 30);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId("click-count")).toHaveText("0");
  await button.click();
  await expect(page.getByTestId("click-count")).toHaveText("1");
  await page.getByTestId("markdown-image-preview-collapsed").click();
  await expect(
    page.getByTestId("markdown-image-preview-collapsed"),
  ).toHaveCount(0);
});

test("vertical scrolling, cancellation, and portaled editor controls do not reveal actions", async ({
  page,
}) => {
  await gesture(page.getByTestId("button"), 3, 90);
  await gesture(page.getByTestId("image"), 90, 0, true);
  await gesture(page.getByTestId("portal"), 90);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId("click-count")).toHaveText("1");
  await expect(page.locator(".touch-task-content")).toHaveCSS(
    "transform",
    "none",
  );
});

test("drawer exposes every task action and defers mutations until the exit animation finishes", async ({
  page,
}) => {
  await taskFixture(page);
  await openTaskActions(page);
  for (const name of [
    "Edit",
    "Copy ID",
    "Copy text",
    "Create subtask",
    "Move to...",
    "Set Status",
    "Delete...",
    "Content actions",
  ]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  }
  await page.getByRole("button", { name: "Set Status", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Pending", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  for (const [name, value] of [
    ["In Progress", 1],
    ["Done", 2],
    ["Won't Do", 3],
    ["Pending", 0],
  ] as const) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(page.getByTestId("last-action")).toHaveText(`status:${value}`);
    await expect(page.locator(".touch-task-sheet")).toHaveCount(0);
    await openTaskActions(page);
    await page.getByRole("button", { name: "Set Status", exact: true }).click();
    await expect(
      page.getByRole("button", { name, exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  }
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Move to...", exact: true }).click();
  await page.getByRole("button", { name: "Other", exact: true }).click();
  await expect(page.getByTestId("last-action")).toHaveText("move:Other");
  await openTaskActions(page);
  await page
    .getByRole("button", { name: "Create subtask", exact: true })
    .click();
  await expect(page.getByTestId("last-action")).toHaveText("subtask");
  for (const [name, cascade] of [
    ["This task only", false],
    ["Task and subtasks", true],
  ] as const) {
    await openTaskActions(page);
    await page.getByRole("button", { name: "Delete...", exact: true }).click();
    await page.getByRole("button", { name, exact: true }).click();
    await expect(page.getByTestId("last-action")).toHaveText(
      `delete:${cascade}`,
    );
  }
  await openTaskActions(page);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Edit task", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("task-edit-input")).toBeFocused();
  await expect(page.locator(".touch-task-sheet")).toHaveCount(0);
});

test("drawer contains the image, video, link and code context actions", async ({
  page,
}) => {
  await taskFixture(page);
  await openTaskActions(page);
  await page
    .getByRole("button", { name: "Content actions", exact: true })
    .click();
  for (const [name, actions] of [
    ["Image: sample", ["Open image", "Copy image"]],
    ["Video: Video", ["Open video", "Copy video URL"]],
    ["Link: Website", ["Open link", "Copy link", "Copy link text"]],
    ["Code: const example = 1;", ["Copy code"]],
  ] as const) {
    await page.getByRole("button", { name, exact: true }).click();
    for (const action of actions)
      await expect(
        page.getByRole("button", { name: action, exact: true }),
      ).toBeVisible();
    await page.getByRole("button", { name: "Back", exact: true }).click();
  }
});

test("long holds on task text, checkbox, and media no longer open menus or change status", async ({
  page,
}) => {
  await taskFixture(page);
  for (const target of [
    page.getByTestId("task-name-abc"),
    page.getByTestId("task-checkbox-abc"),
    page.getByTestId("markdown-image-preview-collapsed"),
  ]) {
    for (const nativeContextMenu of [false, true]) {
      await target.dispatchEvent("pointerdown", {
        pointerType: "touch",
        isPrimary: true,
        pointerId: 1,
      });
      await page.waitForTimeout(800);
      if (nativeContextMenu) await target.dispatchEvent("contextmenu");
      await target.dispatchEvent("pointerup", {
        pointerType: "touch",
        isPrimary: true,
        pointerId: 1,
      });
      await target.dispatchEvent("click");
      await expect(page.getByRole("menu")).toHaveCount(0);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.getByTestId("last-action")).toHaveText("");
    }
  }
});

test("drawer slides in and out and honors reduced motion", async ({ page }) => {
  await taskFixture(page);
  await openTaskActions(page);
  const drawer = page.locator(".touch-task-sheet");
  await expect(drawer).toHaveCSS("animation-name", "task-sheet-in");
  // Read the exit state in the same task as the click: the 180 ms animation can
  // finish (and unmount the drawer) before a separate assertion runs on slow CI.
  const closing = await page
    .getByRole("button", { name: "Cancel", exact: true })
    .evaluate(async (button: HTMLButtonElement) => {
      button.click();
      await new Promise(requestAnimationFrame);
      const sheet = document.querySelector<HTMLElement>(".touch-task-sheet");
      return sheet && [sheet.dataset.state, getComputedStyle(sheet).animationName];
    });
  expect(closing).toEqual(["closed", "task-sheet-out"]);
  await expect(drawer).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openTaskActions(page);
  await expect(drawer).toHaveCSS("animation-name", "none");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(drawer).toHaveCount(0);
});

for (const brokenSecond of [false, true]) {
  test(`content image thumbnails distinguish repeated labels${brokenSecond ? " and handle unavailable images" : ""}`, async ({
    page,
  }) => {
    await page.route("https://example.invalid/*.png", (route) => {
      if (brokenSecond && route.request().url().endsWith("second.png"))
        return route.fulfill({ status: 404, body: "" });
      return route.fulfill({
        contentType: "image/svg+xml",
        body: `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="80" height="60" fill="${route.request().url().endsWith("second.png") ? "blue" : "red"}"/></svg>`,
      });
    });
    await page.goto(page.url() + "?task&two-images");
    // Inline previews stay hidden; thumbnails are created only in the drawer.
    await expect(
      page.getByTestId("markdown-image-preview-collapsed"),
    ).toHaveCount(2);
    await expect(page.locator(".touch-task-sheet img")).toHaveCount(0);
    await openTaskActions(page);
    await page
      .getByRole("button", { name: "Content actions", exact: true })
      .click();
    const images = page.getByRole("button", {
      name: "Image: sample",
      exact: true,
    });
    await expect(images).toHaveCount(2);
    // WebKit reports an SVG's naturalWidth at its drawn size (64 for a 48px
    // tall 4:3 thumbnail), so only assert that the image loaded.
    await expect
      .poll(() =>
        images
          .first()
          .locator("img")
          .evaluate((img: HTMLImageElement) => img.naturalWidth),
      )
      .toBeGreaterThan(0);
    const thumbnailBounds = await images.first().locator("img").boundingBox();
    expect(thumbnailBounds?.width).toBeCloseTo(48, 2);
    expect(thumbnailBounds?.height).toBeCloseTo(48, 2);
    if (brokenSecond) {
      await expect(images.nth(1).locator("img")).toHaveCount(0);
      await expect(images.nth(1).locator(".lucide-image-off")).toBeVisible();
    } else {
      await expect
        .poll(() =>
          images
            .nth(1)
            .locator("img")
            .evaluate((img: HTMLImageElement) => img.naturalWidth),
        )
        .toBeGreaterThan(0);
      await expect(images.nth(1).locator("img")).toHaveAttribute(
        "src",
        "https://example.invalid/second.png",
      );
    }
    await images.first().locator("img").click();
    await expect(
      page.getByRole("button", { name: "Open image", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Copy image", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(images).toHaveCount(2);
    await expect(
      page.getByTestId("markdown-image-preview-collapsed"),
    ).toHaveCount(2);
  });
}
