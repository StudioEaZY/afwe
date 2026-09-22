#!/usr/bin/env bash
# Build everything that can be built headlessly: Studio frontend → embedded into the `afwe` binary.
set -euo pipefail
cd "$(dirname "$0")/.."

if command -v npm >/dev/null 2>&1; then
  echo "▶ building Studio frontend"
  (cd apps/studio && npm install --no-audit --no-fund && npm run build)
else
  echo "▷ npm not found — using the pre-built apps/studio/web-dist"
fi

echo "▶ building afwe (release)"
cargo build --release
echo "✓ target/release/afwe"
