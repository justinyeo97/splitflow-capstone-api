import test from 'node:test';
import assert from 'node:assert/strict';
import { consolidateExpenses } from '../src/services/consolidated.js';
const expense = (id, currency, amount, conversions = []) => ({id,original_currency:currency,original_amount:amount,transaction_date:'2025-01-15',expense_conversions:conversions});
test('consolidation automatically includes USD source expenses and historical conversions once per expense', async () => {
  let calls = 0;
  const result = await consolidateExpenses([
    expense('1','USD','10.005'),expense('2','MYR','100'),expense('3','MYR','20'),
    expense('4','THB','100',[{target_currency:'USD',status:'finalized',converted_amount:'3.00'}]),
  ], async () => { calls++; return {rate:'0.25'}; });
  assert.equal(result.total,'43.01'); assert.equal(result.expense_count,4);assert.equal(result.complete,true);assert.equal(calls,1);
});
test('unavailable rates make a partial total explicit without dropping USD expenses', async () => {
  const result = await consolidateExpenses([expense('1','USD','5'),expense('2','MYR','100')],async()=>({status:'pending'}));
  assert.equal(result.total,'5.00');assert.equal(result.complete,false);assert.equal(result.total_expense_count,2);assert.deepEqual(result.unconverted_expense_ids,['2']);
});
test('empty consolidation is zero', async()=>{assert.equal((await consolidateExpenses([])).total,'0.00')});
