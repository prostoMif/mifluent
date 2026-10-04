#!/usr/bin/env bash
#
# Build the Next.js app the way the Docker image does, with throwaway values
# for the variables the config demands at start-up. `npm run check` type-checks
# the web app but does not build it, and some breakage — a CSS module with a
# global selector, a client page without a Suspense boundary — only shows up
# in `next build`. The autopilot runs this after every task.
set -euo pipefail
cd "$(dirname "$0")/.."

DATABASE_URL="postgres://build:build@localhost:5432/build" \
BETTER_AUTH_SECRET="$(openssl rand -hex 32)" \
BETTER_AUTH_URL="http://localhost:3000" \
ENCRYPTION_KEY="$(openssl rand -hex 32)" \
APP_URL="http://localhost:3000" \
NEXT_TELEMETRY_DISABLED=1 \
  node node_modules/next/dist/bin/next build apps/web
