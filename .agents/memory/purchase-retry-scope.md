---
name: Purchase retry recovery scope
description: Why uncertain purchase requests are retained per tab rather than shared between windows
---

Keep an unconfirmed purchase request within its originating tab, including across
reloads. Do not silently share its retry identity between independent windows.

**Why:** In the shared demo, two windows may represent separate deliberate attempts.
Sharing a single saved request across them could incorrectly merge those intentions.
Per-tab recovery is intentional; durable recovery after closing a tab would require
an explicit product decision about ownership and selecting among uncertain requests.

**How to apply:** Preserve this distinction when extending recovery or adding
cross-window synchronization. Shared purchase history is not permission to merge
independent in-progress forms.
