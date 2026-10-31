---
term: Skipping Resistance
kind: concept
status: canonical
context: core-and-client
---

# Skipping Resistance

Tripwire mechanisms ensuring that agents and developers cannot bypass architectural governance by circumventing AFWE CLI calls.

## Core Tripwires (Section 6A)
- **CI Gate Trailer Check**: `afwe gate --ci` validates that git commits have valid `AFWE-Turn-Hash` and `AFWE-Turn` trailers matching recorded commit trees.
- **Unattributed Work Scanner**: Scans working tree changes and flags unmapped modifications as `UNATTRIBUTED` in the Action Queue.
- **Retroactive Attribution**: `afwe attribute <commit>` allows manual developer commits to be safely and legitimately incorporated into the AFWE audit trail.
