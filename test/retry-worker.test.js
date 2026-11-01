import test from "node:test";
import assert from "node:assert/strict";
import {
  nextRetryAt,
  retryClaimedConversion,
  runConversionRetries,
} from "../src/services/retry-conversion.js";

const job = {
  id: "conversion",
  company_id: "company",
  expense_id: "expense",
  retry_lease: "lease",
  retry_attempts: 1,
  target_currency: "MYR",
};
function database({ saved = true, claimError = false } = {}) {
  const writes = [],
    filters = [];
  return {
    writes,
    filters,
    async rpc() {
      return claimError
        ? { error: { message: "Unavailable" } }
        : { data: [job] };
    },
    from(table) {
      return {
        select() {
          return this;
        },
        eq(key, value) {
          filters.push([table, key, value]);
          return this;
        },
        is(key, value) {
          filters.push([table, key, value]);
          return this;
        },
        update(value) {
          writes.push([table, value]);
          return this;
        },
        upsert(value) {
          writes.push([table, value]);
          return Promise.resolve({ data: null });
        },
        async single() {
          return {
            data: {
              original_amount: "12.50",
              original_currency: "USD",
              transaction_date: "2026-10-01",
            },
          };
        },
        async maybeSingle() {
          return { data: saved ? { id: job.id } : null };
        },
        then(resolve) {
          resolve({ data: null });
        },
      };
    },
  };
}
test("retry backoff starts at five minutes and caps at a day", () => {
  assert.equal(nextRetryAt(1, 0), new Date(300000).toISOString());
  assert.equal(nextRetryAt(1000, 0), new Date(86400000).toISOString());
});
test("scheduled retry finalizes the original currency pair with lease and company checks", async () => {
  const db = database();
  const result = await retryClaimedConversion(
    db,
    job,
    async (from, to, date) => {
      assert.deepEqual([from, to, date], ["USD", "MYR", "2026-10-01"]);
      return {
        rate: "4",
        provider: "test",
        effectiveDate: date,
        fallback: false,
        errors: [],
      };
    },
  );
  assert.equal(result, "finalized");
  const update = db.writes.find(
    ([table]) => table === "expense_conversions",
  )[1];
  assert.equal(update.converted_amount, "50.00");
  assert.equal(update.finalized_by, null);
  assert.ok(
    db.filters.some(
      ([, key, value]) => key === "retry_lease" && value === "lease",
    ),
  );
  assert.ok(
    db.filters.some(
      ([, key, value]) => key === "finalized_at" && value === null,
    ),
  );
});
test("missing rates remain pending and a lost lease never overwrites a final result", async () => {
  const db = database();
  assert.equal(
    await retryClaimedConversion(db, job, async () => ({
      status: "pending",
      errors: [],
    })),
    "pending",
  );
  assert.ok(db.writes[0][1].next_retry_at);
  assert.equal(db.writes[0][1].finalized_at, undefined);
  assert.equal(
    await retryClaimedConversion(database({ saved: false }), job, async () => ({
      status: "pending",
      errors: [],
    })),
    "skipped",
  );
});
test("provider exceptions preserve the pending job and schedule another attempt", async () => {
  const db = database();
  const summary = await runConversionRetries(db, async () => {
    throw new Error("Provider down");
  });
  assert.equal(summary.failed, 1);
  assert.equal(summary.finalized, 0);
  assert.ok(db.writes.at(-1)[1].next_retry_at);
  assert.equal(db.writes.at(-1)[1].retry_lease, null);
});
test("claim failures are surfaced instead of silently dropping jobs", async () => {
  await assert.rejects(
    () => runConversionRetries(database({ claimError: true })),
    /Unavailable/,
  );
});
