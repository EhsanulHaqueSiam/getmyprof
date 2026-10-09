import { expect, test } from "@playwright/test";

// One journey through v1 against the fake agent (GETMYPROF_AGENT=fake, fresh GETMYPROF_HOME).
// The fake runs the real hunt tools on fixture data, so proposals, approvals, spend and
// settling are the real code paths. Tests share one server, so they run in order.
test.describe.configure({ mode: "serial" });

test("first run: setup saves a hunt, confirmed facts and loops", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/setup$/);
  // Paid lookups: the scripted stack accepts any token without reaching treg.
  await page.getByRole("button", { name: "Paste a key" }).click();
  await page.getByLabel("treg token").fill("tok_e2e_fake");
  await page.getByTestId("treg-connect").getByRole("button", { name: "Connect" }).click();
  await expect(page.getByTestId("treg-connected")).toContainText("paid by scripted");
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

  // The paid call's real cost is in the ledger, and Settings shows it for this customer.
  await page.goto("/settings");
  await expect(page.getByTestId("treg-connected")).toContainText("$0.0245 this month · 1 call");
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

  // Three rows of email finding cost more than $0.01, so the dock asks first.
  await page.getByLabel("Select Kevin Lybarger").check();
  await page.getByLabel("Select Mohan Zalake").check();
  await page.getByLabel("Select Natalie Parde").check();
  await page.getByRole("button", { name: /Find and check emails/ }).click();
  await expect(page.getByTestId("row-approval")).toContainText("3 rows · $0.0144");
  await page.getByTestId("row-approval").getByRole("button", { name: "Deny" }).click();
  await page.getByLabel("Select Natalie Parde").uncheck();
  await page.getByRole("button", { name: /Find and check emails/ }).click();
  await expect(page.getByText("2 proposed cells")).toBeVisible();
  // Each Email cell shows what finding that address cost.
  await expect(page.getByTestId("result-row").filter({ hasText: "Kevin Lybarger" })).toContainText(
    "$0.0048",
  );
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
  // Advertised positions: the posting's contact goes into the sheet in one click.
  await page.getByRole("tab", { name: "positions" }).click();
  await page.getByRole("button", { name: "jobs.ac.uk" }).click();
  await page.getByLabel("Topics").fill("language models");
  await page.getByRole("main").getByRole("button", { name: "Search" }).click();
  const posting = page.getByRole("row", { name: /Language models for health records/ });
  await posting.getByRole("button", { name: "Add PI" }).click();
  await expect(posting.getByRole("cell", { name: "yes", exact: true })).toBeVisible();

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
  await page.getByRole("button", { name: "App password", exact: true }).click();
  await page.getByLabel("Your name").fill("Test Applicant");
  await page.getByLabel("Address").fill("me@example.com");
  await page.getByLabel("App password").fill("app-password");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByText("me@example.com")).toBeVisible();

  await page.goto("/");
  await page.getByRole("button", { name: /Settled/ }).click();
  await page.getByRole("link", { name: "Find professors" }).click();
  await page.getByRole("tab", { name: /Results/ }).click();
  await page.getByLabel("Select all rows").check();
  await page.getByRole("button", { name: /Draft first emails/ }).click();
  await page.getByRole("tab", { name: "Chat" }).click();
  await expect(page.getByText("Skipped 1 apply-only")).toBeVisible();

  await page.goto("/pipeline");
  const approve = page.getByTestId("turn-approve");
  await expect(approve).toContainText("To approve · 2");
  await approve.getByText("Kevin Lybarger").click();
  await expect(page.getByTestId("next-step")).toContainText("Approve the draft");

  // A claim with no fact behind it holds the draft back until it's cited or cut.
  const message = page.getByLabel("Message");
  const original = await message.inputValue();
  await message.fill(`${original}\n\nI led a team of five.`);
  await expect(page.getByTestId("draft-issues")).toContainText(
    '"I led a team of five." cites no fact',
  );
  await expect(page.getByRole("button", { name: /Send now/ })).toHaveCount(0);
  await message.fill(original);
  await expect(page.getByTestId("draft-issues")).toHaveCount(0);
  await page.getByRole("button", { name: /Send now/ }).click();
  await expect(page.getByTestId("message")).toHaveCount(1);

  await page.getByTitle("Sync now").click();
  const yours = page.getByTestId("turn-yours");
  await expect(yours).toContainText("Kevin Lybarger");
  await yours.getByText("Kevin Lybarger").click();
  await expect(page.getByText(/reply read as interested/)).toBeVisible();
  await expect(page.getByTestId("sequence")).toContainText("paused: they replied");
  await expect(page.getByLabel("Message")).toHaveValue(/Thank you/);
  // Their attachment is filed in the Vault and shows on their message.
  await expect(page.getByTestId("message-attachments")).toContainText(
    "Kevin Lybarger: lab-projects.txt",
  );

  await page.getByRole("button", { name: "Board" }).click();
  await expect(page.getByTestId("card").filter({ hasText: "Kevin Lybarger" })).toContainText(
    "your turn",
  );
});

