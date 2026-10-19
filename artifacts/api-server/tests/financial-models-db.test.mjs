import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import mongoose from "mongoose";
import { connectMongoDB } from "../src/lib/mongodb.ts";
import { AccountModel } from "../src/models/Account.ts";
import { VirtualCardModel } from "../src/models/VirtualCard.ts";
import { FinancialTransactionModel } from "../src/models/FinancialTransaction.ts";

// Opt-in only; never use the application's own collections or demo identifiers.
test("MongoDB rejects invalid records and enforces one virtual card per account", {
  skip: process.env.RUN_MODEL_DB_TESTS !== "1",
  timeout: 30_000,
}, async () => {
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
