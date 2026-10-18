import { Router, type IRouter, type Request, type Response } from "express";
import {
  CreatePurchaseSimulationBody,
  CreatePurchaseSimulationResponse,
  GetDashboardResponse,
} from "@workspace/api-zod";
import { connectMongoDB } from "../lib/mongodb";
import { PurchaseSimulationModel } from "../models/PurchaseSimulation";

const router: IRouter = Router();

async function databaseReady(req: Request, res: Response): Promise<boolean> {
  try {
    await connectMongoDB();
    return true;
  } catch {
    req.log.warn("MongoDB is not configured or is unavailable");
    res.status(503).json({
      error: process.env.MONGODB_URI
        ? "تعذّر الاتصال بقاعدة البيانات. حاول مجددًا بعد قليل."
        : "يلزم إعداد اتصال MongoDB قبل حفظ محاولات الشراء.",
    });
    return false;
  }
}

function purchaseResponse(record: {
  _id: { toString(): string };
  merchantName: string;
  amount: number;
  currency: string;
  status: string;
  createdAt: Date;
}) {
  return CreatePurchaseSimulationResponse.parse({
    id: record._id.toString(),
    merchantName: record.merchantName,
    amount: record.amount,
    currency: record.currency,
    status: record.status,
    createdAt: record.createdAt,
  });
}

router.get("/dashboard", async (req, res): Promise<void> => {
  if (!(await databaseReady(req, res))) return;

  const records = await PurchaseSimulationModel.find()
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();

  res.json(GetDashboardResponse.parse({
    account: {
      displayName: "مستخدم الدرع",
      availableBalance: 750,
      currency: "KWD",
    },
    virtualCard: {
      holderName: "SAFETY SHIELD DEMO",
      lastFour: "8492",
      status: "active",
    },
    protectionEnabled: false,
    recentSimulations: records.map((record) => purchaseResponse(record as Parameters<typeof purchaseResponse>[0])),
  }));
});

router.post("/purchases/simulate", async (req, res): Promise<void> => {
  const parsed = CreatePurchaseSimulationBody.safeParse(req.body);
  if (!parsed.success || !parsed.data.merchantName.trim()) {
    res.status(400).json({ error: "أدخل اسم المتجر ومبلغًا صحيحًا أكبر من صفر." });
    return;
  }
  if (!(await databaseReady(req, res))) return;

  const record = await PurchaseSimulationModel.create({
    ...parsed.data,
    merchantName: parsed.data.merchantName.trim(),
    status: "simulated",
  });

  res.status(201).json(purchaseResponse(record));
});

export default router;
