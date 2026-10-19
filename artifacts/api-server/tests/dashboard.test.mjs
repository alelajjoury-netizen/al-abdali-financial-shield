import assert from "node:assert/strict";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { afterEach, beforeEach, mock, test } from "node:test";
import express from "express";
import mongoose from "mongoose";

// Match esbuild's extensionless local TypeScript resolution without changing
// production imports. Restrict the hook to the server and generated contract.
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
  ({ default: router } = await import("../src/routes/financial-shield.ts"));
} finally {
  hooks.deregister();
}
const { AccountModel, DEMO_ACCOUNT_ID } = await import("../src/models/Account.ts");
const { VirtualCardModel } = await import("../src/models/VirtualCard.ts");
const { ProtectionSettingsModel } = await import("../src/models/ProtectionSettings.ts");
const { PurchaseSimulationModel } = await import("../src/models/PurchaseSimulation.ts");

const unavailable = {
  error: "تعذّر الوصول إلى قاعدة البيانات. لم يتم تأكيد الحفظ؛ حاول مجددًا.",
};
// Shallow-copy lean fixtures: structuredClone strips ObjectId's prototype.
const query = (value) => ({ lean: async () => ({ ...value }) });
let savedAccount;
let savedCard;
let server;
let base;
let warn;

beforeEach(async () => {
  // All model reads and connection attempts are intercepted. No real database
  // or shared demo documents are read or written, even with a configured URI.
  mock.getter(mongoose, "connection", () => ({ readyState: 1 }));
  mock.method(mongoose, "connect", () => assert.fail("must not connect to a real database"));
  savedAccount = {
    _id: DEMO_ACCOUNT_ID, displayName: "حساب الاختبار المعزول",
    balance: 432.125, currency: "KWD",
  };
  savedCard = {
    accountId: DEMO_ACCOUNT_ID, holderName: "ISOLATED HOLDER",
    lastFour: "0123", status: "locked",
  };
  mock.method(AccountModel, "findById", (id) => {
    assert.equal(id.toString(), DEMO_ACCOUNT_ID.toString());
    return query(savedAccount);
  });
  mock.method(VirtualCardModel, "findOne", ({ accountId }) => {
    assert.equal(accountId.toString(), DEMO_ACCOUNT_ID.toString());
    return query(savedCard);
  });
  for (const model of [AccountModel, VirtualCardModel]) {
    mock.method(model, "findOneAndUpdate", () => assert.fail("must not reset saved data"));
  }
  mock.method(ProtectionSettingsModel, "findById", () => query({ enabled: true }));
  mock.method(PurchaseSimulationModel, "find", () => {
    const result = { sort: () => result, limit: () => result, lean: async () => [] };
    return result;
  });

  warn = mock.fn();
  const app = express();
  app.use((req, _res, next) => { req.log = { warn }; next(); });
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  try {
    if (server) {
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
    }
  } finally {
    server = undefined;
    mock.restoreAll();
  }
});

async function dashboard() {
  const response = await fetch(`${base}/api/dashboard`);
  assert.match(response.headers.get("content-type"), /application\/json/);
  return { status: response.status, body: await response.json() };
}

test("GET /api/dashboard reflects isolated saved account/card edits with the exact response shape", async () => {
  assert.deepEqual(await dashboard(), {
    status: 200,
    body: {
      account: {
        displayName: "حساب الاختبار المعزول", availableBalance: 432.125, currency: "KWD",
      },
      virtualCard: { holderName: "ISOLATED HOLDER", lastFour: "0123", status: "locked" },
      protectionEnabled: true,
      recentSimulations: [],
      pendingSimulations: [],
    },
  });

  // A second request must observe edits, not seed defaults or cached values.
  Object.assign(savedAccount, { displayName: "اسم معدل محفوظ", balance: 0 });
  Object.assign(savedCard, { holderName: "UPDATED HOLDER", lastFour: "9876", status: "expired" });
  assert.deepEqual(await dashboard(), {
    status: 200,
    body: {
      account: { displayName: "اسم معدل محفوظ", availableBalance: 0, currency: "KWD" },
      virtualCard: { holderName: "UPDATED HOLDER", lastFour: "9876", status: "expired" },
      protectionEnabled: true,
      recentSimulations: [],
      pendingSimulations: [],
    },
  });
  assert.equal(warn.mock.callCount(), 0);
});

test("GET /api/dashboard limits recent history to ten without truncating older pending attempts", async () => {
  const start = Date.parse("2026-10-19T10:00:00.000Z");
  const records = Array.from({ length: 24 }, (_, index) => ({
    _id: new mongoose.Types.ObjectId(),
    merchantName: `Isolated purchase ${index}`,
    amount: index + 1,
    currency: "KWD",
    status: index < 10 && index % 2 === 1 ? "simulated" : "cooling_down",
    createdAt: new Date(start - index * 60_000),
    cooldownEndsAt: new Date(start + 60_000),
    decidedAt: null,
  }));
  mock.method(PurchaseSimulationModel, "find", (filter = {}) => {
    let selected = records.filter((record) => Object.entries(filter)
      .every(([key, value]) => record[key] === value)).reverse();
    const result = {
      sort: (order) => {
        assert.deepEqual(order, { createdAt: -1 });
        selected.sort((a, b) => b.createdAt - a.createdAt);
        return result;
      },
      limit: (count) => {
        selected = selected.slice(0, count);
        return result;
      },
      lean: async () => selected.map((record) => ({ ...record })),
    };
    return result;
  });

  const { status, body } = await dashboard();
  assert.equal(status, 200);
  const ids = (items) => items.map((item) => (item._id ?? item.id).toString());
  const expectedPending = records.filter((record) => record.status === "cooling_down");
  assert.equal(expectedPending.length, 19);
  assert.equal(body.recentSimulations.length, 10);
  assert.deepEqual(ids(body.recentSimulations), ids(records.slice(0, 10)));
  assert.deepEqual(ids(body.pendingSimulations), ids(expectedPending));
  assert.ok(body.pendingSimulations.every((item) => item.status === "cooling_down"));
  const oldestId = records.at(-1)._id.toString();
  assert.ok(!ids(body.recentSimulations).includes(oldestId));
  assert.ok(ids(body.pendingSimulations).includes(oldestId));
  assert.equal(warn.mock.callCount(), 0);
});

test("GET /api/dashboard returns 503 when database readiness fails, without reading demo data", async () => {
  // Force readiness failure without accessing or replacing any secret.
  mock.getter(mongoose, "connection", () => { throw new Error("database unavailable"); });
  mock.method(AccountModel, "findById", () => assert.fail("must stop before reading account"));
  assert.deepEqual(await dashboard(), { status: 503, body: unavailable });
  assert.equal(warn.mock.callCount(), 1);
});

for (const [label, model, method] of [
  ["account", AccountModel, "findById"],
  ["card", VirtualCardModel, "findOne"],
  ["history", PurchaseSimulationModel, "find"],
  ["settings", ProtectionSettingsModel, "findById"],
]) {
  test(`GET /api/dashboard returns 503, not static data, when the ${label} read fails`, async () => {
    // Readiness succeeds but the query itself fails (e.g. a lost connection).
    mock.method(model, method, () => {
      const result = {
        sort: () => result,
        limit: () => result,
        lean: async () => { throw new Error("database read unavailable"); },
      };
      return result;
    });
    assert.deepEqual(await dashboard(), { status: 503, body: unavailable });
    assert.equal(warn.mock.callCount(), 1);
  });
}
