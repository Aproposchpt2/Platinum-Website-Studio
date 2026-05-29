// ============================================================
// stripe-webhook.js — Netlify Serverless Function
// AI4 Website Design
// Apropos Group LLC
// Handles: checkout.session.completed for website package purchases
// Tables: orders, users
//
// IMPORTANT:
// Subscription-mode Care Plan checkouts are intentionally ignored here.
// They are handled by stripe-subscription-webhook.js.
// ============================================================

const { createClient } = require('@supabase/supabase-js');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY;

const supabase =
  supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey)
    : null;

const INTERNAL_EMAIL =
  process.env.AI4_INTERNAL_NOTIFICATION_EMAIL ||
  process.env.RESEND_TO_EMAIL ||
  'jmitchell@ai4websitedesign.com';

const RESEND_FROM_EMAIL =
  process.env.RESEND_FROM_EMAIL ||
  'AI4 Website Design <jmitchell@ai4websitedesign.com>';

const PLAN_DEFINITIONS = {
  starter: {
    plan_name: 'Exclusive Founder’s Offer',
    sites_purchased: 1,
    expected_amount_cents: 4999,
    includes_domain_credit: false
  },
  premier: {
    plan_name: 'Premier',
    sites_purchased: 1,
    expected_amount_cents: 11999,
    includes_domain_credit: true
  },
  pro: {
    plan_name: 'Entrepreneur’s Bundle',
    sites_purchased: 5,
    expected_amount_cents: 44999,
    includes_domain_credit: true
  }
};

// Current English Stripe Payment Links from CURRENT STRIPE PAYMENT LINKS.txt.
// Stripe webhook session.payment_link usually arrives as a Stripe Payment Link ID,
// not the public URL. These URL mappings are retained only when Stripe supplies
// a public URL through metadata or custom configuration.
const PAYMENT_LINK_PLAN = {
  'https://buy.stripe.com/cNi6oG53A6Kz8xdfHq7EQ0w': 'starter',
  'https://buy.stripe.com/dRmbJ067E4Cr9Bhan67EQ0H': 'premier',
  'https://buy.stripe.com/8x27sKbrY1qffZFan67EQ0G': 'pro'
};

// Current English Stripe Price IDs from CURRENT STRIPE PAYMENT LINKS.txt.
const PRICE_ID_PLAN = {
  'price_1TSMYmBMRgYNYb8DYbKniWmO': 'starter',
  'price_1TTLcrBMRgYNYb8D7akPPeHq': 'premier',
  'price_1TTLfrBMRgYNYb8DCBCX3jGc': 'pro'
};

function amountToPlanKey(amountTotal = 0) {
  if (amountTotal >= PLAN_DEFINITIONS.pro.expected_amount_cents) return 'pro';
  if (amountTotal >= PLAN_DEFINITIONS.premier.expected_amount_cents) return 'premier';
  return 'starter';
}

function normalizePlanKey(value = '') {
  const raw = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\+/g, ' ')
    .replace(/_/g, '-');

  const aliases = {
    'starter': 'starter',
    'founder': 'starter',
    'founders-offer': 'starter',
    'founder’s offer': 'starter',
    'exclusive-founder’s-offer': 'starter',
    'exclusive founder’s offer': 'starter',
    'premier': 'premier',
    'premium': 'premier',
    'pro': 'pro',
    'entrepreneur': 'pro',
    'entrepreneur-bundle': 'pro',
    'entrepreneurs-bundle': 'pro',
    'entrepreneur’s bundle': 'pro'
  };

  return aliases[raw] || '';
}

function getLineItemPriceId(lineItems = []) {
  for (const item of lineItems) {
    const priceId = item?.price?.id || '';
    if (priceId) return priceId;
  }

  return '';
}

