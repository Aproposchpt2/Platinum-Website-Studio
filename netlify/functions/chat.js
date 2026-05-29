'use strict';

const https = require('https');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { messages, system, max_tokens } = body;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY missing');
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'API key not configured' }) };
  }

  // Build message array
  let msgArray = [];
  if (Array.isArray(messages) && messages.length > 0) {
    msgArray = messages;
  } else if (body.message) {
    msgArray = [{ role: 'user', content: body.message }];
  } else {
    msgArray = [{ role: 'user', content: 'Begin.' }];
  }

  console.log('CHAT: sending', msgArray.length, 'messages to Claude');

  const payload = JSON.stringify({
    model:      'claude-sonnet-4-6',
    max_tokens: max_tokens || 4000,          // use request value or default 4000
    system:     system || 'You are a helpful assistant.',  // use request system prompt
    messages:   msgArray,
  });

  try {
    const reply = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.anthropic.com',
        path:     '/v1/messages',
        method:   'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-api-key':         apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Length':    Buffer.byteLength(payload),
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            console.log('CLAUDE STATUS:', res.statusCode);
            console.log('CLAUDE RAW:', JSON.stringify(parsed).substring(0, 300));
            const text = parsed.content?.map(b => b.text || '').join('') || '';
            resolve(text);
          } catch (e) {
            reject(new Error('Claude parse error: ' + data));
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(28000, () => { req.destroy(); reject(new Error('Claude timeout')); });
      req.write(payload);
      req.end();
    });

    return { statusCode: 200, headers, body: JSON.stringify({ reply }) };

  } catch (err) {
    console.error('CHAT ERROR:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
