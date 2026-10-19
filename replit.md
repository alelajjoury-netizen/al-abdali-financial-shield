# درع الأمان المالي

نموذج ويب عربي لبنك افتراضي يساعد الشباب والموظفين الجدد على تقليل الشراء الاندفاعي. جميع الحسابات والبطاقات وعمليات الشراء تجريبية، ولا توجد عمليات دفع حقيقية.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/financial-shield run dev` — run the React client
- Required secret: `MONGODB_URI` — MongoDB Atlas connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- Product DB: MongoDB Atlas + Mongoose; do not replace it with PostgreSQL
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- Client: `artifacts/financial-shield/`
- Server: `artifacts/api-server/`
- API contract: `lib/api-spec/openapi.yaml`
- MongoDB models: `artifacts/api-server/src/models/`

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

- Shared demo dashboard, virtual card and Arabic purchase history; no real charges.
- Protection settings define device-local daily hours. Attempts started in that window wait for a server-enforced cooldown, then allow awareness answers and continuation or postponement.
- Cooldown deadlines and final decisions persist in MongoDB. Editing settings never shortens existing deadlines; postponement ends the attempt without automatic purchase later.

## User preferences

- Build only the approved MVP: demo account/card, protection controls, purchase simulation with cool-down, awareness questions and postponement.
- Complete one small runnable phase at a time; explain changes. Functionality comes before visual polish.
- Never put secrets in code. Use Replit Secrets.
- Do not implement Open Banking, wearable integrations, behavioral AI, or real payments.
- Read this file before each implementation step.

## Gotchas

- `pnpm --filter @workspace/financial-shield test:ui` runs isolated Chromium cooldown regressions (real reloads and two windows, mocked API, no database writes). See `artifacts/financial-shield/tests/README.md` for setup and coverage.
- `pnpm --filter @workspace/financial-shield test:ui:types` typechecks the UI tests and their API fixtures.
- `pnpm --filter @workspace/api-server test` runs the offline test suite; database and API integration checks remain opt-in.
- `pnpm --filter @workspace/api-server test:models` checks account/card/transaction validation without a database.
- `node --experimental-strip-types --test artifacts/api-server/tests/financial-references.test.mjs` checks reference existence, card ownership, and write-path bypass rejection without database writes. Financial ownership is fixed at creation; use insert-only upserts and field updates, not replacements or pipeline updates.
- `pnpm --filter @workspace/api-server test:models:db` checks actual MongoDB duplicate-card rejection and invalid saves in isolated temporary collections, which it removes afterward.
- `node --experimental-strip-types --test artifacts/api-server/tests/demo-account.test.mjs` checks insert-only demo initialization and error handling without database writes.
- `node --experimental-strip-types --test artifacts/api-server/tests/dashboard.test.mjs` checks the real dashboard HTTP route with isolated model fixtures, saved account/card edits, the response shape, and database-failure 503 responses without accessing shared demo data.
- `RUN_DEMO_DB_TESTS=1 node --experimental-strip-types --test artifacts/api-server/tests/demo-persistence.test.mjs` checks concurrent initialization and persistence in MongoDB using temporary isolated collections that it removes afterward.
- `node --experimental-strip-types --test artifacts/api-server/tests/purchase-protection.test.mjs` checks daily interval and timezone boundaries.
- `RUN_PURCHASE_DB_TESTS=1 node --experimental-strip-types --test artifacts/api-server/tests/purchase-idempotency-db.test.mjs` checks concurrent retry uniqueness and replay after reconnect in an isolated temporary MongoDB collection, removed afterward.
- `RUN_PURCHASE_API_TESTS=1 node --test artifacts/api-server/tests/purchase-flow.test.mjs` is an opt-in development API check through the shared proxy. It temporarily changes shared settings, waits one real minute, leaves labeled demo attempts in history, and restores settings afterward. Do not run against production or alongside active demo use.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
