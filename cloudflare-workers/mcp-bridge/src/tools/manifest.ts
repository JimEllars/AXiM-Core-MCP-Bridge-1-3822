export const mcpTools = [
  {
    name: 'axim_dispatch_task',
    description: 'Stages a mutating system task into public.approval_queue for mandatory operator signature. Does NOT execute directly.',
    inputSchema: {
      type: 'object',
      required: ['action_type', 'target_system'],
      properties: {
        action_type: { type: 'string', description: 'Type of mutating action (e.g., stage_pr_merge, stage_firewall_rule, stage_code_deploy).' },
        target_system: { type: 'string', description: 'Subsystem target (e.g., asguard, coding_lab, core).' },
        payload: { type: 'object', description: 'Parameters for the requested action.' }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false }
  },
  {
    name: 'bridge_runtime_status',
    description: 'Reports bridge runtime, transport, rate-limit, and kill-switch status.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  {
    name: 'bridge_security_check',
    description: 'Checks whether required access controls and KV state are configured; never returns credentials.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  {
    name: 'sanitizer_self_test',
    description: 'Tests egress redaction against representative credentials and personal data.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  {
    name: 'aximDockConfig',
    description: 'Returns the ready-to-use client JSON snippet for Claude Desktop or Cursor to dock into this bridge.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  {
    name: 'core_health_check',
    description: 'Pings Supabase Core and reports database latency and health.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  {
    name: 'telemetry_lookup',
    description: 'Queries recent critical/error telemetry events from public.telemetry_events.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum events to return (default 5, max 25).' },
        service_name: { type: 'string', description: 'Filter by service or component name.' },
        component: { type: 'string', description: 'Alias for service_name filter.' },
        severity: { type: 'string', description: 'Filter by severity level (e.g. ERROR, CRITICAL, WARN).' }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  {
    name: 'hitl_queue_status',
    description: 'Queries approval_queue for records where status = PENDING_OPERATOR_SIGNATURE.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  {
    name: 'axim_session_status',
    description: 'Reports active MCP session runtime, operator identity, and KV session metadata.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  {
    name: 'axim_list_sessions',
    description: 'Lists all currently active docked MCP sessions stored in Cloudflare KV.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  {
    name: 'axim_revoke_session',
    description: 'Instantly revokes an active MCP session from Cloudflare KV by session ID.',
    inputSchema: {
      type: 'object',
      required: ['target_session_id'],
      properties: {
        target_session_id: { type: 'string', description: 'The UUID of the session to revoke.' }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false }
  },
  {
    name: 'axim_get_audit_logs',
    description: 'Retrieves the most recent MCP edge audit logs from Supabase for global telemetry monitoring.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Maximum logs to return (default 20, max 100).' } },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }
];
