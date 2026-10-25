#!/bin/bash
# Default-deny outbound firewall (same proven design as the locked-down
# container). Allowlists only:
#   - Anthropic (Claude Code itself)
#   - the npm registry (npm ci / npm install)
#   - api-real:3001 on the private compose network (opt-in live API server)
#
# Deliberately NOT allowed: GitHub (you push from your PC), PyPI (no Python
# here), CDNs (pdf.js assets are served locally; Playwright's browser is
# baked into the image), everything else.
#
# Runs while the default policy is still ACCEPT (so it can resolve names),
# then locks down. Exits non-zero on any failure; entrypoint.sh treats that
# as fatal and the container never starts unprotected.
set -euo pipefail
IFS=$'\n\t'

echo "[firewall] Flushing existing rules..."

# Preserve Docker's embedded-DNS NAT rules so container DNS keeps working.
DOCKER_DNS_RULES="$(iptables-save -t nat | grep '127\.0\.0\.11' || true)"

iptables -F
iptables -X
iptables -t nat -F
iptables -t nat -X
iptables -t mangle -F
iptables -t mangle -X
ipset destroy allowed-domains 2>/dev/null || true

if [ -n "$DOCKER_DNS_RULES" ]; then
  echo "[firewall] Restoring Docker's embedded DNS rules..."
  iptables -t nat -N DOCKER_OUTPUT 2>/dev/null || true
  iptables -t nat -N DOCKER_POSTROUTING 2>/dev/null || true
  echo "$DOCKER_DNS_RULES" | xargs -L 1 iptables -t nat
fi

# DNS only to Docker's embedded resolver (open DNS = tunneling exfil path).
iptables -A OUTPUT -p udp --dport 53 -d 127.0.0.11 -j ACCEPT
iptables -A INPUT -p udp --sport 53 -s 127.0.0.11 -j ACCEPT
iptables -A OUTPUT -p tcp --dport 53 -d 127.0.0.11 -j ACCEPT
iptables -A INPUT -p tcp --sport 53 -s 127.0.0.11 -j ACCEPT
iptables -A INPUT -i lo -j ACCEPT
iptables -A OUTPUT -o lo -j ACCEPT

ipset create allowed-domains hash:net

resolve_ips() {
  local domain="$1"
  local attempt ips
  for attempt in 1 2 3 4 5; do
    ips="$(dig +noall +answer A "$domain" 2>/dev/null | awk '$4 == "A" {print $5}')"
    if [ -n "$ips" ]; then
      echo "$ips"
      return 0
    fi
    echo "[firewall] $domain not resolvable yet, retrying ($attempt/5)..." >&2
    sleep 1
  done
  return 1
}

ALLOWED_DOMAINS=(
  "api.anthropic.com"       # Claude API + WebFetch safety check + telemetry
  "claude.ai"               # claude.ai account authentication
  "claude.com"              # sign-in redirect page; doc-lookup WebFetch
  "platform.claude.com"     # OAuth token exchange/refresh
  "registry.npmjs.org"      # npm ci / npm install (incl. @napi-rs/canvas binaries)
)

for domain in "${ALLOWED_DOMAINS[@]}"; do
  echo "[firewall] Resolving $domain..."
  ips="$(resolve_ips "$domain")" || {
    echo "[firewall] FATAL: could not resolve $domain after retries" >&2
    exit 1
  }
  while read -r ip; do
    ipset add allowed-domains "$ip" -exist
  done <<< "$ips"
done

# --- Lock everything down ----------------------------------------------------
iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -P OUTPUT DROP

iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m set --match-set allowed-domains dst -j ACCEPT

# The opt-in live API server: exactly one IP, one port. API_REAL_IP is a
# literal in docker-compose.yml (static address on the private network).
if [ -n "${API_REAL_IP:-}" ]; then
  if [[ ! "$API_REAL_IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "[firewall] FATAL: API_REAL_IP '$API_REAL_IP' is not an IPv4 address" >&2
    exit 1
  fi
  echo "[firewall] Allowing api-real at $API_REAL_IP:3001"
  iptables -A OUTPUT -p tcp -d "$API_REAL_IP" --dport 3001 -j ACCEPT
fi

# Fast REJECT instead of silent DROP, so blocked calls fail in seconds.
iptables -A OUTPUT -j REJECT --reject-with icmp-admin-prohibited

# --- IPv6: deny outright (otherwise it routes around the IPv4 allowlist) -----
if command -v ip6tables >/dev/null 2>&1; then
  ip6tables -F 2>/dev/null || true
  ip6tables -X 2>/dev/null || true
  ip6tables -P INPUT DROP 2>/dev/null || true
  ip6tables -P FORWARD DROP 2>/dev/null || true
  ip6tables -P OUTPUT DROP 2>/dev/null || true
  ip6tables -A INPUT -i lo -j ACCEPT 2>/dev/null || true
  ip6tables -A OUTPUT -o lo -j ACCEPT 2>/dev/null || true
fi

echo "[firewall] Rules applied. Running self-check..."

check_reachable() {
  local url="$1"
  local code
  code="$(curl -m 5 -o /dev/null -s -w '%{http_code}' "$url" || true)"
  [ "$code" != "000" ]
}

if ! check_reachable "https://api.anthropic.com"; then
  echo "[firewall] FATAL: cannot reach api.anthropic.com — refusing to start" >&2
  exit 1
fi
if check_reachable "https://example.com"; then
  echo "[firewall] FATAL: example.com is reachable — firewall is not restrictive enough" >&2
  exit 1
fi
if check_reachable "https://github.com"; then
  echo "[firewall] FATAL: github.com is reachable — pushes must only happen from your PC" >&2
  exit 1
fi

echo "[firewall] Self-check passed: Anthropic reachable; example.com and github.com blocked."
