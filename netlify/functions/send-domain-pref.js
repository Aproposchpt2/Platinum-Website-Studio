// ============================================================
// send-domain-pref.js — Netlify Serverless Function
// AI4 Website Design | Apropos Group LLC
// Handles: Domain preference submission from thankyou.html
// Sends:   Email alert to Apropos Group + confirmation to customer
// ============================================================

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY;

const supabase =
  supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey)
    : null;

const DEFAULT_LANGUAGE = 'en';
const INTERNAL_EMAIL =
  process.env.AI4_INTERNAL_NOTIFICATION_EMAIL ||
  process.env.RESEND_TO_EMAIL ||
  'jmitchell@ai4websitedesign.com';

const RESEND_FROM_EMAIL =
  process.env.RESEND_FROM_EMAIL ||
  'AI4 Website Design <jmitchell@ai4websitedesign.com>';

const PLAN_LABELS = {
  starter: 'Exclusive Founder’s Offer',
  premier: 'Premier',
  pro: 'Entrepreneur’s Bundle'
};

const PLAN_ALIASES = {
  'starter': 'starter',
  'business-starter': 'starter',
  'business_starter': 'starter',
  'business starter': 'starter',
  'founder': 'starter',
  'founders-offer': 'starter',
  'exclusive-founders-offer': 'starter',
  'exclusive founder’s offer': 'starter',
  'inicio': 'starter',
  'inicio-empresarial': 'starter',
  'inicio empresarial': 'starter',
  'premier': 'premier',
  'premium': 'premier',
  'advanced': 'premier',
  'avanzado': 'premier',
  'pro': 'pro',
  'professional': 'pro',
  'profesional': 'pro',
  'entrepreneur': 'pro',
  'entrepreneur-bundle': 'pro',
  'entrepreneurs-bundle': 'pro',
  'entrepreneur’s bundle': 'pro',
  'entrepreneur bundle': 'pro'
};

