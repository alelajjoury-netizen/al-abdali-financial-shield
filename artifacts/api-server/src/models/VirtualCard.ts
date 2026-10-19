import mongoose, { Schema, type InferSchemaType } from "mongoose";
import "./Account.ts";
import { protectFinancialReferences } from "./financial-references.ts";
import { rejectFinancialBatchWrites } from "./financial-batch-writes.ts";

const virtualCardSchema = new Schema(
  {
    accountId: {
      type: Schema.Types.ObjectId,
      ref: "Account",
      required: true,
    },
    holderName: { type: String, required: true, trim: true, minlength: 1, maxlength: 100 },
    lastFour: { type: String, required: true, match: /^\d{4}$/ },
    status: {
      type: String,
      required: true,
      enum: ["active", "locked", "expired"],
      default: "active",
    },
    isDefault: { type: Boolean, required: true, default: true },
  },
  { timestamps: true },
);

// The MVP provides a single default virtual card for each account.
virtualCardSchema.index({ accountId: 1 }, { unique: true });
protectFinancialReferences(virtualCardSchema, ["accountId"]);

// Query updates do not run schema validators by default in Mongoose.
virtualCardSchema.pre(["updateOne", "findOneAndUpdate"], function () {
  this.setOptions({ runValidators: true });
});
rejectFinancialBatchWrites(virtualCardSchema);

export type VirtualCardDocument = InferSchemaType<typeof virtualCardSchema>;

export const VirtualCardModel =
  mongoose.models.VirtualCard ?? mongoose.model("VirtualCard", virtualCardSchema);

export async function readDemoVirtualCard(accountId: mongoose.Types.ObjectId) {
  const existing = await VirtualCardModel.findOne({ accountId }).lean();
  if (existing) return existing;

  // Wait for the unique accountId index before allowing concurrent first inserts.
  await VirtualCardModel.init();
  const now = new Date();
  try {
    return await VirtualCardModel.findOneAndUpdate(
      { accountId },
      { $setOnInsert: {
        holderName: "SAFETY SHIELD DEMO",
        lastFour: "8492",
        status: "active",
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      } },
      { upsert: true, returnDocument: "after", runValidators: true, timestamps: false },
    ).lean();
  } catch (error) {
    // Another server can win the first-insert race; read its saved card.
    if (error instanceof mongoose.mongo.MongoServerError && error.code === 11000) {
      const card = await VirtualCardModel.findOne({ accountId }).lean();
      if (card) return card;
    }
    throw error;
  }
}
