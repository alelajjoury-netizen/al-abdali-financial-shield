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

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

- Build only the approved MVP: demo account/card, protection controls, purchase simulation with cool-down, awareness questions and postponement.
- Complete one small runnable phase at a time; explain changes. Functionality comes before visual polish.
- Never put secrets in code. Use Replit Secrets.
- Do not implement Open Banking, wearable integrations, behavioral AI, or real payments.
- Read this file before each implementation step.

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
