import { test, expect, type Page } from "@playwright/test";
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
const calls = (page: Page) =>
  page.evaluate(() =>
    (Reflect.get(window, "calls") as { action: string }[]).map((c) => c.action),
  );
for (const mobile of [false, true]) {
  const name = mobile ? "mobile" : "desktop";
  const device = mobile ? "phone" : "Mac";
  async function open(page: Page, extra = "") {
    await page.setViewportSize({ width: mobile ? 411 : 600, height: 850 });
    await page.goto(
      `${server.resolvedUrls!.local[0]}tests/fixtures/backups.html?${mobile ? "mobile&" : ""}${extra}`,
    );
    await expect(
      page.getByRole("heading", { name: "Backups & Sync", exact: true }),
    ).toBeVisible();
  }
  test(`${name}: one panel shows connection, sync and backups without overflow`, async ({
    page,
  }) => {
    await open(page);
    await expect(page.getByText("Connected", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reconnect" })).toHaveCount(0);
    await expect(page.getByRole("switch", { name: "Sync" })).toBeChecked();
    await expect(page.getByText(`Last backup`)).toContainText(
      `${device} + Drive`,
    );
    for (const icon of await page.locator('img[aria-hidden="true"]').all())
      expect(
        await icon.evaluate(
          (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
        ),
      ).toBe(true);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(mobile ? 411 : 600);
  });
  test(`${name}: switch pauses and resumes sync; failures surface and recover`, async ({
    page,
  }) => {
    await open(page, "failure");
    const toggle = page.getByRole("switch", { name: "Sync" });
    await page.getByRole("button", { name: "Sync now" }).click();
    await expect(page.getByText("Network unavailable")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sync now" })).toBeEnabled();
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await expect(page.getByText("Paused", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sync now" })).toHaveCount(0);
    await toggle.click();
    await expect(toggle).toBeChecked();
  });
  test(`${name}: an expired login shows one Reconnect that resumes sync`, async ({
    page,
  }) => {
    await open(page, "expired&paused");
    await expect(page.getByRole("alert")).toHaveText("Google login expired");
    await expect(page.getByRole("switch", { name: "Sync" })).toBeDisabled();
    await page.getByRole("button", { name: "Reconnect", exact: true }).click();
    await expect(
      page.getByText("Waiting for you to finish in the browser…"),
    ).toBeVisible();
    await expect(page.getByText("Connected", { exact: true })).toBeVisible();
    await expect(page.getByRole("switch", { name: "Sync" })).toBeChecked();
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(await calls(page)).toContain("sync-enable");
  });
  test(`${name}: connect and disconnect`, async ({ page }) => {
    await open(page, "disconnected");
    await expect(page.getByRole("switch", { name: "Sync" })).toHaveCount(0);
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(page.getByText("Connected", { exact: true })).toBeVisible();
    expect(await calls(page)).not.toContain("sync-enable");
    await page.getByRole("button", { name: "Disconnect Google" }).click();
    await expect(
      page.getByRole("button", { name: "Connect", exact: true }),
    ).toBeVisible();
  });
  test(`${name}: upload progress is shown`, async ({ page }) => {
    await open(page, "uploading");
    await expect(page.getByText("Uploading to Drive (2 of 4)…")).toBeVisible();
    await page.screenshot({ path: `test-results/backups-${name}.png` });
  });
  test(`${name}: restore lists local and Drive snapshots together`, async ({
    page,
  }) => {
    await open(page);
    await page.getByRole("button", { name: "Restore…" }).click();
    const rows = page.locator(".backup-row small");
    await expect(rows).toHaveText([
      `newest · 3 KB · ${device} + Drive`,
      "phone · 2 KB · Drive",
      `oldest · 1 KB · ${device}`,
    ]);
    await page
      .locator(".backup-row")
      .filter({ hasText: "phone · 2 KB" })
      .getByRole("button", { name: "Restore" })
      .click();
    await page.getByRole("button", { name: "Restore backup" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        (Reflect.get(window, "calls") as Record<string, unknown>[]).find(
          (c) => c.action === "restore",
        ),
      ),
    ).toMatchObject({ id: "drive-phone", cloud: true });
  });
}
