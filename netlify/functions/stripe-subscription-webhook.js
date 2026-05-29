// ============================================================
// stripe-subscription-webhook.js — Netlify Serverless Function
// AI4 Website Design
// Apropos Group LLC
// Handles: Site Management Services / Care Plan subscription events
// Tables touched: users, subscriptions
//
// IMPORTANT:
// This function is separate from the main package purchase webhook.
// It does not create website-package orders.
// ============================================================

const { createClient } = require('@supabase/supabase-js');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const INTERNAL_EMAIL =
  process.env.AI4_INTERNAL_NOTIFICATION_EMAIL ||
  process.env.RESEND_TO_EMAIL ||
  'jmitchell@ai4websitedesign.com';

const RESEND_FROM_EMAIL =
  process.env.RESEND_FROM_EMAIL ||
  'AI4 Website Design <jmitchell@ai4websitedesign.com>';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY;

const supabase =
  supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey)
    : null;

const CARE_PLANS_BY_PRICE_ID = {
  price_1TTNSIBMRgYNYb8D0wi505W0: {
    plan_key: 'premier_initial_package_purchase',
    plan_name: 'Premier Site Management — Initial Package Purchase',
    stripe_product_name: 'ai4websitedesign Premier Care Package I',
    stripe_price_id: 'price_1TTNSIBMRgYNYb8D0wi505W0',
    stripe_link: 'https://buy.stripe.com/eVq9AS3Zw8SH7t99j27EQ0O',
    public_price: '$19.99/month at initial package purchase',
    monthly_price: '$19.99/month',
    monthly_price_cents: 1999,
    currency: 'usd',
    update_allowance: '5 website updates per month',
    monthly_update_limit: 5,
    support_tier: 'Premier Site Management',
    purchase_timing: 'Initial Package Purchase'
  },
  price_1TTNXBBMRgYNYb8DqFwCCc23: {
    plan_key: 'premier_purchased_later',
    plan_name: 'Premier Site Management — Purchased Later',
    stripe_product_name: 'ai4websitedesign Premier Care Package II',
    stripe_price_id: 'price_1TTNXBBMRgYNYb8DqFwCCc23',
    stripe_link: 'https://buy.stripe.com/5kQeVc67E9WL3cT2UE7EQ0K',
    public_price: '$39.99/month when purchased later',
    monthly_price: '$39.99/month',
    monthly_price_cents: 3999,
    currency: 'usd',
    update_allowance: '5 website updates per month',
    monthly_update_limit: 5,
    support_tier: 'Premier Site Management',
    purchase_timing: 'Purchased Later'
  },
  price_1TTNU0BMRgYNYb8DAJ094sBW: {
    plan_key: 'entrepreneur_initial_package_purchase',
    plan_name: 'Entrepreneur Site Management — Initial Package Purchase',
    stripe_product_name: 'ai4websitedesign Entrepreneur Care Package I',
    stripe_price_id: 'price_1TTNU0BMRgYNYb8DAJ094sBW',
    stripe_link: 'https://buy.stripe.com/28E4gy9jQd8X7t9fHq7EQ0L',
    public_price: '$99.99/month at initial package purchase',
    monthly_price: '$99.99/month',
    monthly_price_cents: 9999,
    currency: 'usd',
    update_allowance: '25 total website updates per month across your launched sites',
    monthly_update_limit: 25,
    support_tier: 'Entrepreneur Site Management',
    purchase_timing: 'Initial Package Purchase'
  },
  price_1TTNYNBMRgYNYb8DGGxicuxF: {
    plan_key: 'entrepreneur_purchased_later',
    plan_name: 'Entrepreneur Site Management — Purchased Later',
    stripe_product_name: 'ai4websitedesign Entrepreneur Care Package II',
    stripe_price_id: 'price_1TTNYNBMRgYNYb8DGGxicuxF',
    stripe_link: 'https://buy.stripe.com/14A6oGanUd8X14L1QA7EQ0J',
    public_price: '$199.99/month when purchased later',
    monthly_price: '$199.99/month',
    monthly_price_cents: 19999,
    currency: 'usd',
    update_allowance: '25 total website updates per month across your launched sites',
    monthly_update_limit: 25,
    support_tier: 'Entrepreneur Site Management',
    purchase_timing: 'Purchased Later'
  }
};

