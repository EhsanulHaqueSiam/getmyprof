#!/usr/bin/env bash
#
# dev-local.sh: bring gradcode's local stack up in one command (tmux, no infra).
#
# Usage:
#   scripts/dev-local.sh up             # start server + web (idempotent)
#   scripts/dev-local.sh down           # stop both
#   scripts/dev-local.sh status         # windows, ports, /api/health
#   scripts/dev-local.sh logs <name>    # last 400 lines of server|web
#   scripts/dev-local.sh restart <name>
#   scripts/dev-local.sh attach         # Ctrl-b d to detach
#   scripts/dev-local.sh share          # put the web app on the tailnet (tailscale serve)
#
set -euo pipefail

SESSION="gradcode-dev"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_PORT="${WEB_PORT:-5174}"
SERVER_PORT="${SERVER_PORT:-4311}"
GRADHUNT_DIR="${GRADHUNT_DIR:-$HOME/Personal/gradhunt}"

# "window|command". The server must be up before the web proxy has anywhere to send /api.
SERVERS=(
  "server|SERVER_PORT=$SERVER_PORT GRADHUNT_DIR='$GRADHUNT_DIR' GRADCODE_HOME='${GRADCODE_HOME:-$HOME/.gradcode}' GRADCODE_AGENT='${GRADCODE_AGENT:-}' pnpm --filter @gradcode/server dev"
  "web|WEB_PORT=$WEB_PORT SERVER_PORT=$SERVER_PORT pnpm --filter @gradcode/web dev"
)
PORTS=("server:$SERVER_PORT" "web:$WEB_PORT")

c_reset=$'\033[0m'; c_dim=$'\033[2m'; c_grn=$'\033[32m'; c_ylw=$'\033[33m'; c_red=$'\033[31m'; c_cyn=$'\033[36m'
info() { printf "${c_cyn}▸ %s${c_reset}\n" "$*"; }
ok()   { printf "${c_grn}✓ %s${c_reset}\n" "$*"; }
warn() { printf "${c_ylw}! %s${c_reset}\n" "$*"; }
die()  { printf "${c_red}✗ %s${c_reset}\n" "$*" >&2; exit 1; }
port_up() { lsof -ti :"$1" -sTCP:LISTEN >/dev/null 2>&1; }
running() { tmux has-session -t "$SESSION" 2>/dev/null; }

preflight() {
  command -v tmux >/dev/null 2>&1 || die "tmux not found. Install: brew install tmux"
  command -v pnpm >/dev/null 2>&1 || die "pnpm not found. Install: mise use -g pnpm"
  [ -d "$ROOT/node_modules" ] || die "Deps not installed. Run: pnpm install"
  [ -f "$GRADHUNT_DIR/scout.py" ] || warn "no scout.py under $GRADHUNT_DIR; set GRADHUNT_DIR (the app still starts)"
  for e in "${PORTS[@]}"; do
    if port_up "${e##*:}" && ! running; then die "port ${e##*:} (${e%%:*}) is taken by another process: lsof -i :${e##*:}"; fi
  done
}

start_window() {  # idempotent: leaves an existing window alone
  local name="$1" cmd="$2"
  if tmux list-windows -t "$SESSION" -F '#{window_name}' 2>/dev/null | grep -qx "$name"; then
    warn "window '$name' already running, leaving it alone"; return
  fi
  tmux new-window -t "$SESSION" -n "$name" -c "$ROOT"
  tmux send-keys -t "$SESSION:$name" "$cmd" C-m
}

port_check() {
  printf "  Ports (${c_dim}· = still starting${c_reset}):\n"
  for e in "${PORTS[@]}"; do
    if port_up "${e##*:}"; then printf "    ${c_grn}●${c_reset} %-8s :%s\n" "${e%%:*}" "${e##*:}"
    else                        printf "    ${c_dim}·${c_reset} %-8s :%s\n" "${e%%:*}" "${e##*:}"; fi
  done
}

cmd_up() {
  preflight
  running || tmux new-session -d -s "$SESSION" -n _bootstrap -c "$ROOT"
  for s in "${SERVERS[@]}"; do start_window "${s%%|*}" "${s#*|}"; done
  tmux kill-window -t "$SESSION:_bootstrap" 2>/dev/null || true
  for _ in $(seq 1 30); do port_up "$WEB_PORT" && port_up "$SERVER_PORT" && break; sleep 0.5; done
  echo; ok "gradcode on http://127.0.0.1:$WEB_PORT  (server :$SERVER_PORT)"; echo
  port_check
  printf "\n${c_dim}  logs: scripts/dev-local.sh logs server|web · stop: scripts/dev-local.sh down${c_reset}\n"
}

cmd_status() {
  if running; then info "tmux '$SESSION':"; tmux list-windows -t "$SESSION" -F '    #{window_name}'
  else warn "session '$SESSION' not running"; fi
  echo; port_check
  if port_up "$SERVER_PORT"; then printf "\n  health: %s\n" "$(curl -fsS "http://127.0.0.1:$SERVER_PORT/api/health" || echo unreachable)"; fi
}

cmd_logs()    { running || die "not running"; tmux capture-pane -p -S -400 -t "$SESSION:${1:?usage: logs server|web}"; }
cmd_restart() { running || die "not running"
  local n="${1:?usage: restart server|web}"; tmux kill-window -t "$SESSION:$n" 2>/dev/null || true
  for s in "${SERVERS[@]}"; do [ "${s%%|*}" = "$n" ] && { start_window "$n" "${s#*|}"; ok "restarted $n"; return; }; done
  die "unknown window '$n' (server|web)"; }
cmd_attach()  { running || die "not running, start with: scripts/dev-local.sh up"; tmux attach -t "$SESSION"; }
cmd_down()    { tmux kill-session -t "$SESSION" 2>/dev/null && ok "stopped" || warn "no session '$SESSION'"; }
# Its own HTTPS port, so it never replaces another app already served on the tailnet's 443.
SHARE_PORT="${SHARE_PORT:-8443}"
cmd_share()   { command -v tailscale >/dev/null 2>&1 || die "tailscale CLI not found"
  tailscale serve --bg --https="$SHARE_PORT" "$WEB_PORT" && ok "on the tailnet at port $SHARE_PORT; undo with: tailscale serve --https=$SHARE_PORT off"; }

case "${1:-up}" in
  up)      cmd_up ;;
  down)    cmd_down ;;
  status)  cmd_status ;;
  logs)    cmd_logs "${2:-}" ;;
  restart) cmd_restart "${2:-}" ;;
  attach)  cmd_attach ;;
  share)   cmd_share ;;
  -h|--help|help) awk 'NR==1{next} /^#/{sub(/^# ?/,"");print;next}{exit}' "${BASH_SOURCE[0]}" ;;
  *) die "unknown command '$1' (up|down|status|logs|restart|attach|share)" ;;
esac
