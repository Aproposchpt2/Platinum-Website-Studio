'use strict';

const https = require('https');

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}

function extractResponseText(data) {
  if (typeof data.output_text === 'string') return data.output_text;

  const chunks = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if ((content.type === 'output_text' || content.type === 'text') && content.text) {
        chunks.push(content.text);
      }
    }
  }

  return chunks.join('\n').trim();
}

function parseAgentJson(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    const match = String(text || '').match(/\{[\s\S]*\}/);
    if (!match) throw error;
    return JSON.parse(match[0]);
  }
}

function callOpenAI(payload, apiKey) {
  const body = JSON.stringify(payload);

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.openai.com',
      path: '/v1/responses',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed = {};
        try { parsed = JSON.parse(data || '{}'); } catch (error) { parsed = { raw: data }; }

        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(parsed.error?.message || `OpenAI request failed with ${res.statusCode}`));
          return;
        }

        resolve(parsed);
      });
    });

    req.on('error', reject);
    req.setTimeout(55000, () => {
      req.destroy();
      reject(new Error('OpenAI optimization timeout'));
    });
    req.write(body);
    req.end();
  });
}

function buildInput({ builtHtml, siteData, language }) {
  return [
    {
      role: 'system',
      content: [{
        type: 'input_text',
        text: [
          'You are the AI4 English Website Output Quality Agent.',
          'Repair generated English website HTML before customer delivery.',
          'Preserve the existing visual design and CSS unless a minimal text/layout fix is required.',
          'Fix spelling, grammar, punctuation, mojibake/encoding damage, misplaced words, overlong CTAs, duplicate labels, generic AI filler, and business-category mismatch.',
          'Use natural customer-facing English.',
          'Do not invent unverifiable phone numbers, addresses, prices, hours, legal claims, awards, guarantees, or income promises.',
          'Return only valid JSON with optimized_html and quality_report.'
        ].join(' ')
      }]
    },
    {
      role: 'user',
      content: [{
        type: 'input_text',
        text: JSON.stringify({
          task: 'Optimize this generated English website output for customer delivery.',
          language,
          site_data: siteData,
          required_json_shape: {
            optimized_html: 'full corrected HTML string',
            quality_report: {
              quality_score: 'number from 1 to 100',
              issues_fixed: ['short issue summary'],
              remaining_risks: ['short risk or empty array']
            }
          },
          built_html: builtHtml,
        }, null, 2)
      }]
    }
  ];
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return json(500, { error: 'OPENAI_API_KEY is not configured.' });

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (error) {
    return json(400, { error: 'Invalid JSON request body.' });
  }

  const builtHtml = String(body.built_html || '');
  const siteData = body.site_data && typeof body.site_data === 'object' ? body.site_data : {};
  const language = body.language || siteData.language || 'en';

  if (builtHtml.length < 500) {
    return json(400, { error: 'Generated HTML is missing or too short to optimize.' });
  }

  const model = process.env.AI4_OUTPUT_AGENT_MODEL || 'gpt-5.5';

  try {
    const data = await callOpenAI({
      model,
      input: buildInput({ builtHtml, siteData, language }),
      max_output_tokens: 60000,
    }, apiKey);

    const text = extractResponseText(data);
    const parsed = parseAgentJson(text);

    if (!parsed.optimized_html || typeof parsed.optimized_html !== 'string') {
      return json(502, { error: 'The AI quality agent did not return optimized HTML.' });
    }

    return json(200, {
      optimized_html: parsed.optimized_html,
      quality_report: parsed.quality_report || {
        quality_score: null,
        issues_fixed: [],
        remaining_risks: ['No quality report was returned by the model.'],
      },
      model,
    });
  } catch (error) {
    console.error('AI4 English output optimization error:', error.message);
    return json(500, { error: error.message || 'Unexpected optimization failure.' });
  }
};
