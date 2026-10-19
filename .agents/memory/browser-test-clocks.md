---
name: Browser test clocks
description: Non-obvious Playwright clock interactions with React Query and multiple windows
---

Keep the browser clock running when asserting asynchronous React Query UI
updates; advance it to exercise cooldown deadlines rather than freezing all
timers while waiting for query results.

**Why:** Pausing all browser timers before loading the page also pauses React
Query's scheduled notifications. The network response can succeed while the UI
remains indefinitely on its loading state.

**How to apply:** For timer assertions, account for real elapsed browser time
when another page is opened. Install Playwright's clock once per browser context,
not once per page: it is shared across windows, and reinstalling it changes the
first page's monotonic clock. Keep API boundary timestamps explicit and do not
mistake the controlled API fixture for proof of server-side enforcement.
