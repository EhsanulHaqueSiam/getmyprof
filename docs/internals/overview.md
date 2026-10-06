# Overview

```
browser (React) ⇄ /api, /ws ⇄ Vite (127.0.0.1:5174) ⇄ server (127.0.0.1:4311)
                                                      ├ rpc.ts: contract methods → services
                                                      ├ SQLite: ~/.gradcode/gradcode.sqlite
                                                      ├ agent runner ── provider: claude | fake
                                                      │    └ hunt tools: nsf_awards, nih_awards, openalex_author,
                                                      │      sheet_search, propose_professor, treg (paid)
                                                      └ adapters: hq facts, gradhunt (scout.py), CSV
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
