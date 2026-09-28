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
for (const mobile of [false, true]) {
  const name = mobile ? "mobile" : "desktop";
  const url = (extra = "") =>
    `${server.resolvedUrls!.local[0]}tests/fixtures/backups.html?${mobile ? "mobile&" : ""}${extra}`;
  test(`${name}: Google logos and newest-first local/Drive ordering`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: mobile ? 411 : 600, height: 850 });
    await page.goto(url());
    await expect(page.locator(".backup-row small")).toHaveText([
      "newest · 3 KB",
      "middle · 2 KB",
      "oldest · 1 KB",
    ]);
    for (const icon of await page.locator('img[aria-hidden="true"]').all())
      expect(
        await icon.evaluate(
          (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
        ),
      ).toBe(true);
    await expect(page.locator('img[aria-hidden="true"]')).toHaveCount(2);
    await page.getByRole("button", { name: "Browse Drive backups" }).click();
    await expect(page.locator(".backup-row small")).toHaveText([
      "newest · 3 KB",
      "middle · 2 KB",
      "oldest · 1 KB",
      "newest · 3 KB",
      "middle · 2 KB",
      "oldest · 1 KB",
    ]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(mobile ? 411 : 600);
  });
  test(`${name}: manual upload returns to idle immediately on completion and failure`, async ({
    page,
  }) => {
    for (const scenario of ["", "failure"]) {
      await page.goto(url(scenario));
      const upload = page.getByRole("button", {
        name: "Upload now",
        exact: true,
      });
      await upload.click();
      await expect(
        page.getByRole("button", { name: "Uploading…", exact: true }),
      ).toBeDisabled();
      await expect(upload).toBeEnabled({ timeout: 2000 });
      if (scenario)
        await expect(page.getByRole("alert")).toHaveText(
          "Upload failed: offline",
        );
    }
  });
  test(`${name}: background upload polling clears the loading state`, async ({
    page,
  }) => {
    await page.goto(url("auto"));
    await expect(
      page.getByRole("button", { name: "Uploading…", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Upload now", exact: true }),
    ).toBeEnabled({ timeout: 2500 });
  });
}
