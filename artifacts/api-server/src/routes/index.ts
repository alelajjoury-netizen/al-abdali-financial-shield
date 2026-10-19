import { Router, type IRouter } from "express";
import healthRouter from "./health";
import financialShieldRouter from "./financial-shield";
import protectionSettingsRouter from "./protection-settings";

const router: IRouter = Router();

router.use(healthRouter);
router.use(financialShieldRouter);
router.use(protectionSettingsRouter);

export default router;
