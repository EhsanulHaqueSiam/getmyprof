---
name: dev-local
description: Start, stop or inspect gradcode's local stack (server + web in tmux). Use for "start the app", "run gradcode", "dev server", "is the stack up", "restart the server", "share it on the tailnet", "/dev-local".
---

# /dev-local

One script: `scripts/dev-local.sh`. tmux session `gradcode-dev`, no infra.

| Window | Command                                                          | Port           |
| ------ | ---------------------------------------------------------------- | -------------- |
| server | `pnpm --filter @gradcode/server dev` (node --watch)              | 4311, loopback |
| web    | `pnpm --filter @gradcode/web dev` (vp dev, proxies /api and /ws) | 5174           |

Open http://127.0.0.1:5174.

Prerequisites: `pnpm install`, tmux. Environment it passes through:

- `GRADCODE_HOME`: data dir (default `~/.gradcode`). Use a temp dir for tests and verification.
- `GRADCODE_AGENT=fake`: the scripted agent, free and deterministic. Unset means the real one.
- `GRADHUNT_DIR`: gradhunt checkout for the sync (default `~/Personal/gradhunt`).

Test stack: `rm -rf /tmp/gc-e2e && GRADCODE_HOME=/tmp/gc-e2e GRADCODE_AGENT=fake scripts/dev-local.sh up`.

| Command               | Does                                                          |
| --------------------- | ------------------------------------------------------------- |
| `up`                  | starts both windows, idempotent, prints ports                 |
| `down`                | kills the session (only what this script started)             |
| `status`              | windows, ports, and `/api/health`                             |
| `logs server\|web`    | last 400 lines of a window                                    |
| `restart server\|web` | restarts one window                                           |
| `attach`              | attach to tmux (Ctrl-b d detaches)                            |
| `share`               | `tailscale serve` on https :8443 in front of :5174, never 443 |

Troubleshooting:

- **Port taken:** `up` refuses to start when another process owns 4311 or 5174. Find it with
  `lsof -i :<port>` and stop it by that PID, never by name.
- **A window exited:** `logs <name>` shows why, then `restart <name>`.
- **Page loads but says "reconnecting":** the server window died. Check `logs server`.
