/**
 * AI4 Website Design — Multi-Agent Pipeline
 * Netlify: netlify/functions/ai4-agent-pipeline.js
 * 5 stages · primary + failover per stage · never hard-crashes
 */

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MODEL         = 'claude-sonnet-4-20250514';
const MAX_TOKENS    = 1000;

async function claude(systemPrompt, userMessage) {
  const res = await fetch(ANTHROPIC_API, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, messages: [{ role: 'user', content: userMessage }], system: systemPrompt }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}`);
  const d = await res.json();
  return (d.content?.find(b => b.type === 'text')?.text || '').replace(/```json|```/g, '').trim();
}

function safeJSON(str, fallback = {}) { try { return JSON.parse(str); } catch { return fallback; } }

async function runAgent({ name, systemPrimary, systemFailover, userMsg, defaultResult }) {
  try { const r = await claude(systemPrimary, userMsg); const p = safeJSON(r, null); if (p) return p; throw new Error('non-JSON'); } catch (e) { console.warn(`[${name}] primary failed:`, e.message); }
  try { const r = await claude(systemFailover, userMsg); const p = safeJSON(r, null); if (p) return p; throw new Error('non-JSON'); } catch (e) { console.warn(`[${name}] failover failed:`, e.message); }
  console.warn(`[${name}] using default`); return defaultResult;
}

async function stageIntake(raw) {
  return runAgent({
    name: 'IntakeParser',
    systemPrimary: `You are the Intake Parser for an AI website builder. Normalise the client's answers into a clean business profile. Return ONLY valid JSON: {"businessName":"","businessType":"service|product|both","city":"","phone":"","email":"","address":"","headline":"","statements":[],"hours":"","accentColor":"#hex"}. Rules: preserve businessName capitalisation exactly; keep all statements verbatim; normalise phone to (XXX) XXX-XXXX; default accentColor #4F6EF7; empty string not null for missing fields.`,
    systemFailover: `Fallback parser. Extract key fields and return ONLY: {"businessName":"","businessType":"service","city":"","phone":"","email":"","address":"","headline":"","statements":[],"hours":"","accentColor":"#4F6EF7"}. Fill every field from data. Empty string if not found.`,
    userMsg: JSON.stringify(raw),
    defaultResult: { businessName: raw.name||'Your Business', businessType:'service', city:raw.city||'', phone:raw.phone||'', email:raw.email||'', address:raw.address||'', headline:raw.headline||'', statements:raw.stmts||[], hours:raw.hours||'', accentColor:raw.color||'#4F6EF7' },
  });
}

async function stageBrand(profile) {
  return runAgent({
    name: 'BrandIntelligence',
    systemPrimary: `You are the Brand Intelligence agent for an AI premium website builder. The 10 templates: 01-bold-impact, 02-clean-minimal, 03-warm-local, 04-professional-trust, 05-digital-showroom, 06-command-authority, 07-premium-launch, 08-portfolio-prestige, 09-modern-trust, 10-elite-brand-experience. Return ONLY valid JSON: {"heroHeadline":"bold specific max 12 words","heroDescription":"2 sentences specific to this business","ctaText":"3-5 word action phrase","ctaLink":"#contact","templateKey":"one of the 10 keys","templateReason":"one sentence"}. Template rules: service/authority/tech → 06 or 09; local service → 03 or 04; luxury/high-end → 10 or 07; portfolio/creative → 08; product/ecommerce → 05; general/startup → 01 or 02. Never use generic copy.`,
    systemFailover: `Fallback brand writer. Return ONLY JSON: {"heroHeadline":"Professional services in [city]","heroDescription":"We deliver results. Contact us today.","ctaText":"Get Started","ctaLink":"#contact","templateKey":"04-professional-trust","templateReason":"Safe professional default"}. Replace [city] with actual value.`,
    userMsg: JSON.stringify(profile),
    defaultResult: { heroHeadline: profile.headline||`${profile.businessName} — Serving ${profile.city}`, heroDescription: profile.statements?.[0]||'Professional service you can trust.', ctaText:'Get Started', ctaLink:'#contact', templateKey:'04-professional-trust', templateReason:'Safe professional default' },
  });
}

