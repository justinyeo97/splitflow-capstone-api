import test from "node:test";
import assert from "node:assert/strict";
import { analysisFacts, createRoiAnalyzer, previousFilters, reportFingerprint, analysisRoles } from "../src/services/roi-analysis.js";
import { api } from "../src/routes/api.js";
import { env } from "../src/config/env.js";

const row = (extra = {}) => ({ period: "2026-10", month: "2026-10", country_id: "MY",
  country: "Malaysia", costs: "100.00", revenue: "250.00", placement_count: 2,
  complete: true, ...extra });
const report = (rows = [row()]) => ({ data: rows, currency: "USD", group_by: "country",
  period: "month", salary_included: false, salary_issues: [] });
const answer = { summary: "Revenue exceeds recorded costs.",
  observations: [{ text: "Recorded operations are profitable.", evidence_ids: ["selected"] }],
  investigations: [{ text: "Review whether revenue is sustainable.", evidence_ids: ["selected"] }],
  limitations: ["Recorded aggregates do not establish causation."] };
const reply = (value = answer, extra = {}) => ({ ok: true, json: async () => ({
  choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }], ...extra,
}) });
const factory = (options = {}) => createRoiAnalyzer({ getKey: () => "test-secret",
  getModel: () => "test-model", usageLimits: { minuteTokens: 1000000, dailyTokens: 10000000, dailyRequests: 1000, concurrent: 4 }, fetchImpl: async () => reply(), ...options });

test("previous period handles year and quarter boundaries and unbounded reports", () => {
  assert.equal(previousFilters({ month: "2026-01" }).month, "2025-12");
  assert.deepEqual(previousFilters({ period: "quarter", year: "2026", quarter: "1" }),
    { period: "quarter", year: 2025, quarter: 4 });
  assert.equal(previousFilters({ period: "year", year: "2026" }).year, 2025);
  assert.equal(previousFilters({ period: "month" }), null);
  assert.equal(previousFilters({ year: "1900" }), null);
});
test("facts sum exact money and recompute ROI, including losses and undefined ratios", () => {
  const facts = analysisFacts(report([row(), row({ costs: "300.00", revenue: "350.00" })]));
  assert.equal(facts.facts[0].costs, "400.00");
  assert.equal(facts.facts[0].roi_percent, "50.00");
  assert.equal(analysisFacts(report([row({ revenue: "25.00" })])).facts[0].roi_percent, "-75.00");
  assert.equal(analysisFacts(report([row({ costs: "0.00" })])).facts[0].roi_percent, null);
  const incomplete = analysisFacts(report([row({ complete: false, missing_salary_count: 1 })]), report());
  assert.equal(incomplete.facts[0].profit, null);
  assert.equal(incomplete.facts[0].missing_salary, 1);
  assert.equal(incomplete.comparison_available, false);
});
test("provider input omits names, IDs, salary breakdowns and includes sample coverage", () => {
  const data = report([row({ consultant_id: "private-id", consultant: "Secret Person", salary_costs: "91.00" })]);
  data.group_by = "consultant";
  const facts = analysisFacts(data);
  const input = JSON.stringify(facts);
  assert.ok(input.includes("Consultant A"));
  for (const secret of ["private-id", "Secret Person", "91.00", "salary_costs"])
    assert.ok(!input.includes(secret));
  const many = analysisFacts(report(Array.from({ length: 30 }, (_, i) => row({ country_id: String(i), country: String(i) }))));
  assert.equal(many.coverage.entities, 30);
  assert.equal(many.facts.filter((f) => f.id.startsWith("entity-")).length, 12);
  assert.equal(many.facts[0].revenue, "7500.00");
});
test("analysis sends server key and strict output, reuses cache, scopes data and expires", async () => {
  let calls = 0, clock = 0;
  const analyze = factory({ now: () => clock, fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url, "https://api.groq.com/openai/v1/chat/completions");
    assert.equal(options.headers.Authorization, "Bearer test-secret");
    const body = JSON.parse(options.body);
    assert.equal(body.response_format.json_schema.strict, true);
    const schema = body.response_format.json_schema.schema;
    assert.equal(schema.properties.summary.pattern, "^[^0-9]+$");
    assert.equal(schema.properties.observations.items.properties.text.pattern, "^[^0-9]+$");
    assert.equal(schema.properties.investigations.items.properties.text.pattern, "^[^0-9]+$");
    assert.equal(schema.properties.limitations.items.pattern, "^[^0-9]+$");
    assert.equal(schema.properties.observations.items.properties.evidence_ids.items.pattern, undefined);
    assert.equal(body.max_completion_tokens, 1800);
    assert.equal(body.reasoning_effort, "low");
    assert.equal(body.messages[0].role, "system");
    assert.equal(body.messages[1].role, "user");
    assert.ok(!("tools" in body));
    assert.ok(!("input" in body));
    return reply();
  } });
  const facts = analysisFacts(report());
  assert.equal((await analyze("company:user", facts)).cached, false);
  assert.equal((await analyze("company:user", facts)).cached, true);
  await analyze("other-company:user", facts);
  await analyze("company:user", analysisFacts(report([row({ costs: "200.00" })])));
  clock = 1800001;
  await analyze("company:user", facts);
  assert.equal(calls, 4);
});
test("concurrent identical requests share generation; repeated distinct requests are limited", async () => {
  let calls = 0, release;
  const analyze = factory({ fetchImpl: async () => {
    calls++;
    await new Promise((resolve) => { release = resolve; });
    return reply();
  } });
  const first = analyze("scope", analysisFacts(report()));
  const second = analyze("scope", analysisFacts(report()));
  release();
  await Promise.all([first, second]);
  assert.equal(calls, 1);
  const limited = factory();
  for (let i = 0; i < 5; i++) await limited("scope", analysisFacts(report([row({ costs: `${100 + i}.00` })])));
  await assert.rejects(() => limited("scope", analysisFacts(report([row({ costs: "300.00" })]))),
    (error) => error.status === 429);
});
test("missing key, provider failures and invalid responses return safe errors", async () => {
  await assert.rejects(() => factory({ getKey: () => "" })("scope", {}), (error) => error.code === "AI_NOT_CONFIGURED");
  for (const [status, code] of [[401, "AI_AUTH_FAILED"], [429, "AI_RATE_LIMITED"], [500, "AI_PROVIDER_ERROR"]]) {
    await assert.rejects(() => factory({ fetchImpl: async () => ({ ok: false, status }) })("scope", analysisFacts(report())),
      (error) => error.code === code && !error.message.includes("test-secret"));
  }
  await assert.rejects(() => factory({ fetchImpl: async () => { throw new Error("secret-provider-details"); } })("scope", analysisFacts(report())),
    (error) => error.code === "AI_UNAVAILABLE" && !error.message.includes("secret-provider-details"));
  for (const response of [reply({ ...answer, summary: "Profit rose 999%." }),
    reply({ ...answer, observations: [{ text: "Unsupported.", evidence_ids: ["invented"] }] }),
    reply({}, { choices: [{ finish_reason: "length", message: { content: "{}" } }] }), reply({}, { choices: [{ finish_reason: "stop", message: { refusal: "Refused" } }] })]) {
    await assert.rejects(() => factory({ fetchImpl: async () => response })("scope", analysisFacts(report())),
      (error) => error.code === "AI_INVALID_OUTPUT");
  }
});

