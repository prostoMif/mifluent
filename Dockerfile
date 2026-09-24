# One image, two commands: the web application and the worker.
#
#   docker compose build
#
# Debian slim rather than Alpine: the local embedding model runs on
# onnxruntime, whose prebuilt binaries are linked against glibc.

FROM node:22-bookworm-slim AS deps
WORKDIR /app

# Manifests first, so the dependency layer is rebuilt only when they change.
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/delivery/package.json packages/delivery/
COPY packages/digest/package.json packages/digest/
COPY packages/discovery/package.json packages/discovery/
COPY packages/domain/package.json packages/domain/
COPY packages/embeddings/package.json packages/embeddings/
COPY packages/llm/package.json packages/llm/
COPY packages/pipeline/package.json packages/pipeline/
COPY packages/sources/package.json packages/sources/

# lefthook's install hook wants a git checkout, which a build context is not.
ENV LEFTHOOK=0
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx tsc --build \
  && node node_modules/next/dist/bin/next build apps/web \
  && cp -r apps/web/.next/static apps/web/.next/standalone/apps/web/.next/static \
  && rm -rf .cache

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

# The worker and the migration run from the built workspace (they use tsx to
# start); the web process runs from Next's self-contained output.
COPY --from=build --chown=node:node /app /app

# Mount point for the model cache volume. Created here, owned by `node`, so a
# fresh named volume inherits that ownership instead of root's.
RUN mkdir -p /models && chown node:node /models

USER node
EXPOSE 3000
CMD ["node", "apps/web/.next/standalone/apps/web/server.js"]

# Backups: the official Postgres client, plus openssl to encrypt each dump.
FROM postgres:17-alpine AS backup
RUN apk add --no-cache openssl
COPY scripts/backup.sh /usr/local/bin/mifluent-backup
RUN chmod 0755 /usr/local/bin/mifluent-backup

# Same reason as /models above: Docker creates a missing mount point as root,
# and the backup script runs as `postgres`. Without this the first dump fails
# on permission and the container restarts forever — with no backups and
# nothing obviously wrong until somebody needs one.
RUN mkdir -p /backups && chown postgres:postgres /backups

USER postgres
CMD ["mifluent-backup"]
