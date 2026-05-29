// register-user.js
// Creates a new user account and sends OTP email (Sign Up flow)

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function generateOTP() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function sendWelcomeEmail(email, name, otp) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from:    process.env.RESEND_FROM_EMAIL,
      to:      email,
      subject: 'Welcome to AI4 Website Design — Your Access Code',
      html: `
        <!DOCTYPE html>
        <html>
        <body style="font-family:Arial,sans-serif;background:#080c10;color:#f0f6fc;padding:40px;margin:0;">
          <div style="max-width:480px;margin:0 auto;background:#0f1419;border-radius:16px;border:1px solid rgba(255,255,255,.1);padding:40px;">
            <div style="font-size:1.2rem;font-weight:900;color:#4F6EF7;margin-bottom:24px;">ai4websitedesign</div>
            <h2 style="color:#f0f6fc;margin:0 0 12px;">Welcome, ${name}! 🎉</h2>
            <p style="color:#8b949e;line-height:1.7;margin:0 0 28px;">
              Your account has been created. Use the code below to verify your email and access your account.
              This code expires in <strong style="color:#f0f6fc;">15 minutes</strong>.
            </p>
            <div style="background:#161d25;border:2px solid #4F6EF7;border-radius:12px;padding:28px;text-align:center;margin-bottom:28px;">
              <div style="font-size:.7rem;color:#8b949e;letter-spacing:.14em;text-transform:uppercase;margin-bottom:10px;font-family:monospace;">Your Access Code</div>
              <div style="font-size:2.8rem;font-weight:900;letter-spacing:.18em;color:#4F6EF7;font-family:monospace;">${otp}</div>
            </div>
            <p style="color:#8b949e;font-size:.85rem;line-height:1.6;">
              Once verified you'll have full access to your account dashboard where you can start building your website.
            </p>
            <hr style="border:none;border-top:1px solid rgba(255,255,255,.07);margin:24px 0;">
            <p style="color:#8b949e;font-size:.75rem;">Powered by Apropos Group LLC · ai4websitedesign.com</p>
          </div>
        </body>
        </html>
      `
    })
  });
  if (!res.ok) throw new Error('Resend error: ' + await res.text());
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  let name, email, phone;
  try { ({ name, email, phone } = JSON.parse(event.body)); } catch(e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request' }) };
  }

  if (!name || !email) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Name and email are required' }) };
  }

  const otp    = generateOTP();
  const expiry = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const now    = new Date().toISOString();

  // Upsert user — if email exists update OTP, if new create record
  const { error } = await supabase
    .from('users')
    .upsert({
      full_name:   name,
      email:       email.toLowerCase(),
      phone:       phone || null,
      status:      'active',
      otp_code:    otp,
      otp_expires: expiry,
      updated_at:  now,
      created_at:  now,
    }, { onConflict: 'email' });

  if (error) {
    console.error('User upsert error:', error.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Could not create account. Please try again.' }) };
  }

  // Send welcome + OTP email
  try {
    await sendWelcomeEmail(email, name, otp);
  } catch(e) {
    console.error('Welcome email error:', e.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Account created but could not send email. Please contact support.' }) };
  }

  return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
};
