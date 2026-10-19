import assert from "node:assert/strict";
import { test } from "node:test";
import { isBlockedAt } from "../src/lib/purchase-protection.ts";

const settings = { enabled: true, blockStartHour: 22, blockEndHour: 7 };
const at = (time) => new Date(`2026-10-19T${time}:00Z`);

test("overnight hours include start and exclude end", () => {
  assert.equal(isBlockedAt(settings, "UTC", at("21:59")), false);
  assert.equal(isBlockedAt(settings, "UTC", at("22:00")), true);
  assert.equal(isBlockedAt(settings, "UTC", at("00:00")), true);
  assert.equal(isBlockedAt(settings, "UTC", at("06:59")), true);
  assert.equal(isBlockedAt(settings, "UTC", at("07:00")), false);
});

test("daytime hours include start and exclude end", () => {
  const daytime = { ...settings, blockStartHour: 9, blockEndHour: 17 };
  assert.equal(isBlockedAt(daytime, "UTC", at("08:59")), false);
  assert.equal(isBlockedAt(daytime, "UTC", at("09:00")), true);
  assert.equal(isBlockedAt(daytime, "UTC", at("16:59")), true);
  assert.equal(isBlockedAt(daytime, "UTC", at("17:00")), false);
});

test("server instant is evaluated in the device timezone", () => {
  assert.equal(isBlockedAt(settings, "Asia/Kuwait", at("19:00")), true);
  assert.equal(isBlockedAt(settings, "UTC", at("19:00")), false);
  assert.equal(isBlockedAt({ ...settings, enabled: false }, "Asia/Kuwait", at("19:00")), false);
});

test("DST timezone conversion follows the selected timezone", () => {
  const early = { ...settings, blockStartHour: 1, blockEndHour: 2 };
  assert.equal(isBlockedAt(early, "America/New_York", new Date("2026-11-01T05:30:00Z")), true);
  assert.equal(isBlockedAt(early, "America/New_York", new Date("2026-11-01T06:30:00Z")), true);
});

test("invalid timezone fails explicitly even with the shield disabled", () => {
  assert.throws(() => isBlockedAt({ ...settings, enabled: false }, "not-a-timezone", at("12:00")), RangeError);
});
