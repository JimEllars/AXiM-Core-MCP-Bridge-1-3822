CREATE TABLE IF NOT EXISTS public.invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number TEXT NOT NULL UNIQUE,
  client_name TEXT NOT NULL,
  client_email TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  subtotal NUMERIC(10, 2) NOT NULL,
  tax_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  total_amount NUMERIC(10, 2) NOT NULL,
  payment_link TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'SENT',
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mcp_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  operator_email TEXT,
  status_code INT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to invoices" ON public.invoices
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access to mcp_audit_logs" ON public.mcp_audit_logs
  FOR ALL TO service_role USING (true) WITH CHECK (true);
