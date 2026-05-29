/**
 * ai4websitedesign — Founder's Offer Promo Redemption
 * netlify/functions/redeem-founder-promo.js
 *
 * PATCHED — fixes applied:
 *  FIX 1: Auto-upsert user if no signup record exists (unblocks new pipeline flow)
 *  FIX 2: builtHTML is optional — promo redeems without attachment, flagged pending_html
 *  FIX 3: Idempotency — re-attempt email on pending_email rows instead of 409 hard-reject
 *  FIX 4: Promise.allSettled — customer + internal emails fire in parallel, neither blocks the other
 *
 * Writes only to users / promo_redemptions / sites.
 * Does not create orders or subscriptions and does not call Stripe webhooks.
 */

'use strict';

const { createClient } = require('@supabase/supabase-js');

const MAX_HTML_LENGTH = 750000;
const MAX_JSON_LENGTH = 250000;
const PROMO_TYPE      = 'founders_offer';

const headers = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type':                 'application/json',
};

const INTERNAL_EMAIL =
  process.env.AI4_INTERNAL_NOTIFICATION_EMAIL ||
  process.env.RESEND_TO_EMAIL ||
  'jmitchell@ai4websitedesign.com';

const RESEND_FROM_EMAIL =
  process.env.RESEND_FROM_EMAIL ||
  'AI4 Website Design <jmitchell@ai4websitedesign.com>';

// ── Helpers ────────────────────────────────────────────────────────────────
function json(statusCode, payload) {
  return { statusCode, headers, body: JSON.stringify(payload) };
}

function safeString(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
}

function normalizeEmail(value) {
  return safeString(value).toLowerCase();
}

function normalizePromoCode(value) {
  return safeString(value).toUpperCase().replace(/\s+/g, '');
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeJson(value, fallback = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const serialized = JSON.stringify(value);
  if (serialized.length > MAX_JSON_LENGTH) return fallback;
  return value;
}

function hasHtmlDocumentShape(value = '') {
  const html = safeString(value);
  return /<!doctype\s+html/i.test(html) || /<html[\s>]/i.test(html);
}

function getAllowedPromoCodes() {
  const raw = [
    process.env.FOUNDER_PROMO_CODES,
    process.env.FOUNDER_PROMO_CODE,
    process.env.AI4_FOUNDER_PROMO_CODES,
    process.env.AI4_FOUNDER_PROMO_CODE,
  ].filter(Boolean).join(',');

  return raw
    .split(',')
    .map((code) => normalizePromoCode(code))
    .filter(Boolean);
}

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Missing Supabase environment variables');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ── Email sender ───────────────────────────────────────────────────────────
async function sendResendEmail({ to, subject, html, text, attachments = [] }) {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not configured');
  if (!to) throw new Error('Email recipient is required');

  const body = {
    from: RESEND_FROM_EMAIL,
    to:   Array.isArray(to) ? to : [to],
    subject,
    html,
    text,
  };

  if (attachments.length) body.attachments = attachments;

  const res = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const responseText = await res.text();
  if (!res.ok) throw new Error(`Resend error: ${responseText}`);

  try {
    return responseText ? JSON.parse(responseText) : {};
  } catch {
    return { raw: responseText };
  }
}

// ── FIX 1: Find user OR auto-create if not found ──────────────────────────
async function findOrCreateUser(supabase, { userId, email, fullName, phone, now }) {
  // Try by ID first
  if (userId) {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw new Error(`User lookup failed: ${error.message}`);
    if (data) return { user: data, created: false };
  }

  // Try by email
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('email', email)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`User lookup failed: ${error.message}`);
  if (data) return { user: data, created: false };

  // AUTO-CREATE — new pipeline users arrive without a prior signup record
  console.log(`[PromoRedeem] No user record for ${email} — auto-creating`);
  const { data: newUser, error: createErr } = await supabase
    .from('users')
    .insert({
      email,
      full_name:  fullName || email,
      phone:      phone    || null,
      source:     'promo_redemption',
      created_at: now,
      updated_at: now,
    })
    .select('*')
    .single();

  if (createErr) throw new Error(`User auto-create failed: ${createErr.message}`);
  console.log(`[PromoRedeem] User created: ${newUser.id}`);
  return { user: newUser, created: true };
}

