import test from 'node:test';
import assert from 'node:assert/strict';
import { consultantSchema } from '../src/schemas/consultant.js';
import { api } from '../src/routes/api.js';
const body={external_id:'C-1004',name:'Test Consultant',country_id:'12345678-1234-4234-8234-123456789abc',job_title:' Recruitment Consultant ',annual_salary:'96000.00',salary_currency:'MYR',salary_effective_from:'2026-10-01'};
test('consultant compensation validates salary, title, currency and effective date',()=>{
 assert.equal(consultantSchema.parse(body).job_title,'Recruitment Consultant');
 for(const change of [{annual_salary:'-1'},{annual_salary:'1.001'},{annual_salary:''},{salary_currency:'myr'},{job_title:' '},{salary_effective_from:'invalid'}])assert.equal(consultantSchema.safeParse({...body,...change}).success,false);
 assert.equal(consultantSchema.safeParse({...body,annual_salary:'0'}).success,true);
});
test('consultant creation and editing persist compensation fields',async()=>{
 for(const method of ['post','patch']){
  const handler=api.stack.find(l=>l.route?.path===(method==='post'?'/consultants':'/consultants/:id')&&l.route.methods[method]).route.stack.at(-1).handle;
  let written;
  const request={body:{...body,country_effective_from:'2026-10-01'},params:{id:body.country_id},db:{from(){return {insert(v){written=v;return this},update(v){written=v;return this},eq(){return this},select(){return this},async single(){return {data:written,error:null}}}}}};
  await handler(request,{status(){return this},json(value){assert.equal(value.data.annual_salary,'96000.00')}});
  assert.equal(Object.hasOwn(written,'external_id'),false);assert.equal(written.salary_currency,'MYR');assert.equal(written.salary_effective_from,'2026-10-01');
 }
});

test('consultant creation requires no external ID',()=>{const {external_id,...withoutId}=body;assert.equal(consultantSchema.safeParse(withoutId).success,true);assert.equal(Object.hasOwn(consultantSchema.parse(body),'external_id'),false)});
