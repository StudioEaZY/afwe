#!/usr/bin/env bash
# AFWE demo.
#   Part 1: a read-only tour of the shipped demo project (it deliberately fails `verify`).
#   Part 2: the turn protocol on a throw-away copy under git: begin → assume → commit, a REDO,
#           a fix that commits, and the intent-indexed timeline.
#   Part 3: Multi-level ratchets: cross-module caller severance, dead-on-arrival exports,
#           and decision-to-code link verification.
# Usage:  scripts/demo.sh            (uses `afwe` on PATH)
#         AFWE=target/release/afwe scripts/demo.sh
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ -n "${AFWE:-}" ]; then
    AFWE_BIN="$AFWE"
elif command -v afwe >/dev/null 2>&1; then
    AFWE_BIN="afwe"
elif [ -f "$ROOT/target/debug/afwe" ]; then
    AFWE_BIN="$ROOT/target/debug/afwe"
elif [ -f "$ROOT/target/release/afwe" ]; then
    AFWE_BIN="$ROOT/target/release/afwe"
else
    AFWE_BIN="afwe"
fi
AFWE="$AFWE_BIN"
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
rm -rf "$TMP/.afwe/turns"/*
cd "$TMP" || exit 1
git init -q
git add -A
git -c user.name=demo -c user.email=demo@example.com commit -qm "demo baseline"

run $AFWE turn begin "Add a charge helper to payments" --target payments
cat > "$WORK/assume-1.json" <<'JSON'
{"intents": [{"id": "charge2", "action": "create", "targets": ["payments"], "title": "Charge helper"}],
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
import { charge2 } from './charge';
export function checkout(user: User) { return charge2(10); }
TS
run $AFWE turn commit t0002 --summary "Checkout uses charge2 (no UI, no debug log)"

step "3. Cross-boundary capability ratchet: severed callers (The t0022 bug catcher)"
run $AFWE turn begin "Refactor checkout without calling charge2" --target payments
echo '{"intents": [{"id": "decouple-charge", "action": "update", "targets": ["payments"]}]}' > "$WORK/assume-3.json"
run $AFWE turn assume t0003 --file "$WORK/assume-3.json"
# Turn touches checkout.ts and removes the call to charge2. charge.ts is completely UNTOUCHED!
cat > src/payments/checkout.ts <<'TS'
import { User } from '../identity/user';
export function checkout(user: User) { return 42; }
TS
# AFWE intercepts the severed caller across files and blocks commit with SEVERED_CAPABILITY!
run $AFWE turn commit t0003 || echo "(SEVERED_CAPABILITY intercepted — exit $? — callee went dead in untouched file)"

# Proper fix: declare the deprecation/replacement in turn assume!
cat > "$WORK/assume-3-fixed.json" <<'JSON'
{"intents": [
  {"id": "decouple-charge", "action": "update", "targets": ["payments"]},
  {"id": "deprecate-charge2", "action": "replace", "targets": ["src/payments/charge.ts"]}
]}
JSON
run $AFWE turn assume t0003 --file "$WORK/assume-3-fixed.json"
run $AFWE turn commit t0003 --summary "Decoupled charge2 with explicit replacement declaration"

step "4. Dead-on-arrival capability detection"
run $AFWE turn begin "Add uncalled zombie helper" --target payments
echo '{"intents": [{"id": "touch-checkout", "action": "update", "targets": ["payments"]}]}' > "$WORK/assume-4.json"
run $AFWE turn assume t0004 --file "$WORK/assume-4.json"
# Introduce a brand new exported function with 0 callers without declaring it
cat >> src/payments/checkout.ts <<'TS'
export function zombieFunction(x: number) { return x * 999; }
TS
run $AFWE turn commit t0004 || echo "(DEAD_ON_ARRIVAL intercepted — exit $? — new export born with 0 references)"

# Reset checkout.ts and abandon t0004
cat > src/payments/checkout.ts <<'TS'
import { User } from '../identity/user';
export function checkout(user: User) { return 42; }
TS
run $AFWE turn abandon t0004

step "5. Concurrent turn architecture: file claims & contention hard-stop"
echo "Simulating Agent A claiming src/payments/charge.ts..."
run $AFWE turn begin "Agent A: Refactor charge helper" --target payments --claim src/payments/charge.ts

echo "Simulating Agent B attempting to claim the SAME file concurrently..."
run $AFWE turn begin "Agent B: Conflicting edits to charge" --target payments --claim src/payments/charge.ts || echo "(CONTENTION intercepted: hard stop prevents two agents writing one file)"

echo "Simulating Agent B claiming a DISJOINT file in parallel..."
run $AFWE turn begin "Agent B: Add receipts module" --target payments --claim src/payments/receipt.ts

echo 'export function printReceipt(id: string) { return id; }' > src/payments/receipt.ts
run $AFWE turn commit t0005 --summary "Agent B added receipts concurrently"
run $AFWE turn commit t0004 --summary "Agent A finished charge refactor"

step "6. What the history now says"
run $AFWE timeline
run $AFWE timeline losses
run $AFWE board
run git -C "$TMP" log --format='%h %s%n    %b' -4
echo
echo "The throw-away repository is at: $TMP"
echo "Open the Studio on the shipped demo with:  cd examples/demo-project && $AFWE studio"
