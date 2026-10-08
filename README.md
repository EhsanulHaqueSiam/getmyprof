# gradcode

An app for anyone hunting a funded degree. Every thread is a Claude Code session
on your own subscription, with free sources (NSF and NIH awards, UKRI, CORDIS, ARC, DFG and
NSERC grants, OpenAlex, CSRankings, web search and faculty pages) and optional paid lookups
through treg. It finds
professors who can fund you and the money behind them, then carries you through outreach,
applications and offers. Siam's install also reads hq and `~/Personal/gradhunt`, so Scout and the
cloud outreach routine keep working.

Design and the full spec, three required pages: the main spec
[docs/mocks/phase1.html](docs/mocks/phase1.html), the applicant's
[journey](docs/mocks/journey.html), and the
[Pipeline, Vault and Writer](docs/mocks/outreach-vault.html).

## Install

gradcode runs on macOS and Linux, with the agent on your own Claude subscription. The first run
downloads Claude Code (about 100 MB, straight from npm, checked against its published checksum)
into `~/.gradcode`; then sign in from Setup's Connect step, or with `gradcode login`.

### Command line

```sh
curl -fsSL https://github.com/EhsanulHaqueSiam/gradcode/releases/latest/download/install.sh | sh
```

Then run `gradcode` to start the server and open the app in your browser. `gradcode serve` keeps
it running in the background, `gradcode update` moves to the newest release, and `gradcode --help`
has the rest. It brings its own Node and says when a new version is out. Once the npm package is
published, `npx gradcode@latest` (Node 24+) tries it once without installing.

### Desktop app

Install the latest version from
[GitHub Releases](https://github.com/EhsanulHaqueSiam/gradcode/releases/latest) or with one of the
commands below. The app tells you when there's a new version and installs it in one click (the
Mac app and the AppImage); `.deb` and AUR installs update through their package manager.

The one-liner with `--desktop` installs the app instead: `gradcode.app` in Applications on a Mac,
or the AppImage with a menu entry on Linux.

```sh
curl -fsSL https://github.com/EhsanulHaqueSiam/gradcode/releases/latest/download/install.sh | sh -s -- --desktop
```

#### macOS (Homebrew)

```sh
brew install --cask EhsanulHaqueSiam/tap/gradcode
```

The Mac app isn't notarized yet. Homebrew and the one-liner handle that; after dragging a
downloaded dmg (`arm64` for Apple Silicon, `x64` for Intel) to Applications, run
`xattr -dr com.apple.quarantine /Applications/gradcode.app` once.

#### Debian, Ubuntu (`.deb`)

Download the `.deb` from GitHub Releases, then:

```sh
sudo apt install ./gradcode_*.deb
```

#### Arch Linux, Omarchy (AUR)

```sh
yay -S gradcode-bin
```

#### Any Linux (AppImage)

Download the `.AppImage` from GitHub Releases, `chmod +x` it and run it. It updates itself.

## Use it

