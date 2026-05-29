-- Site deployments table for Platinum Website Studio
-- Tracks every Webflow publish initiated through the ai4websitedesign.com pipeline

create table if not exists public.site_deployments (
  id                uuid          default gen_random_uuid() primary key,
  created_at        timestamptz   not null default now(),
  business_name     text,
  webflow_site_id   text          not null,
  webflow_item_id   text,
  template_used     text,
  accent_color      text,
  brief_data        jsonb,
  published_domains jsonb,
  published_url     text,
  status            text          not null default 'pending',
  published_at      timestamptz,
  error_message     text
);

comment on table public.site_deployments is
  'Webflow deployment records initiated from the Platinum Website Studio pipeline.';

comment on column public.site_deployments.status is
  'Lifecycle: pending → published | failed';

alter table public.site_deployments enable row level security;

create policy "service role full access"
  on public.site_deployments
  for all
  to service_role
  using (true)
  with check (true);

-- Index for dashboard queries by status and recency
create index if not exists idx_site_deployments_status
  on public.site_deployments (status, created_at desc);
