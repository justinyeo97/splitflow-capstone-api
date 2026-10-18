import { env, fxFallbacks } from "../config/env.js";

async function requestRate(baseUrl, from, to, transactionDate, fetchImpl) {
  const url = `${baseUrl.replace(/\/$/, "")}/${encodeURIComponent(transactionDate)}?base=${encodeURIComponent(from)}&symbols=${encodeURIComponent(to)}`;
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(5000), headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}`);
  const row = await response.json();
  const dateIsValid = /^\d{4}-\d{2}-\d{2}$/.test(row.date || "") && new Date(`${row.date}T00:00:00.000Z`).toISOString().slice(0, 10) === row.date;
  if (row.base !== from || !row.rates || !Number.isFinite(Number(row.rates[to])) || Number(row.rates[to]) <= 0 || !dateIsValid || row.date > transactionDate) throw new Error("Provider returned an invalid pair, rate, or effective date");
  return { provider: baseUrl === env.FRANKFURTER_BASE_URL ? "frankfurter" : "fallback", rate: String(row.rates[to]), effectiveDate: row.date };
}
export async function getHistoricalRate(from, to, transactionDate, { fetchImpl = fetch, providers = [{ name: "frankfurter", baseUrl: env.FRANKFURTER_BASE_URL }, ...fxFallbacks] } = {}) {
  if (from === to) return { provider: "identity", rate: "1", effectiveDate: transactionDate, fallback: false, errors: [] };
  const errors = [];
  for (const provider of providers) {
    try { const result = await requestRate(provider.baseUrl, from, to, transactionDate, fetchImpl); return { ...result, provider: provider.name, fallback: provider.name !== "frankfurter", errors }; }
    catch (error) { errors.push({ provider: provider.name, message: error.message }); }
  }
  return { status: "pending", fallback: false, errors };
}
