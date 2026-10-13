-- Table: public.mcp_audit_logs
CREATE TABLE IF NOT EXISTS public.mcp_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  operator_email TEXT,
  status_code INT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table: public.telemetry_events
CREATE TABLE IF NOT EXISTS public.telemetry_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  component_id TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'INFO',
  message TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table: public.approval_queue
CREATE TABLE IF NOT EXISTS public.approval_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type TEXT NOT NULL,
  target_system TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'PENDING_OPERATOR_SIGNATURE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Row Level Security
ALTER TABLE public.mcp_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telemetry_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to mcp_audit_logs" ON public.mcp_audit_logs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access to telemetry_events" ON public.telemetry_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access to approval_queue" ON public.approval_queue
  FOR ALL TO service_role USING (true) WITH CHECK (true);
