/**
 * AI4 Website Design — Generate Brief Function
 * netlify/functions/generate-brief.js
 *
 * Handles:
 *   1. Saves lead to Supabase leads table
 *   2. Generates branded PDF via Adobe PDF Services
 *   3. Sends alert email to owner via Resend
 *   4. Returns PDF base64 for frontend download
 *
 * ENV VARIABLES REQUIRED (already set in Netlify):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_KEY
 *   RESEND_API_KEY
 *   RESEND_FROM_EMAIL
 *   RESEND_TO_EMAIL
 *   AI4SITE_URL
 *   PDF_SERVICES_CLIENT_ID
 *   PDF_SERVICES_CLIENT_SECRET
 */

'use strict';

const https  = require('https');
const http   = require('http');

const BRAND = {
  name:    'AI4 Website Design',
  entity:  'Apropos Group LLC',
  accent:  '#4F6EF7',
  accent2: '#7C3AED',
  site:    'ai4websitedesign.com',
};

// ── HELPERS ───────────────────────────────────────────────────────────────────

function safeString(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
}

function formatTimestamp() {
  return new Date().toLocaleString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Los_Angeles',
  }) + ' PT';
}

function generateLeadId() {
  const ts  = Date.now().toString(36).toUpperCase();
  const rnd = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `A4W-${ts}-${rnd}`;
}

// ── SUPABASE ──────────────────────────────────────────────────────────────────

function supabaseInsert(table, record) {
  return new Promise((resolve, reject) => {
    const url     = process.env.SUPABASE_URL;
    const key     = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) { console.error('SUPABASE: Missing credentials'); return resolve(null); }

    const postData = JSON.stringify(record);
    const urlObj   = new URL(`${url}/rest/v1/${table}`);

    const options = {
      hostname: urlObj.hostname,
      path:     urlObj.pathname,
      method:   'POST',
      headers: {
        'Authorization':  `Bearer ${key}`,
        'apikey':         key,
        'Content-Type':   'application/json',
        'Prefer':         'return=minimal',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(true);
        } else {
          console.error(`SUPABASE INSERT FAILED — ${table} — ${res.statusCode}:`, data);
          resolve(null);
        }
      });
    });

    req.on('error', (err) => { console.error('SUPABASE ERROR:', err.message); resolve(null); });
    req.setTimeout(5000, () => { req.destroy(); resolve(null); });
    req.write(postData);
    req.end();
  });
}

// ── ADOBE PDF SERVICES ────────────────────────────────────────────────────────

async function getAdobeAccessToken() {
  const clientId     = process.env.PDF_SERVICES_CLIENT_ID;
  const clientSecret = process.env.PDF_SERVICES_CLIENT_SECRET;

  if (!clientId || !clientSecret) throw new Error('Adobe PDF credentials missing');

  const postData = new URLSearchParams({
    client_id:     clientId,
    client_secret: clientSecret,
  }).toString();

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'pdf-services-ue1.adobe.io',
      path:     '/token',
      method:   'POST',
      headers: {
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.access_token) resolve(parsed.access_token);
          else reject(new Error(`Adobe token error: ${data}`));
        } catch (e) { reject(e); }
      });
    });

    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Adobe token timeout')); });
    req.write(postData);
    req.end();
  });
}

