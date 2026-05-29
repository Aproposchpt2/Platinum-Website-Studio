// ============================================================
// partner-inquiry.js — Netlify Serverless Function
// AI4 Website Design | Apropos Group LLC
// Handles: Partner MSP / White Label Consultation inquiries
// Saves:   partner_inquiries when table/schema is available
// Sends:   Internal alert + customer confirmation through Resend
// ============================================================

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}

function clean(value = '', maxLength = 1000) {
  return String(value || '').trim().slice(0, maxLength);
}

function cleanEmail(value = '') {
  return clean(value, 254).toLowerCase();
}

function escapeHtml(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function trySavePartnerInquiry(payload) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.warn('Supabase env vars missing; skipping partner_inquiries save.');
    return { saved: false, error: 'Supabase env vars missing' };
  }

  const now = new Date().toISOString();

  const fullRecord = {
    full_name: payload.full_name,
    email: payload.email,
    phone: payload.phone,
    company: payload.company,
    message: payload.message,
    plan: payload.plan,
    language: payload.language,
    source: payload.source,
    source_url: payload.source_url,
    business_name: payload.business_name,
    domain_credit_accepted: payload.domain_credit_accepted,
    status: 'new',
    created_at: now,
    updated_at: now
  };

  const fallbackRecord = {
    full_name: payload.full_name,
    email: payload.email,
    phone: payload.phone,
    company: payload.company,
    message: [
      payload.message,
      '',
      `Plan context: ${payload.plan || 'not provided'}`,
      `Business/site context: ${payload.business_name || 'not provided'}`,
      `Source: ${payload.source_url || payload.source || 'offer.html'}`
    ].join('\n'),
    status: 'new',
    created_at: now,
    updated_at: now
  };

  const minimalRecord = {
    email: payload.email,
    message: [
      `Partner MSP / White Label Consultation Inquiry`,
      `Name: ${payload.full_name}`,
      `Phone: ${payload.phone || 'not provided'}`,
      `Company: ${payload.company || 'not provided'}`,
      `Plan context: ${payload.plan || 'not provided'}`,
      `Business/site context: ${payload.business_name || 'not provided'}`,
      `Source: ${payload.source_url || payload.source || 'offer.html'}`,
      '',
      payload.message || 'No message provided.'
    ].join('\n'),
    created_at: now
  };

  const attempts = [fullRecord, fallbackRecord, minimalRecord];

  for (const record of attempts) {
    const { data, error } = await supabase
      .from('partner_inquiries')
      .insert(record)
      .select()
      .single();

    if (!error) return { saved: true, data };

    console.error('partner_inquiries insert attempt failed:', error);
  }

  return { saved: false, error: 'All partner_inquiries insert attempts failed' };
}

