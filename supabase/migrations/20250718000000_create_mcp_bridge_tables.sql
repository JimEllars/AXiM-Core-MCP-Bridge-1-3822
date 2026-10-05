CREATE TABLE IF NOT EXISTS public.mcp_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_email TEXT NOT NULL,
  session_id TEXT,
  tool_name TEXT NOT NULL,
  input_arguments JSONB NOT NULL DEFAULT '{}'::jsonb,
  execution_time_ms INTEGER NOT NULL,
  status TEXT NOT NULL,
  error_message TEXT,
  cf_ray_id TEXT,
  client_ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.approval_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type TEXT NOT NULL,
  target_system TEXT NOT NULL,
  staged_by_client TEXT NOT NULL,
  payload JSONB NOT NULL,
  hmac_signature TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING_OPERATOR_SIGNATURE',
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mcp_audit_operator
  ON public.mcp_audit_logs(operator_email);

CREATE INDEX IF NOT EXISTS idx_approval_queue_status
  ON public.approval_queue(status);

ALTER TABLE public.mcp_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow service role full access mcp_audit"
  ON public.mcp_audit_logs
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow service role full access approval_queue"
  ON public.approval_queue
  TO service_role
  USING (true)
  WITH CHECK (true);
