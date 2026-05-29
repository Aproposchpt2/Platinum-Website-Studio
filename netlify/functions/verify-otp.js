// verify-otp.js
// AI4 Website Design — Returning Member Sign In
// Verifies the emailed access code and clears it after successful verification.

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
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

function normalizeEmail(value = '') {
  return String(value || '').trim().toLowerCase();
}

function normalizeCode(value = '') {
  return String(value || '').trim().replace(/\D/g, '').slice(0, 6);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  if (!supabase) {
    console.error('Supabase is not configured for verify-otp.');
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Sign In is not configured yet.' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (err) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request.' }) };
  }

  const email = normalizeEmail(body.email);
  const code = normalizeCode(body.code);

  if (!email || !code) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email and code are required.' }) };
  }

  if (code.length !== 6) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Please enter the 6-digit access code.' }) };
  }

  const { data: user, error } = await supabase
    .from('users')
    .select('email, full_name, otp_code, otp_expires')
    .ilike('email', email)
    .maybeSingle();

  if (error) {
    console.error('OTP user lookup error:', error.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Could not verify the code. Please try again.' }) };
  }

  if (!user) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Account not found. Please check your email address.' }) };
  }

  if (!user.otp_code) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'No active code was found. Please request a new one.' }) };
  }

  if (user.otp_expires && new Date() > new Date(user.otp_expires)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Code has expired. Please request a new one.' }) };
  }

  if (String(user.otp_code).trim() !== code) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Incorrect code. Please try again.' }) };
  }

  const { error: clearError } = await supabase
    .from('users')
    .update({
      otp_code: null,
      otp_expires: null,
      updated_at: new Date().toISOString()
    })
    .ilike('email', email);

  if (clearError) {
    console.error('OTP clear error:', clearError.message);
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      success: true,
      user: {
        email: user.email,
        name: user.full_name || ''
      }
    })
  };
};
