---
id: term-rust-for-project-intent
kind: terminology
title: "Rust for Project Intent"
status: accepted
applies_to:
  - afwe-core
  - afwe-cli
tags:
  - architecture-philosophy
  - compiler-mental-model
created: 2026-10-31T14:27:00Z
---
# Rust for Project Intent

## Meaning
The foundational design philosophy of AFWE: applying the unforgiving, deterministic mental model of the Rust compiler to overall project architecture and intent. Under this paradigm, you can break things on purpose by declaring them explicitly in `turn assume` (`removes: [...]`), but the gate ensures you can never break things by accident.

## Not to be confused with
- **Programming Language Choice**: This refers to the architectural design philosophy of strictness and explicit declaration, regardless of what programming language the user's project uses.
