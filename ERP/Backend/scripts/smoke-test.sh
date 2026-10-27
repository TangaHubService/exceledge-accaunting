#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# Load environment variables from .env (if present) so the server has what it needs.
if [ -f ".env" ]; then
  set -a
  # shellcheck disable=SC1090
  source ".env"
  set +a
fi

SMOKE_PORT="${SMOKE_PORT:-5000}"
SMOKE_URL="${SMOKE_URL:-http://localhost:$SMOKE_PORT/health}"

if [ -z "${JWT_SECRET:-}" ]; then
  echo "JWT_SECRET must be set before running the smoke test" >&2
  exit 1
fi

echo "Building server for smoke test..."
npm run build

RUN_JOBS=false \
  JWT_SECRET="$JWT_SECRET" \
  PORT="$SMOKE_PORT" \
  NODE_ENV=test \
  node dist/index.js &

SERVER_PID=$!
trap 'kill "$SERVER_PID" >/dev/null 2>&1 || true' EXIT

sleep 4

echo "Checking $SMOKE_URL..."
curl --fail --silent --show-error "$SMOKE_URL"

echo "Smoke test succeeded"

kill "$SERVER_PID" >/dev/null 2>&1 || true
wait "$SERVER_PID" 2>/dev/null || true
trap - EXIT
