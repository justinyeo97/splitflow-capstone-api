import test from "node:test";
import assert from "node:assert/strict";
import { calculateRoi } from "../src/services/roi.js";
import { placementSchema } from "../src/schemas/placement.js";
const expense = (amount = "8000", extra = {}) => ({
  id: "e1",
  attributed_country_id: "MY",
  countries: { name: "Malaysia" },
  original_amount: amount,
  original_currency: "USD",
  transaction_date: "2026-10-01",
  ...extra,
});
const placement = (extra = {}) => ({
  id: "p1",
  country_id: "MY",
  countries: { name: "Malaysia" },
  placement_date: "2026-09-01",
  revenue_recognition_date: "2026-10-01",
  revenue_amount: "20000",
  revenue_currency: "USD",
  ...extra,
});
test("ROI uses recognized revenue, exact money, and country-month allocation", async () => {
  const [row] = await calculateRoi([expense()], [placement()]);
  assert.equal(row.month, "2026-10");
  assert.equal(row.profit, "12000.00");
  assert.equal(row.roi_percent, "150.00");
  assert.equal(row.cost_per_placement, "8000.00");
  assert.equal(row.complete, true);
});
test("missing revenue blocks profit and ROI, without inventing zero revenue", async () => {
  const rows = await calculateRoi(
    [expense()],
    [
      placement({
        revenue_amount: null,
        revenue_currency: null,
        revenue_recognition_date: null,
        placement_date: "2026-10-01",
      }),
    ],
  );
  assert.equal(rows[0].complete, false);
  assert.equal(rows[0].roi_percent, null);
  assert.equal(rows[0].profit, null);
  assert.equal(rows[0].missing_revenue_count, 1);
});
test("missing FX blocks ratios and rates are cached across revenue and expenses", async () => {
  let calls = 0;
  const [row] = await calculateRoi(
    [expense("8000", { original_currency: "MYR" })],
    [placement({ revenue_currency: "MYR" })],
    async () => {
      calls++;
      return { status: "pending" };
    },
  );
  assert.equal(calls, 1);
  assert.equal(row.roi_percent, null);
  assert.equal(row.missing_cost_rate_count, 1);
  assert.equal(row.missing_revenue_rate_count, 1);
});
test("zero costs, losses, cost-only rows and unassigned countries are explicit", async () => {
  assert.equal((await calculateRoi([], [placement()]))[0].roi_percent, null);
  const [loss] = await calculateRoi(
    [expense()],
    [placement({ revenue_amount: "2000" })],
  );
  assert.equal(loss.roi_percent, "-75.00");
  assert.equal(loss.profit, "-6000.00");
  const [costOnly] = await calculateRoi([expense()], []);
  assert.equal(costOnly.roi_percent, "-100.00");
  assert.equal(costOnly.cost_per_placement, null);
  const [unassigned] = await calculateRoi(
    [],
    [placement({ country_id: null })],
  );
  assert.equal(unassigned.complete, false);
});
test("different months and countries stay separate and converted revenue is used", async () => {
  const rows = await calculateRoi(
    [expense()],
    [
      placement({ revenue_currency: "MYR" }),
      placement({
        id: "p2",
        country_id: "SG",
        countries: { name: "Singapore" },
        revenue_recognition_date: "2026-11-01",
      }),
    ],
    async () => ({ rate: "0.25" }),
  );
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.country_id === "MY").revenue, "5000.00");
});
test("placement schema requires revenue and country while permitting explicit zero", () => {
  const body = {
    consultant_id: "12345678-1234-4234-8234-123456789abc",
    country_id: "12345678-1234-4234-8234-123456789abd",
    placement_date: "2026-10-01",
    revenue_recognition_date: "2026-10-01",
    revenue_amount: "0",
    revenue_currency: "USD",
  };
  assert.equal(placementSchema.safeParse(body).success, true);
  for (const change of [
    { revenue_amount: undefined },
    { revenue_amount: "-1" },
    { country_id: "" },
    { revenue_currency: "usd" },
    { revenue_recognition_date: "invalid" },
  ])
    assert.equal(
      placementSchema.safeParse({ ...body, ...change }).success,
      false,
    );
});

test("explicit zero revenue needs no exchange rate", async () => {
  const [row] = await calculateRoi(
    [expense()],
    [placement({ revenue_amount: "0", revenue_currency: "MYR" })],
    async () => {
      throw new Error("Zero revenue must not request a rate");
    },
  );
  assert.equal(row.complete, true);
  assert.equal(row.roi_percent, "-100.00");
});

test("consultant ROI combines countries but keeps individuals separate", async () => {
  const e1 = expense("100", {
    consultant_id: "a",
    consultants: { name: "Alice" },
  });
  const e2 = expense("200", {
    id: "e2",
    attributed_country_id: "SG",
    consultant_id: "a",
    consultants: { name: "Alice" },
  });
  const e3 = expense("500", {
    id: "e3",
    consultant_id: "b",
    consultants: { name: "Bob" },
  });
  const p = placement({
    consultant_id: "a",
    consultants: { name: "Alice" },
    revenue_amount: "900",
  });
  const rows = await calculateRoi([e1, e2, e3], [p], undefined, {
    groupBy: "consultant",
    period: "month",
  });
  assert.equal(rows.length, 2);
  const alice = rows.find((r) => r.consultant_id === "a");
  assert.equal(alice.costs, "300.00");
  assert.equal(alice.profit, "600.00");
  assert.equal(alice.roi_percent, "200.00");
  assert.equal(
    rows.find((r) => r.consultant_id === "b").roi_percent,
    "-100.00",
  );
});
test("quarterly and yearly ROI recompute ratios from aggregated money", async () => {
  const expenses = [
    expense("100", { transaction_date: "2026-01-01" }),
    expense("300", { id: "e2", transaction_date: "2026-03-31" }),
    expense("200", { id: "e3", transaction_date: "2026-04-01" }),
  ];
  const placements = [
    placement({
      revenue_amount: "800",
      revenue_recognition_date: "2026-03-01",
    }),
    placement({
      id: "p2",
      revenue_amount: "100",
      revenue_recognition_date: "2026-04-01",
    }),
  ];
  const quarters = await calculateRoi(expenses, placements, undefined, {
    period: "quarter",
  });
  assert.equal(quarters.length, 2);
  assert.equal(
    quarters.find((r) => r.period === "2026-Q1").roi_percent,
    "100.00",
  );
  assert.equal(
    quarters.find((r) => r.period === "2026-Q2").roi_percent,
    "-50.00",
  );
  const [annual] = await calculateRoi(expenses, placements, undefined, {
    period: "year",
  });
  assert.equal(annual.period, "2026");
  assert.equal(annual.costs, "600.00");
  assert.equal(annual.revenue, "900.00");
  assert.equal(annual.roi_percent, "50.00");
});
