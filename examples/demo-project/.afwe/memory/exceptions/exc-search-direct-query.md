---
id: exc-search-direct-query
kind: exception
title: "Exception: Search index raw SQL read permitted during initial bulk load"
status: accepted
applies_to:
  - "Core/models"
created: 2026-10-24T12:00:00Z
---

# Exception: Search index raw SQL read permitted during initial bulk load

During seed startup, search index may execute bulk read queries directly before event sync starts.
