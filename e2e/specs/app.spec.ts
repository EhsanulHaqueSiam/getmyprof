import { expect, test } from "@playwright/test";

// One journey through v1 against the fake agent (GRADCODE_AGENT=fake, fresh GRADCODE_HOME).
// The fake runs the real hunt tools on fixture data, so proposals, approvals, spend and
// settling are the real code paths. Tests share one server, so they run in order.
test.describe.configure({ mode: "serial" });

test("first run: setup saves a hunt, confirmed facts and loops", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/setup$/);
  await page.getByRole("button", { name: "Off" }).click(); // paid lookups on
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByRole("textbox", { name: "Add" }).fill("Bangladesh");
  await page.getByRole("textbox", { name: "Add" }).press("Enter");
  await expect(page.getByRole("button", { name: "Bangladesh" })).toBeVisible();
  await page.getByLabel("CV text").fill("BSc Computer Science 2025, GPA 3.8");
  await page.getByRole("button", { name: "Read it" }).click();
  await expect(page.getByTestId("fact")).toHaveCount(3);
  await page.getByTestId("fact").first().getByRole("checkbox").check();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Your hunt" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Start hunting" }).click();
  await expect(page.getByRole("heading", { name: "What should we find?" })).toBeVisible();
});

test("a hunt asks before paying, proposes rows, and settles once reviewed", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Find professors/ }).click();
  await expect(page).toHaveURL(/\/t\/thr_/);

  const approval = page.getByTestId("approval");
  await expect(approval).toContainText("prospeo.people.email.find");
  await approval.getByRole("button", { name: /Allow once/ }).click();
  await expect(page.getByText(/Three came up/)).toBeVisible();
  await expect(page.getByText(/Worked for/)).toBeVisible();

  await expect(page.getByTestId("proposal")).toHaveCount(3);
  await page.getByRole("button", { name: "Accept all" }).click();
  await expect(page.getByText("Nothing to review")).toBeVisible();
  await expect(page.getByText("Settled · nothing waits on you")).toBeVisible();
  // The settled thread leaves the main list but stays visible while it's open.
  await expect(page.getByRole("button", { name: /Settled/ })).toBeVisible();
});

test("results: a row action fills cells, and accepting clears the blue", async ({ page }) => {
  await page.goto("/");
  // Settled threads hide in the collapsed Settled shelf; open it to reach the thread.
  await page.getByRole("button", { name: /Settled/ }).click();
  await page.getByRole("link", { name: "Find professors" }).click();
  await page.getByRole("tab", { name: /Results/ }).click();
  await expect(page.getByTestId("result-row")).toHaveCount(3);
  await expect(page.getByRole("columnheader", { name: /Money tier/ })).toBeVisible();
  await expect(page.getByText("2 strong").first()).toBeVisible();

  await page.getByLabel("Select Kevin Lybarger").check();
  await page.getByLabel("Select Mohan Zalake").check();
  await page.getByRole("button", { name: /Find and check emails/ }).click();
  await expect(page.getByText("2 proposed cells")).toBeVisible();
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(page.getByText("0 proposed cells")).toBeVisible();
});

test("professors, funding and loops show the hunt's data", async ({ page }) => {
  await page.goto("/professors");
  await expect(page.getByRole("link", { name: "Kevin Lybarger" })).toBeVisible();
  await page.getByRole("link", { name: "Kevin Lybarger" }).click();
  await expect(page.getByRole("heading", { name: "Kevin Lybarger" })).toBeVisible();
  await expect(page.getByText("ok", { exact: false }).first()).toBeVisible();

  await page.goto("/funding");
  await page.getByRole("main").getByRole("button", { name: "Search" }).click();
  await expect(page.getByText("Antonios Anastasopoulos").first()).toBeVisible();

  await page.goto("/loops");
  await expect(page.getByRole("cell", { name: "Nightly sweep" })).toBeVisible();
  await page.getByRole("cell", { name: "New awards" }).click();
  await page.getByRole("button", { name: /Run now/ }).click();
  await expect(page).toHaveURL(/\/t\/thr_/);
  await expect(page.getByRole("heading", { name: /New awards ·/ })).toBeVisible();
});

test("outreach: drafts wait for approval, a sent email's reply comes back as your turn", async ({
  page,
}) => {
  // The fake stack's mailbox never touches the network; Lybarger answers on the next sync.
  await page.goto("/settings");
  await page.getByLabel("Your name").fill("Test Applicant");
  await page.getByLabel("Address").fill("me@example.com");
  await page.getByLabel("App password").fill("app-password");
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByText("me@example.com")).toBeVisible();

  await page.goto("/");
  await page.getByRole("button", { name: /Settled/ }).click();
  await page.getByRole("link", { name: "Find professors" }).click();
  await page.getByRole("tab", { name: /Results/ }).click();
  for (const name of ["Kevin Lybarger", "Mohan Zalake", "Natalie Parde"])
    await page.getByLabel(`Select ${name}`).check();
  await page.getByRole("button", { name: /Draft first emails/ }).click();
  await page.getByRole("tab", { name: "Chat" }).click();
  await expect(page.getByText("Skipped 1 apply-only")).toBeVisible();

  await page.goto("/pipeline");
  const approve = page.getByTestId("turn-approve");
  await expect(approve).toContainText("To approve · 2");
  await approve.getByText("Kevin Lybarger").click();
  await expect(page.getByTestId("next-step")).toContainText("Approve the draft");
  await page.getByRole("button", { name: /Send now/ }).click();
  await expect(page.getByTestId("message")).toHaveCount(1);

  await page.getByTitle("Sync now").click();
  const yours = page.getByTestId("turn-yours");
  await expect(yours).toContainText("Kevin Lybarger");
  await yours.getByText("Kevin Lybarger").click();
  await expect(page.getByText(/reply read as interested/)).toBeVisible();
  await expect(page.getByTestId("sequence")).toContainText("paused: they replied");
  await expect(page.getByLabel("Message")).toHaveValue(/Thank you/);

  await page.getByRole("button", { name: "Board" }).click();
  await expect(page.getByTestId("card").filter({ hasText: "Kevin Lybarger" })).toContainText(
    "your turn",
  );
});
