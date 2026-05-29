'use strict';

const { createClient } = require('@supabase/supabase-js');

const RESEND_FROM = process.env.RESEND_FROM_EMAIL || 'AI4 Website Design <noreply@ai4websitedesign.com>';
const INTERNAL_EMAIL = process.env.AI4_INTERNAL_NOTIFICATION_EMAIL || 'jmitchell@ai4websitedesign.com';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function json(statusCode, payload) {
  return { statusCode, headers, body: JSON.stringify(payload) };
}

function clean(value = '', max = 500) {
  return String(value || '').trim().slice(0, max);
}

function cleanEmail(value = '') {
  return clean(value, 254).toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Missing Supabase environment variables');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function sendEmail({ to, subject, html }) {
  if (!process.env.RESEND_API_KEY) return;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: RESEND_FROM, to: Array.isArray(to) ? to : [to], subject, html }),
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { success: false, error: 'Method not allowed' });

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { success: false, error: 'Invalid JSON' });
  }

  const name       = clean(body.name, 120);
  const email      = cleanEmail(body.email);
  const phone      = clean(body.phone, 30);
  const type       = clean(body.website_type || body.type, 60);
  const promoCode  = clean(body.promo_code || body.promoCode, 60).toUpperCase();
  const expiresAt  = clean(body.expires_at || body.expiresAt, 40);

  if (!name)               return json(400, { success: false, error: 'Name is required' });
  if (!isValidEmail(email)) return json(400, { success: false, error: 'Valid email is required' });
  if (!promoCode)          return json(400, { success: false, error: 'Promo code is required' });

  let supabase;
  try {
    supabase = getSupabase();
  } catch (err) {
    return json(500, { success: false, error: 'Service configuration error' });
  }

  // Duplicate check — one promo per email
  const { data: existing } = await supabase
    .from('promo_leads')
    .select('id, promo_code, used')
    .eq('email', email)
    .limit(1)
    .maybeSingle();

  if (existing) {
    return json(409, {
      success: false,
      duplicate: true,
      used: existing.used,
      promo_code: existing.used ? null : existing.promo_code,
      error: existing.used
        ? 'This email has already used their promo code.'
        : 'A promo code was already issued to this email.',
    });
  }

  // Insert new lead
  const { error: insertError } = await supabase.from('promo_leads').insert({
    name,
    email,
    phone: phone || null,
    website_type: type || null,
    promo_code: promoCode,
    used: false,
    source: 'platinum-promo-page',
    expires_at: expiresAt || null,
  });

  if (insertError) {
    if (insertError.message?.includes('unique') || insertError.message?.includes('duplicate')) {
      return json(409, { success: false, duplicate: true, error: 'Promo code already claimed.' });
    }
    console.error('promo_leads insert error:', insertError.message);
    return json(500, { success: false, error: 'Failed to save promo lead' });
  }

  // Send promo code to customer
  await Promise.allSettled([
    sendEmail({
      to: email,
      subject: 'Your AI4 Website Design Promo Code',
      html: `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#030816;color:#f5f8ff;font-family:Arial,sans-serif;">
  <div style="max-width:580px;margin:0 auto;padding:40px 24px;">
    <div style="background:#061225;border:1px solid rgba(45,184,255,.2);border-radius:16px;padding:32px;">
      <div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#FFB800;font-weight:700;margin-bottom:12px;">AI4 Website Design</div>
      <h1 style="font-size:22px;color:#f5f8ff;margin:0 0 16px;">Hi ${name} — here's your Promo Code</h1>
      <p style="font-size:15px;color:#AEBED3;line-height:1.6;margin:0 0 24px;">Use the code below to claim your free website build. Enter it when you start building.</p>
      <div style="text-align:center;background:rgba(255,184,0,.08);border:1px dashed rgba(255,184,0,.4);border-radius:10px;padding:20px;margin-bottom:24px;">
        <div style="font-size:11px;letter-spacing:.12em;color:#FFD060;text-transform:uppercase;margin-bottom:8px;">Your Promo Code</div>
        <div style="font-size:28px;font-weight:700;letter-spacing:.18em;color:#FFB800;font-family:monospace;">${promoCode}</div>
      </div>
      <div style="text-align:center;">
        <a href="https://ai4websitedesign.com/signup?promo=${promoCode}&type=${encodeURIComponent(type)}" style="display:inline-block;background:linear-gradient(135deg,#FFB800,#FFD060);color:#1a0d00;font-weight:700;font-size:15px;padding:14px 32px;border-radius:10px;text-decoration:none;">Start Building My Website →</a>
      </div>
      <p style="font-size:12px;color:#90A3BC;margin:20px 0 0;text-align:center;">Questions? Reply to this email or contact jmitchell@ai4websitedesign.com</p>
    </div>
  </div>
</body></html>`,
    }),

    // Internal alert
    sendEmail({
      to: INTERNAL_EMAIL,
      subject: `New Promo Lead — ${name}`,
      html: `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;background:#030816;color:#f5f8ff;margin:0;padding:24px;">
  <div style="max-width:520px;margin:0 auto;background:#061225;border:1px solid rgba(45,184,255,.2);border-radius:12px;padding:24px;">
    <div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#FFB800;margin-bottom:12px;">New Promo Lead</div>
    <table style="width:100%;border-collapse:collapse;font-size:14px;color:#AEBED3;">
      <tr><td style="padding:7px 0;color:#90A3BC;width:130px;">Name</td><td>${name}</td></tr>
      <tr><td style="padding:7px 0;color:#90A3BC;">Email</td><td>${email}</td></tr>
      <tr><td style="padding:7px 0;color:#90A3BC;">Phone</td><td>${phone || '—'}</td></tr>
      <tr><td style="padding:7px 0;color:#90A3BC;">Website Type</td><td>${type || '—'}</td></tr>
      <tr><td style="padding:7px 0;color:#90A3BC;">Promo Code</td><td style="color:#FFB800;font-family:monospace;">${promoCode}</td></tr>
    </table>
  </div>
</body></html>`,
    }),
  ]);

  return json(200, { success: true, promo_code: promoCode });
};
