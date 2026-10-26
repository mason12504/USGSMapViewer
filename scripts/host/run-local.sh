#!/usr/bin/env bash
# Run the app on YOUR PC (Git Bash), outside the dev container, as a customer
# would see it: production build, live Anthropic API, opens in your browser.
#
#   bash scripts/host/run-local.sh            # live API (default)
#   bash scripts/host/run-local.sh --mock     # no key; replays the saved mock response
#
# The API key is read by the API server straight from SECRETS.env in your
# private folder. The folder path comes from MAPPARSER_PRIVATE_DIR in
# .devcontainer/.env. The key is never printed, exported or copied anywhere.
set -euo pipefail

# Find the project root (the folder with package.json) no matter where this
# script lives or where it's run from.
root=$(cd "$(dirname "$0")" && pwd)
while [[ ! -f $root/package.json ]]; do
  [[ $root == "$(dirname "$root")" ]] && { echo "Can't find project root (package.json)"; exit 1; }
  root=$(dirname "$root")
done
cd "$root"

API_PORT=3001
WEB_PORT=4173
mode=live; [[ "${1:-}" == "--mock" ]] && mode=mock

# ── 1. Private folder (live mode only) ────────────────────────────────────
if [[ $mode == live ]]; then
  envfile=.devcontainer/.env
  [[ -f $envfile ]] || { echo "Missing $envfile (copy .devcontainer/.env.example)"; exit 1; }
  # Parse the one line we need; never `source` the file.
  priv=$(grep -E '^MAPPARSER_PRIVATE_DIR=' "$envfile" | tail -n1 | cut -d= -f2- | tr -d '\r' | sed -E "s/^['\"]//; s/['\"]$//")
  [[ -n $priv ]] || { echo "MAPPARSER_PRIVATE_DIR is not set in $envfile"; exit 1; }
  # Use a POSIX-style copy of the path for bash tests; node gets the original.
  priv_posix=$priv; command -v cygpath >/dev/null && priv_posix=$(cygpath -u "$priv")
  [[ -f $priv_posix/SECRETS.env ]] || { echo "No SECRETS.env in: $priv"; exit 1; }
  grep -Eq '^ANTHROPIC_API_KEY=.+' "$priv_posix/SECRETS.env" \
    || { echo "ANTHROPIC_API_KEY is missing or empty in $priv/SECRETS.env"; exit 1; }
  echo "Live mode: using key from $priv/SECRETS.env"
fi

# ── 2. Dependencies and production build ──────────────────────────────────
# node_modules in the dev container is a separate Docker volume, so this
# installs Windows-native packages on your PC the first time.
[[ -d node_modules/vite ]] || npm ci
npm run build

# ── 3. API server (background) ────────────────────────────────────────────
if [[ $mode == live ]]; then
  PRIVATE_ROOT="$priv" HOST=127.0.0.1 PORT=$API_PORT node server/index.js &
else
  MOCK_ANTHROPIC=1 HOST=127.0.0.1 PORT=$API_PORT node server/index.js &
fi
api_pid=$!
trap 'kill $api_pid 2>/dev/null || true' EXIT INT TERM

for _ in $(seq 1 30); do
  curl -fs "http://127.0.0.1:$API_PORT/api/health" >/dev/null 2>&1 && break
  kill -0 $api_pid 2>/dev/null || { echo "API server exited; see message above"; exit 1; }
  sleep 0.5
done

# ── 4. Serve the built app and open the browser ───────────────────────────
# /api is proxied to the API server by the config in vite.config.js.
echo "Open http://localhost:$WEB_PORT  (Ctrl+C stops everything)"
npx vite preview --host 127.0.0.1 --port $WEB_PORT --strictPort --open
