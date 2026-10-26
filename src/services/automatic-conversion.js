import { getHistoricalRate } from './fx.js';
import { multiplyAndRound } from '../utils/money.js';

function checked(result) { if (result.error) throw new Error(result.error.message); return result.data; }
// Remember rates already requested during this operation so we do not ask twice.
export function conversionContext(resolveRate = getHistoricalRate) {
  const rates = new Map(), countries = new Map();
  return {
    countries,
    rate(from, to, date) {
      if (from === to) return Promise.resolve({provider:'identity',rate:'1',effectiveDate:date,fallback:false,errors:[]});
      const key = from + ':' + to + ':' + date;
      if (!rates.has(key)) rates.set(key, Promise.resolve().then(() => resolveRate(from, to, date)));
      return rates.get(key);
    },
  };
}

// Conversion failure must never turn an already saved expense into a rejected row.
// Convert the saved expense into the currency used by its assigned country.
export async function autoConvertExpense(db, expense, userId, context = conversionContext()) {
  let target;
  try {
    if (!context.countries.has(expense.attributed_country_id)) {
      const country = checked(await db.from('countries').select('default_reporting_currency').eq('id',expense.attributed_country_id).single());
      context.countries.set(expense.attributed_country_id, country.default_reporting_currency.trim());
    }
    target = context.countries.get(expense.attributed_country_id);
// Leave a finished conversion alone so its recorded value stays the same.
    const existing = checked(await db.from('expense_conversions').select('id,status,finalized_at').eq('expense_id',expense.id).eq('target_currency',target).maybeSingle());
    if (existing?.finalized_at) return {status:'finalized',target_currency:target};
    // Persist the retryable exception before contacting any external provider.
    checked(await db.from('expense_conversions').upsert({expense_id:expense.id,target_currency:target,status:'pending',error_metadata:{reason:'Automatic conversion awaiting a historical rate'}}, {onConflict:'expense_id,target_currency',ignoreDuplicates:true}));
// Ask for the exchange rate for the expense date. If unavailable, leave it pending.
    const result = await context.rate(expense.original_currency.trim(), target, expense.transaction_date);
    if (result.status === 'pending') {
      checked(await db.from('expense_conversions').update({error_metadata:result.errors?.length ? result.errors : {reason:'Historical rate unavailable'}}).eq('expense_id',expense.id).eq('target_currency',target).is('finalized_at',null));
      return {status:'pending',target_currency:target};
    }
    const rate = Number(result.rate).toFixed(12);
    checked(await db.from('exchange_rates').upsert({provider:result.provider,base_currency:expense.original_currency.trim(),quote_currency:target,rate,effective_date:result.effectiveDate,fallback_used:result.fallback}, {onConflict:'provider,base_currency,quote_currency,effective_date'}));
// Save the converted amount and the rate details so Finance can check them later.
    const now = new Date().toISOString();
    checked(await db.from('expense_conversions').update({applied_rate:rate,provider:result.provider,requested_date:expense.transaction_date,effective_rate_date:result.effectiveDate,retrieved_at:now,converted_amount:multiplyAndRound(String(expense.original_amount),rate,2),status:'finalized',fallback_used:result.fallback,error_metadata:result.errors?.length ? {providerFailures:result.errors} : null,finalized_at:now,finalized_by:userId}).eq('expense_id',expense.id).eq('target_currency',target).is('finalized_at',null));
    return {status:'finalized',target_currency:target};
  } catch (error) {
    if (target) {
      try { checked(await db.from('expense_conversions').update({error_metadata:{reason:'Automatic conversion failed; retry required',message:error.message}}).eq('expense_id',expense.id).eq('target_currency',target).is('finalized_at',null)); } catch {}
    }
    console.error(JSON.stringify({level:'error',message:'Automatic conversion deferred',expense_id:expense.id}));
    return {status:'pending',target_currency:target||null,message:'Expense saved. Automatic conversion needs a retry.'};
  }
}