Install it (see [Install](#install)) or start it from source (see [Run it](#run-it)), and
open it. The first run opens Setup:

1. **Connect.** gradcode runs on your own Claude Code login; Setup shows whose, or downloads
   Claude Code on the first run and signs you in. Free sources are on. Paid lookups (people search, email finding) are optional: connect treg by signing in, or
   paste a key someone gave you.
2. **You.** Paste your CV. It becomes facts, each with its source; tick the ones that are right.
   Anything it couldn't settle waits in Input as a question.
3. **Your hunt.** Degree, intake, places, fields, the least funding you'd take, and what matters
   most. Every hunt and loop reads these.
4. **Detail and budget.** How much evidence to gather, and the most a thread, a loop run and a day
   may spend. Anything over the ask line asks you first.

Then:

- **Hunt.** On New thread, say what to find ("funded NLP professors at UIC") or press 1 to 5 for a
  starter. The agent searches grants, faculty pages and papers, and asks before paying.
- **Review.** Every professor it finds waits in Review with its sources; Accept writes them to your
  sheet. In a thread's Results, select rows and run Find and check emails, Check money, Taking
  students? or Draft first emails.
- **Reach out.** In Settings, connect your mailbox: a Gmail app password is free and takes two
  minutes (Google's page is linked there). Drafts wait in Pipeline until you approve them. They go
  at 08:00 the professor's time, Tuesday to Thursday, with follow-ups 7 and 14 business days later,
  and replies come back as your turn. Without a checked address the agent drafts a short LinkedIn
  note: Copy and open LinkedIn, send it there, then Mark sent.
- **Apply.** The Vault keeps your facts, documents, programs and applications. The Writer drafts
  statements and CVs that cite only facts you've proven; offers compare after rent.
- **Keep it going.** Loops run hunts on a schedule. ⌘K jumps anywhere or runs an action. Settings
  has a link and QR code to open it on your phone over Tailscale.

## Screenshots

Taken from the running app on the scripted agent (`GRADCODE_AGENT=fake`), so the data is fixtures.

![A thread: the agent's work log, findings and Review](docs/screenshots/thread.png)

| Pipeline inbox, by whose turn it is              | Pipeline board, by stage                      |
| ------------------------------------------------ | --------------------------------------------- |
| ![Pipeline inbox](docs/screenshots/pipeline.png) | ![Pipeline board](docs/screenshots/board.png) |
| **Writer: every claim cites a fact**             | **Offers, compared after rent**               |
| ![Writer](docs/screenshots/writer.png)           | ![Offers](docs/screenshots/offers.png)        |

![Loops on intervals, weekdays or webhooks](docs/screenshots/loops.png)

## What it does

| What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Check                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **First run.** Setup walks the hunt, your profile, eligibility and loops. The agent uses the Claude Code login already on the machine. Free sources need no keys; a treg key is optional.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | A fresh install with no keys finishes setup and starts a hunt.                                   |
| **Profile from a CV.** The agent reads a CV and your profile links into facts, each with its source, and you confirm them. The agent, drafts and the Writer use only confirmed facts with proof. Siam's install reads hq.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | A confirmed fact without proof never reaches the agent or an export.                             |
| **Hunt preferences.** Degree types, intake and fallback, places, fields and adjacent domains, funding floor, test waivers, what matters most, and your eligibility: citizenship, tests, GPA, fee budget, minimum stipend. Every turn and loop reads them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Set the funding floor to full: every turn is told partly funded programs don't count.            |
| **Detail level.** Brief, Standard or Deep for the install: 6, 10 or 12 Results columns, and how much evidence the agent gathers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Brief shows 6 columns; Deep adds Fits because and Sources.                                       |
| **Threads and the inbox sidebar.** Stream, stop, resume, fork, search; settle, snooze, auto-settle after 3 days; queue and steer; attach files. The agent asks you in Input when only you know. Ask mode answers from what it can read and changes and spends nothing. Runs on the host, so closing the laptop never stops a hunt.                                                                                                                                                                                                                                                                                                                                                                                                                                                     | End of day: every thread is settled, snoozed or working.                                         |
| **Results and row actions.** Every thread has a Results grid. Select rows, or all of them, and run Find and check emails, Check money, Taking students? or Draft first emails from the dock; cells fill in place with what they cost.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Select 3 rows, Find and check emails: it asks first, and three Email cells fill with their cost. |
| **Records and Review.** Field diffs, and nothing is accepted without you. Accepting writes the local store; on Siam's install, changes to gradhunt's rows also go through `scout.py set`. A rejected new professor never comes back.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Reject a professor; the next sweep doesn't propose them again.                                   |
| **Finders and pages.** Professor finder with tier and school filters and row actions; funding finder over NSF, NIH, UKRI, CORDIS, ARC, DFG and NSERC, ranked by the months left after your intake and fit, with one-click Add PI, and the Vault's programs and fellowships beside it; professor pages where every fact shows its source and date, with grants, recent work and interests.                                                                                                                                                                                                                                                                                                                                                                                              | Every award in Funding shows how long it lasts after your intake.                                |
| **Loops.** Every N hours, at a time on chosen weekdays, or on a webhook whose JSON fills the instructions. Each run gets a fresh thread or goes back to one; run now or pause. A loop's budget caps each run. Scope it to schools; propose only, or auto-accept what passes your rules (verified email, official source, fit 4+); each row says what its last run found and what 7 days found and cost.                                                                                                                                                                                                                                                                                                                                                                                | A nightly sweep runs with the laptop closed and waits in the morning.                            |
| **Spend you control.** Every paid call is priced and logged at what it really cost; calls over $0.01 ask; caps per thread, per loop run and per day, which treg enforces per call. A thread over a cap carries on with free sources; a loop run stops and says why.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | A loop run at its cap ends with "Stopped: This would pass the $0.5 cap for this loop run."       |
| **Paid lookups, billed per customer.** Connect treg by signing in, or paste a key someone issued you. Every call is tagged with the customer, hunt and feature by the server; Settings shows this month's spend. A team's owner runs its customers on the Customers page: keys, daily limits, blocks, auto top-up and invoices from treg's ledger.                                                                                                                                                                                                                                                                                                                                                                                                                                     | Connect a token: a lookup's cost shows in Settings and on treg's invoice for that customer.      |
| **Pipeline.** Your own mailbox (a Gmail app password by default, free; or sign in with Google or Microsoft) or your mail app. Drafts cite your facts and fit the professor's money tier; one with an unproven or uncited claim, a third link or an unchecked address waits for a fix. Sends go Tuesday to Thursday at 08:00 the professor's time within warm-up caps; approve one, a day's worth, or all. Follow-ups at +7 and +14 business days, or your own timing; replies come back to the thread, update the record, and can attach your CV. Professors move through To contact, Contacted, Replied, Call, Applied and Offer; accepting an offer ends the hunt. LinkedIn is assisted: a short note opens their message box, and their answer comes back through LinkedIn's email. | Add "I led a team of five." to a draft: it can't be sent until you cite a fact or cut it.        |
| **Vault and Writer.** Your Lifeline: add a CV, a link or a sentence and it becomes dated facts with proof; the panel shows a fact's note, your facts as a CV, or the file itself. Everything is also an OKF bundle on disk (like hq, openable in Obsidian) that the agent searches before it writes. Documents with expiry, scholarships, programs, applications and a To file inbox. The Writer drafts statements, CVs and essays citing your facts; an unproven claim, or one that cites nothing, blocks export to text, PDF or Word.                                                                                                                                                                                                                                                | Unconfirm a cited fact: export turns off until it has proof.                                     |
| **After applying.** Interview prep packs, calendar files and thank-yous; offers compared after rent; negotiation letters; visa steps; reminders and thanks for recommenders.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Two offers side by side: the one leaving more after a year of rent is marked best.               |
| **MCP both ways.** Other agents drive gradcode at `/api/mcp` with a token. Your own MCP servers join every session and ask before each call unless you trust them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Paste the config from Settings into another agent and search the sheet.                          |
| **Your data stays yours.** One local SQLite file. A full backup of every table and Vault file downloads and restores in one click; professors also export and import as CSV. gradcode sends no telemetry.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Download a backup, wipe, restore: nothing lost.                                                  |
| **Polish bar.** ⌘K jumps to any view, thread, professor or school, runs actions (answer an approval, accept Review, approve drafts, run a loop) and searches what was said; j/k through threads, proposals and rows, a/r/⇧A, ↵/esc on approvals, ⌘↵ steer, ⌘. stop, ⌘1 to 3 panel tabs; one-shot motion, nothing animates forever. On a phone, open the tailnet link or scan its QR code in Settings: the sidebar and panel open over the page to read and approve.                                                                                                                                                                                                                                                                                                                    | Triage the thread list without the mouse.                                                        |

**Not yet**, against the original spec: `scout.py add` and `exclude` on Siam's install.

**By design:** no hosted service, no native phone app, no providers other than Claude, no shared
hunts. On Siam's install, gradhunt's own rows stay with its cloud outreach routine.

## Shape

A pnpm monorepo on Vite+ (`vp` for lint, format, test and staged hooks),
TypeScript 7, React 19 with the React Compiler, TanStack Router, Zustand, Base UI with a vendored
`components/ui` kit (MIT, notice kept), Tailwind v4, lucide icons and zod contracts. A local Node
server runs the agent sessions, loops and the send queue; everything lives in one SQLite file
under `~/.gradcode`. How the pieces fit: [docs/internals/overview.md](docs/internals/overview.md).

## Run it

From source, to change it or contribute. Needs tmux, and [Vite+](https://viteplus.dev) (which brings Node and pnpm) or Node 24+ with pnpm.

```sh
curl -fsSL https://vite.plus | bash   # Vite+, once
vp i                                  # or: pnpm install
scripts/dev-local.sh up               # server :4311 + web http://127.0.0.1:5174, in tmux
scripts/dev-local.sh share            # open it from your phone over Tailscale
scripts/dev-local.sh down

# tests: unit, then e2e on a fresh stack with the scripted agent (free, deterministic)
pnpm test
scripts/dev-local.sh down
rm -rf /tmp/gc-e2e && GRADCODE_HOME=/tmp/gc-e2e GRADCODE_AGENT=fake scripts/dev-local.sh up
pnpm e2e
```

The desktop app and the `gradcode` command build into `dist/release`:

```sh
pnpm dist runtime                       # web app, bundled server and CLI, Electron's main
pnpm dist cli darwin-arm64              # the command line tarball (also darwin-x64, linux-x64, linux-arm64)
pnpm dist desktop mac arm64             # dmg + zip, on a Mac; `desktop linux x64` builds the AppImage + .deb
pnpm --filter @gradcode/desktop start   # or run the app from the checkout, after `pnpm dist runtime`
```

How releases are cut: [docs/internals/release.md](docs/internals/release.md). Agents start at
[AGENTS.md](AGENTS.md).
