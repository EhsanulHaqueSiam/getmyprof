# getmyprof

Find professors who can fund your degree, and the money behind them. Every search is a Claude Code
session on your own Claude subscription, using free sources (NSF and NIH awards, UKRI, CORDIS, ARC,
DFG and NSERC grants, OpenAlex, CSRankings, faculty pages) and optional paid lookups through treg.
Then it carries you through outreach, applications and offers. Everything stays in one SQLite file
on your machine, and it sends no telemetry.

## Use

Node 24 or newer, on macOS or Linux.

```sh
npx getmyprof@latest       # try it, nothing to install
npm install -g getmyprof   # or keep the getmyprof command
getmyprof
```

It starts a local server and opens the app in your browser. npm already brought the Claude Code
binary for your machine; sign in from Setup's first step, or with `getmyprof login`.

| Command           | What it does                                            |
| ----------------- | ------------------------------------------------------- |
| `getmyprof`       | starts it and opens it in your browser; Ctrl-C stops it |
| `getmyprof serve` | keeps it running in the background                      |
| `getmyprof stop`  | stops the background server                             |
| `getmyprof login` | signs in to Claude in the terminal                      |

With npx, the command goes after the package: `npx getmyprof@latest serve`. Update with
`npm install -g getmyprof@latest`. Your data lives in `~/.getmyprof`; set `GETMYPROF_HOME` to move
it.

The desktop app, an installer that needs no Node, and the full guide:
[github.com/EhsanulHaqueSiam/getmyprof](https://github.com/EhsanulHaqueSiam/getmyprof#install).
