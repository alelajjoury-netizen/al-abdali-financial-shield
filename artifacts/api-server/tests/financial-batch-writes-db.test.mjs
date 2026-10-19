import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import mongoose from "mongoose";
import { connectMongoDB } from "../src/lib/mongodb.ts";
import { AccountModel } from "../src/models/Account.ts";
import { VirtualCardModel } from "../src/models/VirtualCard.ts";
import { FinancialTransactionModel } from "../src/models/FinancialTransaction.ts";

test("financial batch writes reject before changing any isolated MongoDB records", {
  skip: process.env.RUN_MODEL_DB_TESTS !== "1",
  timeout: 120_000,
}, async (t) => {
  const suffix = randomUUID().replaceAll("-", "");
  const models = [AccountModel, VirtualCardModel, FinancialTransactionModel].map((model) =>
    mongoose.model(`BatchTest${model.modelName}${suffix}`, model.schema.clone(),
      `test_batch_${model.modelName.toLowerCase()}_${suffix}`));
  const [Accounts, Cards, Transactions] = models;
  Cards.schema.path("accountId").options.ref = Accounts.modelName;
  Transactions.schema.path("accountId").options.ref = Accounts.modelName;
  Transactions.schema.path("cardId").options.ref = Cards.modelName;

  try {
    await connectMongoDB();
    await Promise.all(models.map((model) => model.init()));
    const accounts = [];
    const cards = [];
    const transactions = [];
    for (let i = 0; i < 2; i++) {
      const account = await Accounts.create({ displayName: `TEST ${i}`, balance: 10.125, limit: 10 });
      const card = await Cards.create({ accountId: account._id, holderName: "TEST", lastFour: "0042" });
      const transaction = await Transactions.create({
        accountId: account._id, cardId: card._id,
        merchantName: "TEST", amount: 1.125, status: "approved",
      });
      accounts.push(account);
      cards.push(card);
      transactions.push(transaction);
    }

    const cases = [
      {
        Model: Accounts, records: accounts,
        valid: { balance: 20.125, limit: 0.001 },
        invalid: [
          { balance: -0.001 }, { balance: 1.1234 }, { balance: 1_000_000.001 },
          { limit: 0 }, { limit: 1.1234 }, { limit: 10_000.001 }, { currency: "USD" },
        ],
      },
      {
        Model: Cards, records: cards,
        valid: { status: "locked" },
        invalid: [{ status: "unknown" }, { status: "ACTIVE" }, { lastFour: "bad" }],
      },
      {
        Model: Transactions, records: transactions,
        valid: { amount: 2.125, status: "cancelled" },
        invalid: [
          { amount: -1 }, { amount: 0 }, { amount: 1.1234 }, { amount: 10_000.001 },
          { status: "unknown" }, { status: "APPROVED" }, { currency: "USD" },
        ],
      },
    ];

    for (const { Model, records, valid, invalid } of cases) {
      await t.test(`${Model.modelName}: rejects all batch forms and preserves complete BSON records`, async () => {
        const original = await Model.collection.find().sort({ _id: 1 }).toArray();
        const unchanged = async (action) => {
          await assert.rejects(action, mongoose.Error.ValidationError);
          assert.deepEqual(await Model.collection.find().sort({ _id: 1 }).toArray(), original,
            "No record, timestamp, insertion or deletion may change after batch rejection");
        };
        // Both seeded records match: this checks real multi-record updates,
        // not just a query that happens to affect a single document.
        const filter = { _id: { $in: records.map((record) => record._id) } };
        for (const values of [...invalid, valid]) {
          for (const options of [{}, { runValidators: true }, { runValidators: false }]) {
            await unchanged(() => Model.updateMany(filter, { $set: values }, options));
          }
          for (const method of ["updateOne", "updateMany"]) {
            for (const ordered of [true, false]) {
              for (const skipValidation of [true, false]) {
                const change = { [method]: { filter, update: { $set: values } } };
                const first = { updateOne: {
                  filter: { _id: records[0]._id }, update: { $set: valid },
                } };
                await unchanged(() => Model.bulkWrite([first, change], { ordered, skipValidation }));
              }
            }
          }
        }

        const insert = records[0].toObject();
        delete insert._id;
        delete insert.__v;
        // Use a new valid owner for cards, respecting the unique account index.
        if (Model === Cards) {
          const owner = await Accounts.create({ displayName: "INSERT OWNER", balance: 1, limit: 1 });
          insert.accountId = owner._id;
        }
        const missing = { _id: new mongoose.Types.ObjectId() };
        const field = Object.keys(valid)[0];
        const updates = [
          { $unset: { [field]: 1 } },
          { $rename: { otherValue: field } },
          [{ $set: valid }],
        ];
        for (const update of updates) {
          await unchanged(() => Model.updateMany(filter, update, {
            runValidators: false, updatePipeline: true,
          }));
        }
        await unchanged(() => Model.updateMany(missing, { $setOnInsert: insert }, { upsert: true }));
        for (const ordered of [true, false]) {
          // A batch containing only valid operations is also deliberately
          // unsupported, even if it contains only inserts or deletes.
          for (const operation of [
            { insertOne: { document: insert } },
            { insertOne: { document: { ...insert, ...invalid[0] } } },
            { replaceOne: { filter, replacement: insert } },
            { deleteOne: { filter } },
            { deleteMany: { filter } },
            { updateOne: { filter: missing, update: { $setOnInsert: insert }, upsert: true } },
            ...updates.map((update) => ({ updateMany: { filter, update } })),
          ]) {
            await unchanged(() => Model.bulkWrite([
              { deleteOne: { filter: { _id: records[0]._id } } },
              operation,
            ], { ordered, skipValidation: true }));
          }
        }
        // The supported individual path still applies valid exact values.
        await Model.updateOne({ _id: records[0]._id }, { $set: valid });
        const saved = await Model.collection.findOne({ _id: records[0]._id });
        for (const [key, value] of Object.entries(valid)) assert.equal(saved[key], value);
        assert.deepEqual(await Model.collection.findOne({ _id: records[1]._id }), original[1]);
      });
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
