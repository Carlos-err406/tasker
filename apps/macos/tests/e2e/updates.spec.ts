import { test, expect } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
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
  await page.setViewportSize({ width: 411, height: 850 });
});
test("checks, offers update and recovers after a failed download", async ({
  page,
}) => {
  await page.goto(
    `${server.resolvedUrls!.local[0]}tests/fixtures/updates.html?fail`,
  );
  await page
    .getByRole("button", { name: "Check for updates", exact: true })
    .click();
  const update = page.getByRole("button", {
    name: "Update to 0.1.2",
    exact: true,
  });
  await expect(update).toBeEnabled();
  await update.click();
  await expect(
    page.getByRole("button", { name: /Downloading/ }),
  ).toBeDisabled();
  await expect(page.getByRole("alert")).toHaveText(
    "Download failed. Try again.",
  );
  await expect(update).toBeEnabled();
  await page
    .getByRole("button", { name: "Check for updates", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(update).toBeEnabled();
  const box = await update.boundingBox();
  expect(box!.y + box!.height).toBeGreaterThan(780);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    411,
  );
});
test("does not offer an update when the release has no Android package", async ({
  page,
}) => {
  await page.goto(
    `${server.resolvedUrls!.local[0]}tests/fixtures/updates.html?missing`,
  );
  await page
    .getByRole("button", { name: "Check for updates", exact: true })
    .click();
  await expect(page.getByRole("status")).toHaveText(
    "No Android update has been published yet.",
  );
  await expect(page.getByRole("button", { name: /Update to/ })).toHaveCount(0);
});
test("keeps installation available after Android permission settings", async ({
  page,
}) => {
  await page.goto(
    `${server.resolvedUrls!.local[0]}tests/fixtures/updates.html`,
  );
  await page
    .getByRole("button", { name: "Check for updates", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Update to 0.1.2", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Allow updates from Tasker",
  );
  await expect(
    page.getByRole("button", { name: "Install update", exact: true }),
  ).toBeEnabled();
});

test("About groups version, credits and explicit update checks on desktop", async ({
  page,
}) => {
  await page.setViewportSize({ width: 420, height: 620 });
  await page.goto(
    `${server.resolvedUrls!.local[0]}tests/fixtures/updates.html?desktop`,
  );
  await expect(
    page.getByRole("heading", { name: "About", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Version 0.1.1 · Mac", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toHaveText(
    "Check for a newer version of Tasker.",
  );
  await expect(
    page.getByRole("link", { name: "SwiftBar", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Carlos", exact: true }).click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-opened-url",
    "https://github.com/Carlos-err406",
  );
  await page
    .getByRole("button", { name: "Check for updates", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "View update 0.1.2", exact: true }),
  ).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    420,
  );
});
