import { Router, type IRouter } from "express";
import {
  CreatePurchaseSimulationBody,
  CreatePurchaseSimulationResponse,
  GetDashboardResponse,
  GetPurchaseSimulationParams,
  DecidePurchaseSimulationParams,
  DecidePurchaseSimulationBody,
} from "@workspace/api-zod";
import { databaseReady, databaseUnavailable } from "../lib/database-ready";
import { isBlockedAt } from "../lib/purchase-protection";
import { readProtectionSettings } from "../models/ProtectionSettings";
import { PurchaseSimulationModel, createOrRecoverPurchase, PurchaseKeyConflict } from "../models/PurchaseSimulation";
import { readDemoAccount } from "../models/Account";
import { readDemoVirtualCard } from "../models/VirtualCard";

const router: IRouter = Router();

function purchaseResponse(record: {
  _id: { toString(): string };
  merchantName: string;
  amount: number;
  currency: string;
  status: string;
  createdAt: Date;
  cooldownEndsAt?: Date | null;
  decidedAt?: Date | null;
}) {
  return CreatePurchaseSimulationResponse.parse({
    id: record._id.toString(),
    merchantName: record.merchantName,
    amount: record.amount,
    currency: record.currency,
    status: record.status,
    createdAt: record.createdAt,
    cooldownEndsAt: record.cooldownEndsAt ?? null,
    decidedAt: record.decidedAt ?? null,
    serverTime: new Date(),
  });
}

router.get("/dashboard", async (req, res): Promise<void> => {
  if (!(await databaseReady(req, res))) return;

  try {
  const account = await readDemoAccount();
  const virtualCard = await readDemoVirtualCard(account._id);
  const records = await PurchaseSimulationModel.find()
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();
  const settings = await readProtectionSettings();
  const pending = await PurchaseSimulationModel.find({ status: "cooling_down" })
    .sort({ createdAt: -1 }).lean();

  res.json(GetDashboardResponse.parse({
    account: {
      displayName: account.displayName,
      availableBalance: account.balance,
      currency: account.currency,
    },
    virtualCard: {
      holderName: virtualCard.holderName,
      lastFour: virtualCard.lastFour,
      status: virtualCard.status,
    },
    protectionEnabled: settings.enabled,
    recentSimulations: records.map((record) => purchaseResponse(record as Parameters<typeof purchaseResponse>[0])),
    pendingSimulations: pending.map((record) => purchaseResponse(record as Parameters<typeof purchaseResponse>[0])),
  }));
  } catch {
    databaseUnavailable(req, res);
  }
});

router.post("/purchases/simulate", async (req, res): Promise<void> => {
  const parsed = CreatePurchaseSimulationBody.strict().safeParse(req.body);
  if (!parsed.success || !parsed.data.merchantName.trim()) {
    res.status(400).json({ error: "أدخل بيانات شراء صحيحة ومفتاح محاولة UUID صالحًا." });
    return;
  }
  if (!(await databaseReady(req, res))) return;

  try {
    // Validate even for a replay, without recomputing its protection decision.
    try {
      new Intl.DateTimeFormat("en", { timeZone: parsed.data.timeZone });
    } catch {
      res.status(400).json({ error: "المنطقة الزمنية للجهاز غير صالحة." });
      return;
    }
    const { record, created } = await createOrRecoverPurchase(parsed.data, async () => {
      const settings = await readProtectionSettings();
      const now = new Date();
      const blocked = isBlockedAt(settings, parsed.data.timeZone, now);
      return {
        status: blocked ? "cooling_down" : "simulated",
        cooldownEndsAt: blocked ? new Date(now.getTime() + settings.cooldownMinutes * 60_000) : null,
      };
    });

    res.status(created ? 201 : 200).json(purchaseResponse(record));
  } catch (error) {
    if (error instanceof PurchaseKeyConflict) {
      res.status(409).json({ error: "هذا المفتاح مرتبط بمحاولة أخرى. أعيدي إرسال بياناتها الأصلية أو ابدئي محاولة جديدة بمفتاح جديد." });
      return;
    }
    databaseUnavailable(req, res);
  }
});

router.get("/purchases/:id", async (req, res): Promise<void> => {
  const params = GetPurchaseSimulationParams.safeParse(req.params);
  if (!params.success) {
    res.status(404).json({ error: "محاولة الشراء غير موجودة." });
    return;
  }
  if (!(await databaseReady(req, res))) return;
  try {
    const record = await PurchaseSimulationModel.findById(params.data.id).lean();
    if (!record) {
      res.status(404).json({ error: "محاولة الشراء غير موجودة." });
      return;
    }
    res.json(purchaseResponse(record as Parameters<typeof purchaseResponse>[0]));
  } catch {
    databaseUnavailable(req, res);
  }
});

router.post("/purchases/:id/decision", async (req, res): Promise<void> => {
  const params = DecidePurchaseSimulationParams.safeParse(req.params);
  if (!params.success) {
    res.status(404).json({ error: "محاولة الشراء غير موجودة." });
    return;
  }
  const parsed = DecidePurchaseSimulationBody.strict().safeParse(req.body);
  if (!parsed.success || (parsed.data.action === "continue" &&
      (typeof parsed.data.isNecessary !== "boolean" ||
       typeof parsed.data.stillWantsTomorrow !== "boolean" ||
       typeof parsed.data.understandsBudgetImpact !== "boolean"))) {
    res.status(400).json({ error: "اختر قرارًا وأجب عن الأسئلة التوعوية الثلاثة قبل المتابعة." });
    return;
  }
  if (!(await databaseReady(req, res))) return;
  try {
    const now = new Date();
    const continuing = parsed.data.action === "continue";
    // One atomic transition prevents double decisions, races, and early continuation.
    const record = await PurchaseSimulationModel.findOneAndUpdate(
      {
        _id: params.data.id,
        status: "cooling_down",
        ...(continuing ? { cooldownEndsAt: { $ne: null, $lte: now } } : {}),
      },
      { $set: {
        status: continuing ? "simulated" : "postponed",
        decidedAt: now,
        ...(continuing ? { awareness: {
          isNecessary: parsed.data.isNecessary,
          stillWantsTomorrow: parsed.data.stillWantsTomorrow,
          understandsBudgetImpact: parsed.data.understandsBudgetImpact,
        } } : {}),
      } },
      { returnDocument: "after", runValidators: true },
    ).lean();
    if (!record) {
      const exists = await PurchaseSimulationModel.exists({ _id: params.data.id });
      res.status(exists ? 409 : 404).json({ error: exists
        ? "لا يمكن المتابعة قبل انتهاء التهدئة، أو تم اتخاذ قرار لهذه المحاولة بالفعل."
        : "محاولة الشراء غير موجودة." });
      return;
    }
    res.json(purchaseResponse(record as Parameters<typeof purchaseResponse>[0]));
  } catch {
    databaseUnavailable(req, res);
  }
});

export default router;