const route = (method) => api.stack.find((layer) => layer.route?.path === (method === "get" ? "/reports/roi" : "/reports/roi/analysis") && layer.route.methods[method]).route;
const database = () => ({ from(table) {
  return { select() { return this; }, order() { return this; }, range() { return this; },
    eq() { return this; }, then(resolve) { resolve({ error: null, data: table === "expenses" ? [{
      id: "e", attributed_country_id: "MY", countries: { name: "Malaysia" },
      original_amount: "100", original_currency: "USD", transaction_date: "2026-10-01",
    }] : [] }); } };
} });
test("analysis route enforces roles and returns setup errors without database or provider calls", async () => {
  assert.deepEqual(analysisRoles, ["administrator", "finance", "viewer"]);
  let denied;
  route("post").stack[0].handle({ user: { role: "consultant" } }, {}, (error) => { denied = error; });
  assert.equal(denied.status, 403);
  const saved = env.GROQ_API_KEY;
  env.GROQ_API_KEY = "";
  try {
    let status, body;
    await route("post").stack.at(-1).handle({}, { status(value) { status = value; return this; }, json(value) { body = value; } });
    assert.equal(status, 503);
    assert.equal(body.error.code, "AI_NOT_CONFIGURED");
  } finally { env.GROQ_API_KEY = saved; }
});
test("analysis route derives facts server-side, rejects stale snapshots and caches provider output", async () => {
  const savedKey = env.GROQ_API_KEY, savedFetch = globalThis.fetch;
  env.GROQ_API_KEY = "test-server-key";
  let providerCalls = 0;
  globalThis.fetch = async () => { providerCalls++; return reply(); };
  try {
    const req = { db: database(), query: {}, user: { id: "route-test", role: "finance" } };
    let table, status, result;
    const response = { status(value) { status = value; return this; }, json(value) { result = value; } };
    await route("get").stack.at(-1).handle(req, { json(value) { table = value; } });
    assert.equal(table.snapshot.length, 64);
    assert.equal(table.analysis_available, true);
    req.body = { filters: {}, snapshot: "0".repeat(64) };
    await route("post").stack.at(-1).handle(req, response);
    assert.equal(status, 409);
    assert.equal(providerCalls, 0);
    req.body.snapshot = table.snapshot;
    await route("post").stack.at(-1).handle(req, response);
    assert.equal(result.data.analysis.summary, answer.summary);
    assert.equal(result.data.facts[0].costs, "100.00");
    await route("post").stack.at(-1).handle(req, response);
    assert.equal(result.data.cached, true);
    assert.equal(providerCalls, 1);
    req.body.totals = { revenue: "999999" };
    await assert.rejects(() => route("post").stack.at(-1).handle(req, response),
      (error) => error.code === "VALIDATION_ERROR");
  } finally { env.GROQ_API_KEY = savedKey; globalThis.fetch = savedFetch; }
});
test("fingerprints change when report financial data changes", () => {
  assert.notEqual(reportFingerprint(report()), reportFingerprint(report([row({ costs: "200.00" })])));
});

