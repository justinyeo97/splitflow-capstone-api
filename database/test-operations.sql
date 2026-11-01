\set ON_ERROR_STOP on
BEGIN;
INSERT INTO auth.users(email,email_confirmed_at) VALUES('operations@example.invalid',now());
SELECT set_config('test.actor',(SELECT id::text FROM auth.users WHERE email='operations@example.invalid'),true);
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('test.actor'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
SELECT public.create_own_company('Operations test','MYR');
INSERT INTO public.countries(name,iso_code,default_reporting_currency) VALUES('Malaysia','MY','MYR');
INSERT INTO public.consultants(name,country_id,country_effective_from) SELECT 'Test consultant',id,'2026-01-01' FROM public.countries;
INSERT INTO public.expenses(consultant_id,attributed_country_id,transaction_date,original_amount,original_currency,category,created_by)
SELECT id,country_id,'2026-01-02',100,'USD','Travel',auth.uid() FROM public.consultants;
INSERT INTO public.expense_conversions(expense_id,target_currency,status) SELECT id,'MYR','pending' FROM public.expenses;
SELECT set_config('test.expense',(SELECT id::text FROM public.expenses LIMIT 1),true);
SELECT set_config('test.company',(SELECT company_id::text FROM public.profiles WHERE id=auth.uid()),true);
RESET ROLE;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SET LOCAL ROLE service_role;
DO $$ DECLARE jobs integer; BEGIN
  SELECT count(*) INTO jobs FROM public.claim_pending_conversions(10);
  IF jobs<>1 THEN RAISE EXCEPTION 'Expected one pending job'; END IF;
  SELECT count(*) INTO jobs FROM public.claim_pending_conversions(10);
  IF jobs<>0 THEN RAISE EXCEPTION 'Active lease was claimed twice'; END IF;
END $$;
UPDATE public.expense_conversions SET retry_lease_until=now()-interval '1 minute';
DO $$ BEGIN
  IF (SELECT count(*) FROM public.claim_pending_conversions(10))<>1 THEN RAISE EXCEPTION 'Expired lease not recovered'; END IF;
END $$;
UPDATE public.expense_conversions SET status='finalized',applied_rate=4,provider='test',requested_date='2026-01-02',effective_rate_date='2026-01-02',
  retrieved_at=now(),converted_amount=400,finalized_at=now(),retry_lease=NULL,retry_lease_until=NULL;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.claim_pending_conversions(10))<>0 THEN RAISE EXCEPTION 'Finalized job was claimed'; END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('test.actor'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
UPDATE public.expenses SET vendor='Updated vendor';
DELETE FROM public.expenses WHERE id=current_setting('test.expense')::uuid;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.expense_conversions) THEN RAISE EXCEPTION 'Orphan conversion'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.audit_logs WHERE table_name='expenses' AND operation='DELETE' AND actor_id=auth.uid() AND before_data->>'vendor'='Updated vendor') THEN RAISE EXCEPTION 'Delete audit missing'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.audit_logs WHERE actor_kind='system' AND table_name='expense_conversions') THEN RAISE EXCEPTION 'Worker audit missing'; END IF;
END $$;
RESET ROLE;
INSERT INTO auth.users(email,email_confirmed_at) VALUES('other-company@example.invalid',now()),('unverified@example.invalid',NULL);
SELECT set_config('request.jwt.claims',(SELECT json_build_object('sub',id,'role','authenticated')::text FROM auth.users WHERE email='other-company@example.invalid'),true);
SET LOCAL ROLE authenticated;
SELECT public.create_own_company('Other company','USD');
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.audit_logs WHERE company_id=current_setting('test.company')::uuid) THEN RAISE EXCEPTION 'Cross-company audit leak'; END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims',(SELECT json_build_object('sub',id,'role','authenticated')::text FROM auth.users WHERE email='unverified@example.invalid'),true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN PERFORM public.create_own_company('Not verified','USD'); RAISE EXCEPTION 'Unverified account created company'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
ROLLBACK;
