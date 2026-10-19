import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, mock, test } from "node:test";
import mongoose from "mongoose";
import { PurchaseSimulationModel as Model, createOrRecoverPurchase, PurchaseKeyConflict } from "../src/models/PurchaseSimulation.ts";
import { CreatePurchaseSimulationBody } from "../../../lib/api-zod/src/generated/api.ts";

afterEach(() => mock.restoreAll());
const input = {
  idempotencyKey: randomUUID(), merchantName: "متجر تجريبي", amount: 1.25,
  currency: "KWD", timeZone: "UTC",
};
const state = { status: "cooling_down", cooldownEndsAt: new Date("2026-10-19T10:01:00Z") };
const saved = { _id: new mongoose.Types.ObjectId(), ...input, ...state };

test("the generated contract requires a UUID retry key", () => {
  assert.equal(CreatePurchaseSimulationBody.safeParse(input).success, true);
  for (const idempotencyKey of [undefined, "", "not-a-key", "a".repeat(500)]) {
    assert.equal(CreatePurchaseSimulationBody.safeParse({ ...input, idempotencyKey }).success, false);
  }
});

test("recovery preserves the deadline and terminal decision without reading new settings", async () => {
  mock.method(Model, "init", async () => {});
  const find = mock.method(Model, "findOne", async () => saved);
  mock.method(Model, "create", () => assert.fail("must not write a replay"));
  const compute = () => assert.fail("must not re-evaluate protection settings");
  const result = await createOrRecoverPurchase({ ...input, merchantName: ` ${input.merchantName} ` }, compute);
  assert.equal(result.record, saved);
  assert.equal(result.created, false);
  assert.deepEqual(find.mock.calls[0].arguments[0], { idempotencyKey: input.idempotencyKey });
  const terminal = { ...saved, status: "postponed", decidedAt: new Date() };
  find.mock.mockImplementation(async () => terminal);
  assert.equal((await createOrRecoverPurchase(input, compute)).record, terminal);
});

test("changed input cannot reuse a key", async () => {
  mock.method(Model, "init", async () => {});
  mock.method(Model, "findOne", async () => saved);
  for (const changed of [{ merchantName: "آخر" }, { amount: 2 }, { currency: "USD" }, { timeZone: "Asia/Kuwait" }]) {
    await assert.rejects(createOrRecoverPurchase({ ...input, ...changed }, () => assert.fail()), PurchaseKeyConflict);
  }
});

test("a first insert waits for the unique index and normalizes the input", async () => {
  let ready = false;
  mock.method(Model, "init", async () => { ready = true; });
  mock.method(Model, "findOne", async () => { assert.ok(ready); return null; });
  mock.method(Model, "create", async (data) => {
    assert.deepEqual(data, { ...input, ...state });
    return saved;
  });
  const result = await createOrRecoverPurchase({
    ...input, idempotencyKey: input.idempotencyKey.toUpperCase(),
    merchantName: ` ${input.merchantName} `,
  }, async () => state);
  assert.equal(result.created, true);
});

test("a concurrent insert collision recovers the winner, but database failures propagate", async () => {
  mock.method(Model, "init", async () => {});
  let reads = 0;
  mock.method(Model, "findOne", async () => ++reads === 1 ? null : saved);
  const create = mock.method(Model, "create", async () => {
    throw new mongoose.mongo.MongoServerError({ code: 11000, message: "duplicate key" });
  });
  assert.equal((await createOrRecoverPurchase(input, async () => state)).record, saved);
  const error = new Error("database unavailable");
  reads = 0;
  create.mock.mockImplementation(async () => { throw error; });
  await assert.rejects(createOrRecoverPurchase(input, async () => state), error);
});
