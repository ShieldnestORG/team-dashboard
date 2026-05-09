---
title: Tailscale Private Access
summary: Run Team Dashboard with Tailscale-friendly host binding and connect from other devices
---

Use this when you want to access Team Dashboard over Tailscale (or a private LAN/VPN) instead of only `localhost`.

## 1. Start Team Dashboard in private authenticated mode

```sh
pnpm dev --tailscale-auth
```

This configures:

- `PAPERCLIP_DEPLOYMENT_MODE=authenticated`
- `PAPERCLIP_DEPLOYMENT_EXPOSURE=private`
- `PAPERCLIP_AUTH_BASE_URL_MODE=auto`
- `HOST=0.0.0.0` (bind on all interfaces)

Equivalent flag:

```sh
pnpm dev --authenticated-private
```

## 2. Find your reachable Tailscale address

From the machine running Team Dashboard:

```sh
tailscale ip -4
```

You can also use your Tailscale MagicDNS hostname (for example `my-macbook.tailnet.ts.net`).

## 3. Open Team Dashboard from another device

Use the Tailscale IP or MagicDNS host with the Team Dashboard port:

```txt
http://<tailscale-host-or-ip>:3100
```

Example:

```txt
http://my-macbook.tailnet.ts.net:3100
```

## 4. Allow custom private hostnames when needed

If you access Team Dashboard with a custom private hostname, add it to the allowlist:

```sh
pnpm paperclipai allowed-hostname my-macbook.tailnet.ts.net
```

## 5. Verify the server is reachable

From a remote Tailscale-connected device:

```sh
curl http://<tailscale-host-or-ip>:3100/api/health
```

Expected result:

```json
{"status":"ok"}
```

## Troubleshooting

- Login or redirect errors on a private hostname: add it with `paperclipai allowed-hostname`.
- App only works on `localhost`: make sure you started with `--tailscale-auth` (or set `HOST=0.0.0.0` in private mode).
- Can connect locally but not remotely: verify both devices are on the same Tailscale network and port `3100` is reachable.

## Production VPS Tailnet (Coherence Daddy)

The production VPS pair uses Tailscale as the private mesh between VPS4 (team-dashboard backend) and VPS1 (LLM/scrape stack). All inter-VPS calls (Firecrawl, BGE-M3, Ollama) go over Tailnet. No public bind for any LLM or DB service — see [feedback_no_public_llm_db](#) (memory rule).

| Host | Public IP | Tailnet IP | Tailnet hostname |
|---|---|---|---|
| VPS4 (team-dashboard) | 31.220.61.14 | 100.65.70.18 | `shield-main-1` |
| VPS1 (LLM/scrape) | 31.220.61.12 | 100.67.128.51 | `shield-llm` |

Team-dashboard `.env.production` on VPS4:

```sh
EMBED_URL=http://100.67.128.51:8080
FIRECRAWL_URL=http://100.67.128.51:3002
FIRECRAWL_API_KEY=self-hosted
```

### Disable key expiry on headless servers

**Required ops policy.** Tailscale's default device-key expiry is 180 days. When the key expires on a headless server, `tailscaled` silently logs out and all Tailnet calls start timing out — the symptom is `Connect Timeout Error` on whatever the box was serving (BGE-M3, Ollama, Firecrawl, etc.) with no other signal.

For each new headless VPS joined to the Tailnet:

1. Open Tailscale admin: `https://login.tailscale.com/admin/machines`.
2. Click the device row → ⋯ menu → **Disable key expiry**.

This must currently be set on `shield-llm` and `shield-main-1`.

### Known issue resolved 2026-05-09

VPS1 (`shield-llm`) was found logged out of Tailscale (likely 180-day device-key expiry from its 2026-04-01 join). Symptom was silent timeouts when team-dashboard on VPS4 called BGE-M3 / Ollama / Firecrawl over Tailnet. Resolved via interactive `tailscale up` browser-auth flow on VPS1. Open follow-up at the time: disable key expiry on both nodes per the policy above.
