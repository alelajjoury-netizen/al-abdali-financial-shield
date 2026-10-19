---
name: Purchase response ordering
description: Creation replies may be older than decisions already observed through polling
---

Treat a known final purchase decision as newer than an arriving creation reply
for the same attempt, even when the creation request succeeds.

**Why:** Response arrival order is not server event order. A successful reply
can have been serialized while cooling down and held in transit while another
window saves a decision. A replay requested after that decision tests a
different race and does not reproduce this stale payload.

**How to apply:** For regression tests, capture the creation payload before
holding delivery, save the decision in another window, then hold dashboard
refreshes during delivery so they cannot conceal an incorrect cache merge.
