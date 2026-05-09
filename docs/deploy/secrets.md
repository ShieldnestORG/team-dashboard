---
title: Secrets Management
summary: Master key, encryption, and strict mode
---

Team Dashboard encrypts secrets at rest using a local master key. Agent environment variables that contain sensitive values (API keys, tokens) are stored as encrypted secret references.

## Default Provider: `local_encrypted`

Secrets are encrypted with a local master key stored at:

```
~/.paperclip/instances/default/secrets/master.key
```

This key is auto-created during onboarding. The key never leaves your machine.

## Configuration

### CLI Setup

Onboarding writes default secrets config:

```sh
pnpm paperclipai onboard
```

Update secrets settings:

```sh
pnpm paperclipai configure --section secrets
```

Validate secrets config:

```sh
pnpm paperclipai doctor
```

### Environment Overrides

| Variable | Description |
|----------|-------------|
| `PAPERCLIP_SECRETS_MASTER_KEY` | 32-byte key as base64, hex, or raw string |
| `PAPERCLIP_SECRETS_MASTER_KEY_FILE` | Custom key file path |
| `PAPERCLIP_SECRETS_STRICT_MODE` | Set to `true` to enforce secret refs |

## Strict Mode

When strict mode is enabled, sensitive env keys (matching `*_API_KEY`, `*_TOKEN`, `*_SECRET`) must use secret references instead of inline plain values.

```sh
PAPERCLIP_SECRETS_STRICT_MODE=true
```

Recommended for any deployment beyond local trusted.

## Migrating Inline Secrets

If you have existing agents with inline API keys in their config, migrate them to encrypted secret refs:

```sh
pnpm secrets:migrate-inline-env         # dry run
pnpm secrets:migrate-inline-env --apply # apply migration
```

## Secret References in Agent Config

Agent environment variables use secret references:

```json
{
  "env": {
    "ANTHROPIC_API_KEY": {
      "type": "secret_ref",
      "secretId": "8f884973-c29b-44e4-8ea3-6413437f8081",
      "version": "latest"
    }
  }
}
```

The server resolves and decrypts these at runtime, injecting the real value into the agent process environment.

## Proton SMTP Token Rotation

Production alerting uses Proton Mail SMTP (`smtp.protonmail.ch:587`). The `SMTP_PASS` value is a 16-character Proton SMTP token issued from the Proton account (Settings → Email → SMTP), NOT the Proton account password — Proton blocks IMAP/SMTP password auth on the Mail Plus tier and only accepts an explicit SMTP token.

### When to rotate

- The SMTP server returns `535 5.7.8 auth failed` (the token has been revoked from Proton's side or was stale).
- Any suspected leak of `.env.production` or `/etc/egress-watch.env`.
- Routine: at least annually.

### Where the token lives

Two places must be kept in sync:

| Location | File | Read by |
|---|---|---|
| VPS4 | `/opt/team-dashboard/.env.production` (`SMTP_PASS=...`) | team-dashboard alert system inside the Docker container |
| VPS1 + VPS4 | `/etc/egress-watch.env` (mode 600 root:root, `SMTP_PASS=...`) | host-level `/usr/local/bin/egress-watch.sh` cron |

After rotation, restart the team-dashboard container on VPS4 with `docker compose up -d` to re-read the env file. The egress-watch cron picks up the change on its next 5-minute tick.

### Last rotation

**2026-05-09** — prior token was returning `535 5.7.8 auth failed` from `smtp.protonmail.ch`. New token deployed to `/etc/egress-watch.env` on both boxes and tested end-to-end (alert email delivered to `nestd@pm.me` 20:57). Known follow-up: VPS4 `/opt/team-dashboard/.env.production` may still hold the old token — verify and reapply if so, then `docker compose up -d`.
