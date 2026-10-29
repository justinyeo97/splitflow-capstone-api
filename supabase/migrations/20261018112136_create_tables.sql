create extension if not exists pgcrypto;
create type public.app_role as enum ('administrator','finance','viewer');
create type public.conversion_status as enum ('pending','finalized','review');

create table public.profiles(id uuid primary key references auth.users(id) on delete cascade,email text,role public.app_role not null default 'viewer',active boolean not null default true,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create function public.create_profile_for_auth_user() returns trigger language plpgsql security definer set search_path = '' as $$ begin insert into public.profiles(id,email) values(new.id,new.email) on conflict(id) do nothing; return new; end; $$;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.create_profile_for_auth_user();
create function public.current_app_role() returns public.app_role language sql stable security definer set search_path = '' as $$ select role from public.profiles where id=(select auth.uid()) and active=true $$;

create table public.countries(id uuid primary key default gen_random_uuid(),name text not null unique,iso_code char(2) not null unique check(iso_code ~ '^[A-Z]{2}$'),default_reporting_currency char(3) not null check(default_reporting_currency ~ '^[A-Z]{3}$'),created_at timestamptz not null default now());
create table public.consultants(id uuid primary key default gen_random_uuid(),external_id text not null unique,name text not null,country_id uuid not null references public.countries(id) on delete restrict,active boolean not null default true,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create index consultants_country_idx on public.consultants(country_id);
alter table public.consultants add column country_effective_from date not null default current_date;
create table public.consultant_country_history(id uuid primary key default gen_random_uuid(),consultant_id uuid not null references public.consultants(id) on delete cascade,country_id uuid not null references public.countries(id) on delete restrict,effective_from date not null,effective_to date,created_at timestamptz not null default now(),unique(consultant_id,effective_from),check(effective_to is null or effective_to>=effective_from));
create index consultant_country_at_date_idx on public.consultant_country_history(consultant_id,effective_from desc,effective_to);
create function public.track_consultant_country() returns trigger language plpgsql as $$
declare latest date;
begin
 if tg_op='INSERT' then insert into public.consultant_country_history(consultant_id,country_id,effective_from) values(new.id,new.country_id,new.country_effective_from); return new; end if;
 if new.country_id is distinct from old.country_id or new.country_effective_from is distinct from old.country_effective_from then
   select max(effective_from) into latest from public.consultant_country_history where consultant_id=new.id;
   if latest is not null and new.country_effective_from<=latest then raise exception 'Country assignment dates must be added in chronological order'; end if;
   update public.consultant_country_history set effective_to=new.country_effective_from-1 where consultant_id=new.id and effective_to is null;
   insert into public.consultant_country_history(consultant_id,country_id,effective_from) values(new.id,new.country_id,new.country_effective_from);
 end if;
 return new;
end; $$;
create trigger consultant_country_snapshot after insert or update of country_id,country_effective_from on public.consultants for each row execute procedure public.track_consultant_country();
create table public.import_batches(id uuid primary key default gen_random_uuid(),filename text not null,uploaded_by uuid not null references public.profiles(id),uploaded_at timestamptz not null default now(),total_rows integer not null default 0 check(total_rows>=0),accepted_rows integer not null default 0,rejected_rows integer not null default 0,duplicate_rows integer not null default 0,status text not null default 'processing' check(status in ('processing','completed','failed')));
create table public.expenses(id uuid primary key default gen_random_uuid(),consultant_id uuid not null references public.consultants(id) on delete restrict,attributed_country_id uuid not null references public.countries(id) on delete restrict,transaction_date date not null,original_amount numeric(22,8) not null check(original_amount>=0),original_currency char(3) not null check(original_currency ~ '^[A-Z]{3}$'),category text not null,vendor text,description text,source_identifier text,import_batch_id uuid references public.import_batches(id) on delete set null,created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(source_identifier));
create index expenses_date_idx on public.expenses(transaction_date); create index expenses_country_date_idx on public.expenses(attributed_country_id,transaction_date); create index expenses_consultant_date_idx on public.expenses(consultant_id,transaction_date);
create table public.placements(id uuid primary key default gen_random_uuid(),external_id text not null unique,consultant_id uuid not null references public.consultants(id),placement_date date not null,client text,country_id uuid references public.countries(id),created_by uuid not null references public.profiles(id),created_at timestamptz not null default now());
create table public.exchange_rates(id uuid primary key default gen_random_uuid(),provider text not null,base_currency char(3) not null check(base_currency ~ '^[A-Z]{3}$'),quote_currency char(3) not null check(quote_currency ~ '^[A-Z]{3}$'),rate numeric(24,12) not null check(rate>0),effective_date date not null,retrieved_at timestamptz not null default now(),fallback_used boolean not null default false,unique(provider,base_currency,quote_currency,effective_date));
create table public.expense_conversions(id uuid primary key default gen_random_uuid(),expense_id uuid not null references public.expenses(id) on delete cascade,target_currency char(3) not null check(target_currency ~ '^[A-Z]{3}$'),applied_rate numeric(24,12),provider text,requested_date date,effective_rate_date date,retrieved_at timestamptz,converted_amount numeric(22,2),status public.conversion_status not null default 'pending',fallback_used boolean not null default false,error_metadata jsonb,finalized_at timestamptz,finalized_by uuid references public.profiles(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(expense_id,target_currency),check(status<>'finalized' or (applied_rate is not null and provider is not null and effective_rate_date is not null and converted_amount is not null and finalized_at is not null)));
create index conversion_exception_idx on public.expense_conversions(status) where status<>'finalized';
create table public.import_row_errors(id uuid primary key default gen_random_uuid(),batch_id uuid not null references public.import_batches(id) on delete cascade,row_number integer not null check(row_number>0),source_values jsonb not null,error_code text not null,message text not null,created_at timestamptz not null default now(),unique(batch_id,row_number));

create function public.guard_finalized_conversion() returns trigger language plpgsql as $$ begin if old.finalized_at is not null and new is distinct from old then raise exception 'Finalized conversions are immutable'; end if; return new; end; $$;
create trigger finalized_conversion_immutable before update on public.expense_conversions for each row execute procedure public.guard_finalized_conversion();
create function public.guard_expense_with_finalized_conversion() returns trigger language plpgsql as $$
begin
 if (new.consultant_id,new.attributed_country_id,new.transaction_date,new.original_amount,new.original_currency) is distinct from (old.consultant_id,old.attributed_country_id,old.transaction_date,old.original_amount,old.original_currency)
   and exists(select 1 from public.expense_conversions where expense_id=old.id and finalized_at is not null) then
   raise exception 'Expense source fields with finalized conversions are immutable';
 end if;
 return new;
end; $$;
create trigger finalized_expense_immutable before update on public.expenses for each row execute procedure public.guard_expense_with_finalized_conversion();

alter table public.profiles enable row level security; alter table public.countries enable row level security; alter table public.consultants enable row level security; alter table public.consultant_country_history enable row level security; alter table public.expenses enable row level security; alter table public.placements enable row level security; alter table public.exchange_rates enable row level security; alter table public.expense_conversions enable row level security; alter table public.import_batches enable row level security; alter table public.import_row_errors enable row level security;
create policy "read own profile or admin" on public.profiles for select to authenticated using(id=(select auth.uid()) or (select public.current_app_role())='administrator');
create policy "admin manages profiles" on public.profiles for update to authenticated using((select public.current_app_role())='administrator') with check((select public.current_app_role())='administrator');
create policy "authenticated reads countries" on public.countries for select to authenticated using((select public.current_app_role()) is not null);
create policy "admins manage countries" on public.countries for all to authenticated using((select public.current_app_role())='administrator') with check((select public.current_app_role())='administrator');
create policy "authenticated reads consultants" on public.consultants for select to authenticated using((select public.current_app_role()) is not null);
create policy "finance manages consultants" on public.consultants for all to authenticated using((select public.current_app_role()) in ('administrator','finance')) with check((select public.current_app_role()) in ('administrator','finance'));
create policy "authenticated reads consultant country history" on public.consultant_country_history for select to authenticated using((select public.current_app_role()) is not null);
create policy "finance manages consultant country history" on public.consultant_country_history for all to authenticated using((select public.current_app_role()) in ('administrator','finance')) with check((select public.current_app_role()) in ('administrator','finance'));
create policy "authenticated reads expenses" on public.expenses for select to authenticated using((select public.current_app_role()) is not null);
create policy "finance manages expenses" on public.expenses for all to authenticated using((select public.current_app_role()) in ('administrator','finance')) with check((select public.current_app_role()) in ('administrator','finance'));
create policy "authenticated reads placements" on public.placements for select to authenticated using((select public.current_app_role()) is not null);
create policy "finance manages placements" on public.placements for all to authenticated using((select public.current_app_role()) in ('administrator','finance')) with check((select public.current_app_role()) in ('administrator','finance'));
create policy "authenticated reads rates" on public.exchange_rates for select to authenticated using((select public.current_app_role()) is not null);
create policy "finance manages rates" on public.exchange_rates for all to authenticated using((select public.current_app_role()) in ('administrator','finance')) with check((select public.current_app_role()) in ('administrator','finance'));
create policy "authenticated reads conversions" on public.expense_conversions for select to authenticated using((select public.current_app_role()) is not null);
create policy "finance manages conversions" on public.expense_conversions for all to authenticated using((select public.current_app_role()) in ('administrator','finance')) with check((select public.current_app_role()) in ('administrator','finance'));
create policy "authenticated reads batches" on public.import_batches for select to authenticated using((select public.current_app_role()) is not null);
create policy "finance manages batches" on public.import_batches for all to authenticated using((select public.current_app_role()) in ('administrator','finance')) with check((select public.current_app_role()) in ('administrator','finance'));
create policy "authenticated reads import errors" on public.import_row_errors for select to authenticated using((select public.current_app_role()) is not null);
create policy "finance manages import errors" on public.import_row_errors for all to authenticated using((select public.current_app_role()) in ('administrator','finance')) with check((select public.current_app_role()) in ('administrator','finance'));
grant usage on schema public to anon,authenticated;
grant select on public.countries to anon;
grant select,insert,update,delete on all tables in schema public to authenticated;
