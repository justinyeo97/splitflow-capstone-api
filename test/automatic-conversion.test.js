import test from "node:test";
import assert from "node:assert/strict";
import {
  autoConvertExpense,
  conversionContext,
} from "../src/services/automatic-conversion.js";
import { api } from "../src/routes/api.js";
const expense = {
  id: "12345678-1234-4234-8234-123456789abc",
  attributed_country_id: "country",
  original_currency: "MYR",
  original_amount: "100",
  transaction_date: "2026-10-01",
};
function database({
  currency = "MYR",
  existing = null,
  failRates = false,
} = {}) {
  const writes = [];
  const db = {
    writes,
    from(table) {
      let operation = "select",
        body,
        filters = [],
        finalizedLookup = false;
      const builder = {
        select() {
          return this;
        },
        eq(k, v) {
          filters.push([k, v]);
          return this;
        },
        is(k, v) {
          filters.push([k, v]);
          return this;
        },
        not() {
          finalizedLookup = true;
          return this;
        },
        limit() {
          return this;
        },
        lte() {
          return this;
        },
        or() {
          return this;
        },
        order() {
          return this;
        },
        upsert(v) {
          operation = "upsert";
          body = v;
          return this;
        },
        update(v) {
          operation = "update";
          body = v;
          return this;
        },
        insert(v) {
          operation = "insert";
          body = v;
          return this;
        },
        async single() {
          return this.result();
        },
        async maybeSingle() {
          return this.result();
        },
        then(resolve) {
          resolve(this.result());
        },
        result() {
          if (operation !== "select") {
            writes.push({ table, operation, body, filters });
            if (table === "exchange_rates" && failRates)
              return { error: { message: "rate storage failed" } };
            return {
              data:
                table === "expenses"
                  ? { ...expense, ...body }
                  : table === "import_batches"
                    ? { id: "batch" }
                    : body,
              error: null,
            };
          }
          if (table === "expense_conversions" && finalizedLookup)
            return {
              data: existing?.finalized_at ? [existing] : [],
              error: null,
            };
          if (table === "expenses") return { data: expense, error: null };
          if (table === "countries")
            return {
              data: { default_reporting_currency: currency },
              error: null,
            };
          if (table === "consultant_country_history")
            return { data: { country_id: "country" }, error: null };
          if (table === "consultants")
            return {
              data: [{ id: expense.id, external_id: "C-1001" }],
              error: null,
            };
          return { data: existing, error: null };
        },
      };
      return builder;
    },
  };
  return db;
}
test("automatic identity conversion persists pending first then finalizes", async () => {
  const db = database();
  const result = await autoConvertExpense(db, expense, "user");
  assert.equal(result.status, "finalized");
  assert.equal(db.writes[0].body.status, "pending");
  const final = db.writes.find((w) => w.body.status === "finalized");
  assert.equal(final.body.converted_amount, "100.00");
  assert.equal(final.body.finalized_by, "user");
  assert.ok(
    final.filters.some((f) => f[0] === "finalized_at" && f[1] === null),
  );
});
test("unavailable rates remain pending and finalized records are skipped", async () => {
  const db = database({ currency: "USD" });
  const result = await autoConvertExpense(
    db,
    expense,
    "user",
    conversionContext(async () => ({
      status: "pending",
      errors: [{ message: "No rate" }],
    })),
  );
  assert.equal(result.status, "pending");
  assert.equal(
    db.writes.some((w) => w.body.status === "finalized"),
    false,
  );
  const locked = database({ existing: { finalized_at: "2026-10-01" } });
  assert.equal(
    (await autoConvertExpense(locked, expense, "user")).status,
    "finalized",
  );
  assert.equal(locked.writes.length, 0);
});
test("provider exceptions and rate storage failure do not reject saved expense", async () => {
  for (const db of [
    database({ currency: "USD" }),
    database({ failRates: true }),
  ]) {
    const result = await autoConvertExpense(
      db,
      expense,
      "user",
      conversionContext(async () => {
        throw new Error("Provider down");
      }),
    );
    assert.equal(result.status, "pending");
    assert.ok(db.writes.some((w) => w.body.error_metadata?.message));
  }
});
test("bulk context reuses the historical rate for matching currency and date", async () => {
  let calls = 0;
  const context = conversionContext(async () => {
    calls++;
    return {
      rate: "0.25",
      provider: "test",
      effectiveDate: "2026-10-01",
      fallback: false,
      errors: [],
    };
  });
  const db = database({ currency: "USD" });
  await autoConvertExpense(db, expense, "user", context);
  await autoConvertExpense(db, { ...expense, id: "second" }, "user", context);
  assert.equal(calls, 1);
  assert.ok(db.writes.some((w) => w.body.converted_amount === "25.00"));
});
test("expense creation automatically converts before returning success", async () => {
  const handler = api.stack
    .find((l) => l.route?.path === "/expenses" && l.route.methods.post)
    .route.stack.at(-1).handle;
  const db = database();
  let payload;
  await handler(
    {
      body: {
        consultant_id: expense.id,
        transaction_date: expense.transaction_date,
        original_amount: "100",
        original_currency: "MYR",
        category: "Travel",
      },
      user: { id: expense.id },
      db,
    },
    {
      status(code) {
        assert.equal(code, 201);
        return this;
      },
      json(body) {
        payload = body;
      },
    },
  );
  assert.equal(payload.conversion.status, "finalized");
  assert.ok(db.writes.some((w) => w.body.status === "finalized"));
});
test("CSV import converts accepted rows and reports conversion totals", async () => {
  const handler = api.stack
    .find((l) => l.route?.path === "/imports/expenses" && l.route.methods.post)
    .route.stack.at(-1).handle;
  const db = database();
  let payload;
  const csv =
    "consultant_external_id,transaction_date,original_amount,original_currency,category\nC-1001,2026-10-01,100,MYR,Travel";
  await handler(
    { body: csv, is: () => true, headers: {}, user: { id: expense.id }, db },
    {
      status(code) {
        assert.equal(code, 201);
        return this;
      },
      json(body) {
        payload = body;
      },
    },
  );
  assert.equal(payload.data.accepted, 1);
  assert.equal(payload.data.rejected, 0);
  assert.equal(payload.data.conversions_finalized, 1);
  assert.equal(payload.data.conversions_pending, 0);
});

