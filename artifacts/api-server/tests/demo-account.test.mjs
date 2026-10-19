import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import mongoose from "mongoose";
import { AccountModel, DEMO_ACCOUNT_ID, readDemoAccount } from "../src/models/Account.ts";
import { VirtualCardModel, readDemoVirtualCard } from "../src/models/VirtualCard.ts";

afterEach(() => mock.restoreAll());
const query = (value) => ({ lean: async () => value });
const duplicate = () => new mongoose.mongo.MongoServerError({ code: 11000, message: "duplicate key" });

test("saved account data is returned unchanged without writing defaults", async () => {
  const saved = { _id: DEMO_ACCOUNT_ID, displayName: "اسم محفوظ", balance: 321.125, currency: "KWD" };
  mock.method(AccountModel, "findById", (id) => {
    assert.equal(id.toString(), DEMO_ACCOUNT_ID.toString());
    return query(saved);
  });
  const write = mock.method(AccountModel, "findOneAndUpdate", () => assert.fail("must not overwrite saved account"));
  assert.equal(await readDemoAccount(), saved);
  assert.equal(write.mock.callCount(), 0);
});

test("concurrent missing-account reads use one identity and insert-only defaults", async () => {
  let saved;
  mock.method(AccountModel, "findById", () => query(null));
  mock.method(AccountModel, "findOneAndUpdate", (filter, update, options) => {
    assert.equal(filter._id.toString(), DEMO_ACCOUNT_ID.toString());
    assert.deepEqual(Object.keys(update), ["$setOnInsert"]);
    assert.equal(options.upsert, true);
    assert.equal(options.timestamps, false);
    assert.equal(options.runValidators, true);
    saved ??= { _id: filter._id, ...update.$setOnInsert };
    return query(saved);
  });
  const accounts = await Promise.all(Array.from({ length: 20 }, () => readDemoAccount()));
  assert.ok(accounts.every((account) => account === saved));
  assert.equal(saved.balance, 750);
  assert.equal(saved.currency, "KWD");
  assert.equal(await new AccountModel(saved).validate(), undefined);
});

test("account first-insert collision reads the winner instead of resetting it", async () => {
  const saved = { _id: DEMO_ACCOUNT_ID, balance: 222 };
  let reads = 0;
  mock.method(AccountModel, "findById", () => query(reads++ ? saved : null));
  mock.method(AccountModel, "findOneAndUpdate", () => ({ lean: async () => { throw duplicate(); } }));
  assert.equal(await readDemoAccount(), saved);
});

test("saved card fields including locked status are returned without writes", async () => {
  const saved = { accountId: DEMO_ACCOUNT_ID, holderName: "SAVED HOLDER", lastFour: "1234", status: "locked" };
  mock.method(VirtualCardModel, "findOne", (filter) => {
    assert.equal(filter.accountId, DEMO_ACCOUNT_ID);
    return query(saved);
  });
  mock.method(VirtualCardModel, "init", () => assert.fail("no initialization needed for saved card"));
  mock.method(VirtualCardModel, "findOneAndUpdate", () => assert.fail("must not overwrite saved card"));
  assert.equal(await readDemoVirtualCard(DEMO_ACCOUNT_ID), saved);
});

test("missing-card initialization waits for its unique index and uses insert-only defaults", async () => {
  let indexReady = false;
  let saved;
  mock.method(VirtualCardModel, "findOne", () => query(null));
  mock.method(VirtualCardModel, "init", async () => { indexReady = true; });
  mock.method(VirtualCardModel, "findOneAndUpdate", (filter, update, options) => {
    assert.equal(indexReady, true);
    assert.equal(filter.accountId, DEMO_ACCOUNT_ID);
    assert.deepEqual(Object.keys(update), ["$setOnInsert"]);
    assert.equal(options.upsert, true);
    assert.equal(options.timestamps, false);
    assert.equal(options.runValidators, true);
    saved ??= { accountId: filter.accountId, ...update.$setOnInsert };
    return query(saved);
  });
  const cards = await Promise.all(Array.from({ length: 20 }, () => readDemoVirtualCard(DEMO_ACCOUNT_ID)));
  assert.ok(cards.every((card) => card === saved));
  assert.equal(saved.lastFour, "8492");
  assert.equal(saved.status, "active");
  assert.equal(await new VirtualCardModel(saved).validate(), undefined);
  assert.ok(VirtualCardModel.schema.indexes().some(([keys, options]) => keys.accountId === 1 && options.unique));
});

test("card first-insert collision reads the winner", async () => {
  const saved = { accountId: DEMO_ACCOUNT_ID, lastFour: "4321" };
  let reads = 0;
  mock.method(VirtualCardModel, "findOne", () => query(reads++ ? saved : null));
  mock.method(VirtualCardModel, "init", async () => {});
  mock.method(VirtualCardModel, "findOneAndUpdate", () => ({ lean: async () => { throw duplicate(); } }));
  assert.equal(await readDemoVirtualCard(DEMO_ACCOUNT_ID), saved);
});

test("database failures propagate without fabricated account or card data", async () => {
  const failure = new Error("database unavailable");
  const fail = () => ({ lean: async () => { throw failure; } });
  mock.method(AccountModel, "findById", fail);
  mock.method(VirtualCardModel, "findOne", fail);
  await assert.rejects(readDemoAccount(), (error) => error === failure);
  await assert.rejects(readDemoVirtualCard(DEMO_ACCOUNT_ID), (error) => error === failure);
});