test("vault: the agent's finds wait in To file, and submitting an application drafts the notes", async ({
  page,
}) => {
  await page.goto("/vault?section=documents");
  await page.getByLabel("Upload document").setInputFiles({
    name: "passport.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 passport"),
  });
  await expect(page.getByTestId("documents")).toContainText("passport.pdf");

  await page.goto("/vault?section=scholarships");
  await page.getByRole("button", { name: "Find scholarships" }).click();
  await expect(page.getByText("2 wait in your To file.")).toBeVisible();
  await page.goto("/vault?section=scholarships");
  await expect(page.getByTestId("to-file")).toHaveCount(2);
  await page
    .getByTestId("to-file")
    .filter({ hasText: "Fulbright" })
    .getByRole("button", { name: "File" })
    .click();
  await page
    .getByTestId("to-file")
    .filter({ hasText: "Chevening" })
    .getByRole("button", { name: "File" })
    .click();
  // "Fits me" keeps the one open to this applicant's citizenship and PhD track.
  await expect(page.getByTestId("scholarships").locator("tbody tr")).toHaveCount(1);
  await expect(page.getByTestId("scholarships")).toContainText("Fulbright");

  await page.goto("/vault?section=programs");
  await page.getByRole("button", { name: "Find programs" }).click();
  await expect(page.getByText("1 waits in your To file.")).toBeVisible();
  await page.goto("/vault?section=programs");
  await page.getByTestId("to-file").getByRole("button", { name: "File" }).click();
  await page.getByRole("button", { name: "Start application" }).click();
  const app = page.getByTestId("application");
  await expect(app).toContainText("PhD in Information Technology");
  await expect(app.getByRole("button", { name: "Kevin Lybarger" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await app.getByLabel("Application status").selectOption("submitted");
  // The agent drafts the note; it waits behind Lybarger's earlier answer in his sequence.
  await page.goto("/pipeline");
  await page.getByTestId("turn-yours").getByText("Kevin Lybarger").click();
  await expect(page.getByTestId("sequence")).toContainText("After applying");
});

test("writer: a statement cites its facts, and an unproven one blocks export until confirmed", async ({
  page,
}) => {
  await page.goto("/vault?section=writing");
  await page.getByRole("button", { name: "Write", exact: true }).click();
  await expect(page.getByText(/Saved in the Writer/)).toBeVisible();

  await page.goto("/vault?section=writing");
  await expect(page.getByTestId("writing")).toContainText("1 claim needs proof");
  await page.getByTestId("writing").getByRole("link").first().click();
  await expect(page).toHaveURL(/\/vault\/writing\/wri_/);
  const writer = page.url();
  await expect(page.getByTestId("facts-used")).toContainText("BSc in Computer Science, 2025");
  await expect(page.getByTestId("blocked")).toContainText("GPA 3.8 / 4.0");
  await expect(page.locator("[data-blocked]")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Export PDF" })).toBeDisabled();

  // Confirming the fact on the Vault's Lifeline unblocks the claim without rewriting anything.
  await page.goto("/vault");
  await page.getByTestId("lifeline-item").filter({ hasText: "GPA 3.8 / 4.0" }).click();
  const note = page.getByTestId("fact-note");
  await expect(note).toContainText("2025");
  await note.getByRole("button", { name: "Confirm" }).click();
  await expect(note).toContainText("confirmed");
  // The CV tab lays the facts out by section.
  await page.getByRole("button", { name: "CV", exact: true }).click();
  await expect(page.getByTestId("cv-view")).toContainText("Education");
  await page.goto(writer);
  await expect(page.getByTestId("blocked")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Export PDF" })).toBeEnabled();
});

test("after applying: an interview gets a prep pack and a thank-you, and offers compare after rent", async ({
  page,
}) => {
  await page.goto("/vault?section=applications");
  const app = page.getByTestId("application");
  await app.getByLabel("Interview with").fill("Kevin Lybarger");
  await app.getByLabel("Interview time").fill("2026-12-10T09:30");
  await app.getByRole("button", { name: "Add interview" }).click();
  await expect(app.getByLabel("Application status")).toHaveValue("interview");

  await app.getByRole("button", { name: "Write prep pack" }).click();
  await expect(page.getByText(/Saved in the Writer/)).toBeVisible();
  await page.goto("/vault?section=applications");
  await expect(
    page.getByTestId("interviews").getByRole("button", { name: "Prep pack" }),
  ).toBeVisible();

  await page.getByTestId("interviews").getByRole("button", { name: "Thank-you" }).click();
  await expect(page.getByText("A thank-you waits in Pipeline.")).toBeVisible();

  await page.goto("/vault?section=offers");
  const offers = [
    ["George Mason University", "34000", "1500"],
    ["University of Edinburgh", "24000", "900"],
  ];
  for (const [i, [university = "", stipend = "", rent = ""]] of offers.entries()) {
    await page.getByRole("button", { name: "Add offer" }).click();
    for (const [label, value] of [
      ["University", university],
      ["Stipend", stipend],
      ["Rent a month", rent],
    ] as const) {
      const field = page.getByLabel(`${label}, offer ${i + 1}`, { exact: true });
      await field.fill(value);
      await field.blur();
    }
  }
  await expect(page.getByTestId("offers")).toContainText("$16,000");
  await expect(page.getByTestId("offers")).toContainText("$13,200");
});

test("loops: a webhook run fills its placeholders, and every run goes back to one thread", async ({
  page,
  request,
}) => {
  await page.goto("/loops");
  await page.getByRole("button", { name: "New loop" }).click();
  await page.getByLabel("Loop name").fill("Award watch");
  await page.getByLabel("Instructions").fill("Vet {{body.pi}} at {{body.org}}.");
  await page.getByLabel("Schedule").selectOption("webhook");
  await page.getByLabel("Report to").selectOption("same");
  await page.getByRole("button", { name: "Save" }).click();
  const url = await page.getByTestId("hook-url").textContent();
  const path = new URL(url ?? "").pathname;

  const first = await request.post(path, { data: { pi: "Ge Gao", org: "UMD" } });
  expect(first.status()).toBe(202);
  const { threadId } = await first.json();
  const second = await request.post(path, { data: { pi: "Rui Zhang", org: "Penn State" } });
  expect((await second.json()).threadId).toBe(threadId);
  expect((await request.post("/api/hooks/not-a-token", { data: {} })).status()).toBe(404);

  await page.goto(`/t/${threadId}`);
  await expect(page.getByText("Vet Ge Gao at UMD.")).toBeVisible();
  await expect(page.getByText("Vet Rui Zhang at Penn State.")).toBeVisible();
});

test("mcp: your own servers reach every session, and getmyprof answers other agents", async ({
  page,
  request,
}) => {
  await page.goto("/settings");
  await page.getByLabel("MCP server name").fill("papers");
  await page.getByLabel("MCP server URL or command").fill("npx -y papers-mcp --read-only");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("npx -y papers-mcp --read-only")).toBeVisible();
  await page.getByRole("button", { name: "asks each call" }).click();
  await expect(page.getByRole("button", { name: "runs without asking" })).toBeVisible();

  await expect(page.getByTestId("mcp-url")).toHaveText(/\/api\/mcp$/);
  expect((await request.post("/api/mcp", { data: {} })).status()).toBe(401);
});

test("threads: fork one to branch from it, and find any thread by what was said", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Settled/ }).click();
  await page.getByRole("link", { name: "Find professors" }).click();
  await page.getByRole("button", { name: "Fork thread" }).click();
  await expect(page.getByRole("heading", { name: "Find professors (fork)" })).toBeVisible();
  await expect(page.getByText(/Three came up/)).toBeVisible();

  await page.keyboard.press("ControlOrMeta+k");
  await page.getByLabel("Command").fill("wants applications");
  await expect(page.getByText(/Find professors · ".*wants applications/).first()).toBeVisible();
});

test("composer: an attached file is kept in the vault and reaches the agent", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Settled/ }).click();
  await page.getByRole("link", { name: "Find professors", exact: true }).click();
  // The new-thread page has a composer too; attach only once the thread's own is showing.
  await expect(page.getByRole("heading", { name: "Find professors", exact: true })).toBeVisible();
  await page.getByLabel("Attach files").setInputFiles({
    name: "lab-flyer.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 flyer"),
  });
  await expect(page.getByTestId("attachments")).toContainText("lab-flyer.pdf");
  await page.getByLabel("Message").fill("Does this lab fit me?");
  await page.getByLabel("Message").press("Enter");
  await expect(page.getByText("attached lab-flyer.pdf")).toBeVisible();
  await expect(page.getByText("Read lab-flyer.pdf.")).toBeVisible();

  await page.goto("/vault?section=documents");
  await expect(page.getByTestId("documents")).toContainText("lab-flyer.pdf");
});