async function sendResendEmail({ to, subject, html }) {
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
    throw new Error('Resend env vars missing');
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL,
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
    return jsonResponse(405, { error: 'Method Not Allowed' });
  }

  let body;

  try {
    body = JSON.parse(event.body || '{}');
  } catch (err) {
    return jsonResponse(400, { error: 'Invalid request body' });
  }

  const payload = {
    full_name: clean(body.full_name || body.name, 160),
    email: cleanEmail(body.email),
    phone: clean(body.phone, 80),
    company: clean(body.company, 180),
    message: clean(body.message, 3000),
    plan: clean(body.plan, 80),
    language: clean(body.language || 'en', 12),
    source: clean(body.source || 'offer.html', 120),
    source_url: clean(body.source_url, 500),
    business_name: clean(body.business_name, 180),
    domain_credit_accepted: Boolean(body.domain_credit_accepted),
    site_data: body.site_data && typeof body.site_data === 'object' ? body.site_data : {}
  };

  if (!payload.full_name || !payload.email) {
    return jsonResponse(400, { error: 'Name and email are required' });
  }

  console.log('Partner MSP inquiry received:', {
    full_name: payload.full_name,
    email: payload.email,
    phone: payload.phone,
    company: payload.company,
    plan: payload.plan,
    source: payload.source
  });

  const saveResult = await trySavePartnerInquiry(payload);
  if (!saveResult.saved) {
    console.error('Partner inquiry was not saved to Supabase:', saveResult.error);
  }

  const submittedAt = new Date().toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    dateStyle: 'medium',
    timeStyle: 'short'
  });

  const internalHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: Arial, sans-serif; background: #080c10; color: #f0f6fc; margin: 0; padding: 0; }
        .wrap { max-width: 620px; margin: 0 auto; padding: 32px 24px; }
        .brand { font-size: 1.2rem; font-weight: 900; font-style: italic; color: #4F6EF7; margin-bottom: 20px; }
        .card { background: rgba(79,110,247,.09); border: 1px solid rgba(79,110,247,.25); border-radius: 14px; padding: 24px; margin-bottom: 18px; }
        h1 { font-size: 1.25rem; margin: 0 0 16px; }
        .field { margin-bottom: 12px; }
        .label { font-size: 10px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: #8b949e; margin-bottom: 4px; }
        .value { font-size: .95rem; color: #f0f6fc; line-height: 1.6; }
        .highlight { color: #f0a500; font-weight: 700; }
        .footer { text-align: center; font-size: .72rem; color: #484f58; line-height: 1.7; }
      </style>
    </head>
    <body>
      <div class="wrap">
        <div class="brand">ai4websitedesign</div>
        <div class="card">
          <h1>🤝 New Partner MSP / White Label Consultation Inquiry</h1>
          <div class="field"><div class="label">Name</div><div class="value">${escapeHtml(payload.full_name)}</div></div>
          <div class="field"><div class="label">Email</div><div class="value highlight">${escapeHtml(payload.email)}</div></div>
          <div class="field"><div class="label">Phone</div><div class="value">${escapeHtml(payload.phone || 'Not provided')}</div></div>
          <div class="field"><div class="label">Company</div><div class="value">${escapeHtml(payload.company || 'Not provided')}</div></div>
          <div class="field"><div class="label">Plan Context</div><div class="value">${escapeHtml(payload.plan || 'Not provided')}</div></div>
          <div class="field"><div class="label">Business / Site Context</div><div class="value">${escapeHtml(payload.business_name || 'Not provided')}</div></div>
          <div class="field"><div class="label">Message</div><div class="value">${escapeHtml(payload.message || 'No message provided.')}</div></div>
          <div class="field"><div class="label">Source</div><div class="value">${escapeHtml(payload.source_url || payload.source)}</div></div>
          <div class="field"><div class="label">Submitted</div><div class="value">${submittedAt} PT</div></div>
          <div class="field"><div class="label">Supabase Save</div><div class="value">${saveResult.saved ? 'Saved to partner_inquiries' : 'Not saved — check function logs/schema'}</div></div>
        </div>
        <div class="footer">
          Apropos Group LLC · ai4websitedesign.com · Internal operations alert
        </div>
      </div>
    </body>
    </html>
  `;

  const customerHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: Arial, sans-serif; background: #080c10; color: #f0f6fc; margin: 0; padding: 0; }
        .wrap { max-width: 560px; margin: 0 auto; padding: 36px 24px; }
        .brand { font-size: 1.2rem; font-weight: 900; font-style: italic; color: #4F6EF7; margin-bottom: 20px; }
        .hero { background: linear-gradient(135deg, rgba(79,110,247,.12), rgba(124,58,237,.08)); border: 1px solid rgba(79,110,247,.22); border-radius: 14px; padding: 28px; text-align: center; margin-bottom: 18px; }
        h1 { font-size: 1.35rem; margin: 0 0 8px; }
        p { color: #8b949e; font-size: .9rem; line-height: 1.7; }
        .box { background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.07); border-radius: 12px; padding: 18px; margin-bottom: 18px; }
        .footer { text-align: center; font-size: .72rem; color: #484f58; line-height: 1.8; }
        a { color: #4F6EF7; }
      </style>
    </head>
    <body>
      <div class="wrap">
        <div class="brand">ai4websitedesign</div>
        <div class="hero">
          <h1>Consultation Request Received ✓</h1>
          <p>Hi ${escapeHtml(payload.full_name.split(' ')[0] || payload.full_name)} — we received your Partner MSP / White Label Consultation request.</p>
        </div>
        <div class="box">
          <p>Our team will review your inquiry and follow up by email. If your request relates to multiple sites, white-label fulfillment, client volume, or managed implementation, we will help determine the best next step before any custom engagement begins.</p>
          <p><strong>Submitted:</strong> ${submittedAt} PT</p>
        </div>
        <div class="footer">
          Questions? Reply to this email or contact <a href="mailto:support@ai4websitedesign.com">support@ai4websitedesign.com</a><br><br>
          Powered by Apropos Group LLC · ai4websitedesign.com · © 2026
        </div>
      </div>
    </body>
    </html>
  `;

  try {
    await sendResendEmail({
      to: process.env.RESEND_TO_EMAIL || 'support@ai4websitedesign.com',
      subject: `🤝 Partner MSP Inquiry — ${payload.full_name}${payload.company ? ` / ${payload.company}` : ''}`,
      html: internalHtml
    });

    await sendResendEmail({
      to: payload.email,
      subject: '✓ Partner MSP consultation request received',
      html: customerHtml
    });

    console.log('Partner inquiry emails sent successfully:', payload.email);

    return jsonResponse(200, {
      success: true,
      saved: saveResult.saved
    });
  } catch (emailErr) {
    console.error('Partner inquiry email send failed:', emailErr);
    return jsonResponse(500, {
      error: 'Email send failed',
      saved: saveResult.saved
    });
  }
};
