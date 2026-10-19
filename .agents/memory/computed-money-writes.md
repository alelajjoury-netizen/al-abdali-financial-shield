---
name: Computed money writes
description: Why arithmetic and pipeline updates are intentionally unsupported for financial amounts.
---

Reject computed money updates rather than implementing read/compute/write validation.

**Why:** No product path needed arithmetic updates when this policy was chosen. Mongoose update validators do not check final arithmetic results, and a preliminary read would introduce a concurrency race. Supporting such updates without a real requirement adds avoidable financial integrity risk.

**How to apply:** If future product work needs arithmetic money updates, design an atomic operation that constrains the final range and KWD precision before relaxing this policy. Do not merely enable runValidators or add a pre-update read.
