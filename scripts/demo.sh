#!/usr/bin/env bash
# AFWE demo.
#   Part 1: a read-only tour of the shipped demo project (it deliberately fails `verify`).
#   Part 2: the turn protocol on a throw-away copy under git: begin → assume → commit, a REDO,
#           a fix that commits, and the intent-indexed timeline.
# Usage:  scripts/demo.sh            (uses `afwe` on PATH)
#         AFWE=target/release/afwe scripts/demo.sh
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AFWE="${AFWE:-afwe}"
run() { echo; echo "\$ $*"; "$@"; }
step() { echo; echo "════════════════════════════════════════════════════════════════════"; echo "$*"; }

step "1. The shipped demo — read-only tour"
cd "$ROOT/examples/demo-project" || exit 1
run $AFWE status
run $AFWE pin list
run $AFWE intent list
run $AFWE verify --no-commands || echo "(exit $? — expected: the demo contains deliberate violations)"

step "2. The turn protocol on a throw-away git copy"
TMP="$(mktemp -d)"
WORK="$(mktemp -d)"            # helper files live outside the project, so they are not part of any turn
cp -r "$ROOT/examples/demo-project/." "$TMP/"
cd "$TMP" || exit 1
git init -q
git add -A
git -c user.name=demo -c user.email=demo@example.com commit -qm "demo baseline"

run $AFWE turn begin "Add a charge helper to payments" --target payments
cat > "$WORK/assume-1.json" <<'JSON'
{"intents": [{"id": "charge-helper", "action": "create", "targets": ["payments"], "title": "Charge helper"}],
 "assumptions": [{"id": "no-debugger", "text": "the new charge code has no debugger statements",
   "claim": {"type": "forbid_pattern", "pattern": "debugger", "files": ["src/payments/charge.ts"]}}]}
JSON
run $AFWE turn assume t0001 --file "$WORK/assume-1.json"
echo 'export function charge2(amount: number) { return amount * 2 }' > src/payments/charge.ts
run $AFWE turn commit t0001 --summary "Add charge2 helper"

run $AFWE turn begin "Let the checkout show the button" --target payments
echo '{"intents": [{"id": "checkout-button", "action": "update", "targets": ["payments"]}]}' > "$WORK/assume-2.json"
run $AFWE turn assume t0002 --file "$WORK/assume-2.json"
# First attempt: a UI import inside payments. AFWE refuses it (REDO) and nothing is committed.
cat > src/payments/checkout.ts <<'TS'
import { User } from '../identity/user';
import { Button } from '../ui/Button';
export function checkout(user: User) { return Button; }
TS
run $AFWE turn commit t0002 || echo "(REDO, exit $? — nothing was committed)"
# Fix: no UI import, no debug log. Now the gate passes and the turn commits.
cat > src/payments/checkout.ts <<'TS'
import { User } from '../identity/user';
export function checkout(user: User) { return user.id; }
TS
run $AFWE turn commit t0002 --summary "Checkout returns the user id (no UI, no debug log)"

step "3. What the history now says"
run $AFWE timeline
run $AFWE timeline losses
run git -C "$TMP" log --format='%h %s%n    %b' -3
echo
echo "The throw-away repository is at: $TMP"
echo "Open the Studio on the shipped demo with:  cd examples/demo-project && $AFWE studio"
