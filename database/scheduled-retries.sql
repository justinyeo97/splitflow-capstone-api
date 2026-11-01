ALTER TABLE public.expense_conversions
  ADD COLUMN retry_attempts integer NOT NULL DEFAULT 0 CHECK(retry_attempts>=0),
  ADD COLUMN next_retry_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN retry_lease uuid,
  ADD COLUMN retry_lease_until timestamptz;
CREATE INDEX conversions_retry_due_idx ON public.expense_conversions(next_retry_at)
WHERE finalized_at IS NULL AND status='pending';

-- A durable lease prevents two API instances or cron jobs from processing the same item.
-- Only the server worker may claim jobs. The function runs as its caller, not its owner.
CREATE FUNCTION public.claim_pending_conversions(batch_size integer DEFAULT 10)
RETURNS SETOF public.expense_conversions LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$
  WITH due AS (
    SELECT id FROM public.expense_conversions
    WHERE finalized_at IS NULL AND status='pending' AND next_retry_at<=now()
      AND (retry_lease_until IS NULL OR retry_lease_until<=now())
    ORDER BY next_retry_at,id FOR UPDATE SKIP LOCKED LIMIT greatest(1,least(batch_size,25))
  )
  UPDATE public.expense_conversions c SET retry_lease=gen_random_uuid(),retry_lease_until=now()+interval '20 minutes',
    retry_attempts=c.retry_attempts+1
  FROM due WHERE c.id=due.id RETURNING c.*;
$$;
REVOKE ALL ON FUNCTION public.claim_pending_conversions(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pending_conversions(integer) TO service_role;
