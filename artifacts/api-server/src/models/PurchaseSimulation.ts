import mongoose, { Schema, type InferSchemaType } from "mongoose";

const purchaseSimulationSchema = new Schema(
  {
    // Optional only for historical records created before retry keys existed.
    idempotencyKey: { type: String, match: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i },
    merchantName: { type: String, required: true, trim: true, maxlength: 80 },
    amount: { type: Number, required: true, min: 0.001, max: 10000 },
    currency: { type: String, required: true, enum: ["KWD"] },
    status: { type: String, required: true, enum: ["simulated", "cooling_down", "postponed"], default: "simulated" },
    cooldownEndsAt: { type: Date, default: null },
    decidedAt: { type: Date, default: null },
    timeZone: { type: String },
    awareness: {
      isNecessary: { type: Boolean },
      fitsBudget: { type: Boolean },
    },
  },
  { timestamps: true },
);

purchaseSimulationSchema.index({ createdAt: -1 });
purchaseSimulationSchema.index({ status: 1, createdAt: -1 });
purchaseSimulationSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });

export type PurchaseSimulationDocument = InferSchemaType<typeof purchaseSimulationSchema>;

export const PurchaseSimulationModel =
  mongoose.models.PurchaseSimulation ??
  mongoose.model("PurchaseSimulation", purchaseSimulationSchema);

type PurchaseInput = {
  idempotencyKey: string;
  merchantName: string;
  amount: number;
  currency: string;
  timeZone: string;
};

export class PurchaseKeyConflict extends Error {}

/** MongoDB's unique index arbitrates across processes, not an in-memory lock.
 * Only inserts evaluate settings; recovery never mutates the original attempt.
 */
export async function createOrRecoverPurchase(
  input: PurchaseInput,
  initialState: () => Promise<{ status: "cooling_down" | "simulated"; cooldownEndsAt: Date | null }>,
) {
  const normalized = {
    ...input, merchantName: input.merchantName.trim(),
    idempotencyKey: input.idempotencyKey.toLowerCase(),
  };
  // Do not accept writes before the uniqueness constraint is ready.
  await PurchaseSimulationModel.init();
  const recover = (record: PurchaseSimulationDocument & { _id: mongoose.Types.ObjectId }) => {
    if (record.merchantName !== normalized.merchantName || record.amount !== normalized.amount ||
        record.currency !== normalized.currency || record.timeZone !== normalized.timeZone) {
      throw new PurchaseKeyConflict("This key belongs to a different purchase input");
    }
    return { record, created: false };
  };
  const existing = await PurchaseSimulationModel.findOne({ idempotencyKey: normalized.idempotencyKey });
  if (existing) return recover(existing);
  const state = await initialState();
  try {
    const record = await PurchaseSimulationModel.create({ ...normalized, ...state });
    return { record, created: true };
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== 11000) throw error;
    const winner = await PurchaseSimulationModel.findOne({ idempotencyKey: normalized.idempotencyKey });
    if (!winner) throw error;
    return recover(winner);
  }
}
