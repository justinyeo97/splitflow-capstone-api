alter table public.consultants add column email text check(email is null or (email=lower(btrim(email)) and email ~ '^[^[:space:]@]+@[^[:space:]@]+$'));
create unique index consultant_invite_email_unique on public.consultants(company_id,email) where email is not null;
alter table public.company_memberships add column consultant_id uuid;
alter table public.company_memberships add foreign key(consultant_id,company_id) references public.consultants(id,company_id);
alter table public.company_memberships add constraint consultant_members_are_viewers check(consultant_id is null or role='viewer');
create unique index consultant_login_unique on public.company_memberships(company_id,consultant_id) where consultant_id is not null;
alter table public.profiles alter column company_id drop not null;
drop trigger immutable_company on public.profiles;
-- Company assignment remains unavailable to clients; only the checked acceptance RPC changes it.
revoke update(company_id,role) on public.profiles from authenticated;

create function private.current_consultant_id() returns uuid language sql stable security definer set search_path='' as $$
 select m.consultant_id from public.company_memberships m join public.profiles p on p.id=m.user_id and p.company_id=m.company_id where p.id=auth.uid() and p.active;
$$;
revoke all on function private.current_consultant_id() from public,anon;
grant execute on function private.current_consultant_id() to authenticated;
create or replace function private.current_app_role() returns public.app_role language sql stable security definer set search_path='' as $$
 select m.role from public.company_memberships m join public.profiles p on p.id=m.user_id and p.company_id=m.company_id
 where p.id=auth.uid() and p.active and (m.consultant_id is null or exists(select 1 from public.consultants c where c.id=m.consultant_id and c.company_id=m.company_id and c.active));
$$;
create function private.is_staff() returns boolean language sql stable security definer set search_path='' as $$
 select private.current_app_role() is not null and private.current_consultant_id() is null;
$$;
revoke all on function private.is_staff() from public,anon;
grant execute on function private.is_staff() to authenticated;

create function private.invited_companies() returns table(company_id uuid,name text,consultant_id uuid) language plpgsql stable security definer set search_path='' as $$
declare address text;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select lower(u.email) into address from auth.users u join public.profiles p on p.id=u.id and p.active where u.id=auth.uid() and u.email_confirmed_at is not null;
 if address is null then return; end if;
 return query
 select c.id,c.name,m.consultant_id from public.company_memberships m join public.companies c on c.id=m.company_id where m.user_id=auth.uid() and m.consultant_id is null
 union
 select c.id,c.name,p.id from public.consultants p join public.companies c on c.id=p.company_id where p.email=address and p.active;
end $$;
revoke all on function private.invited_companies() from public,anon;
grant execute on function private.invited_companies() to authenticated;
create function public.available_companies() returns table(company_id uuid,name text,consultant_id uuid) language sql stable security invoker set search_path='' as $$ select * from private.invited_companies(); $$;
revoke all on function public.available_companies() from public,anon;
grant execute on function public.available_companies() to authenticated;

create function private.accept_company(target_company uuid) returns void language plpgsql security definer set search_path='' as $$
declare address text; candidate uuid; member_role public.app_role; selected_name text;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select lower(u.email) into address from auth.users u join public.profiles p on p.id=u.id and p.active where u.id=auth.uid() and u.email_confirmed_at is not null;
 if address is null then raise exception 'Verify your email before joining a company' using errcode='42501'; end if;
 select m.role into member_role from public.company_memberships m where m.user_id=auth.uid() and m.company_id=target_company and m.consultant_id is null;
 if member_role is null then
   select c.id into candidate from public.consultants c where c.company_id=target_company and c.email=address and c.active for update;
   if candidate is null then raise exception 'Your email has not been invited to this company' using errcode='42501'; end if;
   if exists(select 1 from public.company_memberships where company_id=target_company and consultant_id=candidate and user_id<>auth.uid()) then raise exception 'This consultant already has a login' using errcode='42501'; end if;
   insert into public.company_memberships(company_id,user_id,role,consultant_id) values(target_company,auth.uid(),'viewer',candidate)
   on conflict(company_id,user_id) do update set role='viewer',consultant_id=excluded.consultant_id;
   member_role:='viewer';
 end if;
 select name into selected_name from public.companies where id=target_company;
 update public.profiles set company_id=target_company,company_name=selected_name,role=member_role where id=auth.uid();
