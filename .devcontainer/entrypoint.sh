#!/bin/bash
# Runs as root just long enough to (1) check the sandbox mounts are what we
# expect and (2) configure the egress firewall, then permanently drops to the
# "dev" user. Any failure = the container does not start. It never falls back
# to running unprotected.
set -euo pipefail

fail() {
  echo "[entrypoint] FATAL: $*" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail "container must start as root to configure the firewall"

# --- 1. Read-only mounts for things that run on your PC ------------------------
# (see the volumes: block in docker-compose.yml for why each one matters)
echo "[entrypoint] Checking read-only mounts..."

[ -d /workspace/.git ] || fail "/workspace/.git is missing. Run 'git init' in the project on your PC BEFORE opening the container."
[ -f /workspace/.git/config ] || fail "/workspace/.git/config is not a file. Docker probably created it as a folder because .git didn't exist yet: on your PC delete .git\\config (the folder), run 'git init' again, then rebuild."
[ -d /workspace/.git/hooks ] || fail "/workspace/.git/hooks is missing or not a folder."

assert_readonly() {
  local target="$1"
  local probe="$target"
  [ -d "$target" ] && probe="$target/.rw-probe-$$"
  if ( : >> "$probe" ) 2>/dev/null; then
    [ -d "$target" ] && rm -f "$probe"
    fail "$target is WRITABLE inside the container; it must be mounted :ro (docker-compose.yml)."
  fi
}
for path in /workspace/.devcontainer /workspace/.git/config /workspace/.git/hooks /workspace/scripts/host; do
  [ -e "$path" ] || fail "$path is missing"
  assert_readonly "$path"
done

# Files that could make git on your PC load config from somewhere writable.
for f in commondir config.worktree; do
  [ -e "/workspace/.git/$f" ] && fail "/workspace/.git/$f exists. Nothing in this project should create it. Inspect it on your PC before continuing."
done
echo "[entrypoint] Mounts OK."

# --- 2. Firewall -----------------------------------------------------------------
echo "[entrypoint] Setting up network firewall..."
/usr/local/bin/init-firewall.sh || fail "firewall setup failed — refusing to start"

# node_modules is a named volume; make sure dev owns it (first start).
chown dev:dev /workspace/node_modules 2>/dev/null || true

echo "[entrypoint] Sandbox ready. Dropping from root to 'dev'..."
exec gosu dev "$@"
