import mongoose, { type Schema } from "mongoose";

// No product flow requires batch writes. Reject the entire operation rather
// than relying on runValidators: bulkWrite skips query/save hooks, and an
// unordered batch can otherwise commit its valid operations before failing.
// Keep this policy on schemas so cloned models receive the same protection.
export function rejectFinancialBatchWrites(schema: Schema) {
  function reject(operation: string): never {
    const error = new mongoose.Error.ValidationError();
    error.addError(operation, new mongoose.Error.ValidatorError({
      path: operation,
      type: "unsupportedBatchWrite",
      message: `${operation} is not supported for financial records; use validated individual writes`,
    }));
    throw error;
  }

  schema.pre("updateMany", function () {
    reject("updateMany");
  });
  // A model hook is required: bulkWrite never invokes updateOne middleware.
  // Reject inserts/deletes too, so mixed batches cannot partially persist.
  schema.pre("bulkWrite", function () {
    reject("bulkWrite");
  });
}
