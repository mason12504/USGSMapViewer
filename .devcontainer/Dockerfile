FROM node:22-bookworm-slim

# Must match "@playwright/test" in package.json exactly: the browser build is
# baked into the image because the firewall blocks Playwright's download CDN
# at runtime. Bump both together.
ARG PLAYWRIGHT_VERSION=1.63.0

# --- System packages ------------------------------------------------------
# git            -> Claude commits locally (no push: GitHub is not allowlisted,
#                   and no credentials exist in here)
# iptables/ipset/dnsutils/iproute2 -> the egress firewall in init-firewall.sh
# gosu           -> drop from root (needed for iptables) to the "dev" user
# zsh/less/procps -> a usable shell
RUN apt-get update && apt-get install -y --no-install-recommends \
        git \
        iptables ipset dnsutils iproute2 \
        gosu \
        zsh less procps \
        curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# --- Playwright: Chromium's system libraries (needs root + apt) -------------
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx -y playwright@${PLAYWRIGHT_VERSION} install-deps chromium \
    && rm -rf /var/lib/apt/lists/* /root/.npm

# --- Non-root user -----------------------------------------------------------
RUN useradd --create-home --shell /usr/bin/zsh dev \
    && mkdir -p /home/dev/.claude /ms-playwright \
    && chown -R dev:dev /home/dev /ms-playwright

# Claude Code keeps auth/settings here; docker-compose.yml mounts a named
# volume on it so you log in once, not on every rebuild.
ENV CLAUDE_CONFIG_DIR=/home/dev/.claude

# npm global prefix owned by "dev", so Claude Code's auto-updater can write it.
ENV NPM_CONFIG_PREFIX=/home/dev/.npm-global
ENV PATH="/home/dev/.npm-global/bin:${PATH}"

USER dev
RUN npm install -g @anthropic-ai/claude-code \
    && npx -y playwright@${PLAYWRIGHT_VERSION} install chromium \
    && rm -rf /home/dev/.npm/_cacache
# /workspace is a bind mount from Windows (shows up root-owned); trust exactly
# that path so git works. Commit identity comes from GIT_* env vars in compose.
RUN git config --global --add safe.directory /workspace
USER root

# node_modules lives in a named volume (fast, Linux-native binaries, never
# written to your PC). Pre-creating it owned by dev makes the volume dev-owned.
RUN mkdir -p /workspace/node_modules && chown -R dev:dev /workspace

WORKDIR /workspace

COPY .devcontainer/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY .devcontainer/init-firewall.sh /usr/local/bin/init-firewall.sh
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/init-firewall.sh

# Starts as root (firewall), then drops permanently to "dev" via gosu.
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["sleep", "infinity"]
