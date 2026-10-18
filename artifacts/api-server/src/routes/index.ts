import { Router, type IRouter } from "express";
import healthRouter from "./health";
import financialShieldRouter from "./financial-shield";

const router: IRouter = Router();

router.use(healthRouter);
router.use(financialShieldRouter);

export default router;
