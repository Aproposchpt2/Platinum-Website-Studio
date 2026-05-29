const { createClient } = require('@supabase/supabase-js');

const WEBFLOW_API = 'https://api.webflow.com/v2';
const WEBFLOW_API_KEY = process.env.WEBFLOW_API_KEY;
const WEBFLOW_SITE_ID = process.env.WEBFLOW_SITE_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ ok: false, error: 'Method not allowed' }) };
  }

  if (!WEBFLOW_API_KEY || !WEBFLOW_SITE_ID) {
    console.error('Missing WEBFLOW_API_KEY or WEBFLOW_SITE_ID');
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'Webflow not configured' }) };
  }

  let brief;
  try {
    brief = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Invalid JSON' }) };
  }

  const { businessName, heroHeadline, businessType, city, phone, email, accentColor, template, statements } = brief;

  if (!businessName) {
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'businessName is required' }) };
  }

  // Verify the Webflow site exists and retrieve its metadata
  let siteData;
  try {
    const siteRes = await fetch(`${WEBFLOW_API}/sites/${WEBFLOW_SITE_ID}`, {
      headers: {
        'Authorization': `Bearer ${WEBFLOW_API_KEY}`,
        'accept-version': '1.0.0',
      },
    });
    if (!siteRes.ok) {
      const err = await siteRes.text();
      console.error('Webflow site fetch error:', err);
      return { statusCode: 502, body: JSON.stringify({ ok: false, error: 'Could not reach Webflow site' }) };
    }
    siteData = await siteRes.json();
  } catch (e) {
    console.error('Webflow API error:', e.message);
    return { statusCode: 502, body: JSON.stringify({ ok: false, error: 'Webflow API unreachable' }) };
  }

  // Write a pending deployment record to Supabase
  let deploymentId = null;
  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const { data, error } = await supabase.from('site_deployments').insert({
        business_name: businessName,
        webflow_site_id: WEBFLOW_SITE_ID,
        brief_data: brief,
        status: 'pending',
        template_used: template || null,
        accent_color: accentColor || null,
      }).select('id').single();

      if (!error && data) deploymentId = data.id;
    } catch (e) {
      console.error('Supabase pending insert error:', e.message);
    }
  }

  // Construct the Webflow preview URL
  const previewUrl = siteData.previewUrl || `https://webflow.com/design/${WEBFLOW_SITE_ID}`;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ok: true,
      deploymentId,
      siteId: WEBFLOW_SITE_ID,
      siteName: siteData.displayName || siteData.name || businessName,
      previewUrl,
      customDomains: (siteData.customDomains || []).map(d => d.url || d),
      shortName: siteData.shortName || '',
    }),
  };
};
