#!/usr/bin/env bash
# Scheduled schema resync — runs 4x daily (every 6h) via Coolify.
#
# The email-pipeline owns migrations (alembic). This pulls whatever the live
# schema is now and regenerates the client so the board never drifts from it.
# NOTE: a regenerated client only takes effect after the app restarts, so we
# restart uvicorn by exiting the container (Coolify's restart policy revives it)
# ONLY when the schema actually changed.
set -uo pipefail
cd /app

BEFORE=$(sha256sum prisma/schema.prisma | awk '{print $1}')
echo "[prisma-pull] $(date -Is) pulling schema…"
if ! prisma db pull --schema=./prisma/schema.prisma; then
  echo "[prisma-pull] db pull FAILED — leaving existing schema untouched"
  exit 1
fi
AFTER=$(sha256sum prisma/schema.prisma | awk '{print $1}')

if [[ "$BEFORE" == "$AFTER" ]]; then
  echo "[prisma-pull] schema unchanged — nothing to do"
  exit 0
fi

echo "[prisma-pull] schema CHANGED — regenerating client"
prisma generate --schema=./prisma/schema.prisma
echo "[prisma-pull] done. Restart the app to load the new client."