test("metadata edits keep finalized conversions while material edits are blocked", async () => {
  const handler = api.stack
    .find((l) => l.route?.path === "/expenses/:id" && l.route.methods.patch)
    .route.stack.at(-1).handle;
  const db = database({
    existing: { id: "conversion", finalized_at: "2026-10-01" },
  });
  let payload;
  await handler(
    {
      params: { id: expense.id },
      body: { category: "Meals" },
      user: { id: expense.id },
      db,
    },
    {
      json(body) {
        payload = body;
      },
    },
  );
  assert.equal(payload.conversion.status, "finalized");
  assert.equal(
    db.writes.filter((w) => w.table === "expense_conversions").length,
    0,
  );
  await assert.rejects(
    () =>
      handler(
        {
          params: { id: expense.id },
          body: { original_amount: "200" },
          user: { id: expense.id },
          db,
        },
        {},
      ),
    (error) => error.status === 409,
  );
});
test("pending expense edits reset stale conversions and recalculate automatically", async () => {
  const handler = api.stack
    .find((l) => l.route?.path === "/expenses/:id" && l.route.methods.patch)
    .route.stack.at(-1).handle;
  const db = database();
  let payload;
  await handler(
    {
      params: { id: expense.id },
      body: { original_amount: "200" },
      user: { id: expense.id },
      db,
    },
    {
      json(body) {
        payload = body;
      },
    },
  );
  assert.equal(payload.conversion.status, "finalized");
  assert.ok(db.writes.some((w) => w.body.converted_amount === "200.00"));
  assert.ok(
    db.writes.some(
      (w) => w.body.status === "pending" && w.body.applied_rate === null,
    ),
  );
});
