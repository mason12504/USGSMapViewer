# Push from your PC, after checking that nothing in .git could make YOUR git
# run code the container wrote. Run from the project root in PowerShell
# (NOT inside the dev container):
#
#   powershell -ExecutionPolicy Bypass -File scripts\host\safe-push.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\host\safe-push.ps1 -u origin main   # first push
#
# Extra arguments are passed to `git push`. This file is mounted read-only in
# the container, so Claude can't change what it does.

$ErrorActionPreference = 'Stop'
$git = Join-Path (Get-Location) '.git'
if (-not (Test-Path $git)) { Write-Host 'Run this from the project root (no .git here).' -ForegroundColor Red; exit 1 }

$problems = @()

# These files would make git read config from somewhere the container can write.
foreach ($f in 'commondir', 'config.worktree') {
  if (Test-Path (Join-Path $git $f)) { $problems += ".git\$f exists" }
}
# .git\config must be a file (Docker turns a missing path into a folder).
if ((Get-Item (Join-Path $git 'config')).PSIsContainer) { $problems += '.git\config is a folder, not a file' }
# Only git's own *.sample hooks should exist.
$hooks = Get-ChildItem (Join-Path $git 'hooks') -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -notlike '*.sample' }
if ($hooks) { $problems += "unexpected git hooks: $($hooks.Name -join ', ')" }
# Settings in .git\config that run programs.
$risky = git config --local --name-only --get-regexp '^(core\.(fsmonitor|hookspath|sshcommand|pager|editor|askpass)|diff\..*\.(command|textconv)|filter\..*|credential\..*|uploadpack\..*|alias\..*)$' 2>$null
if ($risky) { $problems += "risky settings in .git\config: $($risky -join ', ')" }

if ($problems) {
  Write-Host 'Refusing to push. Inspect these on your PC first:' -ForegroundColor Red
  $problems | ForEach-Object { Write-Host "  - $_" }
  exit 1
}

# Belt and braces: run git with hooks and fsmonitor disabled regardless.
$noHooks = Join-Path $env:TEMP 'mapparser-no-hooks'
New-Item -ItemType Directory -Force $noHooks | Out-Null

Write-Host 'Checks passed. Commits to push:' -ForegroundColor Green
git -c core.hooksPath="$noHooks" -c core.fsmonitor=false log --oneline --format='  %h %an: %s' '@{u}..HEAD' 2>$null
git -c core.hooksPath="$noHooks" -c core.fsmonitor=false push @args
