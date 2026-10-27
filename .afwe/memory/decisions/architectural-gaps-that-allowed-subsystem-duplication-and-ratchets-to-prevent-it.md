---
id: architectural-gaps-that-allowed-subsystem-duplication-and-ratchets-to-prevent-it
kind: decision
title: Architectural Gaps That Allowed Subsystem Duplication and Ratchets to Prevent It
status: accepted
tags:
- architecture-reflection
- dead-code-ratchet
- briefing-parity
- consolidation
origin: human
created: 2026-10-27
---

Post-turn architectural reflection on why AFWE failed to prevent subsystem duplication and dead code during ReBorn evolution. Key gaps identified: (1) Inter-file import ratchet only checked whole files, ignoring intra-file unreferenced exported functions (task_start, task_done, ops::workflow_*); (2) Lack of briefing-parity gate between turn.begin and context::build_context allowed naive filter to drop file globs and tags; (3) Unilateral API severance allowed returning retirement strings without pruning underlying functions or CLI commands; (4) Lack of AST clone detection allowed claims.rs to duplicate verify.rs AST/regex evaluation. Prescribes four new architectural tripwires: intra-file dead export ratchet, briefing-context parity invariant, deprecation completeness ratchet, and AST claim deduplication.