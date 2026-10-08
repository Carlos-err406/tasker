import { test, expect, type Locator } from "@playwright/test";
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
  await page.goto(
    server.resolvedUrls!.local[0] + "tests/fixtures/pull-to-refresh.html",
  );
  await expect(page.getByTestId("workspace")).toBeVisible();
});

// Desktop WebKit has no Touch constructor, so events carry plain touch points.
// The Android host gate exercises trusted touch input on the device.
async function drag(
  workspace: Locator,
  dx: number,
  dy: number,
  { release = true } = {},
) {
  await workspace.evaluate(
    (element, { dx, dy, release }) => {
      const fire = (type: string, x: number, y: number) => {
        const event = new Event(type, { bubbles: true });
        const points = type === "touchend" ? [] : [{ clientX: x, clientY: y }];
        Object.defineProperty(event, "touches", { value: points });
        element.dispatchEvent(event);
      };
      fire("touchstart", 150, 100);
      for (let step = 1; step <= 10; step++)
        fire("touchmove", 150 + (dx * step) / 10, 100 + (dy * step) / 10);
      if (release) fire("touchend", 150 + dx, 100 + dy);
    },
    { dx, dy, release },
  );
}

test("pulling down past the threshold refreshes once and shows progress", async ({
  page,
}) => {
  const workspace = page.getByTestId("workspace");
  const indicator = page.getByTestId("pull-to-refresh");
  await drag(workspace, 0, 200, { release: false });
  expect((await indicator.boundingBox())!.height).toBeGreaterThan(60);
  await drag(workspace, 0, 200);
  await expect(page.getByTestId("refresh-count")).toHaveText("1");
  await expect(indicator.locator("svg")).toHaveClass(/animate-spin/);
  await drag(workspace, 0, 200);
  await expect(page.getByTestId("refresh-count")).toHaveText("1");
  await page.evaluate(() => Reflect.get(window, "finishRefresh")());
  await expect(indicator.locator("svg")).not.toHaveClass(/animate-spin/);
  await expect.poll(async () => (await indicator.boundingBox())!.height).toBe(0);
});

test("short pulls, horizontal swipes and pulls below the top do not refresh", async ({
  page,
}) => {
  const workspace = page.getByTestId("workspace");
  await drag(workspace, 0, 60);
  await drag(workspace, 200, 120);
  await workspace.evaluate((element) => (element.scrollTop = 200));
  await drag(workspace, 0, 200);
  await expect(page.getByTestId("refresh-count")).toHaveText("0");
  await expect
    .poll(async () => (await page.getByTestId("pull-to-refresh").boundingBox())!.height)
    .toBe(0);
});
