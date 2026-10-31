---
id: term-dual-timeline-scrubber
kind: terminology
title: "Dual Timeline Scrubber"
status: accepted
applies_to:
  - studio
  - studio-timeline
tags:
  - studio-control
  - timeline
  - scrubbing
created: 2026-10-31T19:50:00Z
---
# Dual Timeline Scrubber

## Meaning
An interactive dual-point range slider in AFWE Studio (`TimelineDualScrubber.tsx`) allowing developers to bind two separate moments in codebase history (Turn A vs Turn B). It dynamically updates the active map or diff viewer to compare structural graph transformations, capability gains, or collateral losses between those moments.

## Not to be confused with
- **4D Timeline Dial**: The 4D Dial scrubs through time linearly to see the past or projected future ghost nodes; the Dual Scrubber selects a bounded range between two arbitrary turns for side-by-side comparative diffing.
