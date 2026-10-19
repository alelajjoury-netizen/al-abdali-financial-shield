import mongoose, { Schema } from "mongoose";

const protectionSettingsSchema = new Schema(
  {
    _id: { type: String, default: "demo" },
    enabled: { type: Boolean, required: true, default: false },
    blockStartHour: {
      type: Number, required: true, default: 22, min: 0, max: 23,
      validate: { validator: Number.isInteger, message: "Hour must be an integer" },
    },
    blockEndHour: {
      type: Number, required: true, default: 7, min: 0, max: 23,
      validate: { validator: Number.isInteger, message: "Hour must be an integer" },
    },
    cooldownMinutes: {
      type: Number, required: true, default: 10, min: 1, max: 120,
      validate: { validator: Number.isInteger, message: "Minutes must be an integer" },
    },
  },
  { timestamps: true },
);

protectionSettingsSchema.pre("validate", function () {
  if (this.blockStartHour === this.blockEndHour) {
    this.invalidate("blockEndHour", "Start and end hours must differ");
  }
});

export const ProtectionSettingsModel = mongoose.model("ProtectionSettings", protectionSettingsSchema);

export async function readProtectionSettings() {
  // A fixed primary key prevents duplicate settings on concurrent first visits.
  return (await ProtectionSettingsModel.findById("demo").lean()) ?? {
    enabled: false, blockStartHour: 22, blockEndHour: 7, cooldownMinutes: 10,
  };
}
