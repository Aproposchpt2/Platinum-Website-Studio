const { createClient } = require('@supabase/supabase-js');

const WEBFLOW_API = 'https://api.webflow.com/v2';
const WEBFLOW_API_KEY = process.env.WEBFLOW_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ ok: false, error: 'Method not allowed' }) };
  }

  if (!WEBFLOW_API_KEY) {
    console.error('Missing WEBFLOW_API_KEY');
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'Webflow not configured' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Invalid JSON' }) };
  }

  const { siteId, deploymentId, domains } = body;

  if (!siteId) {
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'siteId is required' }) };
  }

  // Publish the Webflow site to all configured custom domains
  let publishData;
  try {
    const publishRes = await fetch(`${WEBFLOW_API}/sites/${siteId}/publish`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WEBFLOW_API_KEY}`,
        'Content-Type': 'application/json',
        'accept-version': '1.0.0',
      },
      body: JSON.stringify({
        publishToWebflowSubdomain: true,
        customDomains: domains || [],
      }),
    });

    if (!publishRes.ok) {
      const errText = await publishRes.text();
      console.error('Webflow publish error:', errText);
      if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY && deploymentId) {
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        await supabase.from('site_deployments').update({ status: 'failed' }).eq('id', deploymentId);
      }
      return { statusCode: 502, body: JSON.stringify({ ok: false, error: 'Webflow publish failed' }) };
    }

    publishData = await publishRes.json();
  } catch (e) {
    console.error('Webflow API error:', e.message);
    return { statusCode: 502, body: JSON.stringify({ ok: false, error: 'Webflow API unreachable' }) };
  }

  const publishedUrl = publishData.publishedTo?.[0]
    || (domains && domains[0])
    || `https://${siteId}.webflow.io`;

  const now = new Date().toISOString();

  // Update the deployment record in Supabase to published
  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY && deploymentId) {
    try {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      await supabase.from('site_deployments').update({
        status: 'published',
        published_at: now,
        published_url: publishedUrl,
        published_domains: publishData.publishedTo || domains || [],
      }).eq('id', deploymentId);
    } catch (e) {
      console.error('Supabase update error:', e.message);
    }
  } else if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    // No deploymentId — write a fresh record
    try {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      await supabase.from('site_deployments').insert({
        webflow_site_id: siteId,
        status: 'published',
        published_at: now,
        published_url: publishedUrl,
        published_domains: publishData.publishedTo || domains || [],
      });
    } catch (e) {
      console.error('Supabase insert error:', e.message);
    }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ok: true,
      publishedUrl,
      publishedTo: publishData.publishedTo || [],
      publishedAt: now,
    }),
  };
};
