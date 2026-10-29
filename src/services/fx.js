import { env, fxFallbackProviders } from "../config/env.js";

async function requestJson(url, fetchImpl, headers = {}) {
  const response = await fetchImpl(url, {
    signal: AbortSignal.timeout(5000),
    headers: { accept: "application/json", ...headers },
  });
  if (!response.ok)
    throw new Error(`Provider returned HTTP ${response.status}`);
  return response.json();
}
function validDate(value, transactionDate) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value || "") &&
    new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value &&
    value <= transactionDate
  );
}
function validRate(rate) {
  return Number.isFinite(Number(rate)) && Number(rate) > 0;
}

async function requestRate(provider, from, to, transactionDate, fetchImpl) {
  if (provider.name === "theratesapi") {
    const url = `https://theratesapi.com/api/${encodeURIComponent(transactionDate)}?base=${encodeURIComponent(from)}&symbols=${encodeURIComponent(to)}`;
    const row = await requestJson(url, fetchImpl);
    if (
      row.base !== from ||
      !validRate(row.rates?.[to]) ||
      !validDate(row.date, transactionDate)
    )
      throw new Error(
        "Provider returned an invalid pair, rate, or effective date",
      );
    return { rate: String(row.rates[to]), effectiveDate: row.date };
  }

  if (provider.name === "ecb") {
    // ECB publishes daily currency-per-EUR observations. Use the newest shared
    // business date on or before the transaction date, within a 14-day window.
    const start = new Date(`${transactionDate}T00:00:00.000Z`);
    start.setUTCDate(start.getUTCDate() - 14);
    const startDate = start.toISOString().slice(0, 10);
    const currencies = [
      ...new Set([from, to].filter((code) => code !== "EUR")),
    ];
    const url = new URL(
      `https://data-api.ecb.europa.eu/service/data/EXR/D.${currencies.join("+")}.EUR.SP00.A`,
    );
    url.search = new URLSearchParams({
      startPeriod: startDate,
      endPeriod: transactionDate,
      format: "csvdata",
      detail: "dataonly",
    }).toString();
    const csv = await fetchImpl(url, {
      signal: AbortSignal.timeout(5000),
      headers: { accept: "text/csv" },
    }).then(async (response) => {
      if (!response.ok)
        throw new Error(`Provider returned HTTP ${response.status}`);
      return response.text();
    });
    const lines = csv
      .trim()
      .split(/\r?\n/)
      .map((line) => line.split(","));
    if (lines.length < 2)
      throw new Error(
        "No ECB observation for this currency pair and date range",
      );
    const headers = lines[0];
    const currencyIndex = headers.indexOf("CURRENCY"),
      dateIndex = headers.indexOf("TIME_PERIOD"),
      rateIndex = headers.indexOf("OBS_VALUE");
    if ([currencyIndex, dateIndex, rateIndex].some((index) => index < 0))
      throw new Error("ECB returned an unexpected CSV format");
    const values = new Map();
    for (const cells of lines.slice(1)) {
      const code = cells[currencyIndex],
        date = cells[dateIndex],
        rate = cells[rateIndex];
      if (
        !currencies.includes(code) ||
        !validDate(date, transactionDate) ||
        date < startDate ||
        !validRate(rate)
      )
        continue;
      if (!values.has(code)) values.set(code, new Map());
      values.get(code).set(date, Number(rate));
    }
    const dateSets = currencies.map((code) => [
      ...(values.get(code)?.keys() || []),
    ]);
    const dates = (dateSets[0] || [])
      .filter((date) => dateSets.every((set) => set.includes(date)))
      .sort()
      .reverse();
    const effectiveDate = dates[0];
    if (!effectiveDate)
      throw new Error(
        "No shared ECB observation for this currency pair and date range",
      );
    const fromPerEuro =
      from === "EUR" ? 1 : values.get(from).get(effectiveDate);
    const toPerEuro = to === "EUR" ? 1 : values.get(to).get(effectiveDate);
    return { rate: String(toPerEuro / fromPerEuro), effectiveDate };
  }

  if (provider.name === "fxapi") {
    const url = new URL(
      `https://fxapi.app/api/history/${encodeURIComponent(from.toLowerCase())}/${encodeURIComponent(to.toLowerCase())}.json`,
    );
    url.search = new URLSearchParams({
      from: transactionDate,
      to: transactionDate,
    }).toString();
    const row = await requestJson(url, fetchImpl);
    const observation = row.rates?.find(
      (item) => item.date === transactionDate,
    );
    if (
      row.base?.toUpperCase() !== from ||
      row.target?.toUpperCase() !== to ||
      !observation ||
      !validRate(observation.rate)
    )
      throw new Error(
        "Provider returned no exact-date observation for this pair",
      );
    return { rate: String(observation.rate), effectiveDate: observation.date };
  }

  // Configured custom providers use Frankfurter v1's historical response shape.
  const url = `${provider.baseUrl.replace(/\/$/, "")}/${encodeURIComponent(transactionDate)}?base=${encodeURIComponent(from)}&symbols=${encodeURIComponent(to)}`;
  const row = await requestJson(url, fetchImpl);
  if (
    row.base !== from ||
    !validRate(row.rates?.[to]) ||
    !validDate(row.date, transactionDate)
  )
    throw new Error(
      "Provider returned an invalid pair, rate, or effective date",
    );
  return { rate: String(row.rates[to]), effectiveDate: row.date };
}
export async function getHistoricalRate(
  from,
  to,
  transactionDate,
  {
    fetchImpl = fetch,
    providers = [
      { name: "frankfurter", baseUrl: env.FRANKFURTER_BASE_URL },
      ...fxFallbackProviders,
    ],
  } = {},
) {
  if (from === to)
    return {
      provider: "identity",
      rate: "1",
      effectiveDate: transactionDate,
      fallback: false,
      errors: [],
    };
  const errors = [];
  for (const provider of providers) {
    try {
      const result = await requestRate(
        provider,
        from,
        to,
        transactionDate,
        fetchImpl,
      );
      return {
        ...result,
        provider: provider.name,
        fallback: provider.name !== "frankfurter",
        errors,
      };
    } catch (error) {
      errors.push({ provider: provider.name, message: error.message });
    }
  }
  return { status: "pending", fallback: false, errors };
}
