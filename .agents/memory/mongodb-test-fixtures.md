---
name: MongoDB test fixtures
description: Avoid misleading route failures caused by cloning BSON values in offline tests.
---

Preserve BSON ObjectId prototypes when copying isolated model fixtures; do not use structuredClone on documents containing ObjectIds.

**Why:** structuredClone turns ObjectIds into plain objects. Identifier comparisons then fail inside an otherwise correct route and its error handler reports a misleading database-unavailable response.

**How to apply:** Use shallow copies for flat lean fixtures or explicitly reconstruct BSON values when a deep copy is necessary.
