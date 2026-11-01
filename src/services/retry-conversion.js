import { getHistoricalRate } from "./fx.js";
import { multiplyAndRound } from "../utils/money.js";

function checked(result) {
  if (result.error)
    throw Object.assign(new Error(result.error.message), { status: 503 });
  return result.data;
}

export function nextRetryAt(attempt, now = Date.now()) {
  return new Date(
    now +
      Math.min(1440, 5 * 2 ** Math.min(Math.max(attempt - 1, 0), 10)) * 60_000,
  ).toISOString();
}

// Used by the worker; the lease and finalized checks also protect against concurrent manual retries.
export async function retryClaimedConversion(
  db,
  conversion,
  resolveRate = getHistoricalRate,
) {
  const expense = checked(
    await db
      .from("expenses")
      .select("*")
      .eq("id", conversion.expense_id)
      .eq("company_id", conversion.company_id)
      .single(),
  );
  const rate = await resolveRate(
    expense.original_currency.trim(),
    conversion.target_currency.trim(),
    expense.transaction_date,
  );
  const pending = rate.status === "pending";
  if (!pending)
    checked(
      await db
        .from("exchange_rates")
        .upsert(
          {
            provider: rate.provider,
            base_currency: expense.original_currency.trim(),
            quote_currency: conversion.target_currency.trim(),
            rate: rate.rate,
            effective_date: rate.effectiveDate,
            fallback_used: rate.fallback,
          },
          {
            onConflict: "provider,base_currency,quote_currency,effective_date",
          },
        ),
    );
  const now = new Date().toISOString();
  const update = pending
    ? {
        error_metadata: rate.errors,
        next_retry_at: nextRetryAt(conversion.retry_attempts),
      }
    : {
        applied_rate: rate.rate,
        provider: rate.provider,
        requested_date: expense.transaction_date,
        effective_rate_date: rate.effectiveDate,
        retrieved_at: now,
        converted_amount: multiplyAndRound(
          String(expense.original_amount),
          String(rate.rate),
          2,
        ),
        status: "finalized",
        fallback_used: rate.fallback,
        finalized_at: now,
        finalized_by: null,
        error_metadata: rate.errors?.length
          ? { providerFailures: rate.errors }
          : null,
      };
  const data = checked(
    await db
      .from("expense_conversions")
      .update({ ...update, retry_lease: null, retry_lease_until: null })
      .eq("id", conversion.id)
      .eq("company_id", conversion.company_id)
      .eq("retry_lease", conversion.retry_lease)
      .is("finalized_at", null)
      .select("id")
      .maybeSingle(),
  );
  return data ? (pending ? "pending" : "finalized") : "skipped";
}

export async function runConversionRetries(
  db,
  resolveRate = getHistoricalRate,
) {
  const jobs = checked(
    await db.rpc("claim_pending_conversions", { batch_size: 10 }),
  );
  const summary = {
    claimed: jobs.length,
    finalized: 0,
    pending: 0,
    failed: 0,
    skipped: 0,
  };
  for (const job of jobs) {
    try {
      summary[await retryClaimedConversion(db, job, resolveRate)]++;
    } catch {
      summary.failed++;
      // Preserve failed jobs with backoff; a crashed worker's lease also expires automatically.
      checked(
        await db
          .from("expense_conversions")
          .update({
            retry_lease: null,
            retry_lease_until: null,
            next_retry_at: nextRetryAt(job.retry_attempts),
            error_metadata: {
              reason: "Scheduled retry failed; will retry later",
            },
          })
          .eq("id", job.id)
          .eq("company_id", job.company_id)
          .eq("retry_lease", job.retry_lease)
          .is("finalized_at", null),
      );
    }
  }
  return summary;
}
