import { Router, type IRouter } from "express";
import {
  GetProtectionSettingsResponse,
  UpdateProtectionSettingsBody,
  UpdateProtectionSettingsResponse,
} from "@workspace/api-zod";
import { databaseReady, databaseUnavailable } from "../lib/database-ready";
import { ProtectionSettingsModel, readProtectionSettings } from "../models/ProtectionSettings";

const router: IRouter = Router();

router.get("/protection-settings", async (req, res): Promise<void> => {
  if (!(await databaseReady(req, res))) return;
  try {
    const settings = await readProtectionSettings();
    res.json(GetProtectionSettingsResponse.parse(settings));
  } catch {
    databaseUnavailable(req, res);
  }
});

router.put("/protection-settings", async (req, res): Promise<void> => {
  const parsed = UpdateProtectionSettingsBody.strict().safeParse(req.body);
  // Defaults describe initial values, not permission to omit fields in a replacement.
  const requiredFields = ["enabled", "blockStartHour", "blockEndHour", "cooldownMinutes"];
  if (!parsed.success || !requiredFields.every((key) => Object.hasOwn(req.body ?? {}, key)) ||
      parsed.data.blockStartHour === parsed.data.blockEndHour) {
    res.status(400).json({ error: "أدخل ساعتين مختلفتين بين ٠ و٢٣، ومدة تهدئة صحيحة من ١ إلى ١٢٠ دقيقة، وحالة تشغيل صحيحة." });
    return;
  }
  if (!(await databaseReady(req, res))) return;
  try {
    const record = await ProtectionSettingsModel.findOneAndUpdate(
      { _id: "demo" },
      { $set: parsed.data },
      { upsert: true, returnDocument: "after", runValidators: true },
    ).lean();
    res.json(UpdateProtectionSettingsResponse.parse(record));
  } catch {
    databaseUnavailable(req, res);
  }
});

export default router;
