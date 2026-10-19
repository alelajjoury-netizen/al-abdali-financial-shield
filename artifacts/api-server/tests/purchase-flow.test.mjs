import assert from "node:assert/strict";
import { test } from "node:test";

// Opt-in: this exercises the shared development demo and restores its settings.
// RUN_PURCHASE_API_TESTS=1 node --test artifacts/api-server/tests/purchase-flow.test.mjs
test("saved cooldown, awareness, postponement and atomic final decisions", {
  skip: process.env.RUN_PURCHASE_API_TESTS !== "1",
  timeout: 100_000,
}, async () => {
  const base = "http://localhost:80/api";
  async function request(path, method = "GET", body) {
    const response = await fetch(`${base}${path}`, {
      method, headers: { "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, data: await response.json() };
  }
  const original = await request("/protection-settings");
  assert.equal(original.status, 200);
  const initialDashboard = await request("/dashboard");
  assert.equal(initialDashboard.status, 200);
  const originalBalance = initialDashboard.data.account.availableBalance;
  const attempts = [];
  const hour = new Date().getUTCHours();
  const settings = { enabled: true, blockStartHour: hour, blockEndHour: (hour + 1) % 24, cooldownMinutes: 1 };
  const input = { merchantName: "اختبار محاكاة التهدئة", amount: 1.25, currency: "KWD", timeZone: "UTC" };
  const answers = { action: "continue", isNecessary: false, fitsBudget: false };
  async function create() {
    const result = await request("/purchases/simulate", "POST", input);
    assert.equal(result.status, 201);
    attempts.push(result.data.id);
    return result.data;
  }
  try {
    assert.equal((await request("/protection-settings", "PUT", settings)).status, 200);
    const purchase = await create();
    assert.equal(purchase.status, "cooling_down");
    const duration = Date.parse(purchase.cooldownEndsAt) - Date.parse(purchase.serverTime);
    assert.ok(duration > 55_000 && duration <= 60_000);
    const saved = await request(`/purchases/${purchase.id}`);
    assert.equal(saved.data.cooldownEndsAt, purchase.cooldownEndsAt);
    assert.equal(saved.data.status, "cooling_down");
    assert.equal((await request(`/purchases/${purchase.id}/decision`, "POST", answers)).status, 409);
    assert.equal((await request(`/purchases/${purchase.id}/decision`, "POST", { action: "continue" })).status, 400);

    const deferred = await create();
    const postponed = await request(`/purchases/${deferred.id}/decision`, "POST", { action: "postpone" });
    assert.equal(postponed.data.status, "postponed");
    assert.ok(postponed.data.decidedAt);
    assert.equal((await request(`/purchases/${deferred.id}/decision`, "POST", answers)).status, 409);

    // Editing settings cannot shorten an existing attempt's deadline.
    await request("/protection-settings", "PUT", { ...settings, enabled: false });
    assert.equal((await request(`/purchases/${purchase.id}/decision`, "POST", answers)).status, 409);
    assert.equal((await create()).status, "simulated");
    await request("/protection-settings", "PUT", {
      ...settings, blockStartHour: (hour + 1) % 24, blockEndHour: (hour + 2) % 24,
    });
    assert.equal((await create()).status, "simulated");
    const dashboard = await request("/dashboard");
    assert.ok(dashboard.data.pendingSimulations.some((item) => item.id === purchase.id));
    assert.ok(!dashboard.data.pendingSimulations.some((item) => item.id === deferred.id));
    assert.equal(dashboard.data.account.availableBalance, originalBalance);
    assert.equal((await request("/purchases/not-an-id")).status, 404);
    assert.equal((await request("/purchases/simulate", "POST", { ...input, timeZone: "invalid" })).status, 400);
    console.info("Waiting for the real server-enforced one-minute deadline.");
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, Date.parse(purchase.cooldownEndsAt) - Date.now()) + 1200));
    const decisions = await Promise.all([
      request(`/purchases/${purchase.id}/decision`, "POST", answers),
      request(`/purchases/${purchase.id}/decision`, "POST", answers),
    ]);
    assert.deepEqual(decisions.map((result) => result.status).sort(), [200, 409]);
    assert.equal(decisions.find((result) => result.status === 200).data.status, "simulated");
    assert.equal((await request(`/purchases/${purchase.id}`)).data.status, "simulated");
    assert.equal((await request("/dashboard")).data.account.availableBalance, originalBalance);
  } finally {
    for (const id of attempts) {
      const record = await request(`/purchases/${id}`);
      if (record.data.status === "cooling_down") {
        await request(`/purchases/${id}/decision`, "POST", { action: "postpone" });
      }
    }
    assert.equal((await request("/protection-settings", "PUT", original.data)).status, 200);
  }
});
