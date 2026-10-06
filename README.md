# gradcode

A T3 Code-shaped app for the PhD hunt. Every thread is a Claude Code session (Claude Agent
SDK) and treg is its tool belt. Two jobs: find professors who can fund a student, and find the
money behind them. It runs on the Mac mini on top of `~/Personal/gradhunt`'s data, so Scout,
the cloud outreach routine and the current dashboard keep working while this grows.

Phase 1 is design only. Mocks and the full spec: [docs/mocks/phase1.html](docs/mocks/phase1.html).

## Done (v1)

| #   | Done when                                                                                                                                                                                                                                                             | Check                                                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1   | **Threads.** Start, rename, resume and stop threads. Each is a Claude Code session that streams text and tool calls. It runs on the Mac mini, so closing the laptop never stops a hunt, and it survives a server restart.                                             | Close the laptop mid-turn, reopen from the phone, and the thread has kept going. |
| 2   | **The sidebar is an inbox.** Threads that need you come first: Approval (amber), Input (indigo), Done and unread. Working rows fade back. Settle and Snooze appear on hover. Settled and Snoozed shelves start collapsed. Untouched threads auto-settle after 3 days. | End of day: every thread is settled, snoozed or working.                         |
| 3   | **Threads settle themselves.** A thread settles once nothing waits on you: every proposal reviewed, no approval pending. Optional auto-accept rules (verified email, official source, fit 4+) let a hunt finish unseen.                                               | Review the last proposal and the thread drops into Settled.                      |
| 4   | **Queue and steer.** A message sent mid-turn waits and goes out after the next tool call. Steer sends it now.                                                                                                                                                         | The agent picks up a steered message within one tool call.                       |
| 5   | **Scoped threads.** A thread can be about a school, a professor or a search, and opening one loads that record into context. Start one with `@` or from any row.                                                                                                      | "Ask about Lybarger" answers from the record without fetching it again.          |
| 6   | **treg in view.** Every call shows its endpoint, price, time and result. Thread spend and treg balance are always on screen. Calls over $0.01 ask first, and each thread has a hard cap.                                                                              | A $0.0245 Prospeo lookup raises an approval.                                     |
| 7   | **Results are records.** The agent reports through typed tools (`propose_professor`, `propose_program`, `propose_grant`). Proposals land in Review as field diffs. Accept writes through `scout.py`; reject records the reason in `excluded.json`.                    | Accept 3 and reject 1. Scout's next nightly run sees all four.                   |
| 8   | **Professor finder.** Search by niche and school, or say "next school in the queue". Candidates fill a table: fit, recruiting evidence, money, email check, contact rule. Keep, drop, dig deeper or draft from any row.                                               | "health NLP at GMU, UIC, Arizona" returns rows that all link sources.            |
| 9   | **Funding finder.** NSF and NIH awards by topic at tracked schools (free APIs), with PI, amount, end date, months left after Fall 2027, and whether the PI is in the sheet. One click adds a PI. Program funding sits beside it.                                      | "language model" at UMD shows Ge Gao's CAREER award as not in the sheet yet.     |
| 10  | **Professor page.** Every fact links its source: interests, recent works, grants, recruiting quote, contact rule, email check, threads, draft state.                                                                                                                  | Every field opens its source.                                                    |
| 11  | **Facts guard.** The agent reads hq facts and the Scout spec and claims nothing hq lacks. A draft only shows after `scout.py lint-drafts` passes.                                                                                                                     | A draft that cites a test score fails lint in the UI.                            |
| 12  | **Polish bar.** Every action is in the ⌘K palette and the app is keyboard-first. Motion follows the spec in the mocks. Nothing animates forever, and reduced motion turns every transition off.                                                                       | A full morning of triage without touching the mouse.                             |

**Not in v1:** sending mail and inbox sync (the cloud routine keeps both), the send queue and
Conversations (the current dashboard keeps them until v2 ports them), auth, a phone layout
beyond reading and approving, hosting, more than one user.

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
