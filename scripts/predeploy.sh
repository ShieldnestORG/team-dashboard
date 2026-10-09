#!/usr/bin/env bash
# predeploy.sh — verify the deploy target before SSH-ing.
#
# Usage:
#   ./scripts/predeploy.sh
#
# Exits 0 if the api domain still resolves to the expected VPS,
# exits 1 (with a loud diff) if not. Intended to be the first thing any
# deploy playbook (human or agent) runs.
#
# History: a 2026-05-09 deploy went to the wrong VPS (.12 instead of .14)
# because cached docs and agent recon both quoted the stale IP. This
# script is the cheap, dumb, always-correct check that prevents recurrence.

set -euo pipefail

EXPECTED_API_HOST="api.coherencedaddy.com"
EXPECTED_API_IP="31.220.61.14"
EXPECTED_VPS_LABEL="VPS4 (team-dashboard backend)"

actual=$(dig +short "$EXPECTED_API_HOST" | head -1)

if [ -z "$actual" ]; then
  echo "❌ predeploy: dig returned empty for $EXPECTED_API_HOST"
  echo "   Network issue or DNS misconfigured. Stop and investigate."
  exit 1
fi

if [ "$actual" != "$EXPECTED_API_IP" ]; then
  echo "❌ predeploy: $EXPECTED_API_HOST resolves to $actual"
  echo "   Expected: $EXPECTED_API_IP ($EXPECTED_VPS_LABEL)"
  echo ""
  echo "   This means infra has moved. STOP. Do NOT deploy by"
  echo "   muscle memory. Update docs/deploy/vps-cheat-sheet.md and"
  echo "   docs/deploy/production.md before continuing."
  exit 1
fi

echo "✅ predeploy: $EXPECTED_API_HOST → $actual ($EXPECTED_VPS_LABEL)"

# Run migrations against the configured DATABASE_URL before shipping a new
# image. This is the belt half of the belt+suspenders fix from 2026-05-17:
# migration 0116 shipped in code but never applied because the running
# container was reused on `docker compose up -d` and the boot-time
# auto-apply gate (PAPERCLIP_MIGRATION_AUTO_APPLY) wasn't set in VPS4's env.
# See docs/handoffs/2026-05-17-migration-0116-diagnosis.md.
#
# `pnpm db:migrate` is idempotent — no-op when nothing is pending.
#
# 2026-10-08: with DATABASE_URL unset, `pnpm db:migrate` silently falls back
# to a local embedded Postgres (port 54329) and its failure looks like a prod
# migration failure. Refuse to run without DATABASE_URL, and refuse an
# embedded-postgres target even if something else selected it.
echo ""
if [ -z "${DATABASE_URL:-}" ]; then
  echo "❌ predeploy: DATABASE_URL is empty — refusing to run migrations"
  echo "   Without it, pnpm db:migrate migrates a LOCAL embedded Postgres, not production."
  echo "   Set it from .env without eval (the URL contains '&') and without printing it:"
  echo ""
  echo "     v=\$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2-); export DATABASE_URL=\"\$v\""
  echo ""
  exit 1
fi

echo "→ predeploy: applying pending migrations against \$DATABASE_URL"
migrate_log=$(mktemp)
trap 'rm -f "$migrate_log"' EXIT
if pnpm db:migrate 2>&1 | tee "$migrate_log"; then
  if grep -q "via embedded-postgres" "$migrate_log"; then
    echo "❌ predeploy: migrations ran against a local embedded Postgres, not DATABASE_URL"
    echo "   Production was NOT migrated. Check DATABASE_URL and re-run."
    exit 1
  fi
  echo "✅ predeploy: migrations up to date"
else
  echo "❌ predeploy: migrations failed — aborting deploy"
  echo "   Investigate the migration error above before SSHing to the VPS."
  echo "   Do NOT bypass by running docker compose up directly — the image"
  echo "   will boot against a stale schema."
  exit 1
fi

echo ""
echo "   Safe to deploy. Recommended next step:"
echo ""
echo "     ssh root@$actual \"cd /opt/team-dashboard/repo && git pull && cd /opt/team-dashboard && docker compose up -d --build && docker image prune -f && docker container prune -f && docker builder prune -f\""
echo ""
echo "   The prune tail is part of the command on purpose — production.md"
echo "   says to run it after every build, and omitting it leaves dangling"
echo "   images + build cache until the Sunday 3am cron sweeps them."
echo ""
