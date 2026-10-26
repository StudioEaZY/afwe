---
id: prob-ad-blocker-telemetry
kind: problem
title: "Brave and uBlock Origin blocking beacon telemetry"
status: accepted
applies_to:
  - behavioral-event-sink
created: 2026-10-24T12:00:00Z
---

# Brave and uBlock Origin blocking beacon telemetry

Client-side ad blockers reject POSTs to /telemetry; future revision should route through first-party reverse proxy.
