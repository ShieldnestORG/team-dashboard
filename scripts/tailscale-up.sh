#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# tailscale-up.sh — join this environment to the Coherence Daddy tailnet so
# the agent/session can reach tailnet-only services (Firecrawl :3002, the
# embedding API, etc.).
#
# WHERE THIS RUNS
#   From the environment's SETUP / provisioning script (Claude Code on the web
#   "setup script" field, or a SessionStart provisioning step) — as root,
#   BEFORE the agent starts taking turns.
#
#   It will NOT work if invoked from inside a running agent turn: mid-session
#   egress is locked to an allowlist and Tailscale's control plane
#   (controlplane.tailscale.com) returns `403 host_not_allowed`. The network
#   policy must permit Tailscale (see docs/deploy/tailnet-session-access.md)
#   and this script must run at provision time.
#
# REQUIRED ENV
#   TS_AUTHKEY     Tailscale auth key. Use an EPHEMERAL, PRE-AUTHORIZED, TAGGED
#                  key (e.g. tag:ci). Provide it as an environment SECRET.
#                  Never commit it.
#
# OPTIONAL ENV
#   TS_HOSTNAME    Node name on the tailnet. Default: cc-web-<rand>.
#   TS_TAGS        Comma tags to advertise, e.g. "tag:ci". Default: unset.
#   FIRECRAWL_URL  Tailnet Firecrawl endpoint to verify after connect,
#                  e.g. http://firecrawl:3002 (MagicDNS) or http://100.x.y.z:3002.
#   TS_EXTRA_ARGS  Any extra `tailscale up` flags.
#
# EXIT CODES
#   0 connected (and Firecrawl verified if FIRECRAWL_URL set)
#   1 missing TS_AUTHKEY
#   2 install failed
#   3 tailscaled failed to start
#   4 tailscale up failed
#   5 connected but Firecrawl verification failed (non-fatal-by-policy; see below)
# ---------------------------------------------------------------------------
set -euo pipefail

log() { printf '[tailscale-up] %s\n' "$*"; }

if [ -z "${TS_AUTHKEY:-}" ]; then
  log "ERROR: TS_AUTHKEY is not set. Provide it as an environment secret."
  exit 1
fi

TS_HOSTNAME="${TS_HOSTNAME:-cc-web-$(head -c4 /dev/urandom | od -An -tx1 | tr -d ' \n')}"

# --- 1. Install Tailscale if missing -------------------------------------
if ! command -v tailscale >/dev/null 2>&1; then
  log "tailscale not found — installing via official script"
  if ! curl -fsSL https://tailscale.com/install.sh | sh; then
    log "ERROR: install failed. Ensure the network policy allows pkgs.tailscale.com."
    exit 2
  fi
fi
log "tailscale version: $(tailscale version | head -1)"

# --- 2. Pick networking mode ---------------------------------------------
# Kernel mode needs /dev/net/tun + NET_ADMIN. If either is missing, fall back
# to userspace networking and expose a local SOCKS5/HTTP proxy on :1055 so the
# app can route tailnet traffic through it (set HTTPS_PROXY=http://localhost:1055).
USERSPACE=0
if [ ! -c /dev/net/tun ]; then
  log "no /dev/net/tun — using userspace networking"
  USERSPACE=1
elif ! capsh --print 2>/dev/null | grep -q 'cap_net_admin'; then
  log "no CAP_NET_ADMIN — using userspace networking"
  USERSPACE=1
fi

mkdir -p /var/lib/tailscale /run/tailscale

if pgrep -x tailscaled >/dev/null 2>&1; then
  log "tailscaled already running"
else
  if [ "$USERSPACE" -eq 1 ]; then
    log "starting tailscaled (userspace-networking, proxy on :1055)"
    tailscaled \
      --state=/var/lib/tailscale/tailscaled.state \
      --socket=/run/tailscale/tailscaled.sock \
      --tun=userspace-networking \
      --socks5-server=localhost:1055 \
      --outbound-http-proxy-listen=localhost:1055 \
      >/var/log/tailscaled.log 2>&1 &
  else
    log "starting tailscaled (kernel mode)"
    tailscaled \
      --state=/var/lib/tailscale/tailscaled.state \
      --socket=/run/tailscale/tailscaled.sock \
      >/var/log/tailscaled.log 2>&1 &
  fi
  # Wait for the daemon socket to come up
  for _ in $(seq 1 20); do
    [ -S /run/tailscale/tailscaled.sock ] && break
    sleep 0.5
  done
  if [ ! -S /run/tailscale/tailscaled.sock ]; then
    log "ERROR: tailscaled did not start — see /var/log/tailscaled.log"
    exit 3
  fi
fi

# --- 3. Bring the node up ------------------------------------------------
UP_ARGS=(--authkey="${TS_AUTHKEY}" --hostname="${TS_HOSTNAME}" --accept-dns=true)
[ -n "${TS_TAGS:-}" ] && UP_ARGS+=(--advertise-tags="${TS_TAGS}")
# shellcheck disable=SC2206
[ -n "${TS_EXTRA_ARGS:-}" ] && UP_ARGS+=(${TS_EXTRA_ARGS})

log "tailscale up (hostname=${TS_HOSTNAME})"
if ! tailscale up "${UP_ARGS[@]}"; then
  log "ERROR: tailscale up failed. Check key validity, ACL tags, and that the"
  log "       network policy allows the control plane + DERP."
  exit 4
fi

log "connected. tailnet IPv4: $(tailscale ip -4 2>/dev/null | head -1)"
tailscale status || true

# --- 4. Verify Firecrawl reachability (optional) -------------------------
if [ -n "${FIRECRAWL_URL:-}" ]; then
  log "verifying Firecrawl at ${FIRECRAWL_URL}"
  PROXY_ARG=()
  [ "$USERSPACE" -eq 1 ] && PROXY_ARG=(--proxy http://localhost:1055)
  code=$(curl -sS -m 10 "${PROXY_ARG[@]}" -o /dev/null -w '%{http_code}' \
    -X POST "${FIRECRAWL_URL%/}/v1/scrape" \
    -H "Authorization: Bearer ${FIRECRAWL_BEARER:-self-hosted}" \
    -H 'Content-Type: application/json' \
    -d '{"url":"https://example.com","formats":["markdown"]}' 2>/dev/null || echo "000")
  if [ "$code" = "200" ]; then
    log "OK: Firecrawl reachable over the tailnet (HTTP 200)"
  else
    log "WARN: Firecrawl returned HTTP ${code} (expected 200)."
    log "      tailnet is up, but check FIRECRAWL_URL points at the tailnet"
    log "      address (:3002), the bearer token, and the tag's ACL grant."
    exit 5
  fi
fi

log "done."
