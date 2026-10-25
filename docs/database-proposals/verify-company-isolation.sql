-- Run AFTER the migration, using the SQL editor as postgres. Everything rolls back.
begin;
insert into auth.users(id,email,raw_user_meta_data) values
 ('10000000-0000-4000-8000-000000000001','tenant-a-test@example.invalid','{"company_name":"Isolation test"}'),
 ('10000000-0000-4000-8000-000000000002','tenant-b-test@example.invalid','{"company_name":"Isolation test"}');
do $$ begin
 if (select count(distinct company_id) from public.profiles where id in ('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002'))<>2
 then raise exception 'Same-name signups incorrectly joined companies'; end if;
end $$;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
insert into public.countries(name,iso_code,default_reporting_currency) values('Isolation country','ZZ','USD');
insert into public.consultants(name,country_id,country_effective_from,annual_salary,salary_currency,salary_effective_from,employment_start_date)
select 'Isolation consultant',id,'2026-01-01',120000,'USD','2026-01-01','2026-01-01' from public.countries where iso_code='ZZ';
do $$ begin
 if (select count(*) from public.consultants)<>1 then raise exception 'Tenant A can read another company'; end if;
 if (select count(*) from public.compensation_history)<>1 then raise exception 'Compensation trigger failed'; end if;
 begin
   update public.profiles set role='viewer' where id=auth.uid();
   raise exception 'Profile role is writable';
 exception when insufficient_privilege then null; end;
 begin
   insert into public.company_memberships(company_id,user_id,role) values(private.current_company_id(),'10000000-0000-4000-8000-000000000002','administrator');
   raise exception 'Membership escalation permitted';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
-- Save A's country ID in transaction-local state to attempt a cross-tenant link.
select set_config('test.foreign_country',(select id::text from public.countries where company_id=(select company_id from public.profiles where id='10000000-0000-4000-8000-000000000001')),true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
do $$ begin
 if exists(select 1 from public.countries) or exists(select 1 from public.consultants) or exists(select 1 from public.compensation_history) or exists(select 1 from public.expenses) or exists(select 1 from public.placements)
 then raise exception 'Tenant B can read another company'; end if;
 begin
   insert into public.consultants(name,country_id) values('Invalid cross-company consultant',current_setting('test.foreign_country')::uuid);
   raise exception 'Cross-company foreign key permitted';
 exception when foreign_key_violation then null; end;
end $$;
-- Same country names and ISO codes are valid in separate companies.
insert into public.countries(name,iso_code,default_reporting_currency) values('Isolation country','ZZ','USD');
reset role;
rollback;
