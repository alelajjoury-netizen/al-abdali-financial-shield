# Purchase cooldown UI regression tests

Run from the workspace root:

```sh
pnpm --filter @workspace/financial-shield test:ui:types
pnpm --filter @workspace/financial-shield test:ui
```

On machines without Replit's system Chromium, first run:

```sh
pnpm --filter @workspace/financial-shield exec playwright install chromium
```

Alternatively, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to an installed browser.
Chromium's system dependencies must be available on the host.

## Isolation

Playwright starts a dedicated frontend on port 4173 and shuts it down afterward.
It does not start or call the API server. Context-wide request routing intercepts
every `/api/` request, including requests from the second window. Unrecognized
API requests fail the test. Each test gets fresh in-memory responses matching the
generated API types. No MongoDB connection, credentials, shared settings changes,
real-minute waits, or persistent demo purchases are needed.

The actual home page, cooldown component, generated fetch/hooks, and React Query
cache run in Chromium. Reloads are real document reloads; second-window decisions
use a second page in the same browser context and the real decision buttons.

## Coverage

- Lost creation responses retain their request key across reload and retry; recovery
  keeps the original deadline and deduplicates the UI. Double submissions are blocked;
  explicit new attempts and attempts after confirmed success receive fresh keys.

- Create a purchase and reload during cooldown: remaining time is neither reset
  nor skipped. A device wall-clock jump cannot bypass the monotonic countdown.
- The countdown boundary unlocks the questions, but continuation remains disabled
  with zero or only one answer. Two “no” answers send explicit `false` values.
- Reload after expiry restores the unresolved attempt without automatically
  deciding it. Unsubmitted answers reset; saved decisions persist in history.
- Postpone before expiry without answering; verify the pending card disappears
  and the postponed history status survives reload.
- Server and network save failures keep the attempt and answers available for
  retry. Both decision buttons are disabled while the save is in flight.
- Failed postponement is not displayed as successful, survives reload as pending,
  and can subsequently be saved.
- Externally changed protection settings leave an existing deadline intact.
- A decision from another window reaches the first window through polling, for
  both continue and postpone. A stale-window conflict refreshes the saved result.

The API responses are a controlled boundary, not an assertion of server
enforcement or database durability. Those belong to the server tests in
`artifacts/api-server/tests/`. Account/card/transaction forms are out of scope.

Failure traces and browser artifacts are written under the ignored
`generated-artifacts/financial-shield-ui/` directory.
