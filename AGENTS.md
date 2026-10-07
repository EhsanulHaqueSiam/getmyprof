# gradcode

gradcode is a T3 Code-shaped app for anyone hunting a funded degree. A Node WebSocket server runs
Claude Code sessions (Claude Agent SDK, on the user's own subscription) that use free grant APIs,
the web and optional paid treg lookups to find professors who can fund a student and the money
behind them. A React client shows threads, Results, Review, Funding and Loops. Everything lives in
one local SQLite file. Siam's install also reads hq (profile facts) and `~/Personal/gradhunt`
(records, written back through `scout.py`). The v1 definition of done is in [README.md](README.md);
the approved design is [docs/mocks/phase1.html](docs/mocks/phase1.html).

Channel "measure twice, cut once" and "yagni". Simple systems, no machinery for its own sake.

## Glossary

- **hunt**: one admissions target (Fall 2027, funded PhD). Threads belong to a hunt.
- **thread**: a durable Claude Code session about a school, a professor or a search. **turn**: one
  user-to-agent cycle.
- **record**: a professor row in the store. **proposal**: a change the agent made through
  `propose_professor`, waiting in Review. **row action**: an agent turn run on selected Results rows.
- **settle**: mark a thread as needing nothing. **snooze**: hide it until a time. **loop**: a
  scheduled hunt; each run is a thread.
- **detail**: Brief, Standard or Deep: which fields the agent fills and the grid shows.
- **provider**: the agent backend: `claude` (Agent SDK) or `fake` (scripted, for tests).
- **Scout**: gradhunt's nightly agent loop. **hq**: `~/Personal/hq`, the only source of facts about
  Siam. **treg**: the paid data API catalog (search, people, email checks).

## The ways to hurt yourself

1. **Touching real data.** The store is `~/.gradcode/gradcode.sqlite`; gradhunt's files belong to
   `scout.py` alone (lint: `gradcode/single-writer`). Tests, e2e and `/verify` run with
   `GRADCODE_HOME` set to a temp dir, `GRADCODE_AGENT=fake`, and gradhunt sync off.
2. **Spending money or quota in tests.** treg calls cost money and email lookups hit real people;
   real agent turns spend the user's subscription. The fake provider covers every flow for free.
   Only a task that changes the Claude provider itself earns one short live turn.
3. **Sending real email.** A connected mailbox sends to real professors. Tests and e2e use the
   fake mailer (`GRADCODE_AGENT=fake`); to exercise IMAP and SMTP, run a local GreenMail
   container, never a real inbox.
4. **Claiming facts about Siam.** Facts live once, in hq (`~/Personal/hq/CLAUDE.md`). Read them;
   never copy them into this repo or invent one. A missing fact becomes a question.
5. **Killing by pattern.** This Mac runs T3 Code, Scout and other agents. Never `pkill -f` or kill a
   PID found by name. Stop what you started: `scripts/dev-local.sh down`.
6. **Baking in origins.** Dev is single-origin: Vite proxies `/api` and `/ws`. Never put a server
   URL in the web bundle; it breaks every non-localhost client.

## Where code lives

```
apps/server               Node WebSocket + HTTP server. rpc.ts maps contract methods to services:
                          db/state/threads/records/loops (SQLite), sources (NSF, NIH, OpenAlex, treg),
                          adapters (gradhunt, hq, CSV), agent/ (runner, claude, fake, tools, prompt),
                          outreach/ (mail, store, service, plan: drafts, send queue, reply sync),
                          vault (documents, scholarships, programs, applications, To file)
apps/web                  React 19 + Vite+. src/routes (TanStack file routes), src/state (Zustand),
                          src/components/ui (T3 Code's Base UI kit, vendored), src/lib
packages/contracts        zod schemas for everything on the wire. Decode untrusted input with .parse.
oxlint-plugin-gradcode    golden rules as lint rules, each tested against real oxlint
e2e                       Playwright specs against the running stack
scripts/dev-local.sh      one-command stack in tmux (see /dev-local)
docs/internals            decisions and constraints the code can't carry
```

## Commands

`pnpm install` · `scripts/dev-local.sh up|down|status|logs|share` · `pnpm lint` · `pnpm fmt` ·
`pnpm typecheck` · `pnpm test` · `pnpm build`. e2e needs a fresh fake stack:
`rm -rf /tmp/gc-e2e && GRADCODE_HOME=/tmp/gc-e2e GRADCODE_AGENT=fake scripts/dev-local.sh up`, then `pnpm e2e`.
`vp` is Vite+: `pnpm exec vp test run <file>` for one test file.

## Taste

- Complexity belongs at the boundary (agent adapter, treg, scout.py). The UI stays dumb.
- `components/ui` exports own their look. Pick a `variant` or `size`; don't restyle with
  `className`. It is vendored from T3 Code: keep it identical to upstream (LICENSE.t3code).
- Colors come from theme tokens in `apps/web/src/index.css`, never raw values (lint enforces).
- Inferred types over annotations. `any` is the enemy. zod at trust boundaries, no casts.
- No continuously repainting animations: no spinners, pulses or shimmer. Working shows as a
  static label. Motion is one-shot (docs/internals/design.md).
- No em dashes in UI copy. Minimal copy. Dark, true black.
- Comments say how a thing is used and move with the code.
- If a rule here fights the task, say so and get Siam's sign-off before breaking it.

## Verifying

- Smallest proof: `pnpm exec vp test run <files>` you touched, plus lint and typecheck.
- Test logic and observable behavior, not wiring or markup.
- User-visible changes: run `/verify` (a fresh verifier drives the real app and records proof).
- e2e runs against the stack you brought up. Never weaken an assertion to go green.

## Commits and PRs

- Conventional commit titles in plain language: `feat(web): threads settle after the last review`.
- No AI attribution and no model names in commits or PRs.
- PR body: the problem in a sentence or two, then the fix. UI changes embed a screenshot;
  motion needs a short video. Upload evidence to the `pr-evidence` release, never commit it.
- Rebase on `main` before opening. Real PRs, not drafts.

## Docs

Most changes need no doc change; agents can read the code. `docs/internals/` holds decisions,
cross-component constraints and traps that are hard to see from the source. When a decision
changes, rewrite the text; don't append. Never commit plans or scratch notes.

| Need                                        | Read                                                                        |
| ------------------------------------------- | --------------------------------------------------------------------------- |
| Architecture, wire, agent sessions, tailnet | [docs/internals/overview.md](docs/internals/overview.md)                    |
| Tokens, status hues, motion, copy           | [docs/internals/design.md](docs/internals/design.md)                        |
| gradhunt data, scout.py writes, hq facts    | [docs/internals/gradhunt.md](docs/internals/gradhunt.md)                    |
| What v1 must do                             | [README.md](README.md) and [docs/mocks/phase1.html](docs/mocks/phase1.html) |