function resolvePlan(session, lineItems = []) {
  const amountTotal = Number(session.amount_total || 0);
  const metadataPlan = normalizePlanKey(
    session.metadata?.plan ||
    session.metadata?.package ||
    session.metadata?.tier ||
    ''
  );
  const paymentLink =
    session.metadata?.payment_link_url ||
    session.metadata?.stripe_link ||
    session.payment_link ||
    '';
  const priceId =
    session.line_items?.data?.[0]?.price?.id ||
    getLineItemPriceId(lineItems) ||
    '';

  const mappedKey =
    metadataPlan ||
    PAYMENT_LINK_PLAN[paymentLink] ||
    PRICE_ID_PLAN[priceId] ||
    null;

  const amountKey = amountToPlanKey(amountTotal);
  let finalKey = mappedKey || amountKey;

  // Safety guard: if a mapped link/price charges a clearly lower amount,
  // classify by actual amount so older/conflicting links cannot grant the wrong plan.
  if (mappedKey && amountTotal > 0) {
    const expected = PLAN_DEFINITIONS[mappedKey].expected_amount_cents;
    const minimumAccepted = Math.round(expected * 0.9);

    if (amountTotal < minimumAccepted) {
      console.warn('Stripe amount/plan mismatch. Falling back to actual amount classification.', {
        paymentLink,
        priceId,
        mappedKey,
        amountKey,
        amountTotal,
        expected
      });
      finalKey = amountKey;
    }
  }

  const plan = PLAN_DEFINITIONS[finalKey] || PLAN_DEFINITIONS.starter;

  return {
    plan_key: finalKey,
    plan_name: plan.plan_name,
    sites_purchased: plan.sites_purchased,
    includes_domain_credit: plan.includes_domain_credit,
    amount_paid: amountTotal ? Number((amountTotal / 100).toFixed(2)) : Number((plan.expected_amount_cents / 100).toFixed(2)),
    expected_amount: Number((plan.expected_amount_cents / 100).toFixed(2)),
    stripe_price_id: priceId
  };
}

function getHeader(headers, name) {
  if (!headers) return '';
  const target = name.toLowerCase();

  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === target) return headers[key];
  }

  return '';
}

