// get_portal.js
// AI4 Website Design — Member Dashboard Data
// Returns package, subscription, site, and remaining-build status for Sign In portal.
// Active tables used only: users, orders, subscriptions, sites.

'use strict';

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY;

const supabase =
  supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey)
    : null;

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json'
};

const ENTREPRENEUR_TOTAL_BUILDS = 5;

function normalizeEmail(value = '') {
  return String(value || '').trim().toLowerCase();
}

function normalizeStatus(value = '') {
  return String(value || '').trim().toLowerCase();
}

function isActiveStatus(value = '') {
  const status = normalizeStatus(value);
  if (!status) return true;
  return !['cancelled', 'canceled', 'deleted', 'failed', 'expired', 'inactive'].includes(status);
}

function numberOrNull(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function getPlanKey(row = {}) {
  const raw = [
    row.plan_key,
    row.plan_name,
    row.package,
    row.package_name,
    row.support_tier,
    row.stripe_product_name
  ].filter(Boolean).join(' ').toLowerCase();

  if (raw.includes('entrepreneur') || raw.includes('pro')) return 'entrepreneur';
  if (raw.includes('premier') || raw.includes('premium')) return 'premier';
  if (raw.includes('founder') || raw.includes('starter')) return 'founder';
  return 'unknown';
}

function getLatestActive(rows = []) {
  const usable = Array.isArray(rows) ? rows.filter((row) => isActiveStatus(row.status || row.stripe_status)) : [];

  usable.sort((a, b) => {
    const bDate = new Date(b.updated_at || b.created_at || 0).getTime();
    const aDate = new Date(a.updated_at || a.created_at || 0).getTime();
    return bDate - aDate;
  });

  return usable[0] || null;
}

function getSubscriptionUpdateAllowance(subscription = null) {
  if (!subscription) return null;

  const explicit =
    numberOrNull(subscription.monthly_update_limit) ||
    numberOrNull(subscription.updates_allowed) ||
    numberOrNull(subscription.update_limit);

  if (explicit !== null) return explicit;

  const planKey = getPlanKey(subscription);
  if (planKey === 'entrepreneur') return 25;
  if (planKey === 'premier') return 5;

  return null;
}

function getBuildSummary(order = null, sites = []) {
  if (!order) {
    return {
      allowed: 0,
      used: 0,
      remaining: 0,
      source: 'no_package'
    };
  }

  const planKey = getPlanKey(order);

  const allowedFromOrder =
    numberOrNull(order.sites_purchased) ||
    numberOrNull(order.builds_allowed) ||
    numberOrNull(order.total_builds);

  const allowed =
    planKey === 'entrepreneur'
      ? ENTREPRENEUR_TOTAL_BUILDS
      : (allowedFromOrder || 1);

  const usedFromOrder =
    numberOrNull(order.sites_used) ||
    numberOrNull(order.builds_used);

  const remainingFromOrder =
    numberOrNull(order.sites_remaining) ||
    numberOrNull(order.builds_remaining);

  let used;
  let remaining;
  let source;

  if (remainingFromOrder !== null) {
    remaining = Math.max(0, Math.min(allowed, remainingFromOrder));
    used = Math.max(0, allowed - remaining);
    source = 'order_remaining';
  } else if (usedFromOrder !== null) {
    used = Math.max(0, Math.min(allowed, usedFromOrder));
    remaining = Math.max(0, allowed - used);
    source = 'order_used';
  } else {
    used = Math.max(0, Array.isArray(sites) ? sites.length : 0);
    remaining = Math.max(0, allowed - used);
    source = 'sites_count';
  }

  return {
    allowed,
    used,
    remaining,
    source
  };
}

function safeOrder(row = null) {
  if (!row) {
    return {
      hasPackage: false
    };
  }

  return {
    hasPackage: true,
    id: row.id || null,
    plan_key: getPlanKey(row),
    plan_name: row.plan_name || row.package_name || 'Website Package',
    status: row.status || 'active',
    amount_paid: row.amount_paid || null,
    sites_purchased: row.sites_purchased || null,
    sites_used: row.sites_used || null,
    sites_remaining: row.sites_remaining || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null
  };
}

function safeSubscription(row = null) {
  if (!row) {
    return {
      hasSubscription: false
    };
  }

  return {
    hasSubscription: true,
    id: row.id || null,
    plan_key: row.plan_key || getPlanKey(row),
    plan_name: row.plan_name || row.support_tier || 'Site Management',
    support_tier: row.support_tier || '',
    status: row.stripe_status || row.status || 'active',
    stripe_status: row.stripe_status || '',
    public_price: row.public_price || '',
    update_allowance: row.update_allowance || '',
    updates_allowed: getSubscriptionUpdateAllowance(row),
    current_period_end: row.current_period_end || null,
    cancel_at_period_end: Boolean(row.cancel_at_period_end || false),
    created_at: row.created_at || null,
    updated_at: row.updated_at || null
  };
}

function safeSites(rows = []) {
  return (Array.isArray(rows) ? rows : []).slice(0, 20).map((row) => ({
    id: row.id || null,
    order_id: row.order_id || null,
    email: row.email || '',
    business_name: row.business_name || '',
    site_name: row.site_name || '',
    domain_name: row.domain_name || '',
    site_status: row.site_status || row.status || '',
    template_selected: row.template_selected || '',
    created_at: row.created_at || null,
    updated_at: row.updated_at || null
  }));
}

async function getUser(email) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .ilike('email', email)
    .maybeSingle();

  if (error) {
    console.error('Portal user lookup error:', error.message);
    return null;
  }

  return data || null;
}

async function getRows(table, email) {
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .ilike('email', email)
    .order('created_at', { ascending: false });

  if (error) {
    console.error(`Portal ${table} lookup error:`, error.message);
    return [];
  }

  return Array.isArray(data) ? data : [];
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  if (!supabase) {
    console.error('Supabase is not configured for get_portal.');
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Member dashboard is not configured yet.' }) };
  }

  const email = normalizeEmail(event.queryStringParameters?.email || '');

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'A valid email address is required.' }) };
  }

  try {
    const [user, orders, subscriptions, sites] = await Promise.all([
      getUser(email),
      getRows('orders', email),
      getRows('subscriptions', email),
      getRows('sites', email)
    ]);

    const latestOrder = getLatestActive(orders);
    const latestSubscription = getLatestActive(subscriptions);
    const buildSummary = getBuildSummary(latestOrder, sites);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        email,
        user: {
          email,
          full_name: user?.full_name || latestOrder?.full_name || latestSubscription?.full_name || '',
          phone: user?.phone || latestOrder?.phone || latestSubscription?.phone || '',
          status: user?.status || ''
        },
        package: safeOrder(latestOrder),
        subscription: safeSubscription(latestSubscription),
        builds: buildSummary,
        sites: safeSites(sites),
        counts: {
          orders: orders.length,
          subscriptions: subscriptions.length,
          sites: sites.length
        }
      })
    };
  } catch (err) {
    console.error('Portal handler error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Could not load member dashboard.' }) };
  }
};