function getHeader(headers, name) {
  if (!headers) return '';
  const lowerName = name.toLowerCase();

  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lowerName) return headers[key];
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

function toIsoFromUnix(value) {
  if (!value) return null;
  return new Date(Number(value) * 1000).toISOString();
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getCustomerFirstName(fullName = '') {
  const cleanName = String(fullName || '').trim();
  return cleanName ? cleanName.split(/\s+/)[0] : 'there';
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

async function getSessionLineItems(sessionId) {
  const lineItems = await stripe.checkout.sessions.listLineItems(sessionId, {
    limit: 25,
    expand: ['data.price.product']
  });

  return lineItems.data || [];
}


function getCarePlanByAmountCents(amountCents) {
  const amount = Number(amountCents || 0);

  if (amount === 1999) {
    return {
      ...CARE_PLANS_BY_PRICE_ID.price_1TTNSIBMRgYNYb8D0wi505W0,
      stripe_price_id: '',
      stripe_product_name: 'AI4 subscription amount fallback — Premier Care Plan I'
    };
  }

  if (amount === 3999) {
    return {
      ...CARE_PLANS_BY_PRICE_ID.price_1TTNXBBMRgYNYb8DqFwCCc23,
      stripe_price_id: '',
      stripe_product_name: 'AI4 subscription amount fallback — Premier Care Plan II'
    };
  }

  if (amount === 9999) {
    return {
      ...CARE_PLANS_BY_PRICE_ID.price_1TTNU0BMRgYNYb8DAJ094sBW,
      stripe_price_id: '',
      stripe_product_name: 'AI4 subscription amount fallback — Entrepreneur Care Plan I'
    };
  }

  if (amount === 19999) {
    return {
      ...CARE_PLANS_BY_PRICE_ID.price_1TTNYNBMRgYNYb8DGGxicuxF,
      stripe_price_id: '',
      stripe_product_name: 'AI4 subscription amount fallback — Entrepreneur Care Plan II'
    };
  }

  return null;
}

function getCarePlanFromLineItems(lineItems = []) {
  for (const item of lineItems) {
    const priceId = item?.price?.id || '';
    if (CARE_PLANS_BY_PRICE_ID[priceId]) {
      return CARE_PLANS_BY_PRICE_ID[priceId];
    }
  }

  for (const item of lineItems) {
    const unitAmount =
      item?.price?.unit_amount ||
      item?.amount_total ||
      item?.amount_subtotal ||
      0;

    const fallbackPlan = getCarePlanByAmountCents(unitAmount);
    if (fallbackPlan) {
      return fallbackPlan;
    }
  }

  return null;
}

function getCarePlanFromSubscription(subscription) {
  const items = subscription?.items?.data || [];

  for (const item of items) {
    const priceId = item?.price?.id || '';
    if (CARE_PLANS_BY_PRICE_ID[priceId]) {
      return CARE_PLANS_BY_PRICE_ID[priceId];
    }
  }

  for (const item of items) {
    const unitAmount = item?.price?.unit_amount || 0;
    const fallbackPlan = getCarePlanByAmountCents(unitAmount);
    if (fallbackPlan) {
      return fallbackPlan;
    }
  }

  return null;
}

async function getCustomerDetailsFromStripe(customerId) {
  if (!customerId) {
    return {
      email: '',
      full_name: '',
      phone: ''
    };
  }

  try {
    const customer = await stripe.customers.retrieve(customerId);

    return {
      email: customer?.email || '',
      full_name: customer?.name || '',
      phone: customer?.phone || ''
    };
  } catch (err) {
    console.error('Unable to retrieve Stripe customer:', err.message);
    return {
      email: '',
      full_name: '',
      phone: ''
    };
  }
}

async function getStripeSubscription(subscriptionId) {
  if (!subscriptionId) return null;

  try {
    return await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['items.data.price.product', 'latest_invoice']
    });
  } catch (err) {
    console.error('Unable to retrieve Stripe subscription:', err.message);
    return null;
  }
}

async function upsertUser({ email, full_name, phone, stripe_customer_id }) {
  if (!supabase) {
    console.warn('Supabase is not configured. User upsert skipped.');
    return;
  }

  if (!email) {
    console.warn('User email missing. User upsert skipped.');
    return;
  }

  const { error } = await supabase
    .from('users')
    .upsert({
      email,
      full_name,
      phone,
      stripe_customer_id,
      language: 'en',
      updated_at: new Date().toISOString()
    }, { onConflict: 'email' });

  if (error) {
    throw new Error(`Supabase user upsert failed: ${error.message}`);
  }
}