end $$;
revoke all on function private.accept_company(uuid) from public,anon;
grant execute on function private.accept_company(uuid) to authenticated;
create function public.join_invited_company(target_company uuid) returns void language sql security invoker set search_path='' as $$ select private.accept_company(target_company); $$;
revoke all on function public.join_invited_company(uuid) from public,anon;
grant execute on function public.join_invited_company(uuid) to authenticated;

create or replace function public.create_profile_for_auth_user() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.profiles(id,email,role) values(new.id,new.email,'viewer');
 return new;
end $$;
-- An email on a consultant record is the invitation. Changing/removing it revokes prior consultant access.
create function private.manage_consultant_invite() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and new.email is not distinct from old.email then return new; end if;
 if tg_op='INSERT' and new.email is null then return new; end if;
 if auth.uid() is not null and private.current_app_role() is distinct from 'administrator'::public.app_role then raise exception 'Only administrators can invite consultants' using errcode='42501'; end if;
 if tg_op='UPDATE' then
   update public.profiles set company_id=null,company_name=null,role='viewer' where company_id=old.company_id and id in(select user_id from public.company_memberships where company_id=old.company_id and consultant_id=old.id);
   delete from public.company_memberships where company_id=old.company_id and consultant_id=old.id;
 end if;
 return new;
end $$;
revoke all on function private.manage_consultant_invite() from public,anon,authenticated;
create trigger consultant_invite_change before insert or update of email on public.consultants for each row execute function private.manage_consultant_invite();

drop policy tenant_read on public.expenses;
create policy tenant_read on public.expenses for select to authenticated using(company_id=(select private.current_company_id()) and (select private.current_app_role()) is not null and ((select private.is_staff()) or consultant_id=(select private.current_consultant_id())));
drop policy tenant_read on public.consultants;
create policy tenant_read on public.consultants for select to authenticated using(company_id=(select private.current_company_id()) and (select private.current_app_role()) is not null and (select private.is_staff()));
drop policy tenant_read on public.expense_conversions;
create policy tenant_read on public.expense_conversions for select to authenticated using(company_id=(select private.current_company_id()) and (select private.current_app_role()) is not null and ((select private.is_staff()) or exists(select 1 from public.expenses e where e.id=expense_id and e.consultant_id=(select private.current_consultant_id()))));
drop policy tenant_read on public.countries;
create policy tenant_read on public.countries for select to authenticated using(company_id=(select private.current_company_id()) and (select private.current_app_role()) is not null and ((select private.is_staff()) or id in(select c.country_id from public.consultants c where c.id=(select private.current_consultant_id())) or id in(select e.attributed_country_id from public.expenses e where e.consultant_id=(select private.current_consultant_id()))));
drop policy tenant_read on public.placements;
create policy tenant_read on public.placements for select to authenticated using(company_id=(select private.current_company_id()) and (select private.is_staff()));
drop policy tenant_read on public.import_batches;
create policy tenant_read on public.import_batches for select to authenticated using(company_id=(select private.current_company_id()) and (select private.is_staff()));
drop policy tenant_read on public.import_row_errors;
create policy tenant_read on public.import_row_errors for select to authenticated using(company_id=(select private.current_company_id()) and (select private.is_staff()));
drop policy tenant_read on public.consultant_country_history;
create policy tenant_read on public.consultant_country_history for select to authenticated using(company_id=(select private.current_company_id()) and (select private.is_staff()));
drop policy salary_read on public.compensation_history;
create policy salary_read on public.compensation_history for select to authenticated using(company_id=(select private.current_company_id()) and (select private.is_staff()));

create function private.my_consultant() returns table(id uuid,name text,external_id text,country_id uuid,active boolean) language sql stable security definer set search_path='' as $$
 select c.id,c.name,c.external_id,c.country_id,c.active from public.consultants c where auth.uid() is not null and c.id=private.current_consultant_id() and c.company_id=private.current_company_id();
$$;
revoke all on function private.my_consultant() from public,anon;
grant execute on function private.my_consultant() to authenticated;
create function public.my_consultant() returns table(id uuid,name text,external_id text,country_id uuid,active boolean) language sql stable security invoker set search_path='' as $$ select * from private.my_consultant(); $$;
revoke all on function public.my_consultant() from public,anon;
grant execute on function public.my_consultant() to authenticated;

-- Requested test invitations. Justin's existing administrator account is unchanged.
update public.consultants c set email=case c.external_id when 'C-1002' then 'test1@mail' when 'C-1003' then 'test2@mail' end
from public.profiles p where p.email='yeojiaxing97@gmail.com' and c.company_id=p.company_id and c.external_id in ('C-1002','C-1003');
