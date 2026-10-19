import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import mongoose from "mongoose";
import { connectMongoDB } from "../src/lib/mongodb.ts";
import { AccountModel } from "../src/models/Account.ts";
import { VirtualCardModel } from "../src/models/VirtualCard.ts";
import { FinancialTransactionModel } from "../src/models/FinancialTransaction.ts";

// Opt-in only; never use the application's own collections or demo identifiers.
test("MongoDB rejects invalid creates and updates and enforces one virtual card per account", {
  skip: process.env.RUN_MODEL_DB_TESTS !== "1",
  timeout: 60_000,
}, async (t) => {
  const suffix = randomUUID().replaceAll("-", "");
  const models = [AccountModel, VirtualCardModel, FinancialTransactionModel].map((model) =>
    mongoose.model(`ModelTest${model.modelName}${suffix}`, model.schema.clone(),
      `test_model_${model.modelName.toLowerCase()}_${suffix}`));
  const [Accounts, Cards, Transactions] = models;
  try {
    await connectMongoDB();
    await Promise.all(models.map((model) => model.init()));
    await assert.rejects(Accounts.create({ displayName: "TEST", balance: -1, limit: 100 }),
      mongoose.Error.ValidationError);
    const account = await Accounts.create({ displayName: "TEST", balance: 10.125, limit: 10 });
    const secondAccount = await Accounts.create({ displayName: "TEST 2", balance: 0, limit: 10 });
    const card = { accountId: account._id, holderName: "TEST HOLDER", lastFour: "0042" };
    await assert.rejects(Cards.create({ ...card, lastFour: "invalid" }), mongoose.Error.ValidationError);
    const attempts = await Promise.allSettled(Array.from({ length: 10 }, () => Cards.create(card)));
    const successes = attempts.filter((result) => result.status === "fulfilled");
    const failures = attempts.filter((result) => result.status === "rejected");
    assert.equal(successes.length, 1);
    assert.equal(failures.length, 9);
    for (const { reason } of failures) {
      assert.equal(reason.code, 11000);
      assert.deepEqual(reason.keyPattern, { accountId: 1 });
    }
    // The MVP index allows one card total, even if a second is not marked default.
    await assert.rejects(Cards.create({ ...card, isDefault: false }), { code: 11000 });
    await Cards.create({ ...card, accountId: secondAccount._id });
    assert.equal(await Cards.countDocuments({ accountId: account._id }), 1);
    assert.equal(await Cards.countDocuments(), 2);
    const transaction = {
      accountId: account._id, cardId: successes[0].value._id,
      merchantName: "TEST", amount: 0.001, status: "approved",
    };
    for (const invalid of [{ amount: 1.1234 }, { status: "unknown" }, { cardId: "invalid" }]) {
      await assert.rejects(Transactions.create({ ...transaction, ...invalid }), mongoose.Error.ValidationError);
    }
    assert.equal(await Transactions.countDocuments(), 0);
    const saved = await Transactions.create(transaction);
    assert.equal((await Transactions.findById(saved._id)).amount, 0.001);
    assert.equal(await Accounts.countDocuments(), 2);

    const updateCases = [
      {
        Model: Accounts,
        id: account._id,
        invalid: [
          ["balance", -0.001], ["balance", 1.1234], ["balance", 1_000_000.001],
          ["limit", -1], ["limit", 0], ["limit", 1.1234], ["limit", 10_000.001],
          ["currency", "USD"],
        ],
        valid: [
          { balance: 0, limit: 0.001 },
          { balance: 1_000_000, limit: 10_000 },
          { balance: 10.125, limit: 1.125 },
        ],
      },
      {
        Model: Cards,
        id: successes[0].value._id,
        invalid: [["status", "unknown"], ["status", "ACTIVE"]],
        valid: [{ status: "locked" }, { status: "expired" }, { status: "active" }],
      },
      {
        Model: Transactions,
        id: saved._id,
        invalid: [
          ["amount", -1], ["amount", 0], ["amount", 1.1234], ["amount", 10_000.001],
          ["status", "unknown"], ["status", "APPROVED"], ["currency", "USD"],
        ],
        valid: [
          { amount: 0.001, status: "pending_cooldown" },
          { amount: 10_000, status: "cancelled" },
          { amount: 1.125, status: "approved" },
        ],
      },
    ];
    for (const operation of ["updateOne", "findOneAndUpdate"]) {
      for (const { Model, id, invalid, valid } of updateCases) {
        // No caller-supplied runValidators: the actual cloned production schema
        // must enforce validation itself. An explicit false cannot disable it.
        for (const options of [{}, { runValidators: false }]) {
          for (const [field, value] of invalid) {
            await t.test(`${operation} ${Model.modelName}: rejects ${field}=${value} (options=${JSON.stringify(options)})`, async () => {
              const original = await Model.collection.findOne({ _id: id });
              await assert.rejects(
                Model[operation]({ _id: id }, { $set: { [field]: value } }, options),
                (error) => {
                  assert.ok(error instanceof mongoose.Error.ValidationError);
                  assert.ok(error.errors[field], `expected a validation error for ${field}`);
                  return true;
                },
              );
              // Compare the entire persisted BSON record, including timestamps.
              assert.deepEqual(await Model.collection.findOne({ _id: id }), original);
            });
          }
        }
        await t.test(`${operation} ${Model.modelName}: accepts valid changes without rounding`, async () => {
          for (const values of valid) {
            const result = await Model[operation]({ _id: id }, { $set: values });
            if (operation === "updateOne") assert.equal(result.matchedCount, 1);
            else assert.ok(result);
            const updated = await Model.collection.findOne({ _id: id });
            for (const [field, value] of Object.entries(values)) {
              assert.equal(updated[field], value);
            }
          }
        });
      }
    }
  } finally {
    try {
      if (mongoose.connection.readyState === 1) {
        await Promise.all(models.map((model) => model.collection.drop().catch((error) => {
          if (error.code !== 26) throw error;
        })));
      }
    } finally {
      await mongoose.disconnect();
      for (const model of models) mongoose.deleteModel(model.modelName);
    }
  }
});
