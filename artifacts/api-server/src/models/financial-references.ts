import mongoose, { type Model, type Schema, type ClientSession } from "mongoose";

function invalidReference(path: string, message: string): never {
  const error = new mongoose.Error.ValidationError();
  error.addError(path, new mongoose.Error.ValidatorError({ path, message, type: "reference" }));
  throw error;
}

// Financial ownership is fixed at creation. This also prevents moving a card
// after transactions have already been linked to it.
export function protectFinancialReferences(schema: Schema, fields: string[]) {
  async function check(
    Model: Model<any>,
    values: Record<string, unknown>,
    session?: ClientSession | null,
  ) {
    const candidate = new Model(values);
    await candidate.validate(fields);
    const Accounts = Model.db.model(Model.schema.path("accountId").options.ref);
    if (!await Accounts.exists({ _id: candidate.accountId }).session(session ?? null)) {
      invalidReference("accountId", "The referenced account does not exist");
    }
    if (fields.includes("cardId")) {
      const Cards = Model.db.model(Model.schema.path("cardId").options.ref);
      if (!await Cards.exists({
        _id: candidate.cardId, accountId: candidate.accountId,
      }).session(session ?? null)) {
        invalidReference("cardId", "The referenced card is missing or belongs to another account");
      }
    }
    return candidate;
  }

  function assertInsertOnly(update: Record<string, any>) {
    for (const [operator, changes] of Object.entries(update)) {
      if (operator === "$setOnInsert") continue;
      const paths = operator.startsWith("$") ? Object.keys(changes ?? {}) : [operator];
      for (const field of fields) {
        if (paths.some((path) => path === field || path.startsWith(`${field}.`)) ||
            (operator === "$rename" && Object.values(changes ?? {}).some((path) =>
              path === field || (typeof path === "string" && path.startsWith(`${field}.`))))) {
          invalidReference(field, "Financial references cannot be changed after creation");
        }
      }
    }
  }

  schema.pre("save", async function () {
    for (const field of fields) {
      if (!this.isNew && this.isModified(field)) {
        invalidReference(field, "Financial references cannot be changed after creation");
      }
    }
    await check(this.constructor as Model<any>, this.toObject(), this.$session());
  });

  // insertMany does not run save middleware, including when lean:true is used.
  schema.pre("insertMany", async function (documents) {
    // Mongoose passes only documents (not options) to insertMany hooks.
    for (const document of Array.isArray(documents) ? documents : [documents]) {
      const candidate = await check(this, document);
      // lean:true bypasses Mongoose casting as well as save hooks. Persist the
      // same BSON identifiers whose existence and ownership were checked.
      for (const field of fields) document[field] = candidate.get(field);
    }
  });

  schema.pre(["updateOne", "updateMany", "findOneAndUpdate"], async function () {
    const update = this.getUpdate() ?? {};
    if (Array.isArray(update)) {
      invalidReference(fields[0], "Pipeline updates are not supported for financial records");
    }
    assertInsertOnly(update);
    if (this.getOptions().upsert) {
      // Upsert equality filters become part of the inserted document in MongoDB.
      const values: Record<string, unknown> = { ...update.$setOnInsert };
      const filter = this.getFilter();
      for (const field of fields) {
        if (!(field in values)) {
          const value = filter[field];
          values[field] = value?.$eq ?? value;
        }
      }
      await check(this.model, values, this.getOptions().session);
    }
  });

  // Replacement can silently drop required references, and cannot preserve
  // ownership safely. Callers should update non-reference fields instead.
  schema.pre(["replaceOne", "findOneAndReplace"], function () {
    invalidReference(fields[0], "Replacement of financial records is not supported");
  });

  // bulkWrite bypasses document and query hooks. Check inserts explicitly and
  // reject reference-changing operations rather than silently bypassing checks.
  schema.pre("bulkWrite", async function (operations, options) {
    for (const operation of operations) {
      if ("insertOne" in operation) {
        await check(this, operation.insertOne.document, options?.session);
      } else if ("replaceOne" in operation) {
        invalidReference(fields[0], "Replacement of financial records is not supported");
      } else {
        const change = "updateOne" in operation ? operation.updateOne :
          "updateMany" in operation ? operation.updateMany : undefined;
        if (!change) continue;
        if (Array.isArray(change.update) || change.upsert) {
          invalidReference(fields[0], "Use create or an insert-only query upsert for financial records");
        }
        assertInsertOnly(change.update);
      }
    }
  });
}
