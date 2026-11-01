CREATE TABLE public.audit_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id uuid NOT NULL,
  actor_id uuid,
  actor_email text,
  actor_kind text NOT NULL CHECK (actor_kind IN ('user', 'system')),
  table_name text NOT NULL,
  record_id text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
  before_data jsonb,
  after_data jsonb,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX audit_logs_company_time_idx ON public.audit_logs(company_id, occurred_at DESC, id DESC);
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audit_logs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.audit_logs TO authenticated;
CREATE POLICY audit_read_staff ON public.audit_logs FOR SELECT TO authenticated
USING (company_id = (SELECT private.current_company_id())
  AND (SELECT private.current_app_role()) IN ('administrator'::public.app_role, 'finance'::public.app_role));

-- The trigger owns audit writes. Application users cannot edit or erase history.
CREATE FUNCTION private.audit_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE old_row jsonb; new_row jsonb; row_data jsonb; owner_id uuid; actor uuid := auth.uid();
BEGIN
  IF TG_OP = 'UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
  IF TG_OP <> 'INSERT' THEN old_row := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN new_row := to_jsonb(NEW); END IF;
  row_data := coalesce(new_row, old_row);
  owner_id := CASE WHEN TG_TABLE_NAME='companies' THEN (row_data->>'id')::uuid ELSE (row_data->>'company_id')::uuid END;
  INSERT INTO public.audit_logs(company_id,actor_id,actor_email,actor_kind,table_name,record_id,operation,before_data,after_data)
  VALUES(owner_id,actor,(SELECT email FROM auth.users WHERE id=actor),CASE WHEN actor IS NULL THEN 'system' ELSE 'user' END,
    TG_TABLE_NAME,coalesce(row_data->>'id',row_data->>'user_id'),TG_OP,old_row,new_row);
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.audit_change() FROM PUBLIC, anon, authenticated;
DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['companies','company_memberships','countries','consultants','compensation_history','expenses','placements','expense_conversions','import_batches'] LOOP
    EXECUTE format('CREATE TRIGGER audit_changes AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.audit_change()',name);
  END LOOP;
END $$;
