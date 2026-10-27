---
id: dec-container-health-checks
kind: decision
title: "Standardize container health checks"
status: accepted
applies_to:
  - "Infrastructure"
  - "Infrastructure/deploy"
created: 2026-09-02T10:00:00Z
---

# Standardize container health checks

Every service container exposes /healthz and /readyz probes verified by Terraform deploy manifests.