function getRawBody(event) {
  if (!event.body) return '';

  if (event.isBase64Encoded) {
    return Buffer.from(event.body, 'base64');
  }

  return event.body;
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function getSessionLineItems(sessionId) {
  if (!sessionId) return [];

  try {
    const lineItems = await stripe.checkout.sessions.listLineItems(sessionId, {
      limit: 10,
      expand: ['data.price.product']
    });

    return lineItems.data || [];
  } catch (err) {
    console.error('Unable to retrieve checkout line items:', err.message);
    return [];
  }
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

  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    console.error('STRIPE_WEBHOOK_SECRET is not configured.');
    return { statusCode: 500, body: 'Stripe webhook is not configured.' };
  }

  const sig = getHeader(event.headers, 'stripe-signature');
  let stripeEvent;

  try {
    stripeEvent = stripe.webhooks.constructEvent(
      getRawBody(event),
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;

    // Care Plan subscriptions must not create website-package orders.
    if (session.mode === 'subscription') {
      console.log('Subscription checkout ignored by package webhook:', {
        session_id: session.id,
        customer: session.customer || '',
        amount_total: session.amount_total || 0
      });

      return {
        statusCode: 200,
        body: JSON.stringify({
          received: true,
          ignored: true,
          reason: 'subscription checkout'
        })
      };
    }

    if (!supabase) {
      console.error('Supabase is not configured.');
      return { statusCode: 500, body: 'Supabase is not configured.' };
    }

    try {
      const lineItems          = await getSessionLineItems(session.id);
      const email              = session.customer_details?.email || session.customer_email || '';
      const full_name          = session.customer_details?.name  || '';
      const phone              = session.customer_details?.phone || '';
      const stripe_payment_id  = session.payment_intent || session.id;
      const stripe_customer_id = session.customer || '';
      const payment_link       = session.payment_link || '';
      const planDetails        = resolvePlan(session, lineItems);

      console.log('Processing AI4 website package order:', {
        email,
        plan: planDetails.plan_name,
        amount_paid: planDetails.amount_paid,
        payment_link,
        stripe_price_id: planDetails.stripe_price_id
      });

      const { data: order, error: orderError } = await supabase
        .from('orders')
        .upsert({
          email,
          full_name,
          phone,
          stripe_payment_id,
          stripe_customer_id,
          plan_name:       planDetails.plan_name,
          sites_purchased: planDetails.sites_purchased,
          sites_used:      0,
          sites_remaining: planDetails.sites_purchased,
          amount_paid:     planDetails.amount_paid,
          status:          'active',
          language:        'en',
          updated_at:      new Date().toISOString()
        }, { onConflict: 'stripe_payment_id' })
        .select()
        .single();

      if (orderError) {
        console.error('Order insert error:', orderError);
        return { statusCode: 500, body: 'Order insert failed' };
      }

      console.log('AI4 order created:', order.id);

      const { error: userError } = await supabase
        .from('users')
        .upsert({
          email,
          full_name,
          phone,
          stripe_customer_id,
          language:   'en',
          updated_at: new Date().toISOString()
        }, { onConflict: 'email' });

      if (userError) console.error('User upsert error:', userError);

      try {
        await sendConfirmationEmail({ email, full_name, planDetails, order });
      } catch (emailErr) {
        console.error('Customer package confirmation email failed:', emailErr.message);
      }

      try {
        await sendInternalOrderEmail({ email, full_name, phone, planDetails, order, session });
      } catch (internalEmailErr) {
        console.error('Internal package notification email failed:', internalEmailErr.message);
      }

      return {
        statusCode: 200,
        body: JSON.stringify({ received: true, order_id: order.id })
      };

    } catch (err) {
      console.error('Webhook handler error:', err);
      return { statusCode: 500, body: 'Internal server error' };
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};

async function sendConfirmationEmail({ email, full_name, planDetails, order }) {
  if (!email) {
    console.warn('Customer email missing. Confirmation email skipped.');
    return;
  }

  const firstName = full_name?.split(' ')[0] || 'there';
  const siteWord  = planDetails.sites_purchased === 1 ? 'site' : 'sites';
  const domainCreditLine = 'Includes one standard domain registration credit up to $20 for the first year. Premium domains, specialty extensions, renewals, and domain upgrades may cost extra.';

  const domainNoticeHtml = planDetails.includes_domain_credit
    ? `<div class="notice">${domainCreditLine}</div>`
    : '';

  const domainStepHtml = planDetails.includes_domain_credit
    ? `<div class="step"><div class="step-num">2</div><div class="step-text"><h4>Domain Preference</h4><p>We will review your preferred domain and apply the included standard credit. If it requires an additional cost, we will confirm before proceeding.</p></div></div>`
    : `<div class="step"><div class="step-num">2</div><div class="step-text"><h4>Next Step</h4><p>We will use your order details to continue the website delivery process.</p></div></div>`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: Arial, sans-serif; background: #080c10; color: #f0f6fc; margin: 0; padding: 0; }
        .wrap { max-width: 560px; margin: 0 auto; padding: 40px 24px; }
        .brand { font-size: 1.2rem; font-weight: 900; font-style: italic; color: #4F6EF7; margin-bottom: 24px; }
        .hero { background: linear-gradient(135deg, rgba(79,110,247,.15), rgba(124,58,237,.1)); border: 1px solid rgba(79,110,247,.25); border-radius: 16px; padding: 32px; margin-bottom: 24px; text-align: center; }
        .hero h1 { font-size: 1.5rem; font-weight: 800; margin: 0 0 8px; color: #f0f6fc; }
        .hero p { color: #8b949e; font-size: .9rem; line-height: 1.7; margin: 0; }
        .badge { display: inline-block; background: rgba(240,165,0,.1); border: 1px solid rgba(240,165,0,.3); border-radius: 8px; padding: 8px 18px; font-size: .78rem; color: #f0a500; font-weight: 700; margin: 16px 0; letter-spacing: .04em; }
        .notice { background: rgba(240,165,0,.08); border: 1px solid rgba(240,165,0,.22); border-radius: 12px; padding: 14px 16px; margin-bottom: 24px; color: #c9d1d9; font-size: .8rem; line-height: 1.6; }
        .steps { background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.07); border-radius: 12px; padding: 24px; margin-bottom: 24px; }
        .step { display: flex; gap: 14px; margin-bottom: 16px; align-items: flex-start; }
        .step:last-child { margin-bottom: 0; }
        .step-num { width: 28px; height: 28px; border-radius: 50%; background: linear-gradient(135deg, #4F6EF7, #7C3AED); color: #fff; font-weight: 700; font-size: .8rem; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .step-text h4 { font-size: .9rem; font-weight: 700; margin: 0 0 2px; color: #f0f6fc; }
        .step-text p { font-size: .8rem; color: #8b949e; line-height: 1.5; margin: 0; }
        .cta-btn { display: block; text-align: center; background: linear-gradient(135deg, #f0a500, #e09400); color: #000; font-weight: 800; font-size: 1rem; padding: 16px; border-radius: 10px; text-decoration: none; margin-bottom: 24px; }
        .footer { text-align: center; font-size: .72rem; color: #8b949e; line-height: 1.8; }
      </style>
    </head>
    <body>
      <div class="wrap">
        <div class="brand">ai4websitedesign</div>
        <div class="hero">
          <h1>Payment Confirmed! 🎉</h1>
          <p>Hi ${escapeHtml(firstName)} — your order is in our system. We are already working on it.</p>
          <div class="badge">${escapeHtml(planDetails.plan_name)} — ${planDetails.sites_purchased} ${siteWord} · $${planDetails.amount_paid}</div>
        </div>
        ${domainNoticeHtml}
        <div class="steps">
          <div class="step"><div class="step-num">1</div><div class="step-text"><h4>Payment Received ✓</h4><p>Your ${escapeHtml(planDetails.plan_name)} order is confirmed and active.</p></div></div>
          ${domainStepHtml}
          <div class="step"><div class="step-num">3</div><div class="step-text"><h4>Website Delivery</h4><p>Your ${siteWord === 'site' ? 'site will be' : 'sites will be'} prepared according to the order flow.</p></div></div>
          <div class="step"><div class="step-num">4</div><div class="step-text"><h4>Confirmation</h4><p>Site details and next steps will be sent directly to this email.</p></div></div>
        </div>
        <a class="cta-btn" href="https://ai4websitedesign.com">Return to ai4websitedesign.com</a>
        <div class="footer">
          Order ID: ${escapeHtml(order.id)}<br>
          Questions? Reply to this email or contact us at jmitchell@ai4websitedesign.com<br><br>
          Powered by Apropos Group LLC · ai4websitedesign.com<br>
          © 2026 Apropos Group LLC. All rights reserved.
        </div>
      </div>
    </body>
    </html>
  `;

  await sendResendEmail({
    to: email,
    subject: `✅ Your ${planDetails.plan_name} is confirmed`,
    html
  });

  console.log('AI4 package confirmation email sent to:', email);
}

async function sendInternalOrderEmail({ email, full_name, phone, planDetails, order, session }) {
  const rows = [
    ['Event', 'Website package purchase confirmed'],
    ['Plan', planDetails.plan_name],
    ['Amount Paid', `$${planDetails.amount_paid}`],
    ['Sites Purchased', String(planDetails.sites_purchased)],
    ['Customer Email', email || 'Not provided'],
    ['Customer Name', full_name || 'Not provided'],
    ['Phone', phone || 'Not provided'],
    ['Supabase Order ID', order?.id || 'Not saved'],
    ['Stripe Customer ID', session?.customer || 'Not provided'],
    ['Stripe Payment ID', session?.payment_intent || session?.id || 'Not provided'],
    ['Stripe Session ID', session?.id || 'Not provided']
  ];

  const tableRows = rows.map(([label, value]) => `
    <tr>
      <td style="padding:8px 10px;border-bottom:1px solid #30363d;color:#8b949e;">${escapeHtml(label)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #30363d;color:#f0f6fc;">${escapeHtml(value)}</td>
    </tr>
  `).join('');

  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"></head>
    <body style="margin:0;padding:0;background:#080c10;color:#f0f6fc;font-family:Arial,sans-serif;">
      <div style="max-width:680px;margin:0 auto;padding:32px 22px;">
        <h1 style="font-size:22px;margin:0 0 16px;color:#f0f6fc;">New AI4 Website Package Purchase</h1>
        <p style="color:#c9d1d9;line-height:1.6;margin:0 0 18px;">A website package checkout.session.completed event was received and written to the orders table.</p>
        <table style="width:100%;border-collapse:collapse;background:#101720;border:1px solid #30363d;border-radius:12px;overflow:hidden;">
          ${tableRows}
        </table>
      </div>
    </body>
    </html>
  `;

  await sendResendEmail({
    to: INTERNAL_EMAIL,
    subject: `New AI4 Website Package Purchase: ${planDetails.plan_name}`,
    html
  });
}
