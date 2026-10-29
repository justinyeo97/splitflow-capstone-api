import test from "node:test";
import assert from "node:assert/strict";
import { getHistoricalRate } from "../src/services/fx.js";

test("historical provider date may precede the requested date but never follow it", async () => {
  const rate = await getHistoricalRate("EUR", "USD", "2025-01-05", {
    fetchImpl: async () =>
      Response.json({ base: "EUR", date: "2025-01-03", rates: { USD: 1.03 } }),
    providers: [{ name: "frankfurter", baseUrl: "https://rates.example/v1" }],
  });
  assert.equal(rate.effectiveDate, "2025-01-03");
  assert.equal(rate.fallback, false);
  const future = await getHistoricalRate("EUR", "USD", "2025-01-05", {
    fetchImpl: async () =>
      Response.json({ base: "EUR", date: "2025-01-06", rates: { USD: 1.03 } }),
    providers: [{ name: "frankfurter", baseUrl: "https://rates.example/v1" }],
  });
  assert.equal(future.status, "pending");
});

test("provider fallback is ordered and reports fallback provenance", async () => {
  const called = [];
  const rate = await getHistoricalRate("MYR", "USD", "2025-01-05", {
    fetchImpl: async (url) => {
      called.push(url);
      if (called.length === 1)
        return new Response("unavailable", { status: 503 });
      return Response.json({
        base: "MYR",
        date: "2025-01-03",
        rates: { USD: 0.21 },
      });
    },
    providers: [
      { name: "primary", baseUrl: "https://primary.example/v1" },
      { name: "backup", baseUrl: "https://backup.example/v1" },
    ],
  });
  assert.equal(called.length, 2);
  assert.equal(rate.provider, "backup");
  assert.equal(rate.fallback, true);
});
