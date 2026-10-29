create table public.companies(
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(btrim(name)) between 1 and 200),
 home_currency text not null default 'USD' check(home_currency ~ '^[A-Z]{3}$'),
 reporting_timezone text not null default 'Asia/Kuala_Lumpur',
 created_at timestamptz not null default now()
);
alter table public.profiles add column company_id uuid references public.companies(id);
create table public.company_memberships(
 company_id uuid not null references public.companies(id),
 user_id uuid not null references public.profiles(id),
 role public.app_role not null,
 primary key(company_id,user_id)
);
do $$
declare p record; cid uuid;
begin
 if (select count(*) from public.profiles)<>1 then raise exception 'Existing data requires an explicit ownership mapping'; end if;
 for p in select * from public.profiles loop
 insert into public.companies(name) values(coalesce(nullif(btrim(p.company_name),''),'My company')) returning id into cid;
 update public.profiles set company_id=cid where id=p.id;
 insert into public.company_memberships values(cid,p.id,p.role);
 end loop;
end $$;
alter table public.profiles alter column company_id set not null;
create function private.current_company_id() returns uuid language sql stable security definer set search_path=''
as $$ select p.company_id from public.profiles p where p.id=(select auth.uid()) and p.active $$;
revoke all on function private.current_company_id() from public,anon;
grant execute on function private.current_company_id() to authenticated;
create or replace function private.current_app_role() returns public.app_role language sql stable security definer set search_path=''
as $$ select m.role from public.company_memberships m join public.profiles p on p.id=m.user_id and p.company_id=m.company_id where p.id=(select auth.uid()) and p.active $$;
alter table public.expense_conversions disable trigger finalized_conversion_immutable;
alter table public.countries add column company_id uuid references public.companies(id);
update public.countries set company_id=(select company_id from public.profiles limit 1);
alter table public.countries alter column company_id set not null;
alter table public.countries alter column company_id set default private.current_company_id();
create index countries_company_idx on public.countries(company_id);
alter table public.countries add unique(id,company_id);
alter table public.consultants add column company_id uuid references public.companies(id);
update public.consultants set company_id=(select company_id from public.profiles limit 1);
alter table public.consultants alter column company_id set not null;
alter table public.consultants alter column company_id set default private.current_company_id();
create index consultants_company_idx on public.consultants(company_id);
alter table public.consultants add unique(id,company_id);
alter table public.consultant_country_history add column company_id uuid references public.companies(id);
update public.consultant_country_history set company_id=(select company_id from public.profiles limit 1);
alter table public.consultant_country_history alter column company_id set not null;
alter table public.consultant_country_history alter column company_id set default private.current_company_id();
create index consultant_country_history_company_idx on public.consultant_country_history(company_id);
alter table public.consultant_country_history add unique(id,company_id);
alter table public.expenses add column company_id uuid references public.companies(id);
update public.expenses set company_id=(select company_id from public.profiles limit 1);
alter table public.expenses alter column company_id set not null;
alter table public.expenses alter column company_id set default private.current_company_id();
create index expenses_company_idx on public.expenses(company_id);
alter table public.expenses add unique(id,company_id);
alter table public.placements add column company_id uuid references public.companies(id);
update public.placements set company_id=(select company_id from public.profiles limit 1);
alter table public.placements alter column company_id set not null;
alter table public.placements alter column company_id set default private.current_company_id();
create index placements_company_idx on public.placements(company_id);
alter table public.placements add unique(id,company_id);
alter table public.expense_conversions add column company_id uuid references public.companies(id);
update public.expense_conversions set company_id=(select company_id from public.profiles limit 1);
alter table public.expense_conversions alter column company_id set not null;
alter table public.expense_conversions alter column company_id set default private.current_company_id();
create index expense_conversions_company_idx on public.expense_conversions(company_id);
alter table public.expense_conversions add unique(id,company_id);
alter table public.import_batches add column company_id uuid references public.companies(id);
update public.import_batches set company_id=(select company_id from public.profiles limit 1);
alter table public.import_batches alter column company_id set not null;
alter table public.import_batches alter column company_id set default private.current_company_id();
create index import_batches_company_idx on public.import_batches(company_id);
alter table public.import_batches add unique(id,company_id);
alter table public.import_row_errors add column company_id uuid references public.companies(id);
update public.import_row_errors set company_id=(select company_id from public.profiles limit 1);
alter table public.import_row_errors alter column company_id set not null;
alter table public.import_row_errors alter column company_id set default private.current_company_id();
create index import_row_errors_company_idx on public.import_row_errors(company_id);
alter table public.import_row_errors add unique(id,company_id);
alter table public.expense_conversions enable trigger finalized_conversion_immutable;
alter table public.profiles add unique(id,company_id);
alter table public.countries drop constraint countries_name_key, drop constraint countries_iso_code_key;
alter table public.countries add unique(company_id,name), add unique(company_id,iso_code);
alter table public.expenses drop constraint expenses_source_identifier_key;
alter table public.expenses add unique(company_id,source_identifier);
alter table public.consultants drop constraint consultants_country_id_fkey;
alter table public.consultants add constraint consultants_country_id_fkey foreign key(country_id,company_id) references public.countries(id,company_id);
alter table public.consultant_country_history drop constraint consultant_country_history_consultant_id_fkey;
alter table public.consultant_country_history add constraint consultant_country_history_consultant_id_fkey foreign key(consultant_id,company_id) references public.consultants(id,company_id);
alter table public.consultant_country_history drop constraint consultant_country_history_country_id_fkey;
alter table public.consultant_country_history add constraint consultant_country_history_country_id_fkey foreign key(country_id,company_id) references public.countries(id,company_id);
alter table public.expenses drop constraint expenses_consultant_id_fkey;
alter table public.expenses add constraint expenses_consultant_id_fkey foreign key(consultant_id,company_id) references public.consultants(id,company_id);
alter table public.expenses drop constraint expenses_attributed_country_id_fkey;
alter table public.expenses add constraint expenses_attributed_country_id_fkey foreign key(attributed_country_id,company_id) references public.countries(id,company_id);
alter table public.expenses drop constraint expenses_import_batch_id_fkey;
alter table public.expenses add constraint expenses_import_batch_id_fkey foreign key(import_batch_id,company_id) references public.import_batches(id,company_id);
alter table public.placements drop constraint placements_consultant_id_fkey;
alter table public.placements add constraint placements_consultant_id_fkey foreign key(consultant_id,company_id) references public.consultants(id,company_id);
alter table public.placements drop constraint placements_country_id_fkey;
alter table public.placements add constraint placements_country_id_fkey foreign key(country_id,company_id) references public.countries(id,company_id);
alter table public.expense_conversions drop constraint expense_conversions_expense_id_fkey;
alter table public.expense_conversions add constraint expense_conversions_expense_id_fkey foreign key(expense_id,company_id) references public.expenses(id,company_id);
alter table public.import_row_errors drop constraint import_row_errors_batch_id_fkey;
alter table public.import_row_errors add constraint import_row_errors_batch_id_fkey foreign key(batch_id,company_id) references public.import_batches(id,company_id);
create function private.prevent_company_move() returns trigger language plpgsql set search_path='' as $$
begin if new.company_id is distinct from old.company_id then raise exception 'Company ownership cannot be changed'; end if; return new; end $$;
revoke all on function private.prevent_company_move() from public,anon,authenticated;
create trigger immutable_company before update on public.countries for each row execute function private.prevent_company_move();
create trigger immutable_company before update on public.consultants for each row execute function private.prevent_company_move();
create trigger immutable_company before update on public.consultant_country_history for each row execute function private.prevent_company_move();
create trigger immutable_company before update on public.expenses for each row execute function private.prevent_company_move();
create trigger immutable_company before update on public.placements for each row execute function private.prevent_company_move();
create trigger immutable_company before update on public.expense_conversions for each row execute function private.prevent_company_move();
create trigger immutable_company before update on public.import_batches for each row execute function private.prevent_company_move();
create trigger immutable_company before update on public.import_row_errors for each row execute function private.prevent_company_move();
create trigger immutable_company before update on public.profiles for each row execute function private.prevent_company_move();
do $$ declare p record; begin for p in select tablename,policyname from pg_policies where schemaname='public' and tablename in ('profiles','countries','consultants','consultant_country_history','expenses','placements','expense_conversions','import_batches','import_row_errors') loop execute format('drop policy %I on public.%I',p.policyname,p.tablename); end loop; end $$;
alter table public.companies enable row level security;
alter table public.company_memberships enable row level security;
revoke all on public.companies,public.company_memberships from anon,authenticated;
grant select on public.companies,public.company_memberships to authenticated;
grant update(name,home_currency) on public.companies to authenticated;
create policy company_read on public.companies for select to authenticated using(id=(select private.current_company_id()));
create policy company_update on public.companies for update to authenticated using(id=(select private.current_company_id()) and (select private.current_app_role())='administrator') with check(id=(select private.current_company_id()) and (select private.current_app_role())='administrator');
create policy membership_read on public.company_memberships for select to authenticated using(company_id=(select private.current_company_id()) and (user_id=(select auth.uid()) or (select private.current_app_role())='administrator'));
revoke update on public.profiles from authenticated;
grant update(company_name) on public.profiles to authenticated;
create policy profile_read on public.profiles for select to authenticated using(id=(select auth.uid()));
create policy profile_update on public.profiles for update to authenticated using(id=(select auth.uid())) with check(id=(select auth.uid()));
revoke all on public.countries from anon;
create policy tenant_read on public.countries for select to authenticated using(company_id=(select private.current_company_id()) and (select private.current_app_role()) is not null);
create policy tenant_insert on public.countries for insert to authenticated with check(company_id=(select private.current_company_id()) and (select private.current_app_role()) ='administrator');
create policy tenant_update on public.countries for update to authenticated using(company_id=(select private.current_company_id()) and (select private.current_app_role()) ='administrator') with check(company_id=(select private.current_company_id()) and (select private.current_app_role()) ='administrator');
revoke all on public.consultants from anon;
create policy tenant_read on public.consultants for select to authenticated using(company_id=(select private.current_company_id()) and (select private.current_app_role()) is not null);
create policy tenant_insert on public.consultants for insert to authenticated with check(company_id=(select private.current_company_id()) and (select private.current_app_role()) in ('administrator','finance'));
create policy tenant_update on public.consultants for update to authenticated using(company_id=(select private.current_company_id()) and (select private.current_app_role()) in ('administrator','finance')) with check(company_id=(select private.current_company_id()) and (select private.current_app_role()) in ('administrator','finance'));
revoke all on public.consultant_country_history from anon;
create policy tenant_read on public.consultant_country_history for select to authenticated using(company_id=(select private.current_company_id()) and (select private.current_app_role()) is not null);
create policy tenant_insert on public.consultant_country_history for insert to authenticated with check(company_id=(select private.current_company_id()) and (select private.current_app_role()) in ('administrator','finance'));
create policy tenant_update on public.consultant_country_history for update to authenticated using(company_id=(select private.current_company_id()) and (select private.current_app_role()) in ('administrator','finance')) with check(company_id=(select private.current_company_id()) and (select private.current_app_role()) in ('administrator','finance'));
revoke all on public.expenses from anon;
create policy tenant_read on public.expenses for select to authenticated using(company_id=(select private.current_company_id()) and (select private.current_app_role()) is not null);
create policy tenant_insert on public.expenses for insert to authenticated with check(company_id=(select private.current_company_id()) and (select private.current_app_role()) in ('administrator','finance'));
create policy tenant_update on public.expenses for update to authenticated using(company_id=(select private.current_company_id()) and (select private.current_app_role()) in ('administrator','finance')) with check(company_id=(select private.current_company_id()) and (select private.current_app_role()) in ('administrator','finance'));
revoke all on public.placements from anon;
create policy tenant_read on public.placements for select to authenticated using(company_id=(select private.current_company_id()) and (select private.current_app_role()) is not null);
create policy tenant_insert on public.placements for insert to authenticated with check(company_id=(select private.current_company_id()) and (select private.current_app_role()) in ('administrator','finance'));
create policy tenant_update on public.placements for update to authenticated using(company_id=(select private.current_company_id()) and (select private.current_app_role()) in ('administrator','finance')) with check(company_id=(select private.current_company_id()) and (select private.current_app_role()) in ('administrator','finance'));
revoke all on public.expense_conversions from anon;
create policy tenant_read on public.expense_conversions for select to authenticated using(company_id=(select private.current_company_id()) and (select private.current_app_role()) is not null);
create policy tenant_insert on public.expense_conversions for insert to authenticated with check(company_id=(select private.current_company_id()) and (select private.current_app_role()) in ('administrator','finance'));
create policy tenant_update on public.expense_conversions for update to authenticated using(company_id=(select private.current_company_id()) and (select private.current_app_role()) in ('administrator','finance')) with check(company_id=(select private.current_company_id()) and (select private.current_app_role()) in ('administrator','finance'));
revoke all on public.import_batches from anon;
create policy tenant_read on public.import_batches for select to authenticated using(company_id=(select private.current_company_id()) and (select private.current_app_role()) is not null);
create policy tenant_insert on public.import_batches for insert to authenticated with check(company_id=(select private.current_company_id()) and (select private.current_app_role()) in ('administrator','finance'));
create policy tenant_update on public.import_batches for update to authenticated using(company_id=(select private.current_company_id()) and (select private.current_app_role()) in ('administrator','finance')) with check(company_id=(select private.current_company_id()) and (select private.current_app_role()) in ('administrator','finance'));
revoke all on public.import_row_errors from anon;
create policy tenant_read on public.import_row_errors for select to authenticated using(company_id=(select private.current_company_id()) and (select private.current_app_role()) is not null);
create policy tenant_insert on public.import_row_errors for insert to authenticated with check(company_id=(select private.current_company_id()) and (select private.current_app_role()) in ('administrator','finance'));
create or replace function public.create_profile_for_auth_user() returns trigger language plpgsql security definer set search_path='' as $$
declare cid uuid; company text;
begin
 company:=nullif(btrim(new.raw_user_meta_data->>'company_name'),'');
 insert into public.companies(name) values(coalesce(company,'My company')) returning id into cid;
 insert into public.profiles(id,email,company_name,company_id,role) values(new.id,new.email,company,cid,'administrator');
 insert into public.company_memberships(company_id,user_id,role) values(cid,new.id,'administrator');
 return new;
