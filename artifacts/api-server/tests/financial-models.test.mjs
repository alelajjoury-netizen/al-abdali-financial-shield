import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { AccountModel } from "../src/models/Account.ts";
import { VirtualCardModel } from "../src/models/VirtualCard.ts";
import { FinancialTransactionModel } from "../src/models/FinancialTransaction.ts";

const accountId = new mongoose.Types.ObjectId();
const cardId = new mongoose.Types.ObjectId();
const cases = [
  {
    Model: AccountModel,
    valid: () => ({ displayName: "حساب تجريبي", balance: 750.125, limit: 100 }),
    required: ["displayName", "balance", "currency", "shieldMode", "dangerHours", "limit"],
    withoutDefaults: ["displayName", "balance", "limit"],
  },
  {
    Model: VirtualCardModel,
    valid: () => ({ accountId, holderName: "TEST HOLDER", lastFour: "0042" }),
    required: ["accountId", "holderName", "lastFour", "status", "isDefault"],
    withoutDefaults: ["accountId", "holderName", "lastFour"],
  },
  {
    Model: FinancialTransactionModel,
    valid: () => ({ accountId, cardId, merchantName: "متجر تجريبي", amount: 1.125, status: "approved" }),
    required: ["accountId", "cardId", "merchantName", "amount", "currency", "status"],
    withoutDefaults: ["accountId", "cardId", "merchantName", "amount", "status"],
  },
];

async function rejectsField(Model, values, field, kind) {
  await assert.rejects(new Model(values).validate(), (error) => {
    assert.ok(error instanceof mongoose.Error.ValidationError);
    assert.ok(error.errors[field], `expected an error for ${field}`);
    if (kind) assert.equal(error.errors[field].kind, kind);
    return true;
  });
}

for (const { Model, valid, required, withoutDefaults } of cases) {
  test(`${Model.modelName}: valid document and defaults`, async () => {
    const document = new Model(valid());
    await document.validate();
    assert.ok(document._id instanceof mongoose.Types.ObjectId);
    if (Model === AccountModel) {
      assert.equal(document.currency, "KWD");
      assert.equal(document.shieldMode, false);
      assert.deepEqual(document.dangerHours.toObject(), { enabled: false, startHour: 22, endHour: 7 });
    } else if (Model === VirtualCardModel) {
      assert.equal(document.status, "active");
      assert.equal(document.isDefault, true);
      assert.equal(document.lastFour, "0042");
    } else {
      assert.equal(document.currency, "KWD");
      assert.equal(document.cooldownUntil, undefined);
    }
  });
  for (const field of required) {
    test(`${Model.modelName}: ${field} cannot be null`, async () => {
      await rejectsField(Model, { ...valid(), [field]: null }, field, "required");
    });
  }
  for (const field of withoutDefaults) {
    test(`${Model.modelName}: ${field} cannot be omitted`, async () => {
      const values = valid();
      delete values[field];
      await rejectsField(Model, values, field, "required");
    });
  }
}

for (const [Model, valid, field, min, max] of [
  [AccountModel, cases[0].valid, "balance", 0, 1_000_000],
  [AccountModel, cases[0].valid, "limit", 0.001, 10_000],
  [FinancialTransactionModel, cases[2].valid, "amount", 0.001, 10_000],
]) {
  test(`${Model.modelName}.${field}: inclusive limits and KWD precision`, async () => {
    for (const value of [min, min + 0.001, max - 0.001, max, 1, 1.1, 1.12, 1.125, 0.1 + 0.2]) {
      const document = new Model({ ...valid(), [field]: value });
      await document.validate();
      assert.equal(document[field], value, "valid amounts must not be silently rounded");
    }
    for (const value of [min - 0.001, max + 0.001, -1, 0.0001, 1.1234, 1.00001, NaN, Infinity, -Infinity, "invalid"]) {
      await rejectsField(Model, { ...valid(), [field]: value }, field);
    }
    if (min > 0) await rejectsField(Model, { ...valid(), [field]: 0 }, field, "min");
  });
}

for (const { Model, valid } of [cases[0], cases[2]]) {
  test(`${Model.modelName}: currency must be KWD`, async () => {
    for (const currency of ["USD", "kwd", "", "EUR"]) {
      await rejectsField(Model, { ...valid(), currency }, "currency");
    }
  });
}

