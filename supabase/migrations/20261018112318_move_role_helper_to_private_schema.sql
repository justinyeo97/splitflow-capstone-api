create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
alter function public.current_app_role() set schema private;
alter function private.current_app_role() set search_path = '';
revoke execute on function private.current_app_role() from public, anon;
grant execute on function private.current_app_role() to authenticated;
