-- Missing structural prerequisites recovered from applied migrations.
-- Deliberately excludes the old temporary administrator-default development change.

-- short_sequential_placement_ids
lock table public.placements in access exclusive mode;

create sequence public.placement_external_id_seq as bigint no cycle
  owned by public.placements.external_id;

create function public.format_placement_external_id(number bigint)
returns text language sql immutable strict security invoker
set search_path = ''
as $$
  select 'PL-' || lpad(number::text, greatest(8, length(number::text)), '0');
$$;

revoke all on function public.format_placement_external_id(bigint) from public, anon;
grant execute on function public.format_placement_external_id(bigint) to authenticated, service_role;
revoke all on sequence public.placement_external_id_seq from public, anon;
grant usage on sequence public.placement_external_id_seq to authenticated, service_role;

-- Reserve any existing numeric IDs before assigning new numbers.
select setval(
  'public.placement_external_id_seq'::regclass,
  coalesce(max(substring(external_id from 4)::bigint), 0) + 1,
  false
)
from public.placements where external_id ~ '^PL-[0-9]{1,18}$';

alter table public.placements alter column external_id set default
  public.format_placement_external_id(nextval('public.placement_external_id_seq'::regclass));

-- Shorten previous automatically generated IDs; retain user-supplied references.
do $$
declare placement record;
begin
  for placement in
    select id from public.placements
    where external_id ~ '^PL-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    order by created_at, id
  loop
    update public.placements
      set external_id = public.format_placement_external_id(nextval('public.placement_external_id_seq'::regclass))
      where id = placement.id;
  end loop;
end;
$$;

-- placement_revenue_and_roi
alter table public.placements
  add column revenue_amount numeric(22,8),
  add column revenue_currency text,
  add column revenue_recognition_date date,
  add constraint placements_revenue_valid check (
    (revenue_amount is null and revenue_currency is null and revenue_recognition_date is null)
    or (revenue_amount is not null and revenue_amount >= 0 and revenue_amount <> 'NaN'::numeric
      and revenue_currency is not null and revenue_currency ~ '^[A-Z]{3}$'
      and revenue_recognition_date is not null)
  );
create index placements_revenue_date_idx on public.placements(revenue_recognition_date);
create index expenses_transaction_date_idx on public.expenses(transaction_date);

-- profile_company_name
alter table public.profiles add column company_name text
  check (company_name is null or (length(btrim(company_name)) between 1 and 200));

-- Company is descriptive metadata, never used for roles or access control.
create or replace function public.create_profile_for_auth_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles(id,email,company_name)
  values(new.id,new.email,nullif(btrim(new.raw_user_meta_data ->> 'company_name'),''))
  on conflict(id) do nothing;
  return new;
end;
$$;


-- consultant_job_title_and_salary
alter table public.consultants
  add column job_title text check (job_title is null or length(btrim(job_title)) between 1 and 200),
  add column annual_salary numeric(16,2),
  add column salary_currency text,
  add column salary_effective_from date,
  add constraint consultants_salary_valid check (
    (annual_salary is null and salary_currency is null and salary_effective_from is null)
    or (annual_salary is not null and annual_salary >= 0 and annual_salary <> 'NaN'::numeric
      and salary_currency is not null and salary_currency ~ '^[A-Z]{3}$'
      and salary_effective_from is not null)
  );


-- automatic_consultant_ids
lock table public.consultants in access exclusive mode;
create sequence public.consultant_external_id_seq as bigint no cycle owned by public.consultants.external_id;
create function public.format_consultant_external_id(number bigint)
returns text language sql immutable strict security invoker set search_path = ''
as $$ select 'C-' || lpad(number::text, greatest(8,length(number::text)), '0'); $$;
revoke all on function public.format_consultant_external_id(bigint) from public, anon;
grant execute on function public.format_consultant_external_id(bigint) to authenticated, service_role;
revoke all on sequence public.consultant_external_id_seq from public, anon;
grant usage on sequence public.consultant_external_id_seq to authenticated, service_role;
select setval('public.consultant_external_id_seq'::regclass,
  coalesce(max(substring(external_id from 3)::bigint),0)+1,false)
from public.consultants where external_id ~ '^C-[0-9]{1,18}$';
alter table public.consultants alter column external_id set default
  public.format_consultant_external_id(nextval('public.consultant_external_id_seq'::regclass));


