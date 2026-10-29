alter function public.track_consultant_country() set search_path = '';
alter function public.guard_finalized_conversion() set search_path = '';
alter function public.guard_expense_with_finalized_conversion() set search_path = '';
revoke execute on function public.create_profile_for_auth_user() from public, anon, authenticated;
revoke execute on function public.current_app_role() from public, anon;
grant execute on function public.current_app_role() to authenticated;

drop policy if exists "admins manage countries" on public.countries;
create policy "admin inserts countries" on public.countries for insert to authenticated with check ((select public.current_app_role()) = 'administrator');
create policy "admin updates countries" on public.countries for update to authenticated using ((select public.current_app_role()) = 'administrator') with check ((select public.current_app_role()) = 'administrator');

drop policy if exists "finance manages consultants" on public.consultants;
create policy "finance inserts consultants" on public.consultants for insert to authenticated with check ((select public.current_app_role()) in ('administrator','finance'));
create policy "finance updates consultants" on public.consultants for update to authenticated using ((select public.current_app_role()) in ('administrator','finance')) with check ((select public.current_app_role()) in ('administrator','finance'));

drop policy if exists "finance manages consultant country history" on public.consultant_country_history;
create policy "finance inserts consultant country history" on public.consultant_country_history for insert to authenticated with check ((select public.current_app_role()) in ('administrator','finance'));
create policy "finance updates consultant country history" on public.consultant_country_history for update to authenticated using ((select public.current_app_role()) in ('administrator','finance')) with check ((select public.current_app_role()) in ('administrator','finance'));

drop policy if exists "finance manages expenses" on public.expenses;
create policy "finance inserts expenses" on public.expenses for insert to authenticated with check ((select public.current_app_role()) in ('administrator','finance'));
create policy "finance updates expenses" on public.expenses for update to authenticated using ((select public.current_app_role()) in ('administrator','finance')) with check ((select public.current_app_role()) in ('administrator','finance'));

drop policy if exists "finance manages placements" on public.placements;
create policy "finance inserts placements" on public.placements for insert to authenticated with check ((select public.current_app_role()) in ('administrator','finance'));
create policy "finance updates placements" on public.placements for update to authenticated using ((select public.current_app_role()) in ('administrator','finance')) with check ((select public.current_app_role()) in ('administrator','finance'));

drop policy if exists "finance manages rates" on public.exchange_rates;
create policy "finance inserts rates" on public.exchange_rates for insert to authenticated with check ((select public.current_app_role()) in ('administrator','finance'));
create policy "finance updates rates" on public.exchange_rates for update to authenticated using ((select public.current_app_role()) in ('administrator','finance')) with check ((select public.current_app_role()) in ('administrator','finance'));

drop policy if exists "finance manages conversions" on public.expense_conversions;
create policy "finance inserts conversions" on public.expense_conversions for insert to authenticated with check ((select public.current_app_role()) in ('administrator','finance'));
create policy "finance updates conversions" on public.expense_conversions for update to authenticated using ((select public.current_app_role()) in ('administrator','finance')) with check ((select public.current_app_role()) in ('administrator','finance'));

drop policy if exists "finance manages batches" on public.import_batches;
create policy "finance inserts batches" on public.import_batches for insert to authenticated with check ((select public.current_app_role()) in ('administrator','finance'));
create policy "finance updates batches" on public.import_batches for update to authenticated using ((select public.current_app_role()) in ('administrator','finance')) with check ((select public.current_app_role()) in ('administrator','finance'));

drop policy if exists "finance manages import errors" on public.import_row_errors;
create policy "finance inserts import errors" on public.import_row_errors for insert to authenticated with check ((select public.current_app_role()) in ('administrator','finance'));

create index consultant_country_history_country_idx on public.consultant_country_history(country_id);
create index expense_conversions_finalized_by_idx on public.expense_conversions(finalized_by);
create index expenses_created_by_idx on public.expenses(created_by);
create index expenses_import_batch_idx on public.expenses(import_batch_id);
create index import_batches_uploaded_by_idx on public.import_batches(uploaded_by);
create index placements_consultant_idx on public.placements(consultant_id);
create index placements_country_idx on public.placements(country_id);
create index placements_created_by_idx on public.placements(created_by);
