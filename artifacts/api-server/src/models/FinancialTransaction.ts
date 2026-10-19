import mongoose, { Schema, type InferSchemaType } from "mongoose";

function hasAtMostThreeDecimalPlaces(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value * 1000 - Math.round(value * 1000)) < 1e-8;
}

const financialTransactionSchema = new Schema(
  {
    accountId: {
      type: Schema.Types.ObjectId,
      ref: "Account",
      required: true,
    },
    cardId: {
      type: Schema.Types.ObjectId,
      ref: "VirtualCard",
      required: true,
    },
    merchantName: { type: String, required: true, trim: true, minlength: 1, maxlength: 80 },
    amount: {
      type: Number,
      required: true,
      min: 0.001,
      max: 10_000,
      validate: {
        validator: hasAtMostThreeDecimalPlaces,
        message: "amount must use no more than three decimal places",
      },
    },
    currency: { type: String, required: true, enum: ["KWD"], default: "KWD" },
    status: {
      type: String,
      required: true,
      enum: ["approved", "pending_cooldown", "cancelled"],
    },
    cooldownUntil: { type: Date },
  },
  { timestamps: true },
);

financialTransactionSchema.index({ accountId: 1, createdAt: -1 });
financialTransactionSchema.index({ accountId: 1, status: 1, createdAt: -1 });
financialTransactionSchema.index({ cardId: 1, createdAt: -1 });

export type FinancialTransactionDocument = InferSchemaType<typeof financialTransactionSchema>;

export const FinancialTransactionModel =
  mongoose.models.FinancialTransaction ??
  mongoose.model("FinancialTransaction", financialTransactionSchema);
