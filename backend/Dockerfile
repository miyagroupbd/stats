FROM python:3.12-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PRISMA_HIDE_UPDATE_MESSAGE=1 \
    PYTHONUTF8=1

# Prisma's CLI ships via npm even for prisma-client-py, so Node is needed at
# build time to run `prisma generate` (and for the scheduled `db pull`).
RUN apt-get update \
 && apt-get install -y --no-install-recommends nodejs npm postgresql-client curl \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install -r requirements.txt

# Generate the client INTO the image so the runtime container is self-contained.
# `generate` needs only the schema, not a live DB — keeps the build reproducible.
COPY prisma ./prisma
RUN prisma generate --schema=./prisma/schema.prisma

COPY app ./app
COPY scripts ./scripts
RUN chmod +x ./scripts/*.sh

ENV PORT=8000
EXPOSE 8000

CMD ["./scripts/entrypoint.sh"]
