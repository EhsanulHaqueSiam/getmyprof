# Overview

```
browser (React) ⇄ /api, /ws ⇄ Vite (127.0.0.1:5174) ⇄ server (127.0.0.1:4311)
                                                      ├ rpc.ts: contract methods → services
                                                      ├ SQLite: ~/.getmyprof/getmyprof.sqlite
                                                      ├ agent runner ── provider: claude | fake
                                                      │    └ hunt tools: nsf_awards, nih_awards, openalex_author,
                                                      │      sheet_search, propose_professor, treg (paid)
                                                      ├ adapters: hq facts, gradhunt (scout.py), CSV
                                                      ├ outreach: mailbox (IMAP + SMTP), send queue, reply sync
                                                      └ vault: documents, scholarships, programs, applications
```

## Same site only

The WebSocket and the backup restore act on everything, so the server checks `Origin`: a browser
request must come from the host it was reached on or the tailnet (`*.ts.net`), and another site
the user visits gets 401 or 403. Tools without a browser send no Origin and pass; the MCP endpoint
and webhooks have their own tokens. The `/api` proxy in `apps/web/vite.config.ts` keeps the
browser's Host so the two can be compared.

## Single origin

The server binds loopback only. In dev, Vite proxies `/api` and `/ws` to it, so the browser talks
to one origin and nothing bakes a server URL into the bundle. The desktop app and the `getmyprof`
command have no Vite: the server serves the built web app itself (`GETMYPROF_WEB_DIR`,
`static.ts`), still one origin ([release.md](release.md)). Other devices reach the app through
`scripts/dev-local.sh share` (`tailscale serve` in front of Vite on its own HTTPS port, 8443: the
tailnet's 443 may already belong to another app on this machine, and serving it would replace that); `allowedHosts: [".ts.net"]` in
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
  the limit ask in the dock before they are sent. A loop run that hits a cap stops and says why;
  a thread carries on with free sources.
- **Ask changes nothing.** The composer's Ask sends "[ask] ..."; the runner marks that turn, and
  `askBlocked` refuses every tool outside `READ_ONLY` (awards, OpenAlex, the sheet, the vault) and
  every paid call, in both providers. An Ask is free and proposes, drafts and files nothing.
- **Findings are tool calls.** The agent reports through `propose_professor`; the store diffs it
  against the record and keeps only changed fields. Rejecting an add excludes the person for good.
- **Settling.** A thread settles once it is idle with nothing pending in Review; idle threads
  nobody touched for 3 days settle on their own.

## Paid lookups

Every treg call goes through `treg.ts` over HTTP with one key (`GETMYPROF_HOME/treg.json`, mode
0600, never on the wire or in a backup). It is the user's own team key, which they connect by
signing in at treg.to (`treg login`'s handshake, `treg-org.ts`) or by pasting it, or a key a
team issued to them. treg pins an issued key to its customer, so its team is billed and invoices
that customer from treg's ledger.

- **Tags come from the server.** Each call carries `hunt`, `thread` and `feature` (hunt, loop,
  row-email...) from context, never from the model, which would drop them. treg adds `customer`
  from an issued key's pin; the key holder can't change it. An issued key also sends
  `customer_feature=<customer>.<feature>` (its customer read from the key's identity when it
  connects), since treg's usage report splits by one tag only: that is what the Customers page's
  spend by feature reads.
- **treg holds the line.** The budget left goes out as `X-Treg-Route-Max-Cost`, so treg refuses
  rather than overspend. Routed endpoints try providers in turn and can cost more than their usual
  price; `TREG_ENDPOINTS` keeps each one's ceiling.
- **The ledger records the real cost.** `spend` stores `X-Treg-Cost-Micro` under `X-Treg-Call-Id`,
  with the feature and the sheet row (`about`), so Results cells and Settings show what was spent.
- **Some refusals stay private.** Running out of balance names the issuer's balance and top-up
  link; the applicant and the model only hear "unavailable right now".
- **Issuing keys.** An owner or admin of a team manages its customers on the Customers page
  (Settings links it) or with `apps/server/scripts/treg-admin.ts`, both over `treg-org.ts`: mint a
  key, set a daily limit or the team default, block, revoke, top up, switch on treg's auto top-up
  (it refills the balance under a floor, up to a monthly cap, so no customer's lookups stop on an
  empty balance) and invoice. Adding an id that already has a key is refused: minting under the
  same name replaces the key. The scripted stack talks to a team in memory instead
  (`treg-fake.ts`): signing in makes you its owner. Siam's customers live in the treg team
  `getmyprof`. treg's tool list can't name catalog endpoints, so a customer key gets every tool;
  the team must hold no tools of its own (an X or Google connection would be every customer's),
  and minting refuses in one that does. `TREG_ENDPOINTS` is the vendor list getmyprof lets the
  agent call.

## Your data

One SQLite file holds everything. `GET /api/backup` downloads every table plus the Vault's files
as one JSON file; `POST /api/backup` restores it over the store by primary key, writing only known
tables and columns. The mailbox login lives in `mail.json`, not the store, so it is never in a
backup: a restored install reconnects its mailbox. The professor CSV export stays for spreadsheets.

## Loops

A loop runs every N hours, at a time on chosen weekdays (server local time), or when its webhook
is called: `POST /api/hooks/<token>` with JSON, whose fields fill `{{body.path}}` placeholders in
the instructions. The token is made once per loop and compared in constant time; the URL is the
secret. Runs go to a fresh thread each time, or every run back to the loop's one thread.

## MCP

Both ways. getmyprof serves its own tools at `/api/mcp` (stateless streamable HTTP, POST only):
search the sheet, start a hunt, read threads, list and resolve Review. Each wraps an RPC handler.
It answers only to the bearer token in Settings, made once and compared in constant time; the
token is what keeps another process on this machine or the tailnet from starting paid hunts.
The user's own MCP servers (a URL, or a command run over stdio) go into every Claude session;
their tool calls raise an approval unless the server is marked trusted. The fake provider
ignores them.

## Input

`ask_applicant` puts a question in the thread and returns at once; the turn ends and the thread
waits in Input (indigo) until the applicant's next message, which answers it. Nothing blocks a
tool call on a human: an MCP call held open for hours would time out.

## Providers

`claude` runs the Agent SDK's bundled Claude Code with the user's login. `fake` runs the same hunt
tools on fixture sources with scripted turns (approval, proposals, row actions), so e2e covers the
real store, approval and settle paths without spending anything. Pick with `GETMYPROF_AGENT=fake`.

## Outreach

Messages to and from professors live in the `messages` table; stage and whose turn it is are
derived from them on every read (`outreach/store.ts`, everyone in `outreach/pipeline.ts`), never
stored. A submitted application that names a professor moves them to Applied; an offer from that
school, to Offer. An accepted offer anywhere ends the hunt, also derived: loops stop running on
schedule, cold mail and follow-ups stop, and answers and thank-yous still go. Un-accepting it
resumes everything. The user connects their own
mailbox with an app password, or signs in with Google (Gmail) or Microsoft (Outlook.com, which
dropped app passwords). The login, password or refresh token, sits in `GETMYPROF_HOME/mail.json`,
mode 0600, and never crosses the wire.

- **Signing in takes no setup.** getmyprof ships its own OAuth clients (`SHARED_CLIENTS` in
  `outreach/oauth.ts`): a Desktop app in Google Cloud and a public client in Azure. Neither can
  keep a secret, so they live in the source; a user brings their own only by choice. Gmail's
  scope is restricted: until Google verifies the app (a review plus a yearly paid security
  assessment, CASA), users see an "unverified app" screen and the Google project serves 100
  users, ever. Its consent screen must be In production, or Google expires sign-ins every 7
  days. An app password has neither limit, so Gmail opens on it and offers signing in as the
  other choice. The callback is
  `http://127.0.0.1:<port>/api/oauth/callback` (Microsoft: `localhost`), on this server, with
  PKCE; it connects the mailbox and sends the browser back to Settings, only ever to the app's
  own pages. IMAP and SMTP log in with a fresh access token (XOAUTH2).
- **A login that stops working says so.** Google ends a sign-in after a password change or
  removed access, and a new Google password revokes app passwords. Either one is `SignedOut`:
  Settings offers Sign in again (reusing the user's own client, if they brought one) or a new app
  password, and the mailbox, its warm-up and its queue stay. Sends that failed meanwhile stay in
  the Pipeline as failed, to send again.

- **Nothing sends without approval.** The agent only drafts (`draft_email`). Approving gives each
  first email or follow-up a slot: 08:00 in the professor's zone, Tuesday to Thursday, within
  warm-up caps (5, 10, then 15 a day; 2 per university). Answers and thank-yous skip the caps
  and go in the professor's working hours: Monday to Friday, 08:00 to 18:00 their time.
- **Mail that reads as one person's.** It leaves the user's own mailbox, so SPF and DKIM pass
  as theirs; plain text, one recipient, at most two links, a CV only when asked. Everything
  after the first email answers the latest real one (`In-Reply-To`), so it threads on both
  sides; a "Re:" that answers nothing is a spam signal.
- **One send path.** Every send runs through `outreach.tick`, one message at a time, so a message
  can't go out twice. "Send now" just makes a message due and ticks.
- **One rule for every claim.** Drafts cite facts as `[[fact-id]]`, numbered `[n]` like the
  Writer's, and the markers are stripped from anything that leaves (mail, mailto, LinkedIn copy).
  `draftIssues` in contracts is the rule: an unproven or uncited claim, an unbacked test score,
  a third link, or cold mail to an unchecked address. The server's approve and send, the
  composer and "Approve all" all apply it, and the agent hears why a draft can't go yet.
- **Only reviewed addresses.** A draft must go to the address already accepted in the record;
  apply-only professors get none. On Siam's install gradhunt's rows belong to its cloud outreach
  routine, so getmyprof never drafts to them and the two can't double-send.
- **Replies come back to the agent.** Sync files mail from contacted professors only (by
  In-Reply-To, then sender); a real reply goes to the thread that drafted the first email for
  `classify_reply` and an answer draft. Follow-ups that come due get one drafting thread per day.
- **LinkedIn is assisted.** The user sends the note there and marks it sent; replies arrive as
  LinkedIn's notification emails. No account automation.
- `GETMYPROF_AGENT=fake` also swaps in `fakeMailer`: sends stay in memory and fixture professors
  answer on the next sync.

## Vault

An hq inside the app. Facts are the profile facts above, each with its proof (`source`): a fact
without proof is never written into anything. On Siam's install hq stays the source and the
Vault shows its facts read-only.

- **An OKF bundle, like hq.** `okf.ts` writes the whole Vault (facts by kind, documents, programs,
  professors, applications, offers, writing) to `GETMYPROF_HOME/vault` as typed markdown notes
  with relative links: a fact links its proof, an application its program and professors, a piece
  of writing the facts it cites. It is one way, rebuilt a moment after any change: the app is the
  source, the folder is for Obsidian and for search. On Siam's install hq keeps the facts and
  getmyprof writes none of them.
- **The agent searches before it writes.** The same notes (plus hq's own facts, documents,
  decisions and research on an install that reads hq) fill an FTS5 table, `notes`. `vault_search`
  returns the best notes with what they link to and what links to them, so a fact comes with its
  proof in one call. The table is derived and never backed up.
- **The Lifeline is the front page.** Facts carry a date, as precise as their source; the
  Lifeline lists facts and documents by year. Its panel shows the note, the facts as a CV, or
  the file (a PDF is served without the sandbox header so Chrome will show it; everything else
  keeps it).

- **One table, typed by kind.** Documents, scholarships, programs, applications and To file
  share the `vault` table; `vault.ts` parses each kind with its zod schema on read.
- **Files stay private.** Document bytes live in `GETMYPROF_HOME/files`, mode 0600, named by id
  only. `/api/files/<id>` serves them with `Content-Security-Policy: sandbox`, so an uploaded
  HTML file can't run on the app's origin.
- **Nothing is filed without a click.** The agent's `propose_program` and `propose_scholarship`
  land in To file; File or Dismiss decides. A dismissed find never comes back.
- **The Writer cites, the app judges.** The agent writes through `write_document`, citing facts
  as `[[fact-id]]`; the store numbers them `[1]`, `[2]`. Whether a claim is blocked is computed
  from the cited fact's status on every read, so adding proof unblocks it without a rewrite. A
  blocked claim, a sentence that claims something and cites nothing (`uncitedClaims`), a stray
  marker or a test score no fact backs disables export (text, PDF and Word). Writing again for
  the same target makes the next draft.
- **After the admit.** Interviews live on an application: a private prep pack (kind `prep`, never
  blocked, never sent), an `.ics` file, and a thank-you the agent drafts into the Pipeline (a
  thank-you is not cold mail, so apply-only and gradhunt rows may get one). Offers compare by a
  year of stipend minus a year of rent; the agent drafts negotiation letters (kind `letter`).
- **Submitting closes the loop.** Marking an application submitted hands the professors it names
  to the agent, which drafts "I applied and named you" notes into the Pipeline.
