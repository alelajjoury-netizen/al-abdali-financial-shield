import mongoose, { Schema, type InferSchemaType } from "mongoose";

const purchaseSimulationSchema = new Schema(
  {
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

export type PurchaseSimulationDocument = InferSchemaType<typeof purchaseSimulationSchema>;

export const PurchaseSimulationModel =
  mongoose.models.PurchaseSimulation ??
  mongoose.model("PurchaseSimulation", purchaseSimulationSchema);