async function stageTokens(profile, brand) {
  return runAgent({
    name: 'TokenInjector',
    systemPrimary: `You are the Token Injector for an AI website builder. Produce the complete token map. Return ONLY valid JSON with these exact keys: BUSINESS_NAME, HEADLINE, DESCRIPTION, SERVICE_1, SERVICE_2, SERVICE_3, SERVICE_4, SERVICE_5, SERVICE_1_DESC, SERVICE_2_DESC, SERVICE_3_DESC, CITY, PHONE, EMAIL, ADDRESS, HOURS, CTA_TEXT, CTA_LINK, ACCENT_COLOR. Rules: HEADLINE = brand heroHeadline; DESCRIPTION = brand heroDescription; SERVICE_1/2/3 = first 3 statements as short titles (max 6 words); SERVICE_X_DESC = full statement sentences; no field may contain another {{TOKEN}}.`,
    systemFailover: `Fallback token resolver. Return ONLY JSON with keys: BUSINESS_NAME, HEADLINE, DESCRIPTION, SERVICE_1, SERVICE_2, SERVICE_3, SERVICE_4, SERVICE_5, SERVICE_1_DESC, SERVICE_2_DESC, SERVICE_3_DESC, CITY, PHONE, EMAIL, ADDRESS, HOURS, CTA_TEXT, CTA_LINK, ACCENT_COLOR. Use empty strings for missing values.`,
    userMsg: JSON.stringify({ profile, brand }),
    defaultResult: { BUSINESS_NAME:profile.businessName, HEADLINE:brand.heroHeadline, DESCRIPTION:brand.heroDescription, SERVICE_1:profile.statements?.[0]||'', SERVICE_2:profile.statements?.[1]||'', SERVICE_3:profile.statements?.[2]||'', SERVICE_4:profile.statements?.[3]||'', SERVICE_5:profile.statements?.[4]||'', SERVICE_1_DESC:profile.statements?.[0]||'', SERVICE_2_DESC:profile.statements?.[1]||'', SERVICE_3_DESC:profile.statements?.[2]||'', CITY:profile.city, PHONE:profile.phone, EMAIL:profile.email, ADDRESS:profile.address, HOURS:profile.hours, CTA_TEXT:brand.ctaText, CTA_LINK:brand.ctaLink, ACCENT_COLOR:profile.accentColor },
  });
}

function injectTokens(templateHTML, tokenMap) {
  let html = templateHTML;
  for (const [key, value] of Object.entries(tokenMap)) {
    html = html.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value || '');
  }
  const remaining = html.match(/\{\{[A-Z_]+\}\}/g) || [];
  if (remaining.length > 0) html = html.replace(/\{\{[A-Z_]+\}\}/g, tokenMap.BUSINESS_NAME || '');
  return { html, unresolvedCount: remaining.length };
}

async function stageBrief(profile, brand, tokens) {
  return runAgent({
    name: 'BriefGenerator',
    systemPrimary: `You are the Design Brief Generator for an AI premium website builder. Return ONLY valid JSON: {"businessName":"","businessType":"","targetAudience":"1-2 sentences about ideal customer","styleDirection":"1-2 sentences about visual/tonal direction","recommendedTemplate":"human-readable name","accentColor":"#hex","pages":["Home","Services","Contact"],"features":["Intake Form","Stripe Payments","Mobile Responsive","SEO Ready"],"contentAssets":"1 sentence","timeline":"Ready to launch immediately.","city":"","phone":"","email":"","heroHeadline":"","hours":""}. Be specific and professional.`,
    systemFailover: `Return minimal design brief JSON. Keys: businessName, businessType, targetAudience, styleDirection, recommendedTemplate, accentColor, pages, features, contentAssets, timeline, city, phone, email, heroHeadline, hours. ONLY JSON.`,
    userMsg: JSON.stringify({ profile, brand, tokens }),
    defaultResult: { businessName:profile.businessName, businessType:profile.businessType, targetAudience:'Local customers seeking professional service.', styleDirection:'Clean, professional, and trustworthy.', recommendedTemplate:brand.templateKey, accentColor:profile.accentColor, pages:['Home','Services','Contact'], features:['Intake Form','Stripe Payments','Mobile Responsive','SEO Ready'], contentAssets:'All content captured from client intake.', timeline:'Ready to launch immediately.', city:profile.city, phone:profile.phone, email:profile.email, heroHeadline:brand.heroHeadline, hours:profile.hours },
  });
}

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Headers':'Content-Type', 'Access-Control-Allow-Methods':'POST, OPTIONS', 'Content-Type':'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode:200, headers, body:'' };
  if (event.httpMethod !== 'POST') return { statusCode:405, headers, body:JSON.stringify({ error:'Method not allowed' }) };
  try {
    const { rawAnswers, templateHTML } = JSON.parse(event.body || '{}');
    if (!rawAnswers) return { statusCode:400, headers, body:JSON.stringify({ error:'rawAnswers required' }) };
    const profile  = await stageIntake(rawAnswers);
    const brand    = await stageBrand(profile);
    const tokens   = await stageTokens(profile, brand);
    let builtHTML  = null, qaResult = { unresolvedCount:0 };
    if (templateHTML) { const r = injectTokens(templateHTML, tokens); builtHTML = r.html; qaResult = { unresolvedCount:r.unresolvedCount }; }
    const brief    = await stageBrief(profile, brand, tokens);
    return { statusCode:200, headers, body:JSON.stringify({ success:true, profile, brand, tokens, builtHTML, brief, qa:{ unresolvedTokens:qaResult.unresolvedCount, templateSelected:brand.templateKey, passed:qaResult.unresolvedCount===0 } }) };
  } catch (err) {
    return { statusCode:500, headers, body:JSON.stringify({ success:false, error:err.message }) };
  }
};
