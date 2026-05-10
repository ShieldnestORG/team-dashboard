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
echo "   Safe to deploy. Recommended next step:"
echo ""
echo "     ssh root@$actual \"cd /opt/team-dashboard/repo && git pull && cd /opt/team-dashboard && docker compose up -d --build\""
echo ""
