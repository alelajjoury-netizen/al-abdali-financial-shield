import assert from "node:assert/strict";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { afterEach, beforeEach, mock, test } from "node:test";
import express from "express";
import mongoose from "mongoose";
import {
  checkMongoDBReadiness,
  MONGODB_READINESS_TIMEOUT_MS,
} from "../src/lib/mongodb.ts";

const roots = [
  new URL("../src/", import.meta.url).href,
  new URL("../../../lib/api-zod/src/", import.meta.url).href,
];
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier) &&
        roots.some((root) => context.parentURL?.startsWith(root))) {
      const file = new URL(`${specifier}.ts`, context.parentURL);
      return nextResolve(existsSync(file) ? `${specifier}.ts` : `${specifier}/index.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});
let router;
try {
  ({ default: router } = await import("../src/routes/health.ts"));
} finally {
  hooks.deregister();
}

let connection;
let command;
let connect;
let server;
let base;
const originalEnv = process.env;

beforeEach(async () => {
  // No real database access, even when a workspace secret is configured.
  process.env = { ...originalEnv, MONGODB_URI: "mongodb://unused.invalid/health-test" };
  command = mock.fn(async (input, options) => {
    assert.deepEqual(input, { ping: 1 });
    assert.deepEqual(options, { timeoutMS: MONGODB_READINESS_TIMEOUT_MS });
    return { ok: 1 };
  });
  connection = { readyState: 1, db: { command } };
  mock.getter(mongoose, "connection", () => connection);
  connect = mock.method(mongoose, "connect", async () => {
    assert.fail("unexpected real connection attempt");
  });
  const app = express();
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}/api`;
});

afterEach(async () => {
  mock.timers.reset();
  try {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
  } finally {
    process.env = originalEnv;
    mock.restoreAll();
  }
});

async function get(path) {
  const response = await fetch(`${base}/${path}`);
  assert.match(response.headers.get("content-type"), /application\/json/);
  if (path === "readyz") {
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  return { status: response.status, body: await response.json() };
}

const ready = { status: 200, body: { status: "ready" } };
const unavailable = { status: 503, body: { status: "unavailable" } };

test("liveness stays independent when the database is missing", async () => {
  connection.readyState = 0;
  delete process.env.MONGODB_URI;
  assert.deepEqual(await get("healthz"), { status: 200, body: { status: "ok" } });
  assert.equal(command.mock.callCount(), 0);
  assert.equal(connect.mock.callCount(), 0);
});

test("readiness pings a connected database on every request, without writes", async () => {
  assert.deepEqual(await get("readyz"), ready);
  assert.deepEqual(await get("readyz"), ready);
  assert.equal(command.mock.callCount(), 2);
  assert.equal(connect.mock.callCount(), 0);
});

test("missing configuration returns a sanitized 503 then recovers", async () => {
  connection.readyState = 0;
  delete process.env.MONGODB_URI;
  assert.deepEqual(await get("readyz"), unavailable);
  process.env.MONGODB_URI = "mongodb://unused.invalid/health-test";
  connect.mock.mockImplementation(async () => {
    connection.readyState = 1;
    return mongoose;
  });
  assert.deepEqual(await get("readyz"), ready);
  assert.equal(connect.mock.callCount(), 1);
});

test("a rejected initial connection returns 503 and a later connection succeeds", async () => {
  connection.readyState = 0;
  connect.mock.mockImplementation(async () => {
    throw new Error("mongodb://private-user:private-password@private-host/private-db");
  });
  assert.deepEqual(await get("readyz"), unavailable);
  connect.mock.mockImplementation(async () => {
    connection.readyState = 1;
    return mongoose;
  });
  assert.deepEqual(await get("readyz"), ready);
  assert.equal(connect.mock.callCount(), 2);
});

test("ping failure on an apparently live connection returns 503 then recovers", async () => {
  command.mock.mockImplementation(async () => {
    throw new Error("private-host: authentication failed with private-password");
  });
  assert.deepEqual(await get("readyz"), unavailable);
  assert.deepEqual(await get("healthz"), { status: 200, body: { status: "ok" } });
  command.mock.mockImplementation(async () => ({ ok: 1 }));
  assert.deepEqual(await get("readyz"), ready);
});

test("a missing database handle is unavailable, not a successful readiness check", async () => {
  connection.db = undefined;
  assert.deepEqual(await get("readyz"), unavailable);
  connection.db = { command };
  assert.deepEqual(await get("readyz"), ready);
});

test("a hung ping respects the deadline and a later probe can succeed", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const pending = Promise.withResolvers();
  command.mock.mockImplementation(() => pending.promise);
  const result = assert.rejects(checkMongoDBReadiness(), /deadline exceeded/);
  await Promise.resolve();
  assert.equal(command.mock.callCount(), 1);
  mock.timers.tick(MONGODB_READINESS_TIMEOUT_MS);
  await result;
  // A late failure must be handled, not become an unhandled rejection.
  pending.reject(new Error("late ping failure"));
  command.mock.mockImplementation(async () => ({ ok: 1 }));
  await checkMongoDBReadiness();
});

test("the deadline includes connection time; a late connection does not start a ping", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  connection.readyState = 0;
  const pending = Promise.withResolvers();
  connect.mock.mockImplementation(() => pending.promise);
  const result = assert.rejects(checkMongoDBReadiness(), /deadline exceeded/);
  mock.timers.tick(MONGODB_READINESS_TIMEOUT_MS);
  await result;
  connection.readyState = 1;
  pending.resolve(mongoose);
  // Flush the connect promise and the probe's continuation.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(command.mock.callCount(), 0);
  await checkMongoDBReadiness();
  assert.equal(command.mock.callCount(), 1);
});