async function upsertSubscriptionRecord({ plan, customer, session = {}, subscription = {}, invoice = {}, eventId = '', eventType = '' }) {
  if (!supabase) {
    console.warn('Supabase is not configured. Subscription upsert skipped.');
    return null;
  }

  if (!plan) {
    console.warn('Plan missing. Subscription upsert skipped.');
    return null;
  }

  const stripeSubscriptionId =
    subscription?.id ||
    session?.subscription ||
    invoice?.subscription ||
    '';

  const stripeStatus =
    subscription?.status ||
    session?.subscription_status ||
    invoice?.status ||
    'active';

  const latestInvoice =
    typeof subscription?.latest_invoice === 'object'
      ? subscription.latest_invoice
      : null;

  const latestInvoiceId =
    invoice?.id ||
    latestInvoice?.id ||
    (typeof subscription?.latest_invoice === 'string' ? subscription.latest_invoice : '') ||
    '';

  const latestInvoiceStatus =
    invoice?.status ||
    latestInvoice?.status ||
    '';

  const lastPaymentStatus =
    session?.payment_status ||
    invoice?.payment_status ||
    latestInvoice?.payment_status ||
    '';

  const row = {
    email: customer.email,
    full_name: customer.full_name || '',
    phone: customer.phone || '',
    language: 'en',

    stripe_customer_id:
      customer.stripe_customer_id ||
      subscription?.customer ||
      session?.customer ||
      invoice?.customer ||
      '',

    stripe_subscription_id: stripeSubscriptionId || null,
    stripe_checkout_session_id: session?.id || null,
    stripe_price_id: plan.stripe_price_id,
    stripe_product_name: plan.stripe_product_name,
    stripe_status: stripeStatus,

    plan_key: plan.plan_key,
    plan_name: plan.plan_name,
    support_tier: plan.support_tier,
    purchase_timing: plan.purchase_timing,
    public_price: plan.public_price,
    monthly_price_cents: plan.monthly_price_cents,
    currency: plan.currency,

    update_allowance: plan.update_allowance,
    monthly_update_limit: plan.monthly_update_limit,

    current_period_start: toIsoFromUnix(subscription?.current_period_start),
    current_period_end: toIsoFromUnix(subscription?.current_period_end),
    cancel_at_period_end: Boolean(subscription?.cancel_at_period_end || false),
    canceled_at: toIsoFromUnix(subscription?.canceled_at),

    latest_invoice_id: latestInvoiceId || null,
    latest_invoice_status: latestInvoiceStatus || null,
    last_payment_status: lastPaymentStatus || null,

    metadata: {
      stripe_event_id: eventId,
      stripe_event_type: eventType,
      source: 'stripe-subscription-webhook'
    }
  };

  if (!row.email) {
    console.warn('Subscription email missing. Subscription upsert skipped.', {
      stripeSubscriptionId,
      stripeCustomerId: row.stripe_customer_id
    });
    return null;
  }

  let query = supabase.from('subscriptions');

  const onConflict = row.stripe_subscription_id
    ? 'stripe_subscription_id'
    : 'stripe_checkout_session_id';

  const { data, error } = await query
    .upsert(row, { onConflict })
    .select()
    .single();

  if (error) {
    throw new Error(`Supabase subscription upsert failed: ${error.message}`);
  }

  return data;
}

