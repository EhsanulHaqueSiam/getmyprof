# Overview

```
browser (React) ⇄ /api, /ws ⇄ Vite (127.0.0.1:5174) ⇄ server (127.0.0.1:4311)
                                                      ├ rpc.ts: contract methods → services
                                                      ├ SQLite: ~/.gradcode/gradcode.sqlite
                                                      ├ agent runner ── provider: claude | fake
                                                      │    └ hunt tools: nsf_awards, nih_awards, openalex_author,
                                                      │      sheet_search, propose_professor, treg (paid)
                                                      ├ adapters: hq facts, gradhunt (scout.py), CSV
                                                      └ outreach: mailbox (IMAP + SMTP), send queue, reply sync
```

## Single origin

The server binds loopback only. In dev, Vite proxies `/api` and `/ws` to it, so the browser talks
to one origin and nothing bakes a server URL into the bundle. Other devices reach the app through
`scripts/dev-local.sh share` (`tailscale serve` in front of Vite); `allowedHosts: [".ts.net"]` in
`apps/web/vite.config.ts` lets those requests past Vite's host check. The host machine runs every
agent turn and loop, so closing the laptop never stops a hunt.

## The wire

Every method is a zod input/output pair in `packages/contracts/src/rpc.ts`. The server validates
input before dispatch; the client validates replies. Pushes (`threads`, `event`, `changed`) keep
the Zustand store current, so views refetch only what changed. The client opens one socket for the
app's lifetime and reconnects a second after a drop.

## Agent sessions

`agent/runner.ts` owns sessions: at most one live session per thread. A message to an idle thread
without a session starts one that resumes the thread's earlier Claude conversation (`resume`).
Messages sent mid-turn go in with the SDK's `priority`: `next` (queued after the current tool
call) or `now` (steered). A session closes after a minute idle.

- **Lean sessions.** `settingSources: []` and an explicit tool list (WebSearch, WebFetch, the hunt
  MCP tools), so a user's own Claude config never leaks into the hunt. gradhunt measured global
  plugins at 24k tokens of dead weight per turn.
- **Money asks first.** Free tools are pre-allowed. `treg` goes through `canUseTool`, which checks
  the caps (per thread, per loop run, per day) and asks the user above `askOver`. Row actions over
  the limit ask in the dock before they are sent.
- **Findings are tool calls.** The agent reports through `propose_professor`; the store diffs it
  against the record and keeps only changed fields. Rejecting an add excludes the person for good.
- **Settling.** A thread settles once it is idle with nothing pending in Review; idle threads
  nobody touched for 3 days settle on their own.

## Providers

`claude` runs the Agent SDK's bundled Claude Code with the user's login. `fake` runs the same hunt
tools on fixture sources with scripted turns (approval, proposals, row actions), so e2e covers the
real store, approval and settle paths without spending anything. Pick with `GRADCODE_AGENT=fake`.

## Outreach

Messages to and from professors live in the `messages` table; stage and whose turn it is are
derived from them on every read (`outreach/store.ts`), never stored. The user connects their own
mailbox with an app password; the login sits in `GRADCODE_HOME/mail.json`, mode 0600, and never
crosses the wire.

- **Nothing sends without approval.** The agent only drafts (`draft_email`). Approving gives each
  first email or follow-up a slot: 08:00 in the professor's zone, Tuesday to Thursday, within
  warm-up caps (5, 10, then 15 a day; 2 per university). Replies go at once.
- **One send path.** Every send runs through `outreach.tick`, one message at a time, so a message
  can't go out twice. "Send now" just makes a message due and ticks.
- **Only reviewed addresses.** A draft must go to the address already accepted in the record;
  apply-only professors get none. On Siam's install gradhunt's rows belong to its cloud outreach
  routine, so gradcode never drafts to them and the two can't double-send.
- **Replies come back to the agent.** Sync files mail from contacted professors only (by
  In-Reply-To, then sender); a real reply goes to the thread that drafted the first email for
  `classify_reply` and an answer draft. Follow-ups that come due get one drafting thread per day.
- **LinkedIn is assisted.** The user sends the note there and marks it sent; replies arrive as
  LinkedIn's notification emails. No account automation.
- `GRADCODE_AGENT=fake` also swaps in `fakeMailer`: sends stay in memory and fixture professors
  answer on the next sync.