function buildBriefHtml(brief, leadId, timestamp) {
  const pages    = Array.isArray(brief.pages)    ? brief.pages.join(', ')    : safeString(brief.pages, 'Not specified');
  const features = Array.isArray(brief.features) ? brief.features.join(', ') : safeString(brief.features, 'Not specified');
  const accent   = safeString(brief.accentColor, BRAND.accent);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; background: #fff; padding: 48px; }
  .header { border-bottom: 4px solid ${accent}; padding-bottom: 20px; margin-bottom: 32px; display: flex; justify-content: space-between; align-items: flex-end; }
  .brand { font-size: 11px; color: #888; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 6px; }
  .biz-name { font-size: 28px; font-weight: 700; color: #111; }
  .biz-type { font-size: 14px; color: ${accent}; margin-top: 4px; }
  .badge { background: ${accent}; color: #fff; font-size: 11px; font-weight: 700; padding: 4px 12px; border-radius: 20px; letter-spacing: 0.5px; }
  .meta { font-size: 10px; color: #aaa; text-align: right; line-height: 1.6; }
  .section { margin-bottom: 24px; }
  .section-label { font-size: 10px; color: #888; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 6px; border-bottom: 1px solid #eee; padding-bottom: 4px; }
  .section-value { font-size: 14px; color: #222; line-height: 1.7; }
  .color-swatch { display: inline-block; width: 20px; height: 20px; border-radius: 4px; background: ${accent}; vertical-align: middle; margin-right: 8px; border: 1px solid #ddd; }
  .pages { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 6px; }
  .page-tag { padding: 3px 12px; border-radius: 20px; border: 1px solid ${accent}; color: ${accent}; font-size: 12px; }
  .feature-tag { padding: 3px 12px; border-radius: 20px; background: #f4f4f4; color: #444; font-size: 12px; }
  .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #eee; display: flex; justify-content: space-between; font-size: 10px; color: #aaa; }
  .ecosystem { margin-top: 24px; padding: 16px; background: #f9f9ff; border: 1px solid #e0e0ff; border-radius: 8px; }
  .ecosystem-title { font-size: 11px; font-weight: 700; color: ${accent}; margin-bottom: 6px; letter-spacing: 0.5px; text-transform: uppercase; }
  .ecosystem-text { font-size: 12px; color: #555; line-height: 1.6; }
</style>
</head>
<body>

<div class="header">
  <div>
    <div class="brand">AI4 Website Design · Website Design Brief</div>
    <div class="biz-name">${safeString(brief.businessName, 'Your Business')}</div>
    <div class="biz-type">${safeString(brief.businessType, '')}</div>
  </div>
  <div style="text-align:right;">
    <div><span class="badge">${safeString(brief.recommendedTemplate, 'Modern')} Template</span></div>
    <div class="meta" style="margin-top:8px;">
      Lead ID: ${leadId}<br>
      ${timestamp}
    </div>
  </div>
</div>

<div class="section">
  <div class="section-label">Target Audience</div>
  <div class="section-value">${safeString(brief.targetAudience, 'Not specified')}</div>
</div>

<div class="section">
  <div class="section-label">Style Direction</div>
  <div class="section-value">${safeString(brief.styleDirection, 'Not specified')}</div>
</div>

<div class="section">
  <div class="section-label">Color Palette</div>
  <div class="section-value">
    <span class="color-swatch"></span>${accent}
  </div>
</div>

<div class="section">
  <div class="section-label">Pages &amp; Structure</div>
  <div class="pages">
    ${(Array.isArray(brief.pages) ? brief.pages : [pages]).map(p =>
      `<span class="page-tag">${p}</span>`
    ).join('')}
  </div>
</div>

<div class="section">
  <div class="section-label">Special Features</div>
  <div class="pages">
    ${(Array.isArray(brief.features) ? brief.features : [features]).map(f =>
      `<span class="feature-tag">${f}</span>`
    ).join('')}
  </div>
</div>

<div class="section">
  <div class="section-label">Content Assets</div>
  <div class="section-value">${safeString(brief.contentAssets, 'To be provided by client')}</div>
</div>

<div class="section">
  <div class="section-label">Timeline</div>
  <div class="section-value">${safeString(brief.timeline, 'Ready to launch immediately')}</div>
</div>

<div class="ecosystem">
  <div class="ecosystem-title">The Apropos Group Ecosystem</div>
  <div class="ecosystem-text">
    Your website is just the beginning. As your business grows, The Apropos Group is here to scale with you —
    from AI business tools at AI4Businesses.org to AI call intake at aiflowdeskpro.com,
    and ultimately to becoming a White Label Partner.
  </div>
</div>

<div class="footer">
  <span>© ${new Date().getFullYear()} Apropos Group LLC · ai4websitedesign.com</span>
  <span>Confidential Design Brief · ${timestamp}</span>
</div>

</body>
</html>`;
}

async function generatePdfFromHtml(htmlContent, accessToken) {
  const clientId = process.env.PDF_SERVICES_CLIENT_ID;

  // Step 1 — Get upload URI
  const assetPayload = JSON.stringify({ mediaType: 'text/html' });

  const asset = await new Promise((resolve, reject) => {
    const options = {
      hostname: 'pdf-services-ue1.adobe.io',
      path:     '/assets',
      method:   'POST',
      headers: {
        'Authorization':  `Bearer ${accessToken}`,
        'x-api-key':      clientId,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(assetPayload),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Asset create failed: ${data}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Asset timeout')); });
    req.write(assetPayload);
    req.end();
  });

  if (!asset.uploadUri || !asset.assetID) throw new Error('Adobe: no upload URI returned');

  // Step 2 — Upload HTML to the pre-signed URI
  const htmlBuffer = Buffer.from(htmlContent, 'utf8');
  const uploadUrl  = new URL(asset.uploadUri);
  const protocol   = uploadUrl.protocol === 'https:' ? https : http;

  await new Promise((resolve, reject) => {
    const options = {
      hostname: uploadUrl.hostname,
      path:     uploadUrl.pathname + uploadUrl.search,
      method:   'PUT',
      headers: {
        'Content-Type':   'text/html',
        'Content-Length': htmlBuffer.length,
      },
    };
    const req = protocol.request(options, (res) => {
      res.on('data', () => {});
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(true);
        else reject(new Error(`HTML upload failed: ${res.statusCode}`));
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Upload timeout')); });
    req.write(htmlBuffer);
    req.end();
  });

  // Step 3 — Create HTML-to-PDF job
  const jobPayload = JSON.stringify({
    assetID:         asset.assetID,
    pageLayout:      { pageWidth: 8.5, pageHeight: 11 },
    includeHeaderFooter: false,
  });

  const jobLocation = await new Promise((resolve, reject) => {
    const options = {
      hostname: 'pdf-services-ue1.adobe.io',
      path:     '/operation/htmltopdf',
      method:   'POST',
      headers: {
        'Authorization':  `Bearer ${accessToken}`,
        'x-api-key':      clientId,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(jobPayload),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        if (res.statusCode === 201) resolve(res.headers['location']);
        else reject(new Error(`Job create failed ${res.statusCode}: ${data}`));
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Job create timeout')); });
    req.write(jobPayload);
    req.end();
  });

  if (!jobLocation) throw new Error('Adobe: no job location returned');

  // Step 4 — Poll for job completion (max 30s)
  let pdfAssetId = null;
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 3000));

    const status = await new Promise((resolve, reject) => {
      const loc = new URL(jobLocation);
      const options = {
        hostname: loc.hostname,
        path:     loc.pathname + loc.search,
        method:   'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'x-api-key':     clientId,
        },
      };
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', c => { data += c; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(new Error(`Poll parse error: ${data}`)); }
        });
      });
      req.on('error', reject);
      req.setTimeout(8000, () => { req.destroy(); reject(new Error('Poll timeout')); });
      req.end();
    });

    console.log('Adobe PDF job status:', status.status);

    if (status.status === 'done') {
      pdfAssetId = status.asset?.assetID;
      break;
    }
    if (status.status === 'failed') throw new Error(`Adobe PDF job failed: ${JSON.stringify(status)}`);
  }

  if (!pdfAssetId) throw new Error('Adobe PDF: job did not complete in time');

  // Step 5 — Get download URI for the generated PDF
  const downloadInfo = await new Promise((resolve, reject) => {
    const options = {
      hostname: 'pdf-services-ue1.adobe.io',
      path:     `/assets/${pdfAssetId}`,
      method:   'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'x-api-key':     clientId,
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Download URI parse error: ${data}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Download URI timeout')); });
    req.end();
  });

  if (!downloadInfo.downloadUri) throw new Error('Adobe: no download URI');

  // Step 6 — Fetch and return PDF as base64
  const pdfBase64 = await new Promise((resolve, reject) => {
    const dlUrl  = new URL(downloadInfo.downloadUri);
    const proto  = dlUrl.protocol === 'https:' ? https : http;
    const chunks = [];

    const options = {
      hostname: dlUrl.hostname,
      path:     dlUrl.pathname + dlUrl.search,
      method:   'GET',
    };
    const req = proto.request(options, (res) => {
      res.on('data', chunk => { chunks.push(chunk); });
      res.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('PDF download timeout')); });
    req.end();
  });

  return pdfBase64;
}

// ── RESEND EMAIL ──────────────────────────────────────────────────────────────

function sendAlertEmail(brief, leadId, timestamp) {
  return new Promise((resolve) => {
    const resendKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.RESEND_FROM_EMAIL || `${BRAND.name} <support@ai4websitedesign.com>`;
    const toEmail   = process.env.RESEND_TO_EMAIL   || 'jmitchell@aiflowdeskpro.com';

    if (!resendKey) { console.error('RESEND: No API key'); return resolve(null); }

    const html = `
      <div style="font-family:Arial,sans-serif;background:#0d0d1a;padding:32px;color:#c9d1d9;max-width:560px;border-radius:12px;">
        <div style="margin-bottom:20px;">
          <span style="background:linear-gradient(135deg,${BRAND.accent},${BRAND.accent2});color:#fff;font-weight:700;font-size:13px;padding:4px 10px;border-radius:4px;">A4W</span>
          <span style="color:#555577;font-size:13px;margin-left:10px;letter-spacing:1px;">AI4 WEBSITE DESIGN · NEW LEAD</span>
        </div>
        <div style="background:#13132a;border:1px solid #2a2a4a;border-radius:10px;padding:24px;">
          <p style="margin:0 0 4px;font-size:11px;color:#555577;text-transform:uppercase;letter-spacing:1px;">Design Brief Downloaded</p>
          <h2 style="margin:0 0 16px;font-size:22px;color:#fff;">${safeString(brief.businessName, 'New Lead')}</h2>
          <table style="width:100%;font-size:13px;border-collapse:collapse;">
            <tr><td style="padding:6px 0;color:#555577;width:130px;">Business Type</td><td style="color:#e2e2ff;">${safeString(brief.businessType, '—')}</td></tr>
            <tr><td style="padding:6px 0;color:#555577;">Template</td><td style="color:#e2e2ff;">${safeString(brief.recommendedTemplate, '—')}</td></tr>
            <tr><td style="padding:6px 0;color:#555577;">Email</td><td style="color:${BRAND.accent};">${safeString(brief.email, 'Not captured')}</td></tr>
            <tr><td style="padding:6px 0;color:#555577;">Pages</td><td style="color:#e2e2ff;">${Array.isArray(brief.pages) ? brief.pages.join(', ') : '—'}</td></tr>
            <tr><td style="padding:6px 0;color:#555577;">Features</td><td style="color:#e2e2ff;">${Array.isArray(brief.features) ? brief.features.join(', ') : '—'}</td></tr>
            <tr><td style="padding:6px 0;color:#555577;">Status</td><td style="color:#28c840;">Brief Downloaded — Warm Lead</td></tr>
          </table>
          <div style="margin-top:16px;padding-top:16px;border-top:1px solid #2a2a4a;display:flex;justify-content:space-between;">
            <span style="font-family:monospace;font-size:11px;color:#555577;">Lead ID: ${leadId}</span>
            <span style="font-family:monospace;font-size:11px;color:#555577;">${timestamp}</span>
          </div>
        </div>
        <p style="margin:20px 0 0;font-size:11px;color:#555577;text-align:center;">
          ${BRAND.name.toUpperCase()} · ${BRAND.entity.toUpperCase()} · ${new Date().getFullYear()}
        </p>
      </div>`;

    const emailBody = JSON.stringify({
      from:    fromEmail,
      to:      [toEmail],
      subject: `New Design Brief — ${safeString(brief.businessName, 'New Lead')} · ai4websitedesign.com`,
      html,
      text:    `New Design Brief Downloaded\nBusiness: ${safeString(brief.businessName)}\nType: ${safeString(brief.businessType)}\nEmail: ${safeString(brief.email)}\nTemplate: ${safeString(brief.recommendedTemplate)}\nLead ID: ${leadId}\n${timestamp}`,
    });

    const options = {
      hostname: 'api.resend.com',
      path:     '/emails',
      method:   'POST',
      headers: {
        'Authorization':  `Bearer ${resendKey}`,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(emailBody),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => { console.log('RESEND:', res.statusCode); resolve(data); });
    });
    req.on('error', (e) => { console.error('RESEND ERROR:', e.message); resolve(null); });
    req.setTimeout(6000, () => { req.destroy(); resolve(null); });
    req.write(emailBody);
    req.end();
  });
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  let brief;
  try {
    brief = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  if (!brief.businessName) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'businessName is required' }) };
  }

  const leadId    = generateLeadId();
  const timestamp = formatTimestamp();

  console.log('GENERATE BRIEF:', leadId, '|', brief.businessName, '|', brief.email || 'no email');

  // 1 — Save lead to Supabase
  const leadRecord = {
    email:             safeString(brief.email),
    business_name:     safeString(brief.businessName),
    business_type:     safeString(brief.businessType),
    template_selected: safeString(brief.recommendedTemplate),
    accent_color:      safeString(brief.accentColor),
    pages:             brief.pages    || [],
    features:          brief.features || [],
    design_brief:      JSON.stringify(brief),
    status:            'brief_downloaded',
    source:            'ai4websitedesign',
  };

  const [supabaseResult] = await Promise.allSettled([
    supabaseInsert('leads', leadRecord),
  ]);
  console.log('SUPABASE:', supabaseResult.status);

  // 2 — Generate PDF
  let pdfBase64 = null;
  try {
    const accessToken = await getAdobeAccessToken();
    const htmlContent = buildBriefHtml(brief, leadId, timestamp);
    pdfBase64         = await generatePdfFromHtml(htmlContent, accessToken);
    console.log('PDF GENERATED: success');
  } catch (pdfErr) {
    console.error('PDF GENERATION ERROR:', pdfErr.message);
    // Non-fatal — we still save the lead and send the email
  }

  // 3 — Send alert email (non-blocking)
  sendAlertEmail(brief, leadId, timestamp).catch(e => console.error('EMAIL ERROR:', e.message));

  // 4 — Return response
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      success:   true,
      lead_id:   leadId,
      timestamp,
      pdf_base64: pdfBase64,
      message:   pdfBase64
        ? 'Brief saved and PDF generated successfully'
        : 'Brief saved — PDF generation failed, try browser print fallback',
    }),
  };
};