function buildCustomerConfirmationEmail({ firstName, plan, session, subscriptionRecord }) {
  const safeFirstName = escapeHtml(firstName);
  const safePlanName = escapeHtml(plan.plan_name);
  const safePrice = escapeHtml(plan.public_price);
  const safeAllowance = escapeHtml(plan.update_allowance);
  const subscriptionId = escapeHtml(session.subscription || subscriptionRecord?.stripe_subscription_id || '');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: Arial, sans-serif; background: #080c10; color: #f0f6fc; margin: 0; padding: 0; }
        .wrap { max-width: 600px; margin: 0 auto; padding: 40px 24px; }
        .brand { font-size: 1.2rem; font-weight: 900; color: #4F6EF7; margin-bottom: 24px; }
        .hero { background: linear-gradient(135deg, rgba(79,110,247,.15), rgba(124,58,237,.1)); border: 1px solid rgba(79,110,247,.25); border-radius: 16px; padding: 30px; margin-bottom: 22px; text-align: center; }
        .hero h1 { font-size: 1.5rem; font-weight: 800; margin: 0 0 8px; color: #f0f6fc; }
        .hero p { color: #c9d1d9; font-size: .92rem; line-height: 1.7; margin: 0; }
        .badge { display: inline-block; background: rgba(63,185,80,.10); border: 1px solid rgba(63,185,80,.28); border-radius: 8px; padding: 9px 16px; font-size: .82rem; color: #3fb950; font-weight: 700; margin-top: 16px; }
        .card { background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); border-radius: 14px; padding: 22px; margin-bottom: 22px; }
        .card h2 { margin: 0 0 10px; color: #f0f6fc; font-size: 1.05rem; }
        .card p { color: #c9d1d9; font-size: .88rem; line-height: 1.7; margin: 0 0 12px; }
        ul { padding-left: 20px; margin: 10px 0 0; color: #c9d1d9; font-size: .86rem; line-height: 1.7; }
        .notice { background: rgba(240,165,0,.08); border: 1px solid rgba(240,165,0,.22); border-radius: 12px; padding: 14px 16px; color: #c9d1d9; font-size: .82rem; line-height: 1.6; margin-bottom: 22px; }
        .cta-btn { display: block; text-align: center; background: linear-gradient(135deg, #4F6EF7, #7C3AED); color: #fff; font-weight: 800; font-size: .95rem; padding: 15px; border-radius: 10px; text-decoration: none; margin-bottom: 24px; }
        .footer { text-align: center; font-size: .72rem; color: #8b949e; line-height: 1.8; }
      </style>
    </head>
    <body>
      <div class="wrap">
        <div class="brand">ai4websitedesign</div>

        <div class="hero">
          <h1>Your Site Management subscription is active</h1>
          <p>Hi ${safeFirstName} — your Subscriber Member support plan has been confirmed.</p>
          <div class="badge">${safePlanName} · ${safePrice}</div>
        </div>

        <div class="card">
          <h2>Plan details</h2>
          <p><strong>Update allowance:</strong> ${safeAllowance}</p>
          <p>Subscriber members can request updates, small content changes, and continued website support each month based on their selected plan.</p>
        </div>

        <div class="card">
          <h2>Monthly updates may include:</h2>
          <ul>
            <li>Text changes</li>
            <li>Image swaps</li>
            <li>Basic section edits</li>
            <li>Link updates</li>
            <li>Small layout adjustments</li>
            <li>Content refreshes</li>
          </ul>
        </div>

        <div class="notice">
          Large redesigns, new pages, advanced integrations, custom automation, third-party platform setup, or major rebuilds may require a separate quote.
        </div>

        <a class="cta-btn" href="https://ai4websitedesign.com">Return to ai4websitedesign.com</a>

        <div class="footer">
          ${subscriptionId ? `Stripe Subscription ID: ${subscriptionId}<br>` : ''}
          Questions? Reply to this email or contact us at jmitchell@ai4websitedesign.com<br><br>
          Powered by Apropos Group LLC · ai4websitedesign.com<br>
          © 2026 Apropos Group LLC. All rights reserved.
        </div>
      </div>
    </body>
    </html>
  `;
}

function buildInternalNotificationEmail({ title, plan, customer, stripeData, subscriptionRecord }) {
  const rows = [
    ['Event', title],
    ['Plan', plan?.plan_name || 'Unknown'],
    ['Public Price', plan?.public_price || 'Unknown'],
    ['Update Allowance', plan?.update_allowance || 'Unknown'],
    ['Customer Email', customer?.email || 'Not provided'],
    ['Customer Name', customer?.full_name || 'Not provided'],
    ['Phone', customer?.phone || 'Not provided'],
    ['Supabase Subscription ID', subscriptionRecord?.id || 'Not saved'],
    ['Stripe Customer ID', stripeData?.customer_id || 'Not provided'],
    ['Stripe Subscription ID', stripeData?.subscription_id || 'Not provided'],
    ['Stripe Session ID', stripeData?.session_id || 'Not provided'],
    ['Stripe Event ID', stripeData?.event_id || 'Not provided']
  ];

  const tableRows = rows.map(([label, value]) => `
    <tr>
      <td style="padding:8px 10px;border-bottom:1px solid #30363d;color:#8b949e;">${escapeHtml(label)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #30363d;color:#f0f6fc;">${escapeHtml(value)}</td>
    </tr>
  `).join('');

  return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"></head>
    <body style="margin:0;padding:0;background:#080c10;color:#f0f6fc;font-family:Arial,sans-serif;">
      <div style="max-width:680px;margin:0 auto;padding:32px 22px;">
        <h1 style="font-size:22px;margin:0 0 16px;color:#f0f6fc;">${escapeHtml(title)}</h1>
        <p style="color:#c9d1d9;line-height:1.6;margin:0 0 18px;">A Site Management Services subscription event was received.</p>
        <table style="width:100%;border-collapse:collapse;background:#101720;border:1px solid #30363d;border-radius:12px;overflow:hidden;">
          ${tableRows}
        </table>
      </div>
    </body>
    </html>
  `;
}

async function handleCheckoutSessionCompleted(eventId, session) {
  if (session.mode !== 'subscription') {
    return {
      handled: false,
      reason: 'Checkout session is not subscription mode.'
    };
  }

  const lineItems = await getSessionLineItems(session.id);
  const plan = getCarePlanFromLineItems(lineItems);

  if (!plan) {
    return {
      handled: false,
      reason: 'No matching AI4 Site Management Services price ID found.'
    };
  }

  const stripeCustomer = await getCustomerDetailsFromStripe(session.customer);
  const stripeSubscription = await getStripeSubscription(session.subscription);

  const customer = {
    email:
      session.customer_details?.email ||
      session.customer_email ||
      stripeCustomer.email ||
      '',
    full_name:
      session.customer_details?.name ||
      stripeCustomer.full_name ||
      '',
    phone:
      session.customer_details?.phone ||
      stripeCustomer.phone ||
      '',
    stripe_customer_id: session.customer || ''
  };

  await upsertUser(customer);

  const subscriptionRecord = await upsertSubscriptionRecord({
    plan,
    customer,
    session,
    subscription: stripeSubscription || {},
    eventId,
    eventType: 'checkout.session.completed'
  });

  const firstName = getCustomerFirstName(customer.full_name);

  try {
    await sendResendEmail({
      to: customer.email,
      subject: `✅ Your ${plan.support_tier} subscription is active`,
      html: buildCustomerConfirmationEmail({ firstName, plan, session, subscriptionRecord })
    });
  } catch (err) {
    console.error('Customer subscription confirmation email failed:', err.message);
  }

  try {
    await sendResendEmail({
      to: INTERNAL_EMAIL,
      subject: `New AI4 Subscriber Member: ${plan.support_tier}`,
      html: buildInternalNotificationEmail({
        title: 'New Site Management Services Subscription',
        plan,
        customer,
        subscriptionRecord,
        stripeData: {
          customer_id: session.customer || '',
          subscription_id: session.subscription || '',
          session_id: session.id || '',
          event_id: eventId
        }
      })
    });
  } catch (err) {
    console.error('Internal subscription notification email failed:', err.message);
  }

  return {
    handled: true,
    plan_key: plan.plan_key,
    plan_name: plan.plan_name,
    customer_email: customer.email,
    subscription_id: subscriptionRecord?.id || null
  };
}

async function handleSubscriptionStatusEvent(eventId, subscription, eventType) {
  const plan = getCarePlanFromSubscription(subscription);

  if (!plan) {
    return {
      handled: false,
      reason: 'Subscription does not use a matching AI4 Site Management Services price ID.'
    };
  }

  const stripeCustomer = await getCustomerDetailsFromStripe(subscription.customer);

  const customer = {
    email: stripeCustomer.email || '',
    full_name: stripeCustomer.full_name || '',
    phone: stripeCustomer.phone || '',
    stripe_customer_id: subscription.customer || ''
  };

  await upsertUser(customer);

  const subscriptionRecord = await upsertSubscriptionRecord({
    plan,
    customer,
    subscription,
    eventId,
    eventType
  });

  try {
    await sendResendEmail({
      to: INTERNAL_EMAIL,
      subject: `AI4 Subscription Event: ${eventType}`,
      html: buildInternalNotificationEmail({
        title: `AI4 Subscription Event: ${eventType}`,
        plan,
        customer,
        subscriptionRecord,
        stripeData: {
          customer_id: subscription.customer || '',
          subscription_id: subscription.id || '',
          session_id: '',
          event_id: eventId
        }
      })
    });
  } catch (err) {
    console.error('Internal subscription status email failed:', err.message);
  }

  return {
    handled: true,
    plan_key: plan.plan_key,
    plan_name: plan.plan_name,
    subscription_status: subscription.status || '',
    event_type: eventType,
    subscription_id: subscriptionRecord?.id || null
  };
}

async function handleInvoiceEvent(eventId, invoice, eventType) {
  const subscriptionId = invoice.subscription || '';

  if (!subscriptionId) {
    return {
      handled: false,
      reason: 'Invoice is not attached to a subscription.'
    };
  }

  let subscription;

  try {
    subscription = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['items.data.price.product', 'latest_invoice']
    });
  } catch (err) {
    console.error('Unable to retrieve subscription for invoice event:', err.message);
    return {
      handled: false,
      reason: 'Unable to retrieve Stripe subscription.'
    };
  }

  const plan = getCarePlanFromSubscription(subscription);

  if (!plan) {
    return {
      handled: false,
      reason: 'Invoice subscription does not use a matching AI4 Site Management Services price ID.'
    };
  }

  const stripeCustomer = await getCustomerDetailsFromStripe(invoice.customer);

  const customer = {
    email: invoice.customer_email || stripeCustomer.email || '',
    full_name: stripeCustomer.full_name || '',
    phone: stripeCustomer.phone || '',
    stripe_customer_id: invoice.customer || ''
  };

  await upsertUser(customer);

  const subscriptionRecord = await upsertSubscriptionRecord({
    plan,
    customer,
    subscription,
    invoice,
    eventId,
    eventType
  });

  try {
    await sendResendEmail({
      to: INTERNAL_EMAIL,
      subject: `AI4 Subscription Invoice Event: ${eventType}`,
      html: buildInternalNotificationEmail({
        title: `AI4 Subscription Invoice Event: ${eventType}`,
        plan,
        customer,
        subscriptionRecord,
        stripeData: {
          customer_id: invoice.customer || '',
          subscription_id: subscriptionId,
          session_id: '',
          event_id: eventId
        }
      })
    });
  } catch (err) {
    console.error('Internal invoice notification email failed:', err.message);
  }

  return {
    handled: true,
    plan_key: plan.plan_key,
    plan_name: plan.plan_name,
    invoice_status: invoice.status || '',
    event_type: eventType,
    subscription_id: subscriptionRecord?.id || null
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: 'Method Not Allowed'
    };
  }

  const signature = getHeader(event.headers, 'stripe-signature');

  if (!signature) {
    return {
      statusCode: 400,
      body: 'Missing Stripe signature'
    };
  }

  let stripeEvent;

  try {
    stripeEvent = stripe.webhooks.constructEvent(
      getRawBody(event),
      signature,
      process.env.STRIPE_SUBSCRIPTION_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Subscription webhook signature verification failed:', err.message);
    return {
      statusCode: 400,
      body: `Webhook Error: ${err.message}`
    };
  }

  try {
    let result = {
      handled: false,
      reason: `Event type ${stripeEvent.type} ignored.`
    };

    if (stripeEvent.type === 'checkout.session.completed') {
      result = await handleCheckoutSessionCompleted(
        stripeEvent.id,
        stripeEvent.data.object
      );
    }

    if (
      stripeEvent.type === 'customer.subscription.created' ||
      stripeEvent.type === 'customer.subscription.updated' ||
      stripeEvent.type === 'customer.subscription.deleted'
    ) {
      result = await handleSubscriptionStatusEvent(
        stripeEvent.id,
        stripeEvent.data.object,
        stripeEvent.type
      );
    }

    if (
      stripeEvent.type === 'invoice.paid' ||
      stripeEvent.type === 'invoice.payment_succeeded' ||
      stripeEvent.type === 'invoice.payment_failed'
    ) {
      result = await handleInvoiceEvent(
        stripeEvent.id,
        stripeEvent.data.object,
        stripeEvent.type
      );
    }

    console.log('AI4 subscription webhook processed:', {
      event_id: stripeEvent.id,
      event_type: stripeEvent.type,
      ...result
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        received: true,
        ...result
      })
    };

  } catch (err) {
    console.error('Subscription webhook handler error:', err);
    return {
      statusCode: 500,
      body: 'Internal server error'
    };
  }
};
