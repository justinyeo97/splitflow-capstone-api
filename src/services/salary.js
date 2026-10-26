import { decimal } from '../utils/money.js';

const iso = date => date.toISOString().slice(0, 10);
const utc = date => new Date(date + 'T00:00:00Z');
const next = date => { const value = utc(date); value.setUTCDate(value.getUTCDate() + 1); return iso(value); };
function money(value) { return `${value / 100n}.${String(value % 100n).padStart(2, '0')}`; }

// Monthly base pay is annual / 12, accrued by calendar days. Allocate cents
// cumulatively so country moves and salary changes never introduce duplicate days.
// Work out salary costs for the reporting dates, stopping at today or the employment end date.
export function salaryExpenses(consultants, histories, assignments, { start, end, asOf = iso(new Date()) } = {}) {
  const rows = [], issues = [];
  const last = end && end < next(asOf) ? end : next(asOf);
  for (const person of consultants) {
    const salaries = histories.filter(h => h.consultant_id === person.id).sort((a, b) => a.effective_from.localeCompare(b.effective_from));
    const employmentStart = person.employment_start_date || salaries[0]?.effective_from;
    if (!employmentStart) { issues.push({ consultant_id: person.id, reason: 'Employment start or salary history missing' }); continue; }
    let from = start && start > employmentStart ? start : employmentStart;
    const until = person.employment_end_date && next(person.employment_end_date) < last ? next(person.employment_end_date) : last;
    if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(until))) throw new Error('Invalid salary reporting dates');
    const segments = new Map();
    // For each day, find the salary and country that applied on that day.
    for (let day = from; day < until; day = next(day)) {
      const pay = salaries.find(h => h.effective_from <= day && (!h.effective_to || h.effective_to >= day));
      const assignment = assignments.find(h => h.consultant_id === person.id && h.effective_from <= day && (!h.effective_to || h.effective_to >= day));
      const month = day.slice(0, 7), key = `${person.id}:${month}:${pay?.id || 'missing'}:${assignment?.country_id || 'unassigned'}`;
      if (!segments.has(key)) segments.set(key, { pay, assignment, month, days: [], key });
      segments.get(key).days.push(day);
    }
    // Group those days by month, salary record and country, then calculate each group cost.
    for (const s of segments.values()) {
      const monthEnd = new Date(Date.UTC(Number(s.month.slice(0, 4)), Number(s.month.slice(5)), 0));
      const daysInMonth = monthEnd.getUTCDate();
      const missing = !s.pay;
      let cents = 0n;
      if (!missing) {
        const annual = decimal(String(s.pay.annual_salary), 2), divisor = 12n * BigInt(daysInMonth);
        // Share out the cents carefully so splitting a month does not add extra money.
        const rounded = day => (annual * BigInt(day) * 2n + divisor) / (2n * divisor);
        for (const day of s.days) { const n = Number(day.slice(8)); cents += rounded(n) - rounded(n - 1); }
      }
      rows.push({
        id: 'salary:' + s.key, consultant_id: person.id, consultants: { name: person.name },
        attributed_country_id: s.assignment?.country_id || null, countries: s.assignment?.countries || null,
        transaction_date: s.days.at(-1), original_amount: money(cents), original_currency: s.pay?.salary_currency || 'USD',
        cost_kind: 'salary', salary_missing: missing, accrued_days: s.days.length,
      });
    }
  }
  return { rows, issues };
}
