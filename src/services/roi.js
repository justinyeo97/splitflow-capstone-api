import { consolidateExpenses } from './consolidated.js';
import { getHistoricalRate } from './fx.js';
import { decimal } from '../utils/money.js';

export function formatMinor(value) {
  const abs = value < 0n ? -value : value;
  return `${value < 0n ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}
function ratio(numerator, denominator, factor = 1n) {
  const negative = numerator < 0n;
  const abs = negative ? -numerator : numerator;
  const scaled = abs * factor * 100n;
  const rounded = scaled / denominator + ((scaled % denominator) * 2n >= denominator ? 1n : 0n);
  return formatMinor(negative ? -rounded : rounded);
}

// All costs incurred in a country/month are allocated to that country's
// recognized placement revenue in the same month. No per-placement allocation.
// Compare money earned with operating expenses plus salary, in one reporting currency.
export async function calculateRoi(expenses, placements, resolveRate = getHistoricalRate, { groupBy = 'country', period = 'month', currency = 'USD', salaryRows = [] } = {}) {
  const groups = new Map(), rates = new Map();
  const cachedRate = (from, to, date) => {
    const key = `${from}:${to}:${date}`;
    if (!rates.has(key)) rates.set(key, resolveRate(from, to, date));
    return rates.get(key);
  };
// Put each record into the chosen company, country or consultant and time period.
  function group(record, date, isExpense) {
    const countryId = isExpense ? record.attributed_country_id : record.country_id;
    const id = groupBy === 'company' ? 'company' : groupBy === 'consultant' ? record.consultant_id : countryId;
    const name = groupBy === 'company' ? 'Company total' : groupBy === 'consultant' ? record.consultants?.name : record.countries?.name;
    const bucket = period === 'year' ? date.slice(0,4) : period === 'quarter' ? date.slice(0,4)+'-Q'+Math.ceil(Number(date.slice(5,7))/3) : date.slice(0,7);
    const key = (id || 'unassigned')+':'+bucket;
    if (!groups.has(key)) groups.set(key, {country_id:groupBy==='country'?countryId:null,country:groupBy==='country'?(name||'Unassigned'):null,consultant_id:groupBy==='consultant'?id:null,consultant:groupBy==='consultant'?(name||'Unassigned'):null,period:bucket,month:bucket,entity_id:id,company:groupBy==='company'?name:null,expenses:[],placements:[]});
    return groups.get(key);
  }
// Add salary separately and skip marked payroll expenses so salary is not counted twice.
  for (const e of [...expenses.filter(e=>!e.is_payroll),...salaryRows]) group(e,e.transaction_date,true).expenses.push(e);
  for (const p of placements) group(p,p.revenue_recognition_date||p.placement_date,false).placements.push(p);
  const rows = [];
  for (const g of groups.values()) {
    const operating = await consolidateExpenses(g.expenses.filter(e=>e.cost_kind!=='salary'),cachedRate,currency);
    const salary = await consolidateExpenses(g.expenses.filter(e=>e.cost_kind==='salary'),cachedRate,currency);
    const missingSalary = g.expenses.filter(e=>e.salary_missing).length;
    const cost = {total:formatMinor(decimal(operating.total,2)+decimal(salary.total,2)),complete:operating.complete&&salary.complete&&missingSalary===0,unconverted_count:operating.unconverted_count+salary.unconverted_count};
    const missingRevenue = g.placements.filter(p => p.revenue_amount == null || !p.revenue_currency || !p.revenue_recognition_date);
    const revenue = await consolidateExpenses(g.placements.filter(p => !missingRevenue.includes(p)).map(p => ({
      id: p.id, original_amount: String(p.revenue_amount), original_currency: p.revenue_currency,
      transaction_date: p.revenue_recognition_date,
    })), cachedRate,currency);
// Only show profit and ROI when the required money, rate and ownership details are available.
    const complete = cost.complete && revenue.complete && missingRevenue.length === 0 && Boolean(g.entity_id);
// Profit is revenue minus costs. ROI is profit divided by costs, times 100.
    const costs = decimal(cost.total, 2), revenues = decimal(revenue.total, 2);
    rows.push({ country_id: g.country_id, country: g.country, consultant_id:g.consultant_id, consultant:g.consultant, period:g.period, month: g.month, company:g.company,currency,
      operating_costs:operating.total,salary_costs:salary.total,missing_salary_count:missingSalary,costs: cost.total, revenue: revenue.total, profit: complete ? formatMinor(revenues - costs) : null,
      roi_percent: complete && costs > 0n ? ratio(revenues - costs, costs, 100n) : null,
      cost_per_placement: cost.complete && g.entity_id && g.placements.length ? ratio(costs, BigInt(g.placements.length) * 100n) : null,
      placement_count: g.placements.length, expense_count: g.expenses.filter(e=>e.cost_kind!=='salary').length,
      missing_revenue_count: missingRevenue.length,
      missing_cost_rate_count: cost.unconverted_count, missing_revenue_rate_count: revenue.unconverted_count,
      complete,
    });
  }
  return rows.sort((a, b) => b.month.localeCompare(a.month) || (a.country||a.consultant||'').localeCompare(b.country||b.consultant||''));
}