for (const [Model, valid, field, max] of [
  [AccountModel, cases[0].valid, "displayName", 100],
  [VirtualCardModel, cases[1].valid, "holderName", 100],
  [FinancialTransactionModel, cases[2].valid, "merchantName", 80],
]) {
  test(`${Model.modelName}.${field}: trims names and enforces length`, async () => {
    const document = new Model({ ...valid(), [field]: "  اسم تجريبي  " });
    await document.validate();
    assert.equal(document[field], "اسم تجريبي");
    await new Model({ ...valid(), [field]: "a".repeat(max) }).validate();
    for (const value of ["", "   ", "a".repeat(max + 1)]) {
      await rejectsField(Model, { ...valid(), [field]: value }, field);
    }
  });
}

test("Account: danger-hour fields are required and restricted to integer hours", async () => {
  for (const field of ["enabled", "startHour", "endHour"]) {
    await rejectsField(AccountModel, {
      ...cases[0].valid(), dangerHours: { [field]: null },
    }, `dangerHours.${field}`, "required");
  }
  for (const field of ["startHour", "endHour"]) {
    for (const value of [0, 23]) {
      await new AccountModel({ ...cases[0].valid(), dangerHours: { [field]: value } }).validate();
    }
    for (const value of [-1, 24, 1.5, NaN, Infinity]) {
      await rejectsField(AccountModel, {
        ...cases[0].valid(), dangerHours: { [field]: value },
      }, `dangerHours.${field}`);
    }
  }
});

test("VirtualCard: lastFour contains exactly four digits", async () => {
  for (const lastFour of ["0000", "1234", "9999"]) {
    await new VirtualCardModel({ ...cases[1].valid(), lastFour }).validate();
  }
  for (const lastFour of ["123", "12345", "12a4", " 1234", "1234 ", "١٢٣٤"]) {
    await rejectsField(VirtualCardModel, { ...cases[1].valid(), lastFour }, "lastFour", "regexp");
  }
});

for (const [Model, valid, statuses] of [
  [VirtualCardModel, cases[1].valid, ["active", "locked", "expired"]],
  [FinancialTransactionModel, cases[2].valid, ["approved", "pending_cooldown", "cancelled"]],
]) {
  test(`${Model.modelName}: only the three supported statuses are accepted`, async () => {
    assert.deepEqual(Model.schema.path("status").enumValues, statuses);
    for (const status of statuses) await new Model({ ...valid(), status }).validate();
    for (const status of ["unknown", "pending", "APPROVED", "ACTIVE", ""]) {
      await rejectsField(Model, { ...valid(), status }, "status");
    }
  });
}

for (const [Model, valid, field, ref] of [
  [VirtualCardModel, cases[1].valid, "accountId", "Account"],
  [FinancialTransactionModel, cases[2].valid, "accountId", "Account"],
  [FinancialTransactionModel, cases[2].valid, "cardId", "VirtualCard"],
]) {
  test(`${Model.modelName}.${field}: ObjectId casting and referenced model`, async () => {
    assert.equal(Model.schema.path(field).options.ref, ref);
    for (const value of [accountId, accountId.toHexString()]) {
      const document = new Model({ ...valid(), [field]: value });
      await document.validate();
      assert.ok(document[field] instanceof mongoose.Types.ObjectId);
      assert.ok(document[field].equals(accountId));
    }
    // ObjectId refs validate shape, not whether a referenced document exists.
    for (const value of ["not-an-id", "a".repeat(23), "g".repeat(24), 42, {}]) {
      await rejectsField(Model, { ...valid(), [field]: value }, field, "ObjectId");
    }
  });
}

test("VirtualCard: one card per account is a unique MongoDB index, not a validator", async () => {
  const indexes = VirtualCardModel.schema.indexes();
  assert.ok(indexes.some(([keys, options]) =>
    Object.keys(keys).length === 1 && keys.accountId === 1 &&
    options.unique === true && !options.sparse && !options.partialFilterExpression));
  // Both documents pass validation: only MongoDB can arbitrate concurrent writes.
  await new VirtualCardModel(cases[1].valid()).validate();
  await new VirtualCardModel({ ...cases[1].valid(), isDefault: false }).validate();
});
