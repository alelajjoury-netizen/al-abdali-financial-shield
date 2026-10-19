import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import mongoose from "mongoose";
import { AccountModel } from "../src/models/Account.ts";
import { FinancialTransactionModel } from "../src/models/FinancialTransaction.ts";

afterEach(() => mock.restoreAll());

for (const [Model, fields] of [
  [AccountModel, ["balance", "limit"]],
  [FinancialTransactionModel, ["amount"]],
]) {
  test(`${Model.modelName}: computed updates fail before reaching MongoDB`, async () => {
    let writes = 0;
    for (const method of ["updateOne", "updateMany", "findOneAndUpdate", "bulkWrite"]) {
      mock.method(Model.collection, method, async () => { writes++; return {}; });
    }
    for (const field of fields) {
      for (const update of [
        { $inc: { [field]: -100 } },
        { $inc: { [field]: 0.0001 } },
        { $mul: { [field]: -2 } },
        { $min: { [field]: -1 } },
        { $max: { [field]: 1_000_001 } },
        { $rename: { [field]: "other" } },
        { $rename: { other: field } },
        [{ $set: { [field]: { $add: [`$${field}`, 0.0001] } } }],
        [{ $replaceWith: { [field]: -1 } }],
      ]) {
        for (const method of ["updateOne", "updateMany", "findOneAndUpdate"]) {
          await assert.rejects(Model[method]({}, update, {
            runValidators: false, updatePipeline: true,
          }), mongoose.Error.ValidationError);
        }
        for (const method of ["updateOne", "updateMany"]) {
          await assert.rejects(Model.bulkWrite([
            { [method]: { filter: {}, update } },
          ], { ordered: false, skipValidation: true }), mongoose.Error.ValidationError);
        }
      }
    }
    assert.equal(writes, 0);
  });
}