// ── Site lookup ────────────────────────────────────────────────────────────
async function findSelectedSite(supabase, { siteId, buildId, email }) {
  const requestedId = safeString(siteId || buildId);

  if (requestedId) {
    const { data, error } = await supabase
      .from('sites')
      .select('*')
      .eq('id', requestedId)
      .maybeSingle();
    if (error) throw new Error(`Build lookup failed: ${error.message}`);
    if (data) return data;
  }

  const { data, error } = await supabase
    .from('sites')
    .select('*')
    .eq('email', email)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Build lookup failed: ${error.message}`);
  return data || null;
}

// ── FIX 3: Idempotency — check for pending_email rows to retry ────────────
async function findExistingRedemption(supabase, { email, userId }) {
  let query = supabase
    .from('promo_redemptions')
    .select('id,status,created_at,html_delivery_status')
    .eq('promo_type', PROMO_TYPE)
    .order('created_at', { ascending: false })
    .limit(1);

  query = userId ? query.eq('user_id', userId) : query.eq('email', email);

  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`Promo lookup failed: ${error.message}`);
  return data || null;
}

// ── Build email HTML ───────────────────────────────────────────────────────
function buildCustomerEmail({ safeFullName, safeBusinessName, hasAttachment }) {
  const attachmentNote = hasAttachment
    ? `Your custom website file for <strong style="color:#ffffff;">${safeBusinessName}</strong> is attached to this email as <strong style="color:#ffffff;">index.html</strong>.`
    : `Your website for <strong style="color:#ffffff;">${safeBusinessName}</strong> is being prepared. You'll receive a follow-up email with your file shortly.`;

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#080c10;color:#f0f6fc;font-family:Arial,sans-serif;">
  <div style="max-width:640px;margin:0 auto;padding:32px 24px;">
    <div style="border:1px solid #1c2430;background:#0f1419;border-radius:18px;padding:28px;">
      <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#f0a500;font-weight:700;">AI4 Website Design</div>
      <h1 style="font-size:24px;line-height:1.25;margin:14px 0 12px;color:#f0f6fc;">Your Founder's Offer website file is ready</h1>
      <p style="font-size:15px;line-height:1.7;color:#c9d1d9;margin:0 0 14px;">Hi ${safeFullName},</p>
      <p style="font-size:15px;line-height:1.7;color:#c9d1d9;margin:0 0 14px;">${attachmentNote}</p>
      ${hasAttachment ? `<p style="font-size:15px;line-height:1.7;color:#c9d1d9;margin:0 0 14px;">Save the attached file to your computer. This is the HTML file generated from your AI4 Website Design build.</p>` : ''}
      <p style="font-size:14px;line-height:1.7;color:#8b949e;margin:22px 0 0;">Questions? Reply to this email or contact jmitchell@ai4websitedesign.com.</p>
    </div>
    <p style="font-size:12px;line-height:1.6;color:#8b949e;margin:18px 0 0;text-align:center;">Powered by Apropos Group LLC</p>
  </div>
</body>
</html>`;
}

function buildInternalEmail({ safeFullName, safeBusinessName, email, promoCode, redemptionId, siteId, hasAttachment, userCreated }) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;background:#080c10;color:#f0f6fc;margin:0;padding:0;">
  <div style="max-width:660px;margin:0 auto;padding:32px 24px;">
    <div style="border:1px solid #1c2430;background:#0f1419;border-radius:18px;padding:24px;">
      <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#f0a500;font-weight:700;">Founder's Offer Promo Redeemed</div>
      <h1 style="font-size:22px;margin:12px 0;color:#f0f6fc;">Promo fulfillment ${hasAttachment ? 'completed' : 'queued — no HTML yet'}</h1>
      <p style="font-size:15px;line-height:1.7;color:#c9d1d9;">A Founder's Offer promo code was redeemed. Customer ${hasAttachment ? 'was emailed their website file as <strong>index.html</strong>' : 'has been notified — HTML delivery is pending'}.</p>
      <table style="width:100%;border-collapse:collapse;margin-top:18px;font-size:14px;color:#c9d1d9;">
        <tr><td style="padding:8px;border-bottom:1px solid #1c2430;color:#8b949e;">Customer</td><td style="padding:8px;border-bottom:1px solid #1c2430;">${safeFullName}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #1c2430;color:#8b949e;">Email</td><td style="padding:8px;border-bottom:1px solid #1c2430;">${escapeHtml(email)}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #1c2430;color:#8b949e;">Business</td><td style="padding:8px;border-bottom:1px solid #1c2430;">${safeBusinessName}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #1c2430;color:#8b949e;">Promo Code</td><td style="padding:8px;border-bottom:1px solid #1c2430;">${escapeHtml(promoCode)}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #1c2430;color:#8b949e;">Redemption ID</td><td style="padding:8px;border-bottom:1px solid #1c2430;">${escapeHtml(redemptionId)}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #1c2430;color:#8b949e;">Site ID</td><td style="padding:8px;border-bottom:1px solid #1c2430;">${escapeHtml(siteId || 'Not persisted')}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #1c2430;color:#8b949e;">HTML Attached</td><td style="padding:8px;border-bottom:1px solid #1c2430;">${hasAttachment ? '✓ Yes' : '✗ No — pending_html'}</td></tr>
        <tr><td style="padding:8px;color:#8b949e;">User Auto-Created</td><td style="padding:8px;">${userCreated ? '✓ Yes (new pipeline user)' : 'No (existing)'}</td></tr>
      </table>
    </div>
  </div>
</body>
</html>`;
}

