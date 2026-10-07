import { expect, test } from "@playwright/test";

// Threads and loops, on the state app.spec.ts leaves: its hunt's professors in the sheet, treg
// connected, an offer accepted. The "after" project runs it once app.spec.ts has finished.
test.describe.configure({ mode: "serial" });

test("scoped threads: Ask about a professor answers from the record, @ adds a school, rename, filter, starter keys", async ({
  page,
}) => {
  await page.goto("/professors");
  await page
    .getByRole("main")
    .getByRole("link", { name: /Kevin Lybarger/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Ask about Lybarger" }).click();
  await expect(page.getByTestId("scope-chip")).toContainText("Lybarger");
  const message = page.getByLabel("Message");
  await message.press("End");
  await message.pressSequentially("what money do they have?");
  await message.press("Enter");

  // Ask mode with the record in context: answered from the sheet, nothing fetched or spent.
  await expect(page).toHaveURL(/\/t\/thr_/);
  await expect(page.getByText(/From the sheet, without fetching: Kevin Lybarger/)).toBeVisible();
  // The next question in this thread is an Ask too.
  await expect(page.getByRole("button", { name: "Ask", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("scope-chip")).toContainText("Lybarger");
  await page.getByRole("tab", { name: "Professor" }).click();
  await expect(page.getByTestId("professor-tab")).toContainText("Kevin Lybarger");

  // @ picks a school from the sheet and it joins the chip.
  await message.pressSequentially("@George");
  await page.getByRole("option", { name: /^George Mason University\s*school$/ }).click();
  await expect(page.getByTestId("scope-chip")).toContainText("George Mason University");

  // Rename from the header.
  await page.getByRole("heading").getByRole("button").click();
  await page.getByLabel("Thread title").fill("Lybarger's money");
  await page.getByLabel("Thread title").press("Enter");
  await expect(page.getByRole("heading", { name: "Lybarger's money" })).toBeVisible();

  // Filter the hunt's Results down to one row.
  await page.getByRole("link", { name: "Find professors", exact: true }).click();
  await page.getByRole("tab", { name: /Results/ }).click();
  await page.getByLabel("Filter rows").fill("Lybarger");
  await expect(page.getByTestId("result-row")).toHaveCount(1);

  // On a new thread, 2 starts the second starter.
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "What should we find?" })).toBeVisible();
  await page.keyboard.press("2");
  await expect(page.getByRole("heading", { name: "Follow the money" })).toBeVisible();
});

test("loops: scope, auto-accept rules, and Always under $x here; the table shows the run", async ({
  page,
}) => {
  await page.goto("/loops");
  await page.getByRole("button", { name: "New loop" }).click();
  await page.getByLabel("Loop name").fill("Auto sweep");
  await page
    .getByLabel("Instructions")
    .fill("Sweep George Mason for professors who fund students.");
  await page.getByLabel("Add a school").fill("George Mason University");
  await page.getByLabel("Add a school").press("Enter");
  await page.getByRole("radio", { name: "Auto-accept rules" }).click();
  await expect(page.getByRole("checkbox", { name: "verified email" })).toBeChecked();
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("button", { name: "Run now" }).click();

  // The run carries its scope, and a paid call can be allowed for good under a cent ceiling.
  await expect(page).toHaveURL(/\/t\/thr_/);
  await expect(page.getByTestId("scope-chip")).toContainText("George Mason University");
  await page.getByRole("button", { name: "Always under $0.03 here" }).click();
  await expect(page.getByText(/Allowed · /)).toBeVisible();

  await page.goto("/loops");
  const row = page.getByRole("row", { name: /Auto sweep/ });
  await expect(row).toContainText("$0.0245");
  await expect(row).not.toContainText("never");
  // An earlier test accepted an offer, so the hunt is over; the loop still keeps its settings.
  await row.click();
  await expect(page.getByRole("radio", { name: "Auto-accept rules" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
});

test("funding and professor pages: Add PI, tabs, every fact with its source, finder row actions", async ({
  page,
}) => {
  await page.goto("/funding");
  await page.getByLabel("Topics").fill("language technologies");
  await page.getByRole("main").getByRole("button", { name: "Search", exact: true }).click();
  const award = page.getByRole("row", { name: /Anastasopoulos/ });
  await award.getByRole("button", { name: "Add PI" }).click();
  await expect(award).toContainText("yes");
  await page.getByRole("tab", { name: "programs" }).click();
  await expect(page.getByTestId("program-row").first()).toBeVisible();

  // The added PI has the award as a grant, linked to its page.
  await page.goto("/professors");
  await page.getByRole("main").getByRole("link", { name: "Antonios Anastasopoulos" }).click();
  await expect(page.getByRole("link", { name: "NSF 2439202" }).first()).toBeVisible();

  // A professor the hunt found shows where each fact came from, and what happened.
  await page.goto("/professors");
  await page.getByRole("main").getByRole("link", { name: "Kevin Lybarger" }).click();
  await expect(page.getByRole("link", { name: /kevinlybarger\.me · / }).first()).toBeVisible();
  await expect(page.getByTestId("professor-side")).toContainText("Added to the sheet");
  await expect(page.getByRole("link", { name: "Scholar" })).toBeVisible();

  // The finder filters by tier and runs a row action in a thread of its own.
  await page.goto("/professors");
  await page.getByLabel("Money tier").selectOption("2");
  await page.getByLabel("Select Kevin Lybarger").check();
  await page.getByRole("button", { name: "Check money" }).click();
  await expect(
    page.getByRole("heading", { name: "Check money (NSF, NIH) · 1 professor" }),
  ).toBeVisible();
});

test("keyboard: Enter allows, j moves, r rejects, shift-A accepts all; ⌘K goes to a school", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "What should we find?" })).toBeVisible();
  await page.keyboard.press("1");
  await expect(page.getByTestId("approval")).toBeVisible();
  // Out of the composer, Enter allows the open approval.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("Enter");
  await expect(page.getByText(/^Allowed · /)).toBeVisible();

  const proposals = page.getByTestId("proposal");
  await expect(proposals.first()).toBeVisible();
  // How many depends on what earlier tests left in the sheet; j stops at the last one.
  const before = await proposals.count();
  await page.keyboard.press("j");
  await expect(proposals.nth(Math.min(1, before - 1))).toHaveAttribute("aria-current", "true");
  await page.keyboard.press("r");
  await expect(proposals).toHaveCount(before - 1);
  if (before > 1) {
    await page.keyboard.press("Shift+A");
    await expect(proposals).toHaveCount(0);
  }

  await page.keyboard.press("ControlOrMeta+k");
  await page.getByLabel("Command").fill("University of Illinois");
  await page.getByLabel("Command").press("Enter");
  await expect(page).toHaveURL(/\/professors\?school=/);
  await expect(page.getByLabel("School")).toHaveValue("University of Illinois Chicago");
});

test("phone: the sidebar opens over the page and closes on the way somewhere", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/professors");
  // The page itself gets the width: a 0px column would hide its heading.
  await expect(page.getByRole("heading", { name: "Professors" })).toBeVisible();
  const sidebar = page.getByRole("link", { name: /^Funding/ });
  await expect(sidebar).toBeHidden();
  await page.getByRole("button", { name: "Menu" }).click();
  await sidebar.click();
  await expect(page).toHaveURL(/\/funding$/);
  await expect(sidebar).toBeHidden();
  await expect(page.getByRole("heading", { name: "Funding" })).toBeVisible();
  // The Vault stacks too: its content column keeps the width.
  await page.goto("/vault?section=facts");
  const width = await page.locator("main").evaluate((m) => m.scrollWidth <= m.clientWidth + 1);
  expect(width).toBe(true);
});
