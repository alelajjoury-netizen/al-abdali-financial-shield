import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import mongoose from "mongoose";
import { AccountModel } from "../src/models/Account.ts";
import { VirtualCardModel } from "../src/models/VirtualCard.ts";
import { FinancialTransactionModel } from "../src/models/FinancialTransaction.ts";

const accountId = new mongoose.Types.ObjectId();
const otherAccountId = new mongoose.Types.ObjectId();
const missingId = new mongoose.Types.ObjectId();
const cardId = new mongoose.Types.ObjectId();
const otherCardId = new mongoose.Types.ObjectId();
const card = () => ({ accountId, holderName: "TEST", lastFour: "0042" });
const transaction = () => ({
  accountId, cardId, merchantName: "TEST", amount: 1.125, status: "approved",
});
let writes;
let reads;
let failure;

beforeEach(() => {
  writes = [];
  reads = [];
  failure = undefined;
  // Exercise real Mongoose queries, casting and middleware; mock only the
  // database boundary. No connection and no writes to shared demo collections.
  mock.method(AccountModel.collection, "findOne", async (filter, options) => {
    reads.push({ filter, options });
    if (failure) throw failure;
    return [accountId, otherAccountId].some((id) => id.equals(filter._id))
      ? { _id: filter._id } : null;
  });
  mock.method(VirtualCardModel.collection, "findOne", async (filter, options) => {
    reads.push({ filter, options });
    if (failure) throw failure;
    const owner = filter._id?.equals(cardId) ? accountId :
      filter._id?.equals(otherCardId) ? otherAccountId : null;
    return owner && (!filter.accountId || owner.equals(filter.accountId))
      ? { _id: filter._id, accountId: owner } : null;
  });
  for (const Model of [VirtualCardModel, FinancialTransactionModel]) {
    for (const method of [
      "insertOne", "insertMany", "updateOne", "updateMany", "findOneAndUpdate",
      "replaceOne", "findOneAndReplace", "bulkWrite",
    ]) {
      mock.method(Model.collection, method, async (...args) => {
        writes.push({ Model, method, args });
        return { acknowledged: true, insertedId: args[0]?._id, matchedCount: 1 };
      });
    }
  }
});
afterEach(() => mock.restoreAll());

async function rejectsReference(action, field) {
  const before = writes.length;
  await assert.rejects(action, (error) => {
    assert.ok(error instanceof mongoose.Error.ValidationError, error.message);
    assert.ok(error.errors[field], `expected ${field} validation error`);
    return true;
  });
  assert.equal(writes.length, before, "invalid links must never reach a write");
}

for (const [Model, values, invalid] of [
  [VirtualCardModel, card, [
    ["accountId", { accountId: missingId }],
  ]],
  [FinancialTransactionModel, transaction, [
    ["accountId", { accountId: missingId }],
    ["cardId", { cardId: missingId }],
    ["cardId", { cardId: otherCardId }],
  ]],
]) {
  for (const method of ["save", "create", "insertMany", "bulkWrite"]) {
    function insert(data, options = {}) {
      if (method === "save") return new Model(data).save(options);
      if (method === "create") return Model.create(data);
      if (method === "insertMany") return Model.insertMany([data], options);
      return Model.bulkWrite([{ insertOne: { document: data } }], options);
    }
    test(`${Model.modelName}.${method}: ${method === "bulkWrite" ? "batch policy rejects even correctly owned references" : "accepts existing, correctly owned references"}`, async () => {
      // Also prove that string ObjectIds are cast before looking up references.
      const action = () => insert(Object.fromEntries(Object.entries(values()).map(([key, value]) =>
        [key, value instanceof mongoose.Types.ObjectId ? value.toString() : value])));
      if (method === "bulkWrite") {
        await rejectsReference(action, "bulkWrite");
      } else {
        await action();
        assert.equal(writes.length, 1);
      }
    });
    for (const [field, patch] of invalid) {
      test(`${Model.modelName}.${method}: rejects ${field}=${String(Object.values(patch)[0])}`, async () => {
        await rejectsReference(() => insert({ ...values(), ...patch }), field);
      });
    }
    test(`${Model.modelName}.${method}: lookup failures stop writes`, async () => {
      failure = new Error("reference lookup unavailable");
      await assert.rejects(insert(values()), (error) => error === failure);
      assert.equal(writes.length, 0);
    });
  }
}

test("disabling save validation or using lean insertMany cannot bypass reference checks", async () => {
  await rejectsReference(() => new VirtualCardModel({ ...card(), accountId: missingId })
    .save({ validateBeforeSave: false }), "accountId");
  await rejectsReference(() => FinancialTransactionModel.insertMany(
    [{ ...transaction(), cardId: otherCardId }], { lean: true, ordered: false }), "cardId");
  await rejectsReference(() => FinancialTransactionModel.bulkWrite(
    [{ insertOne: { document: { ...transaction(), cardId: otherCardId } } }],
    { skipValidation: true, ordered: false }), "cardId");
});

