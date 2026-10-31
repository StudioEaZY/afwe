---
id: term-ambiguity-question
kind: terminology
title: "Ambiguity Question"
status: accepted
applies_to:
  - afwe-core
  - afwe-cli
tags:
  - confidence-bands
  - human-in-the-loop
created: 2026-10-31T14:27:00Z
---
# Ambiguity Question

## Meaning
A high-blast-radius architectural dilemma generated when system confidence falls below 85% (`afwe question list`). Instead of making an unverified guess, AFWE pauses and queues the question for human architect confirmation, persisting the resolution into memory or pins.

## Not to be confused with
- **Probing Guide**: Probing guides (85%–90%) advise agents without blocking; Ambiguity Questions (<85%) halt high-risk forks for human judgment.
