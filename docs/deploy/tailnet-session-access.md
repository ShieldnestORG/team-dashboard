# Tailnet Access for Web / Agent Sessions

**Goal:** let a Claude Code on the web (or any ephemeral agent) session reach
**tailnet-only services** — primarily the self-hosted **Firecrawl `:3002`** and
the embedding API — so the agent can drive them directly instead of handing you
a script to run elsewhere.

> **Why this is needed.** A default web/agent session runs behind a strict
> egress allowlist. Every non-whitelisted host (the VPS, Firecrawl, even
> `controlplane.tailscale.com`) is refused at the harness proxy with
> `HTTP 403 x-deny-reason: host_not_allowed` — the request never leaves the
> container. Nothing *inside* a running session can bypass this: not curl, not
> SSH, not Tailscale, not a sub-agent (same sandbox), and not a browser (no
> bridge from your local browser to the container). The only fix is to
> **provision tailnet access when the environment is created.** See the audit:
> [`docs/operations/firecrawl-serp-connectivity-audit.md`](../operations/firecrawl-serp-connectivity-audit.md).

Background on environments + network policies:
https://code.claude.com/docs/en/claude-code-on-the-web

---

## Prerequisites

- Admin access to the Tailscale tailnet (to mint an auth key + edit ACLs).
- Ability to edit this repo's **web environment** config (network policy,
  secrets, setup script) in the Claude Code web/app settings.
- The Firecrawl node's tailnet name or IP (MagicDNS, e.g. `firecrawl`, or
  `100.x.y.z`). It listens on `:3002` (see
  `packages/plugins/plugin-firecrawl/docker/SELF_HOSTING.md`).

---

## Step 1 — Loosen the network policy (the hard blocker)

In the environment settings, switch the egress policy off "strict allowlist" to
one that permits Tailscale. At minimum the policy must allow outbound to:

| Purpose | Host / port |
|---|---|
| Package install | `pkgs.tailscale.com` (443) |
| Control plane | `controlplane.tailscale.com` (443) |
| DERP relays | `*.tailscale.com` / DERP servers (443 + UDP) |
| Direct connections | UDP `41641` (falls back to DERP/443 if blocked) |

If the platform only offers coarse policies, pick the most permissive one that
still meets your security bar. Tailscale can operate entirely over **443/DERP**
if UDP is blocked, so an HTTPS-only-but-not-allowlisted policy is usually enough.

> If this step is skipped, `scripts/tailscale-up.sh` fails at install or
> `tailscale up` with a control-plane 403 — that's the symptom of the policy
> still blocking egress.

## Step 2 — Mint a scoped auth key + ACL grant

In the Tailscale admin console:

1. **Auth key** (Settings → Keys → Generate): make it **Ephemeral**
   (node auto-removes when the session ends) and **Pre-authorized**, and assign
   a **tag** such as `tag:ci`. Ephemeral + tagged keeps short-lived sandbox
   nodes from piling up and scopes their access.
2. **ACL grant** — give the tag *least-privilege* reach to Firecrawl only, e.g.:

   ```jsonc
   // tailnet ACLs
   "tagOwners": { "tag:ci": ["autogroup:admin"] },
   "acls": [
     { "action": "accept",
       "src": ["tag:ci"],
       "dst": ["tag:firecrawl:3002"] }   // or the firecrawl node:3002
   ]
   ```

   `dst` is the Firecrawl host — **VPS1 (`.12`, tailnet `100.67.128.51`)** — on port `3002`.
   Use its tailnet tag or name.

## Step 3 — Add environment secrets / vars

In the web environment config:

| Name | Value | Notes |
|---|---|---|
| `TS_AUTHKEY` | the key from Step 2 | **Secret.** Never commit. |
| `TS_TAGS` | `tag:ci` | matches the ACL tag |
| `FIRECRAWL_URL` | `http://100.67.128.51:3002` | **VPS1 (`.12`) tailnet IP** where Firecrawl is bound — NOT `firecrawl.coherencedaddy.com` (that resolves to VPS4 `.14`, the wrong box) |
| `SSH_PRIVATE_KEY` | the `nestd@pm.me` ed25519 private key | **Secret.** Only for `ssh root@31.220.61.12` ops on the Firecrawl stack (logs, restarts). See "SSH access" below. |
| `TS_HOSTNAME` | `cc-web` *(optional)* | friendly node name |

