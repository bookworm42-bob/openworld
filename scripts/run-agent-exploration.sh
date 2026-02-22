#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPENWORLD_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

DEV_PORT="${DEV_PORT:-5173}"
BRIDGE_PORT="${BRIDGE_PORT:-8787}"
DEV_HOST="${DEV_HOST:-0.0.0.0}"
WS_URL="${OPENWORLD_WS_URL:-ws://127.0.0.1:${BRIDGE_PORT}}"
DEV_URL="http://127.0.0.1:${DEV_PORT}"
AGENT_SCRIPT="${AGENT_SCRIPT:-scripts/agent-exploration-first-steps.mjs}"
TAKE_SCREENSHOTS="${TAKE_SCREENSHOTS:-1}"
SHOT_WAIT_MS="${SHOT_WAIT_MS:-4000}"
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"
SHOTS_DIR="${SHOTS_DIR:-$OPENWORLD_DIR/artifacts/agent-runs/$RUN_ID}"

DEV_LOG="${DEV_LOG:-$OPENWORLD_DIR/.agent-dev.log}"
WAIT_TIMEOUT_SEC="${WAIT_TIMEOUT_SEC:-25}"
BROWSER_CLIENT_ENABLED="${BROWSER_CLIENT_ENABLED:-1}"
BROWSER_CLIENT_LOG="${BROWSER_CLIENT_LOG:-$OPENWORLD_DIR/.agent-browser-client.log}"
BROWSER_CLIENT_WAIT_SEC="${BROWSER_CLIENT_WAIT_SEC:-4}"
BROWSER_CLIENT_HEADLESS="${BROWSER_CLIENT_HEADLESS:-false}"

DEV_PID=""
BROWSER_CLIENT_PID=""

find_port_pids() {
  local port="$1"

  if [ -x /usr/sbin/lsof ]; then
    /usr/sbin/lsof -ti "tcp:${port}" 2>/dev/null || true
    return
  fi

  if command -v lsof >/dev/null 2>&1; then
    lsof -ti "tcp:${port}" 2>/dev/null || true
    return
  fi

  if command -v ss >/dev/null 2>&1; then
    ss -ltnp "( sport = :${port} )" 2>/dev/null | awk -F 'pid=' 'NF>1 {print $2}' | awk -F ',' '{print $1}' || true
    return
  fi

  if command -v netstat >/dev/null 2>&1; then
    netstat -lntp 2>/dev/null | awk -v p=":${port}" '$4 ~ p {print $7}' | awk -F '/' '{print $1}' | sed '/^-/d' || true
    return
  fi
}

kill_port() {
  local port="$1"
  local pids

  pids="$(find_port_pids "$port" | tr '\n' ' ' | xargs || true)"
  if [ -z "$pids" ]; then
    echo "[PORT] :${port} already free"
    return
  fi

  echo "[PORT] killing :${port} -> ${pids}"
  kill -9 $pids 2>/dev/null || true
  sleep 0.15
}

