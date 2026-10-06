# gradcode

A T3 Code-shaped app for anyone hunting a funded degree. Every thread is a Claude Code session
on your own subscription, with free sources (NSF, NIH RePORTER, OpenAlex, CSRankings, faculty
pages) and optional paid lookups through treg. It finds professors who can fund you and the money
behind them, by your preferences: degree, places, fields, funding floor, detail level and loops.
Siam's install also reads hq and `~/Personal/gradhunt`, so Scout and the cloud outreach routine
keep working.

Design and the full spec: [docs/mocks/phase1.html](docs/mocks/phase1.html) (round 2).

## Done (v1)

| #   | Done when                                                                                                                                                                                 | Check                                                                               |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1   | **First run in five minutes.** Finds your Claude Code login. Free sources need no keys; a treg key is optional.                                                                           | A fresh Mac with no keys has a first hunt running in five minutes.                  |
| 2   | **Profile from a CV.** The agent drafts each fact with its source; you confirm it. Drafts and fit use confirmed facts only. Siam's install reads hq.                                      | An unconfirmed fact never appears in a draft.                                       |
| 3   | **Hunt preferences.** Degree types, intake, places, fields and adjacent domains, funding floor, test rules, schools per sweep, what matters most. Every turn and loop reads them.         | Raise the funding floor and the next sweep stops proposing partly funded programs.  |
| 4   | **Detail level.** Brief, Standard or Deep, per install and per thread: columns, evidence depth, cost per row.                                                                             | Brief shows 5 columns and costs less per row than Deep.                             |
| 5   | **Threads and the inbox sidebar.** Stream, stop, resume; settle, snooze, auto-settle; queue and steer. Runs on the host, so closing the laptop never stops a hunt.                        | End of day: every thread is settled, snoozed or working.                            |
| 6   | **Results and row actions.** Every thread has a Results grid. Select rows and run Find emails, Check money, Taking students? or Draft from the dock; cells fill in place with their cost. | Select 3 rows, Find emails: three cells fill and spend rises by exactly their cost. |
| 7   | **Records and Review.** Field diffs; accept writes to the local store (through `scout.py` on Siam's install). Auto-accept is off. A rejected row never comes back.                        | Reject a professor; the next sweep doesn't propose them again.                      |
| 8   | **Finders and pages.** Professor finder, funding finder (NSF and NIH awards, months left after your intake), professor pages with every fact sourced.                                     | Every field opens its source.                                                       |
| 9   | **Loops.** Recurring hunts you configure: what, when, scope, budget, autonomy. Each run is a thread that settles once reviewed.                                                           | A nightly sweep runs with the laptop closed and waits in the morning.               |
| 10  | **Spend you control.** Every call priced; paid actions over $0.01 ask; caps per thread, per loop run, per day.                                                                            | A loop stops at its cap and says why.                                               |
| 11  | **Your data stays yours.** One local SQLite file, CSV import and export, no telemetry.                                                                                                    | Export, wipe, import: nothing lost.                                                 |
| 12  | **Polish bar.** T3 Code's feel: ⌘K for everything, keyboard-first, one-shot motion, nothing animates forever.                                                                             | A full morning of triage without the mouse.                                         |

**Not in v1:** sending mail for other users (Siam's install keeps the cloud routine), a hosted
service, a phone app beyond reading and approving, providers other than Claude, shared hunts.

## Shape

```
browser (React) ⇄ WebSocket ⇄ local server (Node, Mac mini)
                                  └ Claude Agent SDK ─ Claude Code CLI
                                      ├ treg MCP              search, people, email checks
                                      ├ hunt MCP (in-process)  propose_* tools, zod schemas
                                      ├ scout.py               allowlisted Bash, the only writer
                                      └ NSF + NIH APIs         free grant search
store: gradhunt/loopany/prof-scout/data (JSON) · hq (facts read-only, signals)
```

Built like T3 Code: a pnpm monorepo on Vite+ (`vp` for lint, format, test and staged hooks),
TypeScript 7, React 19 with the React Compiler, TanStack Router, Zustand, Base UI with T3 Code's
`components/ui` kit (MIT, notice kept), Tailwind v4, lucide icons and zod contracts. No database:
gradhunt's JSON stays the source of truth.

## Run it

```sh
pnpm install
scripts/dev-local.sh up      # server :4311 + web http://127.0.0.1:5174, in tmux
pnpm e2e                     # against the running stack
scripts/dev-local.sh down
```

Agents start at [AGENTS.md](AGENTS.md).
