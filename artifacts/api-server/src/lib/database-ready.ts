import type { Request, Response } from "express";
import { connectMongoDB } from "./mongodb";

export function databaseUnavailable(req: Request, res: Response): void {
  req.log.warn("MongoDB is not configured or is unavailable");
  res.status(503).json({ error: "تعذّر الوصول إلى قاعدة البيانات. لم يتم تأكيد الحفظ؛ حاول مجددًا." });
}

export async function databaseReady(req: Request, res: Response): Promise<boolean> {
  try {
    await connectMongoDB();
    return true;
  } catch {
    databaseUnavailable(req, res);
    return false;
  }
}
