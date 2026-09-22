#!/usr/bin/env bash
# Frontend dev loop: engine API on :4242 (from the demo project) + Vite dev server on :5173 with /api proxy.
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT="${1:-examples/demo-project}"
cargo build
( cd "$PROJECT" && "$OLDPWD/target/debug/afwe" studio --port 4242 --no-open ) &
API=$!
trap 'kill $API' EXIT
cd apps/studio && npm run dev
