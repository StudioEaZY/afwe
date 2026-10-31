---
id: term-capability-bridge
kind: terminology
title: Capability Bridge
tags: [terminology, architecture, capabilities, interoperability]
date: 2026-10-31
---

# Capability Bridge

### Definition
An explicit adapter layer or interface mapping between decoupled subsystems, crates, or runtime boundaries (such as between the Rust AFWE-Core engine and the TypeScript Studio UI, or between MCP and the CLI).

### Why it Matters
Capability Bridges enforce capability contracts across language and transport boundaries. They prevent implicit API drift, validate serializable JSON-RPC schemas, and ensure that capabilities verified in the engine remain strictly aligned with user-facing tools and external clients.

### Example in Practice
The MCP server in `crates/afwe-cli/src/mcp.rs` serves as a Capability Bridge between the engine's core turn API (`crates/afwe-core/src/api.rs`) and external AI agent runners, exposing structured tools while preserving validation logic.
