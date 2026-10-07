# Overview

```
browser (React) ⇄ /api, /ws ⇄ Vite (127.0.0.1:5174) ⇄ server (127.0.0.1:4311)
                                                      └ Claude Agent SDK sessions (next)
                                                          ├ treg MCP
                                                          ├ hunt MCP: propose_* tools (zod)
                                                          ├ scout.py (allowlisted, the only writer)
                                                          └ NSF + NIH APIs (free)
```

## Single origin

The server binds loopback only. In dev, Vite proxies `/api` and `/ws` to it, so the browser
talks to one origin and nothing bakes a server URL into the bundle. Other devices reach the app
through `scripts/dev-local.sh share` (`tailscale serve` in front of Vite). `allowedHosts:
[".ts.net"]` in `apps/web/vite.config.ts` is what lets those requests through Vite's host check.
The Mac mini runs everything; the laptop and phone are only clients, so closing them never stops
a turn.

## The wire

Everything that crosses it is a zod schema in `packages/contracts`. The server pushes a
`ServerMessage` union over `/ws`. The client decodes it with `safeParse` and ignores types it
doesn't know, so a newer server never crashes an older tab. The client opens one socket for the
app's lifetime, from `main.tsx` outside React, and reconnects a second after a drop
(`apps/web/src/state/connectionStore.ts`).

## Constraints for agent sessions

These are known before the code exists, because Scout already ran into them:

- **Lean sessions.** Start each Agent SDK session with project settings only and an explicit MCP
  list (treg plus hunt). gradhunt measured the global plugins, skills and connectors at 24k
  tokens of dead weight per turn (`gradhunt/lean-agent.sh`).
- **Money asks first.** Paid treg calls over $0.01, and any write to hq, go through the SDK's
  permission callback and become an approval in the UI. Each thread has a hard spend cap; tests
  run at $0.
- **Findings are tool calls.** The agent reports through `propose_*` tools whose zod schemas live
  in `packages/contracts`, so the UI renders records and diffs instead of parsing prose.