wait_http() {
  local url="$1"
  local timeout="$2"
  local i

  for ((i=0; i<timeout*4; i++)); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

wait_tcp() {
  local host="$1"
  local port="$2"
  local timeout="$3"
  local i

  for ((i=0; i<timeout*4; i++)); do
    if command -v nc >/dev/null 2>&1 && nc -z "$host" "$port" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

cleanup() {
  local code=$?
  if [ -n "$BROWSER_CLIENT_PID" ] && kill -0 "$BROWSER_CLIENT_PID" >/dev/null 2>&1; then
    echo "[CLEANUP] stopping browser client pid=$BROWSER_CLIENT_PID"
    kill "$BROWSER_CLIENT_PID" >/dev/null 2>&1 || true
    sleep 0.2
    kill -9 "$BROWSER_CLIENT_PID" >/dev/null 2>&1 || true
  fi
  if [ -n "$DEV_PID" ] && kill -0 "$DEV_PID" >/dev/null 2>&1; then
    echo "[CLEANUP] stopping dev server pid=$DEV_PID"
    kill "$DEV_PID" >/dev/null 2>&1 || true
    sleep 0.2
    kill -9 "$DEV_PID" >/dev/null 2>&1 || true
  fi
  exit "$code"
}
trap cleanup EXIT INT TERM

echo "[SETUP] openworld=$OPENWORLD_DIR"
echo "[SETUP] dev_url=$DEV_URL ws_url=$WS_URL"
echo "[SETUP] agent_script=$AGENT_SCRIPT"
if [ "$TAKE_SCREENSHOTS" = "1" ]; then
  echo "[SETUP] screenshots enabled -> $SHOTS_DIR"
fi

kill_port "$DEV_PORT"
kill_port "$BRIDGE_PORT"

cd "$OPENWORLD_DIR"
echo "[START] npm run dev -- --host ${DEV_HOST} --port ${DEV_PORT}"
VITE_AGENT_BRIDGE_WS_URL="$WS_URL" npm run dev -- --host "$DEV_HOST" --port "$DEV_PORT" >"$DEV_LOG" 2>&1 &
DEV_PID=$!
echo "[START] dev pid=$DEV_PID log=$DEV_LOG"

if ! wait_http "$DEV_URL" "$WAIT_TIMEOUT_SEC"; then
  echo "[ERROR] dev server did not become ready at $DEV_URL"
  echo "[ERROR] recent dev log:"
  tail -n 80 "$DEV_LOG" || true
  exit 1
fi

if ! wait_tcp "127.0.0.1" "$BRIDGE_PORT" "$WAIT_TIMEOUT_SEC"; then
  echo "[WARN] bridge port :$BRIDGE_PORT not confirmed by tcp probe; continuing"
fi

echo "[READY] dev reachable at $DEV_URL"
if [ "$BROWSER_CLIENT_ENABLED" = "1" ]; then
  echo "[START] browser client -> $DEV_URL (headless=$BROWSER_CLIENT_HEADLESS)"
  DEV_URL="$DEV_URL" BROWSER_CLIENT_HARD_REFRESH="${BROWSER_CLIENT_HARD_REFRESH:-1}" \
    PLAYWRIGHT_HEADLESS="$BROWSER_CLIENT_HEADLESS" \
    node scripts/browser-client-keepalive.cjs >"$BROWSER_CLIENT_LOG" 2>&1 &
  BROWSER_CLIENT_PID=$!
  sleep "$BROWSER_CLIENT_WAIT_SEC"
  if ! kill -0 "$BROWSER_CLIENT_PID" >/dev/null 2>&1; then
    echo "[ERROR] browser client failed to start"
    echo "[ERROR] recent browser client log:"
    tail -n 80 "$BROWSER_CLIENT_LOG" || true
    exit 1
  fi
  echo "[READY] browser client pid=$BROWSER_CLIENT_PID log=$BROWSER_CLIENT_LOG"
fi

if [ "$TAKE_SCREENSHOTS" = "1" ]; then
  mkdir -p "$SHOTS_DIR"
  DEV_URL="$DEV_URL" OUT_PATH="$SHOTS_DIR/00-before-agent.png" WAIT_MS="$SHOT_WAIT_MS" \
    node scripts/visual-snapshot.cjs || echo "[WARN] pre-agent screenshot failed"
fi

echo "[RUN] OPENWORLD_WS_URL=$WS_URL node $AGENT_SCRIPT"
OPENWORLD_WS_URL="$WS_URL" node "$AGENT_SCRIPT"

if [ "$TAKE_SCREENSHOTS" = "1" ]; then
  DEV_URL="$DEV_URL" OUT_PATH="$SHOTS_DIR/99-after-agent.png" WAIT_MS="1200" \
    node scripts/visual-snapshot.cjs || echo "[WARN] post-agent screenshot failed"
  echo "[DONE] screenshots in $SHOTS_DIR"
fi