test("free token budget is shared across users and cached results survive exhausted quotas", async () => {
  let calls = 0, clock = 0;
  const analyze = factory({ now: () => clock,
    usageLimits: { minuteTokens: 6000, dailyTokens: 120000, dailyRequests: 40, concurrent: 1 },
    fetchImpl: async () => { calls++; return reply(); } });
  const facts = analysisFacts(report());
  await analyze("one-user", facts);
  // A second user cannot bypass the shared per-minute reservation.
  await assert.rejects(() => analyze("two-user", facts), (error) => error.code === "AI_RATE_LIMITED");
  assert.equal((await analyze("one-user", facts)).cached, true);
  assert.equal(calls, 1);
  clock = 60001;
  await analyze("two-user", facts);
  assert.equal(calls, 2);
});
test("daily attempt and token budgets reject requests until the UTC day changes", async () => {
  for (const limits of [
    { minuteTokens: 7000, dailyTokens: 120000, dailyRequests: 1, concurrent: 1 },
    { minuteTokens: 7000, dailyTokens: 6000, dailyRequests: 40, concurrent: 1 },
  ]) {
    let clock = 0, calls = 0;
    const analyze = factory({ now: () => clock, usageLimits: limits,
      fetchImpl: async () => { calls++; return reply(); } });
    await analyze("one", analysisFacts(report()));
    clock = 60001;
    await assert.rejects(() => analyze("two", analysisFacts(report())), (error) => error.code === "AI_DAILY_LIMIT");
    assert.equal(calls, 1);
    clock = 86400001;
    await analyze("two", analysisFacts(report()));
    assert.equal(calls, 2);
  }
});
test("oversized inputs are stopped before a provider call", async () => {
  let calls = 0;
  const analyze = factory({ usageLimits: { minuteTokens: 7000, dailyTokens: 120000, dailyRequests: 40, concurrent: 1 },
    fetchImpl: async () => { calls++; return reply(); } });
  await assert.rejects(() => analyze("scope", { ...analysisFacts(report()), unexpected: "x".repeat(30000) }),
    (error) => error.code === "AI_INPUT_TOO_LARGE");
  assert.equal(calls, 0);
});
test("provider limits pause new generations without retries or paid fallback", async () => {
  let clock = 0, calls = 0;
  const analyze = factory({ now: () => clock, fetchImpl: async (url) => {
    calls++;
    assert.equal(url, "https://api.groq.com/openai/v1/chat/completions");
    return { ok: false, status: 429, headers: new Headers({ "retry-after": "120" }) };
  } });
  const facts = analysisFacts(report());
  await assert.rejects(() => analyze("one", facts), (error) => error.code === "AI_RATE_LIMITED");
  clock = 60001;
  await assert.rejects(() => analyze("two", facts), (error) => error.code === "AI_RATE_LIMITED");
  assert.equal(calls, 1);
  clock = 120001;
  await assert.rejects(() => analyze("two", facts), (error) => error.code === "AI_RATE_LIMITED");
  assert.equal(calls, 2);
});
