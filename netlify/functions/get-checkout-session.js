// ============================================================
// get-checkout-session.js — Netlify Serverless Function
// AI4 Website Design
// Apropos Group LLC
//
// Purpose:
// Safely reads limited customer display information from a Stripe
// Checkout Session after redirecting to thankyou.html.
// ============================================================

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify(body)
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return json(405, { error: 'Method Not Allowed' });
  }

  const sessionId = String(event.queryStringParameters?.session_id || '').trim();

  if (!sessionId || !sessionId.startsWith('cs_')) {
    return json(400, { error: 'A valid Checkout Session ID is required.' });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('STRIPE_SECRET_KEY is not configured.');
    return json(500, { error: 'Stripe is not configured.' });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['customer']
    });

    const customerObject =
      session.customer && typeof session.customer === 'object'
        ? session.customer
        : {};

    const customerName =
      session.customer_details?.name ||
      customerObject.name ||
      '';

    const customerEmail =
      session.customer_details?.email ||
      session.customer_email ||
      customerObject.email ||
      '';

    return json(200, {
      session_id: session.id,
      mode: session.mode || '',
      status: session.status || '',
      payment_status: session.payment_status || '',
      customer_name: customerName,
      customer_email: customerEmail
    });
  } catch (err) {
    console.error('Unable to retrieve Checkout Session:', err.message);
    return json(500, { error: 'Unable to retrieve Checkout Session.' });
  }
};
