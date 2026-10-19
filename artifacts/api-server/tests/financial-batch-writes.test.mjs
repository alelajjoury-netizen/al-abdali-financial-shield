import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import mongoose from "mongoose";
import { AccountModel } from "../src/models/Account.ts";
import { VirtualCardModel } from "../src/models/VirtualCard.ts";
import { FinancialTransactionModel } from "../src/models/FinancialTransaction.ts";

afterEach(() => mock.restoreAll());

for (const [Model, values] of [
  [AccountModel, { balance: -1 }],
  [VirtualCardModel, { status: "unknown" }],
  [FinancialTransactionModel, { amount: 1.1234, status: "unknown" }],
]) {
  test(`${Model.modelName}: batch policy stops writes regardless of validation options`, async () => {
    let writes = 0;
    for (const method of ["updateMany", "bulkWrite"]) {
      mock.method(Model.collection, method, async () => { writes++; return {}; });
    }
    for (const runValidators of [undefined, true, false]) {
      await assert.rejects(Model.updateMany({}, { $set: values }, { runValidators }),
        (error) => error instanceof mongoose.Error.ValidationError &&
          error.errors.updateMany?.kind === "unsupportedBatchWrite");
    }
    for (const ordered of [true, false]) {
      for (const skipValidation of [true, false]) {
        for (const method of ["updateOne", "updateMany"]) {
          await assert.rejects(Model.bulkWrite([
            { deleteOne: { filter: {} } },
            { [method]: { filter: {}, update: { $set: values } } },
          ], { ordered, skipValidation }),
          (error) => error instanceof mongoose.Error.ValidationError &&
            error.errors.bulkWrite?.kind === "unsupportedBatchWrite");
        }
      }
    }
    assert.equal(writes, 0);
  });
}
