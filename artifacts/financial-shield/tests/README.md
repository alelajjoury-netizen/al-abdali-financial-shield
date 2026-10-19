# Isolated UI regression tests

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

The protection-settings tests use a separate settings-only API fixture. Reads and
writes, including failures and delayed responses, stay in memory. Unexpected
requests (including purchase creation) fail the test. To run only these tests:

```sh
pnpm --filter @workspace/financial-shield test:ui protection-settings.spec.ts
```

## Coverage

### Protection settings

- Initial loading offers no editable defaults; HTTP and network failures show an
  error, and explicit reload retrieves the saved values without a write.
- HTTP and network save failures retain all four edited fields, show no success
  or false dashboard shield state, and retry sends the same typed payload.
  Confirmed saves update the shield status and survive a real page reload.
- A held save disables save, cancel, and every field; additional pointer clicks
  do not duplicate writes, and no success is announced until confirmation.
- Polling refreshes an untouched form without enabling save. Polling cannot
  overwrite a local draft; cancelling reveals the latest server values.
- A real save from a second window reaches the API fixture without overwriting
  the first window's unsaved edits when it polls.

### Purchase cooldown and retries

- A full ten-entry history does not hide an older pending attempt. It survives
  cooldown expiry and reloads; continuing or postponing it preserves all ten
  recent rows and the other pending card, including after refetch and reload.

- Lost creation responses retain their request key across reload and retry; recovery
  keeps the original deadline and deduplicates the UI. Double submissions are blocked;
  explicit new attempts and attempts after confirmed success receive fresh keys.
- If another window continues or postpones before a lost-response retry, recovery
  shows the saved final decision once with the correct confirmation. Held dashboard
  reads verify that the retry itself removes pending UI; passing the original
  deadline and reloading never reopens a timer or awareness questions.
- An already serialized successful creation reply can arrive with an old
  `cooling_down` state after another window saves a decision. Once polling has
  delivered that decision, releasing the stale reply with dashboard reads held
  cannot overwrite it or reopen actionable controls. Both final decisions
  survive refetch, the original deadline, and reload without another creation.

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