end $$;
revoke all on function public.create_profile_for_auth_user() from public,anon,authenticated;

create extension if not exists btree_gist;
alter table public.consultants add column employment_start_date date;
alter table public.consultants add column employment_end_date date;
update public.consultants set employment_start_date=coalesce(salary_effective_from,country_effective_from);
alter table public.consultants alter column employment_start_date set default current_date;
alter table public.consultants alter column employment_start_date set not null;
alter table public.consultants add constraint valid_employment_dates check(employment_end_date is null or employment_end_date>=employment_start_date);
create table public.compensation_history(
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null default private.current_company_id() references public.companies(id),
 consultant_id uuid not null,
 annual_salary numeric(16,2) not null check(annual_salary>=0 and annual_salary<>'NaN'::numeric),
 salary_currency text not null check(salary_currency ~ '^[A-Z]{3}$'),
 effective_from date not null,
 effective_to date,
 check(effective_to is null or effective_to>=effective_from),
 foreign key(consultant_id,company_id) references public.consultants(id,company_id),
 unique(consultant_id,effective_from),
 exclude using gist(consultant_id with =,daterange(effective_from,effective_to,'[]') with &&)
);
insert into public.compensation_history(company_id,consultant_id,annual_salary,salary_currency,effective_from)
select company_id,id,annual_salary,salary_currency,salary_effective_from from public.consultants where annual_salary is not null;
create index compensation_history_company_idx on public.compensation_history(company_id);
alter table public.compensation_history enable row level security;
revoke all on public.compensation_history from anon,authenticated;
grant select on public.compensation_history to authenticated;
create policy salary_read on public.compensation_history for select to authenticated using(company_id=(select private.current_company_id()) and (select private.current_app_role()) is not null);
-- Only the consultant trigger writes compensation history; direct clients cannot rewrite historical pay.
create function private.record_compensation() returns trigger language plpgsql security definer set search_path='' as $$
declare latest date;
begin
 if tg_op='UPDATE' and (new.annual_salary,new.salary_currency,new.salary_effective_from) is not distinct from (old.annual_salary,old.salary_currency,old.salary_effective_from) then return new; end if;
 if new.annual_salary is null then return new; end if;
 select max(effective_from) into latest from public.compensation_history where consultant_id=new.id;
 if latest is not null and new.salary_effective_from<=latest then raise exception 'Salary changes need a new effective date after the previous salary'; end if;
 update public.compensation_history set effective_to=new.salary_effective_from-1 where consultant_id=new.id and effective_to is null;
 insert into public.compensation_history(company_id,consultant_id,annual_salary,salary_currency,effective_from) values(new.company_id,new.id,new.annual_salary,new.salary_currency,new.salary_effective_from);
 return new;
end $$;
revoke all on function private.record_compensation() from public,anon,authenticated;
create trigger compensation_snapshot after insert or update of annual_salary,salary_currency,salary_effective_from on public.consultants for each row execute function private.record_compensation();
alter table public.expenses add column is_payroll boolean not null default false;
