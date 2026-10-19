import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mock, test } from "node:test";
import mongoose from "mongoose";
import { connectMongoDB } from "../src/lib/mongodb.ts";
import { PurchaseSimulationModel, createOrRecoverPurchase, PurchaseKeyConflict } from "../src/models/PurchaseSimulation.ts";

// Isolated collections only; no changes to shared settings or demo purchases.
test("MongoDB concurrent retries create one attempt and retain its original deadline after reconnect", {
  skip: process.env.RUN_PURCHASE_DB_TESTS !== "1", timeout: 30_000,
}, async () => {
  const suffix = randomUUID().replaceAll("-", "");
  const Model = mongoose.model(`TestPurchases${suffix}`, PurchaseSimulationModel.schema.clone(), `test_purchases_${suffix}`);
  try {
    await connectMongoDB();
    await Model.init();
    for (const method of ["init", "findOne", "create"]) {
      mock.method(PurchaseSimulationModel, method, Model[method].bind(Model));
    }
    const input = {
      idempotencyKey: randomUUID(), merchantName: "اختبار الإعادة", amount: 1.25,
      currency: "KWD", timeZone: "UTC",
    };
    const deadline = new Date(Date.now() + 60_000);
    const compute = async () => ({ status: "cooling_down", cooldownEndsAt: deadline });
    const attempts = await Promise.all(Array.from({ length: 20 }, () => createOrRecoverPurchase(input, compute)));
    assert.equal(attempts.filter((result) => result.created).length, 1);
    const original = attempts[0].record;
    assert.ok(attempts.every(({ record }) => record._id.equals(original._id)));
    assert.equal(await Model.countDocuments(), 1);
    // Legacy records with no key do not conflict with each other or new requests.
    const { idempotencyKey, ...legacy } = input;
    await Model.create([legacy, legacy]);
    assert.equal(await Model.countDocuments(), 3);
    await assert.rejects(createOrRecoverPurchase({ ...input, amount: 2 }, compute), PurchaseKeyConflict);
    const next = await createOrRecoverPurchase({ ...input, idempotencyKey: randomUUID() }, compute);
    assert.ok(!next.record._id.equals(original._id));
    await Model.updateOne({ _id: original._id }, { $set: { status: "postponed", decidedAt: new Date() } });
    const before = await Model.findById(original._id).lean();
    await mongoose.disconnect();
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    const replay = await createOrRecoverPurchase(input, () => assert.fail("must not read changed settings"));
    assert.equal(replay.created, false);
    assert.ok(replay.record._id.equals(original._id));
    assert.equal(replay.record.cooldownEndsAt.getTime(), deadline.getTime());
    assert.equal(replay.record.status, "postponed");
    assert.equal(replay.record.createdAt.getTime(), before.createdAt.getTime());
    assert.equal(replay.record.updatedAt.getTime(), before.updatedAt.getTime());
    assert.equal(await Model.countDocuments(), 4);
  } finally {
    mock.restoreAll();
    try {
      if (mongoose.connection.readyState === 1) {
        await Model.collection.drop().catch((error) => { if (error.code !== 26) throw error; });
      }
    } finally {
      await mongoose.disconnect();
      mongoose.deleteModel(Model.modelName);
    }
  }
});