test("lean insertMany persists checked reference strings as BSON ObjectIds", async () => {
  await FinancialTransactionModel.insertMany([{
    ...transaction(), accountId: accountId.toString(), cardId: cardId.toString(),
  }], { lean: true });
  const stored = writes[0].args[0][0];
  assert.ok(stored.accountId instanceof mongoose.Types.ObjectId);
  assert.ok(stored.cardId instanceof mongoose.Types.ObjectId);
  assert.ok(stored.accountId.equals(accountId));
  assert.ok(stored.cardId.equals(cardId));
});

test("insertMany and bulkWrite validate every reference before writing any records", async () => {
  const invalid = { ...transaction(), cardId: missingId };
  await rejectsReference(() => FinancialTransactionModel.insertMany(
    [transaction(), invalid], { ordered: false }), "cardId");
  await rejectsReference(() => FinancialTransactionModel.bulkWrite([
    { insertOne: { document: transaction() } },
    { insertOne: { document: invalid } },
  ], { ordered: false }), "cardId");
});

for (const [Model, values, fields] of [
  [VirtualCardModel, card, ["accountId"]],
  [FinancialTransactionModel, transaction, ["accountId", "cardId"]],
]) {
  for (const method of ["updateOne", "updateMany", "findOneAndUpdate"]) {
    test(`${Model.modelName}.${method}: non-reference updates ${method === "updateMany" ? "are rejected by batch policy" : "remain supported"}`, async () => {
      const action = () => Model[method]({ _id: missingId }, { $set: { status: Model === VirtualCardModel ? "locked" : "cancelled" } });
      if (method === "updateMany") {
        await rejectsReference(action, "updateMany");
      } else {
        await action();
        assert.equal(writes.length, 1);
      }
    });
    for (const field of fields) {
      test(`${Model.modelName}.${method}: rejects ownership edits and destructive operators on ${field}`, async () => {
        for (const update of [
          { [field]: missingId }, { $set: { [field]: missingId } },
          { $unset: { [field]: 1 } }, { $rename: { [field]: "elsewhere" } },
          { $rename: { elsewhere: field } }, { $set: { [`${field}.nested`]: missingId } },
        ]) {
          await rejectsReference(() => Model[method]({ _id: missingId }, update), field);
        }
      });
    }
    test(`${Model.modelName}.${method}: rejects pipelines`, async () => {
      await rejectsReference(() => Model[method](
        {}, [{ $set: { accountId: missingId } }], { updatePipeline: true }), "accountId");
    });
    test(`${Model.modelName}.${method}: insert-only upsert validates references${method === "updateMany" ? " but remains unsupported" : ""}`, async () => {
      const { accountId: owner, ...rest } = values();
      const action = () => Model[method]({ accountId: owner }, { $setOnInsert: rest }, { upsert: true });
      if (method === "updateMany") {
        await rejectsReference(action, "updateMany");
      } else {
        await action();
        assert.equal(writes.length, 1);
      }
      await rejectsReference(() => Model[method](
        { accountId: missingId }, { $setOnInsert: rest }, { upsert: true }), "accountId");
      if (Model === FinancialTransactionModel) {
        await rejectsReference(() => Model[method](
          { accountId: owner }, { $setOnInsert: { ...rest, cardId: otherCardId } },
          { upsert: true }), "cardId");
      }
    });
  }
  test(`${Model.modelName}: saving an existing record cannot reassign ownership`, async () => {
    for (const field of fields) {
      const doc = Model.hydrate({ _id: missingId, ...values() });
      doc[field] = field === "accountId" ? otherAccountId : otherCardId;
      await rejectsReference(() => doc.save(), field);
    }
  });
  test(`${Model.modelName}: existing records can save non-reference edits`, async () => {
    const doc = Model.hydrate({ _id: missingId, ...values() });
    doc.status = Model === VirtualCardModel ? "locked" : "cancelled";
    await doc.save();
    assert.equal(writes.length, 1);
  });
  test(`${Model.modelName}: replacements and bulk reference edits cannot bypass checks`, async () => {
    for (const method of ["replaceOne", "findOneAndReplace"]) {
      await rejectsReference(() => Model[method]({ _id: missingId }, values()), "accountId");
    }
    await rejectsReference(() => Model.bulkWrite([
      { replaceOne: { filter: {}, replacement: values() } },
    ]), "accountId");
    for (const operation of ["updateOne", "updateMany"]) {
      await rejectsReference(() => Model.bulkWrite([
        { [operation]: { filter: {}, update: { $set: { accountId: otherAccountId } } } },
      ]), "accountId");
      await rejectsReference(() => Model.bulkWrite([
        { [operation]: { filter: {}, update: { $setOnInsert: values() }, upsert: true } },
      ]), "accountId");
    }
  });
}

test("save and upsert reference reads use the write session", async () => {
  // The collection boundary is mocked; no real driver session is needed.
  // Driver sessions are class instances; a plain object is cloned by Mongoose.
  const session = new (class FixtureSession { transaction = null; })();
  const doc = new FinancialTransactionModel(transaction());
  doc.$session(session);
  await doc.save();
  assert.ok(reads.length >= 2);
  assert.ok(reads.every(({ options }) => options.session === session));
  reads = [];
  await VirtualCardModel.updateOne(
    { accountId }, { $setOnInsert: card() }, { upsert: true, session });
  assert.ok(reads.every(({ options }) => options.session === session));
});
