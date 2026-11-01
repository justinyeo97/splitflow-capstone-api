-- Called only through the signed-in user's JWT. Never accepts a user ID or role.
CREATE OR REPLACE FUNCTION private.create_own_company(company_name text, home_currency text DEFAULT 'USD')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid := auth.uid(); new_company uuid; current_company uuid; desired_name text := btrim(company_name); desired_currency text := home_currency;
BEGIN
  IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=actor AND email_confirmed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'A verified account is required' USING ERRCODE='42501';
  END IF;
  IF length(btrim(company_name)) NOT BETWEEN 1 AND 200 OR company_name IS NULL OR home_currency IS NULL OR home_currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'Invalid company name or currency' USING ERRCODE='22023';
  END IF;
  SELECT company_id INTO current_company FROM public.profiles WHERE id=actor AND active=true FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active profile is required' USING ERRCODE='42501'; END IF;
  IF current_company IS NOT NULL OR EXISTS(SELECT 1 FROM public.company_memberships WHERE company_memberships.user_id=actor) THEN
    RAISE EXCEPTION 'Only users without a company can create a company' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.companies(name,home_currency) VALUES(desired_name,desired_currency) RETURNING id INTO new_company;
  INSERT INTO public.company_memberships(company_id,user_id,role) VALUES(new_company,actor,'administrator');
  UPDATE public.profiles SET company_id=new_company,company_name=desired_name,role='administrator' WHERE id=actor;
  RETURN new_company;
END $$;
REVOKE ALL ON FUNCTION private.create_own_company(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.create_own_company(text,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.create_own_company(company_name text,home_currency text DEFAULT 'USD')
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.create_own_company(company_name,home_currency); $$;
REVOKE ALL ON FUNCTION public.create_own_company(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_own_company(text,text) TO authenticated;
