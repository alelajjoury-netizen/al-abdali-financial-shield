// Vercel owns the HTTP listener. Reuse the same Express app and /api routes
// as the managed Replit service without importing its app.listen() entrypoint.
export { default } from "../artifacts/api-server/src/app";
