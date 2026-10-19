import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { afterEach, beforeEach, mock, test } from "node:test";
import mongoose from "mongoose";
import { connectMongoDB } from "../src/lib/mongodb.ts";

// Match the bundled server's extensionless TypeScript import in this Node test.
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "./mongodb" &&
        context.parentURL === new URL("../src/lib/database-ready.ts", import.meta.url).href) {
      return nextResolve("./mongodb.ts", context);
    }
    return nextResolve(specifier, context);
  },
});
const { databaseReady } = await import("../src/lib/database-ready.ts");
hooks.deregister();

const originalEnv = process.env;
beforeEach(() => {
  // All connections are mocked; these tests need no configured database secret.
  process.env = { MONGODB_URI: "mongodb://unused.invalid/reconnect-test" };
});
afterEach(() => {
  process.env = originalEnv;
  mock.restoreAll();
});

function disconnectedDatabase() {
  const connection = { readyState: 0 };
  mock.getter(mongoose, "connection", () => connection);
  return (value) => { connection.readyState = value; };
}

function deferred() {
  const { promise, resolve, reject } = Promise.withResolvers();
  return { promise, resolve, reject };
}

test("a successful connection can reconnect after a disconnect without restarting", async () => {
  const setState = disconnectedDatabase();
  const attempts = [deferred(), deferred()];
  const connect = mock.method(mongoose, "connect", (_uri, options) => {
    assert.equal(options.serverSelectionTimeoutMS, 5000);
    setState(2);
    return attempts[connect.mock.callCount()].promise;
  });

  for (const [index, attempt] of attempts.entries()) {
    const callers = Array.from({ length: 20 }, () => connectMongoDB());
    assert.equal(connect.mock.callCount(), index + 1, "concurrent callers share one attempt");
    let settled = false;
    const all = Promise.all(callers).then(() => { settled = true; });
    await Promise.resolve();
    assert.equal(settled, false, "callers must wait for the current connection");
    setState(1);
    attempt.resolve(mongoose);
    await all;

    await connectMongoDB();
    assert.equal(connect.mock.callCount(), index + 1, "reuse a live connection");
    setState(0);
  }
});

test("a failed reconnect returns 503 for all callers and a later request can recover", async () => {
  const setState = disconnectedDatabase();
  const failure = new Error("database unavailable");
  const reconnect = deferred();
  const connect = mock.method(mongoose, "connect", async () => {
    switch (connect.mock.callCount()) {
      case 0:
      case 2:
        setState(1);
        return mongoose;
      case 1:
        return reconnect.promise;
      default:
        assert.fail("unexpected duplicate connection attempt");
    }
  });
  await connectMongoDB();
  setState(0);

  const warn = mock.fn();
  const req = { log: { warn } };
  const responses = Array.from({ length: 10 }, () => ({
    statusCode: undefined,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  }));
  const callers = responses.map((res) => databaseReady(req, res));
  assert.equal(connect.mock.callCount(), 2);
  reconnect.reject(failure);
  assert.deepEqual(await Promise.all(callers), Array(10).fill(false));
  for (const res of responses) {
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.body, {
      error: "تعذّر الوصول إلى قاعدة البيانات. لم يتم تأكيد الحفظ؛ حاول مجددًا.",
    });
  }
  assert.equal(warn.mock.callCount(), 10);

  const res = {
    status() { assert.fail("recovery must not send an error"); },
  };
  assert.equal(await databaseReady(req, res), true);
  assert.equal(connect.mock.callCount(), 3);
});
