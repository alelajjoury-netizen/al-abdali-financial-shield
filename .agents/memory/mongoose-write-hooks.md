---
name: Mongoose write hook constraints
description: Session visibility limitations of insertMany hooks in the installed Mongoose version.
---

Do not assume an `insertMany` pre-hook receives the caller's options or session in Mongoose 9.11, even though its TypeScript declaration permits an options argument.

**Why:** The installed implementation invokes the hook with documents only. A reference lookup from that hook cannot see account/card records created but not yet committed in the caller's transaction. It rejects safely, but prevents a valid multi-record transaction from succeeding.

**How to apply:** When adding transactional financial writes, explicitly propagate the session through a supported write service or use document saves, which expose the session. Verify with real isolated MongoDB transactions, not just a mocked session.
