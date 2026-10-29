-- Run after the approved invitation change. No accounts or data are committed.
begin;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('20000000-0000-4000-8000-000000000001','test1@mail',now(),'{"company_name":"Cohort13"}'),
 ('20000000-0000-4000-8000-000000000002','test2@mail',now(),'{}'),
 ('20000000-0000-4000-8000-000000000003','not-invited@example.invalid',now(),'{}'),
 ('20000000-0000-4000-8000-000000000004','unverified@example.invalid',null,'{}');
do $$ begin
 if exists(select 1 from public.profiles where id::text like '20000000-%' and (company_id is not null or role<>'viewer')) then raise exception 'Signup granted company access'; end if;
end $$;
select set_config('test.company_id',(select company_id::text from public.profiles where email='yeojiaxing97@gmail.com'),true);
select set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$ begin
 if (select count(*) from public.available_companies())<>1 then raise exception 'Invited companies were not filtered correctly'; end if;
 perform public.join_invited_company(current_setting('test.company_id')::uuid);
 if (select count(*) from public.expenses)=0 then raise exception 'Invited consultant cannot see their expenses'; end if;
 if exists(select 1 from public.expenses where consultant_id<>private.current_consultant_id()) then raise exception 'Other consultant expenses leaked'; end if;
 if exists(select 1 from public.consultants) or exists(select 1 from public.placements) or exists(select 1 from public.compensation_history) or exists(select 1 from public.import_batches) then raise exception 'Company data leaked to consultant'; end if;
 if (select count(*) from public.my_consultant())<>1 then raise exception 'Own identity is unavailable'; end if;
 begin
   insert into public.expenses(consultant_id,attributed_country_id,transaction_date,original_amount,original_currency,category,created_by)
   select id,country_id,current_date,1,'USD','Travel',auth.uid() from public.my_consultant();
   raise exception 'Consultant was able to write expenses';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
do $$ begin
 if exists(select 1 from public.available_companies()) then raise exception 'Company names leaked to uninvited user'; end if;
 begin perform public.join_invited_company(current_setting('test.company_id')::uuid);raise exception 'Uninvited user joined company';exception when insufficient_privilege then null;end;
end $$;
reset role;
-- Revoking the invitation must immediately revoke an already-issued login's access.
select set_config('request.jwt.claims',json_build_object('sub',id,'role','authenticated')::text,true) from public.profiles where email='yeojiaxing97@gmail.com';
update public.consultants set email=null where email='test1@mail';
select set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$ begin if exists(select 1 from public.expenses) then raise exception 'Revoked consultant retained access';end if;end $$;
reset role;
rollback;
