/**
 * ai4websitedesign — Save Design Handler
 * netlify/functions/save-design.js
 * Saves the user's builder answers and template choice to Supabase
 */

'use strict';

const https = require('https');

function safeString(val, fallback = '') {
  if (val === null || val === undefined) return fallback;
  return String(val).trim();
}

async function supabaseRequest(method, path, body = null) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) { console.error('SUPABASE: Missing credentials'); return null; }
  const bodyStr = body ? JSON.stringify(body) : null;
  return new Promise((resolve) => {
    const urlObj = new URL(`${url}/rest/v1/${path}`);
    const headers = {
      'Authorization': `Bearer ${key}`,
      'apikey': key,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    };
    if (bodyStr) headers['Content-Length'] = Buffer.byteLength(bodyStr);
    const options = { hostname: urlObj.hostname, path: urlObj.pathname + (urlObj.search || ''), method, headers };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        if ([200, 201, 204].includes(res.statusCode)) {
          try { resolve(data ? JSON.parse(data) : true); } catch { resolve(true); }
        } else {
          console.error(`SUPABASE ${method} FAILED — ${res.statusCode} — ${data}`);
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(5000, () => { req.destroy(); resolve(null); });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { email, business_type, business_name, business_dream, template } = body;

  if (!email) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email is required' }) };
  }

  console.log('SAVE DESIGN:', business_name, '|', email, '|', template);

  // Look up user by email
  const userResult = await supabaseRequest('GET', `users?email=eq.${encodeURIComponent(email.toLowerCase())}&select=id&limit=1`);
  const userId = userResult?.[0]?.id || null;

  // Save design
  const design = await supabaseRequest('POST', 'designs', {
    user_id: userId,
    business_type: safeString(business_type),
    business_name: safeString(business_name),
    business_dream: safeString(business_dream),
    template: safeString(template),
    status: 'saved',
  });

  if (!design) {
    console.error('Failed to save design');
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to save design' }) };
  }

  console.log('DESIGN SAVED:', design?.[0]?.id);

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      success: true,
      design_id: design?.[0]?.id || null,
    }),
  };
};
