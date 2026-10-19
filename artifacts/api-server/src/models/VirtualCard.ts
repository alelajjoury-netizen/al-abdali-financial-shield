import mongoose, { Schema, type InferSchemaType } from "mongoose";

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

export type VirtualCardDocument = InferSchemaType<typeof virtualCardSchema>;

export const VirtualCardModel =
  mongoose.models.VirtualCard ?? mongoose.model("VirtualCard", virtualCardSchema);
