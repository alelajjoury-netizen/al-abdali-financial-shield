import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { protectFinancialAmountUpdates } from "./financial-amount-updates.ts";
import { rejectFinancialBatchWrites } from "./financial-batch-writes.ts";

function hasAtMostThreeDecimalPlaces(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value * 1000 - Math.round(value * 1000)) < 1e-8;
}

const dangerHoursSchema = new Schema(
  {
    enabled: { type: Boolean, required: true, default: false },
    startHour: {
      type: Number,
      required: true,
      default: 22,
      min: 0,
      max: 23,
      validate: { validator: Number.isInteger, message: "startHour must be an integer" },
    },
    endHour: {
      type: Number,
      required: true,
      default: 7,
      min: 0,
      max: 23,
      validate: { validator: Number.isInteger, message: "endHour must be an integer" },
    },
  },
  { _id: false },
);

const accountSchema = new Schema(
  {
    displayName: { type: String, required: true, trim: true, minlength: 1, maxlength: 100 },
    balance: {
      type: Number,
      required: true,
      min: 0,
      max: 1_000_000,
      validate: {
        validator: hasAtMostThreeDecimalPlaces,
        message: "balance must use no more than three decimal places",
      },
    },
    currency: { type: String, required: true, enum: ["KWD"], default: "KWD" },
    shieldMode: { type: Boolean, required: true, default: false },
    dangerHours: {
      type: dangerHoursSchema,
      required: true,
      default: () => ({}),
    },
    limit: {
      type: Number,
      required: true,
      min: 0.001,
      max: 10_000,
      validate: {
        validator: hasAtMostThreeDecimalPlaces,
        message: "limit must use no more than three decimal places",
      },
    },
  },
  { timestamps: true },
);

// Query updates do not run schema validators by default in Mongoose.
protectFinancialAmountUpdates(accountSchema, ["balance", "limit"]);
accountSchema.pre(["updateOne", "findOneAndUpdate"], function () {
  this.setOptions({ runValidators: true });
});
rejectFinancialBatchWrites(accountSchema);

export type AccountDocument = InferSchemaType<typeof accountSchema>;

export const AccountModel =
  mongoose.models.Account ?? mongoose.model("Account", accountSchema);

// A reserved ObjectId keeps the shared demo singleton safe across server instances.
export const DEMO_ACCOUNT_ID = new mongoose.Types.ObjectId("000000000000000000000001");

export async function readDemoAccount() {
  const existing = await AccountModel.findById(DEMO_ACCOUNT_ID).lean();
  if (existing) return existing;

  const now = new Date();
  try {
    return await AccountModel.findOneAndUpdate(
      { _id: DEMO_ACCOUNT_ID },
      { $setOnInsert: {
        displayName: "مستخدم الدرع",
        balance: 750,
        currency: "KWD",
        shieldMode: false,
        dangerHours: { enabled: false, startHour: 22, endHour: 7 },
        limit: 100,
        createdAt: now,
        updatedAt: now,
      } },
      { upsert: true, returnDocument: "after", runValidators: true, timestamps: false },
    ).lean();
  } catch (error) {
    if (error instanceof mongoose.mongo.MongoServerError && error.code === 11000) {
      const account = await AccountModel.findById(DEMO_ACCOUNT_ID).lean();
      if (account) return account;
    }
    throw error;
  }
}
