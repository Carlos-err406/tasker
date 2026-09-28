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
  test(`${mobile ? "mobile" : "desktop"}: enable, sync, pause and failure recover controls`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: mobile ? 411 : 600, height: 850 });
    await page.goto(
      `${server.resolvedUrls!.local[0]}tests/fixtures/sync.html?failure&${mobile ? "mobile" : ""}`,
    );
    await expect(
      page.getByRole("button", { name: "Enable sync" }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Enable sync" }).click();
    await expect(page.getByRole("status")).toContainText("Up to date");
    await page.getByRole("button", { name: "Sync now" }).click();
    await expect(
      page.getByRole("button", { name: "Syncing…", exact: true }),
    ).toBeDisabled();
    await expect(page.getByRole("alert")).toHaveText("Network unavailable");
    await expect(page.getByRole("button", { name: "Sync now" })).toBeEnabled();
    await page.getByRole("button", { name: "Pause sync" }).click();
    await expect(page.getByRole("status")).toContainText("Sync paused");
    await expect(
      page.getByRole("button", { name: "Enable sync" }),
    ).toBeEnabled();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(mobile ? 411 : 600);
    expect(
      await page
        .locator("img")
        .first()
        .evaluate(
          (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
        ),
    ).toBe(true);
  });
}
