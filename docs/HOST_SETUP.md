# Setting up your PC (Windows)

Everything here happens on **your PC**, outside the dev container. Do it once.

## 1. Prerequisites

- Docker Desktop (WSL2 backend is fine; you don't need to use WSL yourself)
- VS Code + the **Dev Containers** extension
- Git for Windows (includes Git Credential Manager for GitHub sign-in)

## 2. Stop VS Code handing your GitHub login to containers

By default, Dev Containers copies your `.gitconfig` into every container and
forwards your git credential helper. Anything in the container can then run
`git credential fill` and get your GitHub token back in plain text. These
settings are **global**, so they also protect your other dev containers.

1. In VS Code on your PC (a normal window, not a container window), press
   `Ctrl+Shift+P` → **Preferences: Open User Settings (JSON)**.
2. Add these inside the outer `{ }`:

   ```jsonc
   // Don't copy my .gitconfig into containers
   "dev.containers.copyGitConfig": false,
   // Don't let containers ask my PC for git credentials
   "dev.containers.gitCredentialHelperConfigLocation": "none",
   // Never auto-run tasks from a project's .vscode/tasks.json
   "task.allowAutomaticTasks": "off",
   ```

   If VS Code underlines a name as unknown, setting names may have changed in
   your version; check the Dev Containers extension's settings page rather than guessing.
3. Rebuild existing containers (**Dev Containers: Rebuild Container**); the
   old copied config lives inside them until you do.
4. Verify in a container terminal. Run these yourself, not through Claude:

   ```bash
   git config --show-origin --get-all credential.helper   # expect: no output
   printf 'protocol=https\nhost=github.com\n\n' | GIT_TERMINAL_PROMPT=0 git credential fill
   # expect an error like "terminal prompts disabled", NOT a username/password
   echo $SSH_AUTH_SOCK                                     # expect: empty
   ```

## 3. The private folder (only needed for real AI calls)

The dev container never sees this folder. Only the opt-in `api-real`
service does, read-only.

1. Create a folder **outside** the project, e.g. `C:\Users\you\mapparser-private`.
2. Inside it, create `SECRETS.env`:

   ```env
   ANTHROPIC_API_KEY=sk-ant-...
   # optional
   ANTHROPIC_MODEL=claude-sonnet-5-5
   ```

   Use a dedicated key with a monthly spend limit (Anthropic Console →
   workspace limits), separate from your Claude Code login.
3. Copy `.devcontainer/.env.example` to `.devcontainer/.env` (gitignored) and
   set `MAPPARSER_PRIVATE_DIR` to that folder (forward slashes work).

## 4. Open the project

The project must be a git repo **before** the container first starts. The
container mounts `.git/config` read-only, and Docker would otherwise create
it as a folder. The zip you got already has `.git`.

1. Unzip the project somewhere like `C:\dev\mapparser`.
2. VS Code → **File → Open Folder** → the project → **Reopen in Container**.
3. First build takes a few minutes (Chromium for UI tests is baked in).
   Watch the log for `[firewall] Self-check passed` and `Sandbox ready`.
4. In the container terminal: `npm run dev` → open http://localhost:5173 →
   drop in `fixtures/pikeview/OF-01-03_Pikeview_Geologic_Map.pdf`.
5. Run `claude` in the container terminal (or use the Claude Code extension)
   and log in once; the login persists across rebuilds.

## 5. First push to GitHub (from your PC)

1. Create an **empty** repo on GitHub (no README/license, so histories don't clash).
2. In PowerShell, in the project folder:

   ```powershell
   git remote add origin https://github.com/<you>/mapparser.git
   powershell -ExecutionPolicy Bypass -File scripts\host\safe-push.ps1 -u origin main
   ```

   Git Credential Manager opens a browser to sign in once. The token is stored
   in Windows Credential Manager and never enters the container.

After that, the loop is: Claude commits in the container → review with
`git log -p` (or VS Code's Source Control in a **local** window) → run
`safe-push.ps1`.

`safe-push.ps1` checks `.git` for anything that could make your git run code
written in the container (hooks, `fsmonitor`, redirect files), then pushes
with hooks disabled. It's read-only inside the container, so Claude can't
alter it.

## 6. Live AI calls (optional)

Starts the server that holds your key, on a private Docker network that only
the dev container can reach. From PowerShell in the project folder:

```powershell
docker compose -f .devcontainer/docker-compose.yml --profile real up api-real
```

Then in the container terminal run `npm run dev:live` instead of `npm run dev`
(it starts only Vite, proxying `/api` to `api-real`; no mock server). The header badge shows
**API: live**. Stop it with `Ctrl+C` in PowerShell when done.

If the dev container can't reach `api-real`, check `docker compose ls`: both
should be under the project name `mapparser`. If VS Code named its project
differently, add `-p <that-name>` to the command above.

To turn a live response into a mock, set
`MAPPARSER_RECORD_DIR=/app/fixtures/_recorded` in `.devcontainer/.env`,
restart `api-real`, run the AI legend check, and copy the new file over
`fixtures/mock/anthropic-parse-legend.json`.

## What protects what

| Risk | Protection |
|---|---|
| Claude reads your PC's files | Only the project folder is mounted. No home folder, `~/.ssh`, or Docker socket. |
| GitHub token reaches the container | Credential forwarding off (step 2); container has no git credentials; GitHub blocked by firewall. |
| Anthropic API key reaches Claude | Key only in your private folder, mounted only into `api-real`. Sandbox runs in mock mode. |
| Data exfiltration | Default-deny egress: only Anthropic + npm registry (+ `api-real:3001`). Self-check refuses to start if example.com or github.com is reachable. |
| Container writes something your PC later executes | `.devcontainer/`, `.git/config`, `.git/hooks/`, `scripts/host/` are read-only in the container; `.vscode/` is a throwaway tmpfs; startup refuses to run if they're writable; `safe-push.ps1` re-checks before pushing. |

**Residual risk to know about:** Claude writes the code that `api-real` runs.
In principle it could make that code misuse the key (e.g. spend it). Review
`server/` diffs before starting `api-real`, and keep the spend limit on.
