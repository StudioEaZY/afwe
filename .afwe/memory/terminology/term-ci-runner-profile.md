---
id: term-ci-runner-profile
term: CI Runner Profile & Cached Acquisition
kind: terminology
status: accepted
context: core-and-client
---

# CI Runner Profile & Cached Acquisition

The production CI configuration schema and binary acquisition strategy that guarantees fast, deterministic architectural gating on pull requests and pushes.

## Core Rules
1. **Configurable Runner Label**: `manifest.ci.runs_on` specifies the target runner (e.g. `blacksmith-4vcpu-ubuntu-2404`, defaulting to `ubuntu-latest`).
2. **Fixed Check Name**: The GitHub Actions job name is strictly fixed to `afwe-gate` to ensure repository branch protection requirements never break when runners or configurations shift.
3. **Fast Binary Acquisition**: Uses GitHub Actions caching (`actions/cache@v4`) and pinned prebuilt release downloads with SHA-256 checksum verification before falling back to compilation.
4. **Full History & Turn Records**: Enforces `fetch-depth: 0` and verifies that commit trailers have corresponding turn records committed in `.afwe/turns/`.
