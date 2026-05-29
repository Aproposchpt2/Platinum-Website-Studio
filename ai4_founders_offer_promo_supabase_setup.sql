-- AI4 Website Design — Founder’s Offer Promo Redemption Sandbox Setup
-- Purpose:
-- 1. Add promo-used flags to users.
-- 2. Add build-persistence columns to sites.
-- 3. Create promo_redemptions for non-Stripe Founder’s Offer promo fulfillment.
--
-- Safe to run more than once because ALTER statements use IF NOT EXISTS
-- and table/constraint creation is guarded.

-- Required for gen_random_uuid() on most Supabase projects.
create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- USERS: promo-used flags
-- ------------------------------------------------------------
alter table public.users
  add column if not exists founders_offer_promo_used boolean not null default false,
  add column if not exists founders_offer_promo_used_at timestamptz null,
  add column if not exists founders_offer_promo_code text null,
  add column if not exists founders_offer_promo_redemption_id uuid null;

-- ------------------------------------------------------------
-- SITES: build-persistence fields used by netlify/functions/save-build.js
-- ------------------------------------------------------------
alter table public.sites
  add column if not exists user_id uuid null,
  add column if not exists email text null,
  add column if not exists full_name text null,
  add column if not exists phone text null,
  add column if not exists business_name text null,
  add column if not exists site_name text null,
  add column if not exists site_status text null,
  add column if not exists template_selected text null,
  add column if not exists color_choice text null,
  add column if not exists built_html text null,
  add column if not exists site_data jsonb null,
  add column if not exists source text null,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz null;

create index if not exists idx_ai4_sites_email_updated_at
  on public.sites (email, updated_at desc);

create index if not exists idx_ai4_sites_user_id_updated_at
  on public.sites (user_id, updated_at desc);

-- ------------------------------------------------------------
-- PROMO REDEMPTIONS: non-Stripe Founder’s Offer redemptions
-- ------------------------------------------------------------
create table if not exists public.promo_redemptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null,
  email text not null,
  full_name text null,
  phone text null,
  promo_code text not null,
  promo_type text not null default 'founders_offer',
  status text not null default 'pending_email',
  site_id uuid null,
  build_id uuid null,
  business_name text null,
  html_delivery_status text null,
  customer_email_sent_at timestamptz null,
  internal_email_sent_at timestamptz null,
  redeemed_at timestamptz null,
  created_at timestamptz not null default now(),
  metadata jsonb null
);

alter table public.promo_redemptions
  add column if not exists user_id uuid null,
  add column if not exists email text,
  add column if not exists full_name text null,
  add column if not exists phone text null,
  add column if not exists promo_code text,
  add column if not exists promo_type text,
  add column if not exists status text,
  add column if not exists site_id uuid null,
  add column if not exists build_id uuid null,
  add column if not exists business_name text null,
  add column if not exists html_delivery_status text null,
  add column if not exists customer_email_sent_at timestamptz null,
  add column if not exists internal_email_sent_at timestamptz null,
  add column if not exists redeemed_at timestamptz null,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists metadata jsonb null;

-- Keep the promo_type/status defaults in place for existing or future rows.
alter table public.promo_redemptions
  alter column promo_type set default 'founders_offer',
  alter column status set default 'pending_email',
  alter column created_at set default now();

-- Prevent more than one active/successful Founder’s Offer promo redemption per email.
-- Failed rows do not block a retry during sandbox validation.
drop index if exists public.ux_ai4_promo_redemptions_email_type;

create unique index if not exists ux_ai4_promo_redemptions_email_type
  on public.promo_redemptions (lower(email), promo_type)
  where status in ('pending_email', 'redeemed');

-- Helpful lookup indexes.
create index if not exists idx_ai4_promo_redemptions_user_id
  on public.promo_redemptions (user_id);

create index if not exists idx_ai4_promo_redemptions_site_id
  on public.promo_redemptions (site_id);

create index if not exists idx_ai4_promo_redemptions_created_at
  on public.promo_redemptions (created_at desc);

-- Add a soft reference from users to promo_redemptions.
-- This does not create a foreign key so it will not fail if existing sandbox rows are incomplete.
create index if not exists idx_ai4_users_founders_offer_promo_redemption_id
  on public.users (founders_offer_promo_redemption_id);

-- ------------------------------------------------------------
-- OPTIONAL CHECK QUERIES
-- ------------------------------------------------------------
-- select column_name, data_type from information_schema.columns where table_schema='public' and table_name='users' and column_name like 'founders_offer%';
-- select column_name, data_type from information_schema.columns where table_schema='public' and table_name='sites' and column_name in ('built_html','site_data','color_choice','source');
-- select * from public.promo_redemptions order by created_at desc limit 5;
