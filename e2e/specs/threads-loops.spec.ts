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
