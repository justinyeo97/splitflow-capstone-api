import test from 'node:test';
import assert from 'node:assert/strict';
import { signupSchema, authCredentials, companyProfileSchema } from '../src/schemas/auth.js';
import { api } from '../src/routes/api.js';
test('signup requires a company name; login keeps its existing contract',()=>{
 const credentials={email:'person@example.com',password:'password123'};
 assert.equal(signupSchema.safeParse(credentials).success,false);
 assert.equal(signupSchema.safeParse({...credentials,company_name:'   '}).success,false);
 assert.equal(signupSchema.safeParse({...credentials,company_name:'x'.repeat(201)}).success,false);
 assert.equal(signupSchema.parse({...credentials,company_name:' Cohort13 '}).company_name,'Cohort13');
 assert.equal(authCredentials.safeParse(credentials).success,true);
 assert.equal(companyProfileSchema.safeParse({company_name:'Cohort13',role:'administrator'}).success,false);
});
test('profile update is scoped to authenticated user and only writes company name',async()=>{
 const handler=api.stack.find(l=>l.route?.path==='/auth/profile'&&l.route.methods.patch).route.stack.at(-1).handle;
 let scope,written;
 const req={user:{id:'own-user'},body:{company_name:' Cohort13 '},db:{from(table){assert.equal(table,'profiles');return {update(body){written=body;return this},eq(column,id){scope={column,id};return this},select(){return this},async single(){return {data:{id:'own-user',company_name:written.company_name},error:null}}}}}};
 await handler(req,{json(body){assert.equal(body.data.company_name,'Cohort13')}});
 assert.deepEqual(scope,{column:'id',id:'own-user'});assert.deepEqual(written,{company_name:'Cohort13'});
});
