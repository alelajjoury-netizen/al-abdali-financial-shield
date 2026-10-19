import mongoose, { type Schema } from "mongoose";

// Mongoose update validators validate $set values, not the final result of
// arithmetic operators. Do not read/compute/write here: that would race with
// concurrent writes. Until an atomic, result-checked write API is introduced,
// money fields may only be assigned (or unset, subject to required validators).
export function protectFinancialAmountUpdates(schema: Schema, fields: string[]) {
  function reject(path: string): never {
    const error = new mongoose.Error.ValidationError();
    error.addError(path, new mongoose.Error.ValidatorError({
      path,
      type: "unsupportedUpdate",
      message: "Financial amounts require validated assignments; computed and pipeline updates are not supported",
    }));
    throw error;
  }

  function check(update: unknown) {
    // A pipeline can replace the whole document or derive a field indirectly.
    if (Array.isArray(update)) reject(fields[0]);
    if (!update || typeof update !== "object") return;
    for (const [operator, changes] of Object.entries(update)) {
      if (!operator.startsWith("$") ||
          ["$set", "$setOnInsert", "$unset"].includes(operator)) continue;
      if (!changes || typeof changes !== "object") continue;
      const paths = Object.keys(changes);
      if (operator === "$rename") paths.push(...Object.values(changes).filter(
        (value): value is string => typeof value === "string",
      ));
      for (const field of fields) {
        if (paths.some((path) => path === field || path.startsWith(`${field}.`))) {
          reject(field);
        }
      }
    }
  }

  schema.pre(["updateOne", "updateMany", "findOneAndUpdate"], function () {
    check(this.getUpdate());
  });
  // bulkWrite does not run query middleware. Reject the whole batch before
  // any write, even for ordered:false and skipValidation:true.
  schema.pre("bulkWrite", function (operations) {
    for (const operation of operations) {
      if ("updateOne" in operation) check(operation.updateOne.update);
      if ("updateMany" in operation) check(operation.updateMany.update);
    }
  });
}