function normalizeDomainPreferences(value = '') {
  const raw = String(value || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\r/g, '\n');

  return raw
    .split(/[\n,;|]+/)
    .map((item) =>
      item
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//i, '')
        .replace(/^www\./i, '')
        .split(/[/?#]/)[0]
        .replace(/\s+/g, '')
        .replace(/\.$/, '')
    )
    .filter(Boolean)
    .slice(0, 3);
}

function normalizeEmail(value = '') {
  return String(value).trim().toLowerCase();
}

function normalizePlan(value = '') {
  const raw = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\+/g, ' ')
    .replace(/_/g, '-');

  return PLAN_ALIASES[raw] || 'unknown';
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function sendResendEmail({ to, subject, html }) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('RESEND_API_KEY is not configured. Email skipped.', { to, subject });
    return;
  }

  if (!to) {
    console.warn('Email recipient missing. Email skipped.', { subject });
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: RESEND_FROM_EMAIL,
      to,
      subject,
      html
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend error: ${err}`);
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let domains, domainDisplay, email, planKey, plan, language, sourceUrl;

  try {
    const body = JSON.parse(event.body || '{}');
    domains = normalizeDomainPreferences(body.domain || body.domains || '');
    domainDisplay = domains.join(', ');
    email = normalizeEmail(body.email || '');
    planKey = normalizePlan(body.plan || body.plan_name || '');
    plan = PLAN_LABELS[planKey] || (body.plan_name || body.plan || 'Unknown');
    language = String(body.language || DEFAULT_LANGUAGE).trim().toLowerCase() === 'es' ? 'es' : 'en';
    sourceUrl = String(body.source_url || '').trim();
  } catch(e) {
    return { statusCode: 400, body: 'Invalid request body' };
  }

  if (!domainDisplay) {
    return { statusCode: 400, body: 'At least one domain preference is required' };
  }

  if (!email) console.warn('Domain preference submitted without customer email.');
  if (planKey === 'unknown') console.warn('Domain preference submitted without recognized plan.');

  console.log('Domain preference received:', {
    domains,
    email,
    plan: planKey,
    plan_name: plan,
    language
  });

  const safeDomainDisplay = escapeHtml(domainDisplay);
  const safeEmail = escapeHtml(email || 'Not provided');
  const safePlan = escapeHtml(plan);
  const safeSourceUrl = escapeHtml(sourceUrl || 'Not provided');

  // Save to Supabase when configured. Non-fatal if unavailable in sandbox.
  try {
    if (supabase && email) {
      const { data: order, error: orderLookupError } = await supabase
        .from('orders')
        .select('id')
        .eq('email', email)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (orderLookupError) console.error('Supabase order lookup error:', orderLookupError);

      if (order) {
        const { error: siteError } = await supabase
          .from('sites')
          .upsert({
            order_id:    order.id,
            email,
            domain_name: domainDisplay,
            site_status: 'building',
            updated_at:  new Date().toISOString()
          }, { onConflict: 'order_id' });

        if (siteError) console.error('Supabase site upsert error:', siteError);
      }

      const { error: userUpdateError } = await supabase
        .from('users')
        .update({
          language,
          updated_at: new Date().toISOString()
        })
        .eq('email', email);

      if (userUpdateError) console.error('Supabase user update error:', userUpdateError);
    }
  } catch(dbErr) {
    console.error('DB error:', dbErr);
  }

  const internalHtml = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"></head>
    <body style="font-family:Arial,sans-serif;background:#080c10;color:#f0f6fc;margin:0;padding:0;">
      <div style="max-width:620px;margin:0 auto;padding:32px 24px;">
        <h1 style="color:#f0f6fc;font-size:22px;margin:0 0 16px;">New Domain Preferences Received</h1>
        <div style="background:rgba(240,165,0,.08);border:1px solid rgba(240,165,0,.25);border-radius:14px;padding:22px;">
          <p><strong>Requested website names:</strong><br>${safeDomainDisplay}</p>
          <p><strong>Customer Email:</strong><br>${safeEmail}</p>
          <p><strong>Plan Purchased:</strong><br>${safePlan}</p>
          <p><strong>Language:</strong><br>${language}</p>
          <p><strong>Source URL:</strong><br>${safeSourceUrl}</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const customerHtml = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"></head>
    <body style="font-family:Arial,sans-serif;background:#080c10;color:#f0f6fc;margin:0;padding:0;">
      <div style="max-width:620px;margin:0 auto;padding:32px 24px;">
        <h1 style="color:#f0f6fc;font-size:22px;margin:0 0 12px;">Domain Preferences Received ✓</h1>
        <p style="color:#c9d1d9;line-height:1.7;">We received your website name preferences and our team will check availability.</p>
        <div style="background:rgba(240,165,0,.08);border:1px solid rgba(240,165,0,.25);border-radius:14px;padding:18px;color:#f0a500;font-weight:700;">
          ${safeDomainDisplay}
        </div>
        <p style="color:#c9d1d9;line-height:1.7;">If one of these options is available within the standard domain registration credit, we will continue with registration. If a premium domain, specialty extension, renewal, or upgrade costs extra, we will confirm before proceeding.</p>
        <p style="font-size:12px;color:#8b949e;line-height:1.7;">Questions? Contact jmitchell@ai4websitedesign.com</p>
      </div>
    </body>
    </html>
  `;

  try {
    await sendResendEmail({
      to: INTERNAL_EMAIL,
      subject: 'New AI4 domain preferences received',
      html: internalHtml
    });
  } catch (err) {
    console.error('Internal domain email failed:', err.message);
  }

  if (email) {
    try {
      await sendResendEmail({
        to: email,
        subject: 'Your AI4 domain preferences were received',
        html: customerHtml
      });
    } catch (err) {
      console.error('Customer domain email failed:', err.message);
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      ok: true,
      domains,
      email,
      plan: planKey
    })
  };
};
