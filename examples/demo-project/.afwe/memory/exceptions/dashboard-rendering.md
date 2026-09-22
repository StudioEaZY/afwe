---
id: dashboard-rendering
kind: exception
title: Dashboard rendering ignores Lighthouse budgets
status: accepted
applies_to:
- dashboard
tags:
- performance
origin: human
created: 2026-09-22
---

## Exception
The performance budget check may be skipped for `src/dashboard/**`.

## Why it is intentional
See decision `lighthouse-exception`. Two years from now another model should still not "fix" this.
