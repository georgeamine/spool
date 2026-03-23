#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

cd "$ROOT_DIR"
pnpm --filter @spool/share-api package
node "$ROOT_DIR/apps/api/scripts/deploy-lambda.mjs"
