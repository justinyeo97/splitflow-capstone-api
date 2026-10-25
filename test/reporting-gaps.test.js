import test from 'node:test';
import assert from 'node:assert/strict';
import { salaryExpenses } from '../src/services/salary.js';
import { calculateRoi } from '../src/services/roi.js';
import { consolidateExpenses } from '../src/services/consolidated.js';
import { companyClient } from '../src/services/company.js';

const person = {id:'p1',name:'Consultant',employment_start_date:'2026-01-01'};
const pay = {id:'pay1',consultant_id:'p1',annual_salary:'120000.00',salary_currency:'USD',effective_from:'2026-01-01'};
const assignment = {consultant_id:'p1',country_id:'MY',countries:{name:'Malaysia'},effective_from:'2026-01-01'};
const sum = rows => rows.reduce((n,row)=>n+BigInt(row.original_amount.replace('.','')),0n);

test('full year and quarter accrue annual salary without monthly rounding drift',()=>{
  const full=salaryExpenses([person],[pay],[assignment],{start:'2026-01-01',end:'2027-01-01',asOf:'2026-12-31'});
  assert.equal(full.rows.length,12); assert.equal(sum(full.rows),12000000n);
  const quarter=salaryExpenses([person],[pay],[assignment],{start:'2026-01-01',end:'2026-04-01',asOf:'2026-12-31'});
  assert.equal(sum(quarter.rows),3000000n);
});
test('employment dates and current date bound payroll including leap days',()=>{
  const p={...person,employment_start_date:'2024-02-15',employment_end_date:'2024-02-29'};
  const result=salaryExpenses([p],[{...pay,effective_from:'2024-01-01'}],[{...assignment,effective_from:'2024-01-01'}],{asOf:'2024-02-20'});
  assert.equal(result.rows.length,1);assert.equal(result.rows[0].accrued_days,6);
  assert.equal(result.rows[0].transaction_date,'2024-02-20');
  assert.equal(sum(result.rows),206896n);
});
test('country transfers divide salary without duplicating days or cents',()=>{
  const history=[{...assignment,effective_to:'2026-01-15'},{...assignment,country_id:'SG',countries:{name:'Singapore'},effective_from:'2026-01-16'}];
  const {rows}=salaryExpenses([person],[pay],history,{start:'2026-01-01',end:'2026-02-01',asOf:'2026-12-31'});
  assert.equal(rows.length,2);assert.equal(sum(rows),1000000n);assert.equal(rows.reduce((n,r)=>n+r.accrued_days,0),31);
});
test('salary changes use historical rates rather than overwriting earlier pay',()=>{
  const history=[{...pay,effective_to:'2026-01-31'},{...pay,id:'pay2',annual_salary:'240000.00',effective_from:'2026-02-01'}];
  const {rows}=salaryExpenses([person],history,[assignment],{start:'2026-01-01',end:'2026-03-01',asOf:'2026-12-31'});
  assert.equal(rows[0].original_amount,'10000.00');assert.equal(rows[1].original_amount,'20000.00');
});
test('salary gaps are represented explicitly instead of invented zero pay',async()=>{
  const {rows}=salaryExpenses([person],[],[assignment],{start:'2026-01-01',end:'2026-02-01',asOf:'2026-12-31'});
  const [report]=await calculateRoi([],[],undefined,{salaryRows:rows});
  assert.equal(report.complete,false);assert.equal(report.roi_percent,null);assert.equal(report.missing_salary_count,1);
});
test('ROI includes salary, excludes marked payroll, and consolidates countries in home currency',async()=>{
  const rows=[{id:'salary',consultant_id:'p1',attributed_country_id:'MY',original_amount:'1000',original_currency:'EUR',transaction_date:'2026-01-31',cost_kind:'salary'}];
  const expenses=[{...rows[0],id:'office',cost_kind:undefined,original_amount:'200'}, {...rows[0],id:'payroll',cost_kind:undefined,original_amount:'1000',is_payroll:true}];
  const placements=[{id:'rev',consultant_id:'p1',country_id:'SG',revenue_amount:'2400',revenue_currency:'EUR',revenue_recognition_date:'2026-01-15'}];
  const [report]=await calculateRoi(expenses,placements,async()=>({rate:'2'}),{groupBy:'company',currency:'MYR',salaryRows:rows});
  assert.equal(report.currency,'MYR');assert.equal(report.operating_costs,'400.00');assert.equal(report.salary_costs,'2000.00');assert.equal(report.costs,'2400.00');assert.equal(report.revenue,'4800.00');assert.equal(report.roi_percent,'100.00');
});
test('consolidation uses target currency and ignores finalized amounts in another currency',async()=>{
  const [expense]=[{id:'e',original_amount:'100',original_currency:'EUR',transaction_date:'2026-01-01',expense_conversions:[{target_currency:'USD',status:'finalized',converted_amount:'999'}]}];
  const report=await consolidateExpenses([expense],async(from,to)=>{assert.equal(to,'MYR');return {rate:'5'}},'MYR');
  assert.equal(report.total,'500.00');assert.equal(report.currency,'MYR');
});
test('API scopes reads and updates and overwrites untrusted ownership on writes',()=>{
  const calls=[];
  const base={from(table){return {select(...args){calls.push(['select',table,...args]);return this},eq(...args){calls.push(['eq',...args]);return this},update(...args){calls.push(['update',...args]);return this},insert(body){calls.push(['insert',body]);return this},upsert(body){calls.push(['upsert',body]);return this}}}};
  const db=companyClient(base,'company-A');
  db.from('expenses').select('*');db.from('consultants').update({name:'x'});db.from('expenses').insert({company_id:'company-B',category:'Travel'});db.from('expenses').upsert([{company_id:'company-B'}]);
  assert.equal(calls.filter(c=>c[0]==='eq'&&c[1]==='company_id'&&c[2]==='company-A').length,2);
  assert.equal(calls.find(c=>c[0]==='insert')[1].company_id,'company-A');assert.equal(calls.find(c=>c[0]==='upsert')[1][0].company_id,'company-A');
});