test("the end of the journey: a thank-you to a recommender, and visa steps once you accept", async ({
  page,
}) => {
  await page.goto("/vault?section=applications");
  const app = page.getByTestId("application");
  await app.getByLabel("Recommender name").fill("Dr. Rahman");
  await app.getByLabel("Recommender email").fill("rahman@example.edu");
  await app.getByRole("button", { name: "Add recommender" }).click();
  await app
    .getByTestId("recommender")
    .filter({ hasText: "Dr. Rahman" })
    .getByRole("button", { name: "Thank-you" })
    .click();
  await expect(page.getByText(/Saved in the Writer/)).toBeVisible();

  await page.goto("/vault?section=offers");
  await page.getByLabel("Status, offer 1").selectOption("accepted");
  await page.getByRole("button", { name: "Write visa steps" }).click();
  await expect(page.getByText(/Saved in the Writer/)).toBeVisible();

  await page.goto("/vault?section=writing");
  await expect(page.getByTestId("writing")).toContainText("Note · Thank-you to Dr. Rahman");
  await expect(page.getByTestId("writing")).toContainText("Visa steps · George Mason University");
});

test("your data: a backup holds everything and restores", async ({ request }) => {
  const download = await request.get("/api/backup");
  expect(download.ok()).toBe(true);
  const backup = await download.json();
  expect(backup.app).toBe("getmyprof");
  expect(backup.tables.records.length).toBeGreaterThan(0);
  expect(Object.keys(backup.files).length).toBeGreaterThan(0);

  const restore = await request.post("/api/backup", { data: backup });
  expect(restore.ok()).toBe(true);
  expect((await restore.json()).records).toBe(backup.tables.records.length);
  expect((await request.post("/api/backup", { data: { tables: {} } })).status()).toBe(400);
});

test("mailbox: sign in with Google with nothing to set up", async ({ page }) => {
  // The scripted stack has a Google client of its own, skips Google's page and calls its own
  // callback, which sends the browser back to Settings with the mailbox connected.
  await page.goto("/settings");
  await page.getByTestId("mail-connected").getByRole("button", { name: "Disconnect" }).click();
  // Gmail opens on the app password; signing in is the other choice.
  await expect(page.getByLabel("App password")).toBeVisible();
  await page.getByRole("button", { name: "Sign in with Google", pressed: false }).click();
  const form = page.getByTestId("mail-signin");
  await expect(form.getByLabel("Client ID")).toHaveCount(0);
  // A user can still bring their own client.
  await form.getByRole("button", { name: "Use my own client" }).click();
  await expect(form.getByLabel("Client ID")).toBeVisible();
  await form.getByRole("button", { name: "Use getmyprof's client" }).click();
  await form.getByLabel("Your name").fill("Test Applicant");
  await form.getByRole("button", { name: "Sign in with Google" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByTestId("mail-connected")).toContainText("applicant@example.com");
  await expect(page.getByTestId("mail-connected")).toContainText("signed in with Google");
});
