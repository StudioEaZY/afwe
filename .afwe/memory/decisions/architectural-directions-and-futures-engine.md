---
id: architectural-directions-and-futures-engine
kind: decision
title: Architectural Directions and Futures Engine
status: accepted
applies_to:
- afwe-core
tags:
- futures
- blueprint
- verify
origin: human
created: 2026-10-08
---

Blueprint nodes support status: planned and constraints support phase: planned. Planned nodes are exempted from missing-file drift warnings, and planned constraints are evaluated as informative non-blocking notices during verify, allowing developers and agents to declare architectural intents without premature build or gate failure.