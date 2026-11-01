\set ON_ERROR_STOP on
BEGIN;
INSERT INTO auth.users(email,email_confirmed_at) VALUES('verified@example.invalid',now());
SELECT set_config('request.jwt.claims',(SELECT json_build_object('sub',id,'role','authenticated')::text FROM auth.users WHERE email='verified@example.invalid'),true);
SET LOCAL ROLE authenticated;
SELECT public.create_own_company('Fresh setup test','MYR');
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.company_memberships WHERE user_id=auth.uid() AND role='administrator') THEN RAISE EXCEPTION 'Founder is not an administrator'; END IF;
  IF (SELECT count(*) FROM public.audit_logs WHERE actor_id=auth.uid())<2 THEN RAISE EXCEPTION 'Audit missing'; END IF;
  BEGIN PERFORM public.create_own_company('Duplicate','USD'); RAISE EXCEPTION 'Duplicate creation allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN DELETE FROM public.audit_logs; RAISE EXCEPTION 'Audit deletion allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.claim_pending_conversions(1); RAISE EXCEPTION 'User claimed worker jobs'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
ROLLBACK;
