-- Expense conversions are removed atomically with their parent expense.
-- Finalized conversions remain immutable while their parent expense exists.
ALTER TABLE public.expense_conversions DROP CONSTRAINT expense_conversions_expense_id_fkey;
ALTER TABLE public.expense_conversions ADD CONSTRAINT expense_conversions_expense_id_fkey
  FOREIGN KEY (expense_id, company_id) REFERENCES public.expenses(id, company_id) ON DELETE CASCADE;

CREATE POLICY expenses_delete_staff ON public.expenses FOR DELETE TO authenticated
USING (company_id = (SELECT private.current_company_id())
  AND (SELECT private.current_app_role()) IN ('administrator'::public.app_role, 'finance'::public.app_role));
CREATE POLICY placements_delete_staff ON public.placements FOR DELETE TO authenticated
USING (company_id = (SELECT private.current_company_id())
  AND (SELECT private.current_app_role()) IN ('administrator'::public.app_role, 'finance'::public.app_role));