// ══════════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ══════════════════════════════════════════════════════════════════════════
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST')    return json(405, { success: false, error: 'Method not allowed' });

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { success: false, error: 'Invalid JSON body' });
  }

  // ── Env check ─────────────────────────────────────────────────────────────
  const allowedCodes = getAllowedPromoCodes();
  if (!allowedCodes.length) {
    return json(500, { success: false, error: 'Founder promo code is not configured' });
  }

  // ── Parse + validate inputs ───────────────────────────────────────────────
  const promoCode             = normalizePromoCode(body.promo_code);
  const email                 = normalizeEmail(body.email);
  const userIdFromClient      = safeString(body.user_id);
  const siteIdFromClient      = safeString(body.site_id);
  const buildIdFromClient     = safeString(body.build_id);
  const fullNameFromClient    = safeString(body.full_name || body.name);
  const phoneFromClient       = safeString(body.phone);
  const siteDataFromClient    = safeJson(body.site_data, {});
  const businessNameFromClient = safeString(
    body.business_name ||
    siteDataFromClient.businessName ||
    siteDataFromClient.business_name ||
    'Website Build'
  );

  if (!promoCode)                     return json(400, { success: false, error: 'Promo code is required' });
  if (!allowedCodes.includes(promoCode)) return json(400, { success: false, error: 'Invalid promo code' });
  if (!isValidEmail(email))           return json(400, { success: false, error: 'Valid signup email is required' });

  // ── FIX 2: builtHTML is optional ─────────────────────────────────────────
  let builtHtmlFromClient = safeString(body.built_html);
  if (builtHtmlFromClient.length > MAX_HTML_LENGTH) {
    return json(413, { success: false, error: 'Built HTML is too large' });
  }

  // ── Supabase ──────────────────────────────────────────────────────────────
  let supabase;
  try {
    supabase = getSupabase();
  } catch (error) {
    console.error('Promo configuration error:', error.message);
    return json(500, { success: false, error: 'Promo redemption is not configured' });
  }

  let redemptionId = null;
  const now        = new Date().toISOString();

  try {
    // ── FIX 1: Find or auto-create user ──────────────────────────────────────
    const { user, created: userCreated } = await findOrCreateUser(supabase, {
      userId:   userIdFromClient,
      email,
      fullName: fullNameFromClient,
      phone:    phoneFromClient,
      now,
    });

    // Block if already redeemed on user flag
    if (user.founders_offer_promo_used) {
      return json(409, { success: false, error: "Founder's Offer promo has already been redeemed for this account" });
    }

    // ── FIX 3: Idempotency — check for existing redemption row ───────────────
    const existing = await findExistingRedemption(supabase, { email, userId: user.id });

    if (existing) {
      // Already fully redeemed — hard stop
      if (existing.status === 'redeemed') {
        return json(409, { success: false, error: "Founder's Offer promo has already been redeemed for this account" });
      }
      // pending_email = created but email never fired — fall through and retry with this ID
      if (existing.status === 'pending_email') {
        console.log(`[PromoRedeem] Retrying email for pending redemption ${existing.id}`);
        redemptionId = existing.id;
      }
    }

    // ── Site lookup ──────────────────────────────────────────────────────────
    const site = await findSelectedSite(supabase, {
      siteId:   siteIdFromClient,
      buildId:  buildIdFromClient,
      email,
    });

    const siteBuiltHtml = site && site.built_html ? safeString(site.built_html) : '';
    const builtHtml     = siteBuiltHtml || builtHtmlFromClient;

    // FIX 2: Don't hard-fail on missing HTML — flag it and continue
    const hasAttachment = Boolean(builtHtml) && hasHtmlDocumentShape(builtHtml) && builtHtml.length <= MAX_HTML_LENGTH;
    if (builtHtml && !hasAttachment) {
      console.warn(`[PromoRedeem] HTML present but invalid/oversized — proceeding without attachment`);
    }

    const businessName = safeString(
      (site && (site.business_name || site.site_name)) ||
      businessNameFromClient ||
      'Website Build'
    );

    const fullName = safeString(
      (user && (user.full_name || user.name)) ||
      fullNameFromClient ||
      email
    );

    const phone = safeString((user && user.phone) || phoneFromClient);

    const siteData =
      site && site.site_data && typeof site.site_data === 'object'
        ? site.site_data
        : siteDataFromClient;

    // ── Insert redemption row (only if not retrying) ──────────────────────────
    if (!redemptionId) {
      const { data: redemption, error: insertError } = await supabase
        .from('promo_redemptions')
        .insert({
          user_id:               user.id,
          email,
          full_name:             fullName,
          phone:                 phone || null,
          promo_code:            promoCode,
          promo_type:            PROMO_TYPE,
          status:                'pending_email',
          // NOTE: site_id and build_id both reference sites.id for now.
          // If a separate builds table is added in future, build_id should reference that.
          site_id:               site && site.id ? site.id : null,
          build_id:              site && site.id ? site.id : null,
          business_name:         businessName,
          html_delivery_status:  hasAttachment ? 'pending' : 'pending_html',
          created_at:            now,
          redeemed_at:           now,
          metadata: {
            source:            'offer.html',
            delivery_file:     'index.html',
            client_site_id:    siteIdFromClient  || null,
            client_build_id:   buildIdFromClient || null,
            build_persisted:   Boolean(site && site.id),
            has_attachment:    hasAttachment,
            user_auto_created: userCreated,
            site_data:         siteData,
          },
        })
        .select('id')
        .single();

      if (insertError) {
        const msg = String(insertError.message || '').toLowerCase();
        if (msg.includes('duplicate') || msg.includes('unique')) {
          return json(409, { success: false, error: "Founder's Offer promo has already been redeemed for this account" });
        }
        throw new Error(`Promo insert failed: ${insertError.message}`);
      }

      redemptionId = redemption.id;
    }

    // ── Backfill built_html on site if needed ────────────────────────────────
    if (site && site.id && !siteBuiltHtml && builtHtmlFromClient && hasAttachment) {
      const { error: siteUpdateError } = await supabase
        .from('sites')
        .update({
          built_html: builtHtmlFromClient,
          site_data:  siteData,
          updated_at: new Date().toISOString(),
        })
        .eq('id', site.id);

      if (siteUpdateError) {
        console.error('Unable to backfill built_html on site:', siteUpdateError.message);
      }
    }

    // ── Build email payloads ─────────────────────────────────────────────────
    const safeFullName     = escapeHtml(fullName);
    const safeBusinessName = escapeHtml(businessName);

    const customerEmailPayload = {
      to:      email,
      subject: 'Your AI4 Website Design file is ready',
      html:    buildCustomerEmail({ safeFullName, safeBusinessName, hasAttachment }),
      text:    [
        "Your Founder's Offer website file is ready.",
        '',
        `Hi ${fullName},`,
        hasAttachment
          ? `Your custom website file for ${businessName} is attached as index.html.`
          : `Your website for ${businessName} is being prepared. You will receive a follow-up email with your file shortly.`,
        '',
        'Questions? Reply to this email or contact jmitchell@ai4websitedesign.com.',
      ].join('\n'),
      attachments: hasAttachment
        ? [{ filename: 'index.html', content: Buffer.from(builtHtml, 'utf8').toString('base64') }]
        : [],
    };

    const internalEmailPayload = {
      to:      INTERNAL_EMAIL,
      subject: "AI4 Founder's Offer Promo Redeemed",
      html:    buildInternalEmail({
        safeFullName, safeBusinessName, email, promoCode,
        redemptionId, siteId: site && site.id ? site.id : null,
        hasAttachment, userCreated,
      }),
      text: `Founder's Offer promo redeemed for ${fullName} <${email}>. Redemption ID: ${redemptionId}. HTML attached: ${hasAttachment}`,
    };

    // ── FIX 4: Fire both emails in parallel — neither blocks the other ────────
    const [customerResult, internalResult] = await Promise.allSettled([
      sendResendEmail(customerEmailPayload),
      sendResendEmail(internalEmailPayload),
    ]);

    // Customer email must succeed
    if (customerResult.status === 'rejected') {
      throw new Error(`Customer email failed: ${customerResult.reason?.message}`);
    }

    const internalWarning = internalResult.status === 'rejected'
      ? internalResult.reason?.message
      : null;

    if (internalWarning) {
      console.error('Internal promo notification failed:', internalWarning);
    }

    const sentAt = new Date().toISOString();

    // ── Update redemption to redeemed ────────────────────────────────────────
    const { error: redemptionUpdateError } = await supabase
      .from('promo_redemptions')
      .update({
        status:                   'redeemed',
        html_delivery_status:     hasAttachment ? 'sent' : 'pending_html',
        customer_email_sent_at:   sentAt,
        internal_email_sent_at:   internalResult.status === 'fulfilled' ? sentAt : null,
        metadata: {
          source:                           'offer.html',
          delivery_file:                    'index.html',
          client_site_id:                   siteIdFromClient  || null,
          client_build_id:                  buildIdFromClient || null,
          build_persisted:                  Boolean(site && site.id),
          has_attachment:                   hasAttachment,
          user_auto_created:                userCreated,
          site_data:                        siteData,
          internal_notification_warning:    internalWarning,
        },
      })
      .eq('id', redemptionId);

    if (redemptionUpdateError) {
      throw new Error(`Promo update failed: ${redemptionUpdateError.message}`);
    }

    // ── Flag user as redeemed ─────────────────────────────────────────────────
    const { error: userUpdateError } = await supabase
      .from('users')
      .update({
        founders_offer_promo_used:            true,
        founders_offer_promo_used_at:         sentAt,
        founders_offer_promo_code:            promoCode,
        founders_offer_promo_redemption_id:   redemptionId,
        updated_at:                           sentAt,
      })
      .eq('id', user.id);

    if (userUpdateError) {
      throw new Error(`User promo flag update failed: ${userUpdateError.message}`);
    }

    return json(200, {
      success:               true,
      redeemed:              true,
      redemption_id:         redemptionId,
      user_id:               user.id,
      user_created:          userCreated,
      site_id:               site && site.id ? site.id : null,
      build_id:              site && site.id ? site.id : null,
      customer_email_sent:   true,
      html_attached:         hasAttachment,
      internal_email_sent:   internalResult.status === 'fulfilled',
      warning:               internalWarning || null,
    });

  } catch (error) {
    console.error('Founder promo redemption error:', error.message);

    // ── Rollback: mark row as failed so it can be retried ────────────────────
    if (redemptionId) {
      try {
        await supabase
          .from('promo_redemptions')
          .update({
            status:               'failed_email',
            html_delivery_status: 'failed',
            metadata: {
              failure_message: error.message,
              failed_at:       new Date().toISOString(),
            },
          })
          .eq('id', redemptionId);
      } catch (updateError) {
        console.error('Unable to record failed promo redemption:', updateError.message);
      }
    }

    return json(500, {
      success: false,
      error:   "Unable to complete Founder's Offer promo redemption right now",
    });
  }
};
