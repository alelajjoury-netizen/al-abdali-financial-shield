import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mock, test } from "node:test";
import mongoose from "mongoose";
import { connectMongoDB } from "../src/lib/mongodb.ts";
import { AccountModel, readDemoAccount } from "../src/models/Account.ts";
import { VirtualCardModel, readDemoVirtualCard } from "../src/models/VirtualCard.ts";

// Opt-in development check. Uses isolated temporary collections, never demo records.
// RUN_DEMO_DB_TESTS=1 node --experimental-strip-types --test artifacts/api-server/tests/demo-persistence.test.mjs
test("MongoDB preserves account/card edits and prevents concurrent duplicate seeds", {
  skip: process.env.RUN_DEMO_DB_TESTS !== "1",
  timeout: 30_000,
}, async () => {
  const suffix = randomUUID().replaceAll("-", "");
  const Accounts = mongoose.model(`TestAccounts${suffix}`, AccountModel.schema.clone(), `test_accounts_${suffix}`);
  const Cards = mongoose.model(`TestCards${suffix}`, VirtualCardModel.schema.clone(), `test_cards_${suffix}`);
  Cards.schema.path("accountId").options.ref = Accounts.modelName;
  try {
    await connectMongoDB();
    for (const method of ["findById", "findOneAndUpdate"]) {
      mock.method(AccountModel, method, Accounts[method].bind(Accounts));
    }
    for (const method of ["findOne", "findOneAndUpdate", "init"]) {
      mock.method(VirtualCardModel, method, Cards[method].bind(Cards));
    }
    const results = await Promise.all(Array.from({ length: 20 }, async () => {
      const account = await readDemoAccount();
      return { account, card: await readDemoVirtualCard(account._id) };
    }));
    assert.equal(await Accounts.countDocuments(), 1);
    assert.equal(await Cards.countDocuments(), 1);
    assert.ok(results.every(({ account, card }) =>
      account._id.equals(results[0].account._id) && card._id.equals(results[0].card._id)));
    const { account, card } = results[0];
    await Accounts.updateOne({ _id: account._id }, { $set: { displayName: "اسم محفوظ", balance: 432.125 } });
    await Cards.updateOne({ _id: card._id }, { $set: {
      holderName: "PERSISTED DEMO", lastFour: "1234", status: "locked",
    } });
    const before = await Accounts.findById(account._id).lean();
    const cardBefore = await Cards.findById(card._id).lean();
    // Reconnect to prove that neither connection state nor cached values own the data.
    await mongoose.disconnect();
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    const after = await readDemoAccount();
    const cardAfter = await readDemoVirtualCard(after._id);
    assert.equal(after.displayName, "اسم محفوظ");
    assert.equal(after.balance, 432.125);
    assert.equal(after.updatedAt.getTime(), before.updatedAt.getTime());
    assert.equal(cardAfter.holderName, "PERSISTED DEMO");
    assert.equal(cardAfter.lastFour, "1234");
    assert.equal(cardAfter.status, "locked");
    assert.equal(cardAfter.updatedAt.getTime(), cardBefore.updatedAt.getTime());
    assert.equal(await Accounts.countDocuments(), 1);
    assert.equal(await Cards.countDocuments(), 1);
  } finally {
    mock.restoreAll();
    if (mongoose.connection.readyState === 1) {
      for (const model of [Accounts, Cards]) {
        await model.collection.drop().catch((error) => {
          if (error.code !== 26) throw error;
        });
      }
    }
    await mongoose.disconnect();
    mongoose.deleteModel(Accounts.modelName);
    mongoose.deleteModel(Cards.modelName);
  }
});
