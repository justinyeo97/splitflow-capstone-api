import test from "node:test";
import assert from "node:assert/strict";
import { api } from "../src/routes/api.js";
const handler = (path, method) =>
  api.stack
    .find((layer) => layer.route?.path === path && layer.route.methods[method])
    .route.stack.at(-1).handle;
test("ROI route pages through more than 500 rows and applies monthly filters", async () => {
  const calls = [];
  let payload;
  const req = {
    query: { month: "2026-12" },
    db: {
      from(table) {
        let offset = 0;
        const query = {
          select(value) {
            calls.push(["select", table, value]);
            return this;
          },
          order() {
            return this;
          },
          range(start) {
            offset = start;
            calls.push(["range", table, start]);
            return this;
          },
          or(value) {
            calls.push(["or", value]);
            return this;
          },
          gte(column, value) {
            calls.push(["gte", column, value]);
            return this;
          },
          lt(column, value) {
            calls.push(["lt", column, value]);
            return this;
          },
          then(resolve) {
            resolve({
              data:
                table === "expenses" && offset === 0
                  ? Array.from({ length: 500 }, (_, i) => ({
                      id: String(i),
                      attributed_country_id: "MY",
                      countries: { name: "Malaysia" },
                      original_amount: "1",
                      original_currency: "USD",
                      transaction_date: "2026-12-01",
                    }))
                  : [],
              error: null,
            });
          },
        };
        return query;
      },
    },
  };
  await handler("/reports/roi", "get")(req, {
    json(value) {
      payload = value;
    },
  });
  assert.equal(payload.data[0].costs, "500.00");
  assert.equal(payload.data[0].expense_count, 500);
  assert.ok(calls.some((call) => call[0] === "range" && call[2] === 500));
  assert.ok(calls.some((call) => call[0] === "lt" && call[2] === "2027-01-01"));
  assert.ok(
    calls.some(
      (call) =>
        call[0] === "or" &&
        call[1].includes(
          "revenue_recognition_date.is.null,placement_date.gte.2026-12-01",
        ),
    ),
  );
});
test("invalid ROI month fails before querying the database", async () => {
  await assert.rejects(
    () =>
      handler("/reports/roi", "get")(
        {
          query: { month: "2026-13" },
          db: {
            from() {
              throw new Error("Must not query");
            },
          },
        },
        {},
      ),
    (error) => error.code === "VALIDATION_ERROR",
  );
});
test("placement create and edit store revenue and leave automatic IDs alone", async () => {
  const body = {
    consultant_id: "12345678-1234-4234-8234-123456789abc",
    country_id: "12345678-1234-4234-8234-123456789abd",
    placement_date: "2026-10-01",
    revenue_recognition_date: "2026-11-01",
    revenue_amount: "20000",
    revenue_currency: "USD",
    external_id: "user-input",
  };
  for (const method of ["post", "patch"]) {
    let written;
    const db = {
      from() {
        return {
          insert(value) {
            written = value;
            return this;
          },
          update(value) {
            written = value;
            return this;
          },
          eq() {
            return this;
          },
          select() {
            return this;
          },
          async single() {
            return { data: written, error: null };
          },
        };
      },
    };
    await handler(
      method === "post" ? "/placements" : "/placements/:id",
      method,
    )(
      {
        body,
        params: { id: body.consultant_id },
        user: { id: body.consultant_id },
        db,
      },
      {
        status(code) {
          assert.equal(code, 201);
          return this;
        },
        json(value) {
          assert.equal(value.data.revenue_amount, "20000");
        },
      },
    );
    assert.equal(Object.hasOwn(written, "external_id"), false);
    assert.equal(written.revenue_recognition_date, "2026-11-01");
  }
});

test("ROI consultant filter and Q4 boundaries apply to both sources", async () => {
  const calls = [];
  const consultant = "12345678-1234-4234-8234-123456789abc";
  const req = {
    query: {
      group_by: "consultant",
      period: "quarter",
      year: "2026",
      quarter: "4",
      consultant_id: consultant,
    },
    db: {
      from(table) {
        return {
          select() {
            return this;
          },
          order() {
            return this;
          },
          range() {
            return this;
          },
          eq(k, v) {
            calls.push([table, k, v]);
            return this;
          },
          or(v) {
            calls.push([table, "or", v]);
            return this;
          },
          gte(k, v) {
            calls.push([table, "gte", v]);
            return this;
          },
          lt(k, v) {
            calls.push([table, "lt", v]);
            return this;
          },
          then(resolve) {
            resolve({ data: [], error: null });
          },
        };
      },
    },
  };
  await handler("/reports/roi", "get")(req, {
    json(value) {
      assert.equal(value.group_by, "consultant");
      assert.equal(value.period, "quarter");
    },
  });
  assert.equal(
    calls.filter((c) => c[1] === "consultant_id" && c[2] === consultant).length,
    2,
  );
  assert.ok(calls.some((c) => c[1] === "gte" && c[2] === "2026-10-01"));
  assert.ok(calls.some((c) => c[1] === "lt" && c[2] === "2027-01-01"));
  assert.ok(
    calls.some(
      (c) =>
        c[1] === "or" &&
        c[2].includes("revenue_recognition_date.lt.2027-01-01"),
    ),
  );
});
test("ROI rejects invalid consultant and inconsistent period filters", async () => {
  for (const query of [
    { consultant_id: "bad" },
    { period: "week" },
    { period: "quarter", quarter: "5", year: "2026" },
    { period: "quarter", quarter: "1" },
    { period: "year", month: "2026-01" },
  ])
    await assert.rejects(
      () => handler("/reports/roi", "get")({ query }, {}),
      (e) => e.code === "VALIDATION_ERROR",
    );
});
