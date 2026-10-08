---
id: dual-context-separation-between-afwe-core-and-afwe-client
kind: decision
title: Dual-context separation between AFWE-Core and AFWE-Client
status: accepted
origin: human
created: 2026-10-08
---

Establish explicit codenames: AFWE-Core for development of the AFWE engine itself, and AFWE-Client for consumer repos initialized via afwe init. AGENTS.md block generator strictly points to .afwe/docs/ for AFWE-Client, and onboarding/init guards against overwriting the AFWE-Core AGENTS.md. Enforces mandatory post-turn docs, skill, and MCP sync obligations.