import test from "node:test";
import assert from "node:assert/strict";
process.env.COMPANY_REPORTING_ENABLED = "true";
const { api } = await import("../src/routes/api.js");
const handler = (path, method) =>
  api.stack
    .find((l) => l.route?.path === path && l.route.methods[method])
    .route.stack.at(-1).handle;

test("enabled company ROI includes historical salary and returns the configured currency", async () => {
  const fixtures = {
    expenses: [
      {
        id: "e",
        consultant_id: "p",
        attributed_country_id: "MY",
        original_amount: "100",
        original_currency: "EUR",
        transaction_date: "2026-01-05",
        countries: { name: "Malaysia" },
      },
    ],
    placements: [
      {
        id: "r",
        consultant_id: "p",
        country_id: "MY",
        revenue_amount: "2200",
        revenue_currency: "EUR",
        revenue_recognition_date: "2026-01-15",
      },
    ],
    consultants: [
      { id: "p", name: "Consultant", employment_start_date: "2026-01-01" },
    ],
    compensation_history: [
      {
        id: "s",
        consultant_id: "p",
        annual_salary: "12000.00",
        salary_currency: "EUR",
        effective_from: "2026-01-01",
      },
    ],
    consultant_country_history: [
      {
        consultant_id: "p",
        country_id: "MY",
        effective_from: "2026-01-01",
        countries: { name: "Malaysia" },
      },
    ],
  };
  const db = {
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
        eq() {
          return this;
        },
        gte() {
          return this;
        },
        lt() {
          return this;
        },
        or() {
          return this;
        },
        then(resolve) {
          resolve({ data: fixtures[table], error: null });
        },
      };
    },
  };
  let response;
  await handler("/reports/roi", "get")(
    {
      query: { month: "2026-01", group_by: "company" },
      company: {
        home_currency: "EUR",
        reporting_timezone: "Asia/Kuala_Lumpur",
      },
      db,
    },
    {
      json(value) {
        response = value;
      },
    },
  );
  assert.equal(response.currency, "EUR");
  assert.equal(response.salary_included, true);
  assert.equal(response.data[0].salary_costs, "1000.00");
  assert.equal(response.data[0].costs, "1100.00");
  assert.equal(response.data[0].profit, "1100.00");
  assert.equal(response.data[0].roi_percent, "100.00");
});
test("company settings only update the authenticated company and reject ownership fields", async () => {
  const route = handler("/company", "patch");
  let scope, written;
  const req = {
    body: { name: "Cohort13", home_currency: "MYR" },
    user: { company_id: "own-company" },
    db: {
      from(table) {
        assert.equal(table, "companies");
        return {
          update(v) {
            written = v;
            return this;
          },
          eq(k, v) {
            scope = [k, v];
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
    },
  };
  await route(req, {
    json(value) {
      assert.equal(value.data.home_currency, "MYR");
    },
  });
  assert.deepEqual(scope, ["id", "own-company"]);
  assert.deepEqual(written, { name: "Cohort13", home_currency: "MYR" });
  await assert.rejects(
    () => route({ ...req, body: { ...req.body, id: "other-company" } }, {}),
    (e) => e.code === "VALIDATION_ERROR",
  );
});
