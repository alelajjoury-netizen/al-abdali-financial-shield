import { Router, type IRouter } from "express";
import { HealthCheckResponse, ReadinessCheckResponse } from "@workspace/api-zod";
import type { ReadinessUnavailable } from "@workspace/api-zod";
import { checkMongoDBReadiness } from "../lib/mongodb";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/readyz", async (_req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    await checkMongoDBReadiness();
    res.json(ReadinessCheckResponse.parse({ status: "ready" }));
  } catch {
    // Do not expose driver errors, credentials, hostnames, or connection state.
    const data: ReadinessUnavailable = { status: "unavailable" };
    res.status(503).json(data);
  }
});

export default router;
