---
id: term-turn-hash
kind: terminology
title: Turn Hash
tags: [terminology, identity, integrity, protocol]
date: 2026-10-31
---

# Turn Hash

### Definition
A cryptographic hash digest (derived via BLAKE3) calculated over the deterministic content of a Turn, including its turn ID, prompt, claims, assumption manifest, and baseline tree hash.

### Why it Matters
The Turn Hash provides content-addressable identity and tamper evidence for agent executions. It prevents replay attacks, ensures that modifications cannot be injected into an in-flight Turn without invalidating the working context, and enables deterministic verification of receipts across parallel subagents.

### Example in Practice
When `afwe turn begin` runs, an initial Turn Hash is calculated and stamped onto the briefing pack. At `afwe turn commit`, the final tree digest and diff are blended into the hash, recorded into `.afwe/receipts/t0057.json`, and cited in the Git commit trailer.
