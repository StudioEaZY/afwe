#!/usr/bin/env bash
# Walk through the demo project from the CLI.
set -uo pipefail
cd "$(dirname "$0")/../examples/demo-project"
AFWE="${AFWE:-afwe}"
run() { echo; echo "\$ $*"; "$@"; }
run $AFWE status
run $AFWE blueprint show
run $AFWE context src/dashboard/Widget.tsx
run $AFWE verify --changed src/payments/checkout.ts --no-commands
run $AFWE drift
run $AFWE proposals
run $AFWE board
run $AFWE lens show workspace-blueprint
run $AFWE workflow show add-tagging
echo; echo "Now try: $AFWE studio"
