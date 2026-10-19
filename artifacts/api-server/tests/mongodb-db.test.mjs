import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import mongoose from "mongoose";
import { connectMongoDB } from "../src/lib/mongodb.ts";

// Node's test runner executes this file in its own process. Never import the
// server entry point or application models, or disconnect a running app.
test("real MongoDB reconnect serves concurrent callers and preserves temporary data", {
  skip: process.env.RUN_MONGODB_DB_TESTS !== "1",
  timeout: 60_000,
}, async (t) => {
  assert.ok(process.env.MONGODB_URI, "MONGODB_URI is required for this opt-in test");
  assert.equal(mongoose.connection.readyState, 0, "start with a test-only connection");

  const collectionName = `test_mongodb_reconnect_${randomUUID().replaceAll("-", "")}`;
  const document = { _id: randomUUID(), marker: "temporary reconnect fixture" };
  const events = [];
  const listeners = ["connecting", "connected", "disconnected"].map((event) => {
    const listener = () => events.push(event);
    mongoose.connection.on(event, listener);
    return [event, listener];
  });
  let collectionMayExist = false;

  t.after(async () => {
    try {
      if (collectionMayExist) {
        // An assertion may fail while disconnected. Reopen before cleanup;
        // do not silently leave fixtures behind because readyState is zero.
        await connectMongoDB();
        try {
          await mongoose.connection.db.collection(collectionName).drop();
        } catch (error) {
          if (error.code !== 26) throw error; // NamespaceNotFound is already clean.
        }
      }
    } finally {
      try {
        await mongoose.disconnect();
      } finally {
        for (const [event, listener] of listeners) {
          mongoose.connection.off(event, listener);
        }
      }
    }
  }, { timeout: 20_000 });

  const connectConcurrently = () =>
    Promise.all(Array.from({ length: 20 }, () => connectMongoDB()));

  await connectConcurrently();
  assert.equal(mongoose.connection.readyState, 1);
  assert.deepEqual(events, ["connecting", "connected"],
    "concurrent initial callers must share a single connection");
  const originalClient = mongoose.connection.getClient();
  collectionMayExist = true;
  await mongoose.connection.db.collection(collectionName).insertOne(document);
  assert.deepEqual(
    await mongoose.connection.db.collection(collectionName).findOne({ _id: document._id }),
    document,
  );

  // Close this process's real driver connection, not a mocked readyState.
  await mongoose.disconnect();
  assert.equal(mongoose.connection.readyState, 0);
  assert.deepEqual(events, ["connecting", "connected", "disconnected"]);

  const recoveredReads = await Promise.all(Array.from({ length: 20 }, async () => {
    await connectMongoDB();
    // Reacquire the collection from the reopened client, not the closed one.
    return mongoose.connection.db.collection(collectionName).findOne({ _id: document._id });
  }));
  assert.equal(mongoose.connection.readyState, 1);
  assert.notEqual(mongoose.connection.getClient(), originalClient,
    "recovery must open a new driver client in the same process");
  assert.deepEqual(events, [
    "connecting", "connected", "disconnected", "connecting", "connected",
  ], "concurrent recovery callers must share a single reconnect");
  for (const recovered of recoveredReads) assert.deepEqual(recovered, document);

  await connectConcurrently();
  assert.equal(events.length, 5, "later callers must reuse the recovered connection");
});
