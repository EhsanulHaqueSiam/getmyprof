import { CHECKS, Health } from "@gradcode/contracts";
import { expect, test } from "@playwright/test";

// Layered: the server answers /api/health, the page shows the same checks, and the
// browser's WebSocket reaches the server through Vite's proxy.
test("shell boots and reaches the server", async ({ page, request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBe(true);
  const health = Health.parse(await res.json());

  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto("/");
  await expect(page.getByTestId("ws-status")).toHaveText("connected");
  for (const name of CHECKS) {
    await expect(page.getByTestId(`check-${name}`)).toContainText(
      health.checks[name] ? "found" : "missing",
    );
  }

  await page.getByRole("button", { name: "Recheck tools" }).click();
  await expect(page.getByTestId("check-claude")).toBeVisible();
  expect(errors).toEqual([]);
});
