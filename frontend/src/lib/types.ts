// Shared response types mirroring the backend pydantic schemas.

export interface User {
  id: number;
  email: string;
  name: string | null;
  role: string;
  is_active: boolean;
  last_login_at: string | null;
}

export interface Domain {
  id: number;
  slug: string;
  name: string;
  website: string | null;
  is_active: boolean;
  from_name: string | null;
  from_email: string | null;
  reply_to: string | null;
  signature: string | null;
  ai_context: string | null;
  icp_segments: IcpSegment[] | null;
  model: string;
  smtp_host: string;
  smtp_port: number;
  smtp_user: string | null;
  smtp_secure: boolean;
  imap_host: string;
  imap_port: number;
  daily_limit: number;
  batch_size: number;
  batch_delay_sec: number;
  send_days: number[] | null;
  send_hour_start: number;
  send_hour_end: number;
  follow_up_days: number;
  max_follow_ups: number;
  confidence_threshold: number;
  smtp_configured: boolean;
  created_at: string;
  updated_at: string;
}

export interface IcpSegment {
  key: string;
  label: string;
  description: string;
}

export interface Lead {
  id: number;
  domain_id: number;
  campaign_id: number | null;
  email: string;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  linkedin_url: string | null;
  phone: string | null;
  company: string | null;
  company_domain: string | null;
  industry: string | null;
  country: string | null;
  employee_count: number | null;
  status: string;
  segment: string | null;
  priority: string | null;
  score: number | null;
  source: string;
  verify_status: string;
  verify_confidence: number | null;
  pain_point: string | null;
  hook: string | null;
  notes: string | null;
  follow_up_count: number;
  last_contacted_at: string | null;
  replied_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface Campaign {
  id: number;
  domain_id: number;
  name: string;
  description: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  lead_count: number | null;
}

export interface Message {
  id: number;
  lead_id: number;
  campaign_id: number | null;
  kind: string;
  subject: string | null;
  subject_b: string | null;
  body: string | null;
  status: string;
  smtp_message_id: string | null;
  error: string | null;
  sent_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  from_email: string | null;
  created_at: string;
}

export interface Run {
  id: number;
  domain_id: number | null;
  mode: string;
  stage: string | null;
  status: string;
  triggered_by: string;
  stats: Record<string, unknown> | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface RunLog {
  id: number;
  run_id: number;
  agent: string | null;
  level: string;
  message: string;
  created_at: string;
}

export interface DomainStat {
  slug: string;
  name: string;
  is_active: boolean;
  total_leads: number;
  contacted: number;
  replied: number;
  bounced: number;
  reply_rate: number;
}

export interface Overview {
  domains: number;
  active_domains: number;
  total_leads: number;
  total_contacted: number;
  total_replied: number;
  total_bounced: number;
  messages_sent: number;
  runs_recent: number;
  reply_rate: number;
  per_domain: DomainStat[];
  status_breakdown: Record<string, number>;
}

export interface AutomationSummary {
  configured: boolean;
  workflows: number;
  active_workflows: number;
  executions: number;
  succeeded: number;
  failed: number;
  running: number;
  success_rate: number;
  checked_at: string;
}

export interface N8nWorkflow {
  id: string;
  name: string;
  active: boolean;
  created_at: string | null;
  updated_at: string | null;
  tags: string[];
}

export interface N8nExecution {
  id: string;
  workflow_id: string | null;
  workflow_name: string | null;
  status: string;
  mode: string | null;
  started_at: string | null;
  stopped_at: string | null;
}