> **Firecrawl runs on VPS1 (`root@31.220.61.12`), Tailnet-only**, bound to the tailnet IP
> `100.67.128.51:3002` (not loopback, not public). The public domain
> `firecrawl.coherencedaddy.com` resolves to VPS4 `.14` — the team-dashboard backend, the
> *wrong* target. Point `FIRECRAWL_URL` at the tailnet IP. See
> [`docs/deploy/vps-cheat-sheet.md`](vps-cheat-sheet.md) ("there is no overlap").

## Step 4 — Wire the setup script

Set the environment's **setup script** (runs at container provision, as root,
before the agent starts) to invoke the helper committed here:

```bash
bash scripts/tailscale-up.sh
```

The script is idempotent: installs Tailscale if missing, picks kernel vs
userspace networking automatically (userspace if `/dev/net/tun` or
`CAP_NET_ADMIN` is unavailable, exposing a proxy on `localhost:1055`), runs
`tailscale up`, and — if `FIRECRAWL_URL` is set — verifies a real
`POST /v1/scrape` returns `200`.

> **Userspace mode caveat:** if the script logs "userspace networking", the
> agent's own outbound calls won't transparently use the tailnet. Either set
> `HTTPS_PROXY=http://localhost:1055` for the relevant processes, or prefer an
> environment that grants `CAP_NET_ADMIN` + `/dev/net/tun` for transparent
> kernel-mode routing.

## Step 5 — Verify in the next session

Start a fresh session against the re-provisioned environment and confirm:

```bash
tailscale status            # node is Online, tagged tag:ci
tailscale ip -4             # 100.x.y.z assigned
curl -s -X POST "$FIRECRAWL_URL/v1/scrape" \
  -H "Authorization: Bearer self-hosted" -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com","formats":["markdown"]}' | jq '.success'   # true
```

Once `.success == true`, the agent can drive Firecrawl `scrape` / `search` /
`extract` directly — no more "run it on a tailnet box."

---

## Optional — SSH to the Firecrawl box (VPS1 `.12`)

Some ops (reading container logs, restarting `firecrawl-api-1`, checking queue depth) need a
shell on VPS1, not just HTTP. This is what a local laptop session does — to give a *web* session
the same reach:

1. Add the `nestd@pm.me` **ed25519 private key** as the `SSH_PRIVATE_KEY` secret (Step 3). Per the
   [cheat sheet](vps-cheat-sheet.md), **both VPS use this same key.**
2. In the setup script (after `tailscale-up.sh`), install the client and drop the key:

   ```bash
   apt-get update -y && apt-get install -y openssh-client
   install -d -m 700 ~/.ssh
   printf '%s\n' "$SSH_PRIVATE_KEY" > ~/.ssh/id_ed25519
   chmod 600 ~/.ssh/id_ed25519
   ssh-keyscan -H 31.220.61.12 >> ~/.ssh/known_hosts 2>/dev/null || true
   ```

3. Then: `ssh -i ~/.ssh/id_ed25519 root@31.220.61.12`.

> **Reachability still applies.** SSH to `.12` needs both the key *and* a network path to
> `31.220.61.12:22` — from a sandbox that means either an egress policy permitting port 22 to that
> host, or reaching it over the tailnet. The Firecrawl HTTP API (`100.67.128.51:3002`)
> specifically requires the tailnet. The key alone is not enough (this is the cheat sheet's "the
> key isn't installed where you're calling from" — plus the network boundary).

## Security notes

- **Ephemeral, tagged keys only.** Don't reuse a long-lived key for throwaway
  sandboxes; ephemeral nodes self-clean and the tag bounds their access.
- **Least-privilege ACL.** Grant `tag:ci` reach to Firecrawl `:3002` and the
  embedding API only — not the whole tailnet.
- **Secrets stay secrets.** `TS_AUTHKEY` lives in the env secret store, never in
  the repo. `scripts/tailscale-up.sh` reads it from the environment.
- **Rotate** the key on a schedule and revoke if a session is compromised.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `403 host_not_allowed` on any host | Network policy still strict | Step 1 |
| install fails | `pkgs.tailscale.com` blocked | Step 1 allowlist |
| `tailscale up` hangs/fails | control plane / DERP blocked, or bad key | Step 1 + Step 2 |
| "userspace networking" + app can't reach tailnet | no TUN/NET_ADMIN | set `HTTPS_PROXY=http://localhost:1055` or use a kernel-mode env |
| Firecrawl `403` after connect | wrong bearer or missing ACL grant | Step 2 ACL; confirm token |
| Firecrawl `000`/timeout | `FIRECRAWL_URL` points at public domain | use the tailnet `:3002` address (Step 3) |
