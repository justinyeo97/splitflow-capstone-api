import { getHistoricalRate } from './fx.js';
import { decimal, multiplyAndRound } from '../utils/money.js';

// Read-only USD valuation. Reuse finalized USD records; value other expenses
// from their original amount using the transaction-date rate.
export async function consolidateExpenses(expenses, resolveRate = getHistoricalRate, targetCurrency = 'USD') {
  let total = 0n, included = 0;
  const missing = [], rates = new Map();
  for (const expense of expenses) {
    const stored = expense.expense_conversions?.find(c => c.target_currency.trim() === targetCurrency && c.status === 'finalized');
    let amount;
    if (decimal(String(expense.original_amount)) === 0n) amount = '0.00';
    else if (stored) amount = stored.converted_amount;
    else if (expense.original_currency.trim() === targetCurrency) amount = multiplyAndRound(String(expense.original_amount), '1');
    else {
      const currency = expense.original_currency.trim();
      const key = currency + ':' + expense.transaction_date;
      if (!rates.has(key)) rates.set(key, await resolveRate(currency, targetCurrency, expense.transaction_date));
      const rate = rates.get(key);
      if (rate.status === 'pending') { missing.push(expense.id); continue; }
      amount = multiplyAndRound(String(expense.original_amount), Number(rate.rate).toFixed(12));
    }
    total += decimal(String(amount), 2); included++;
  }
  return { currency: targetCurrency, total: (total / 100n).toString() + '.' + (total % 100n).toString().padStart(2, '0'), expense_count: included, total_expense_count: expenses.length, unconverted_count: missing.length, unconverted_expense_ids: missing, complete: missing.length === 0 };
}
