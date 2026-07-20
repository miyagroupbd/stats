#!/usr/bin/env bash
# Container entrypoint for the Miya Stats control-plane API.
# The email-pipeline owns the schema (alembic), so we do NOT push schema here —
# we only ensure the generated client exists, then serve.
set -uo pipefail

PORT="${PORT:-8000}"

# Belt-and-braces: if the baked client is missing for any reason, regenerate.
python -c "import prisma; prisma.Prisma()" >/dev/null 2>&1 || {
  echo "[entrypoint] regenerating prisma client…"
  prisma generate --schema=./prisma/schema.prisma || true
}

echo "[entrypoint] starting uvicorn on :${PORT}"
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT}"
