/**
 * pipeline-caller.js
 * Deploy to: /js/pipeline-caller.js
 * Add to ai4-design-studio.html: <script src="/js/pipeline-caller.js" defer></script>
 * Change complete button onclick to: launchPipeline()
 */

async function loadTemplate(templateKey) {
  try { const res = await fetch(`/templates/${templateKey}.html`); if (!res.ok) throw new Error(); return await res.text(); } catch { return null; }
}

function showSpinner(msg) {
  let o = document.getElementById('pipeline-overlay');
  if (!o) {
    o = document.createElement('div');
    o.id = 'pipeline-overlay';
    o.style.cssText = 'position:fixed;inset:0;background:rgba(6,6,10,.93);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;z-index:9999;';
    o.innerHTML = `<div id="pipeline-spinner" style="width:48px;height:48px;border-radius:50%;border:3px solid rgba(79,110,247,.2);border-top-color:#4F6EF7;animation:pspin .8s linear infinite;"></div><div id="pipeline-msg" style="font-size:15px;color:rgba(251,244,231,.7);text-align:center;max-width:320px;line-height:1.6;padding:0 24px;"></div><style>@keyframes pspin{to{transform:rotate(360deg)}}</style>`;
    document.body.appendChild(o);
  }
  document.getElementById('pipeline-msg').textContent = msg;
  o.style.display = 'flex';
}

function hideSpinner() { const o = document.getElementById('pipeline-overlay'); if (o) o.style.display = 'none'; }
function updateSpinner(msg) { const e = document.getElementById('pipeline-msg'); if (e) e.textContent = msg; }

async function runPipeline(answers) {
  showSpinner('Reading your answers...');
  const MSGS = ['Parsing your business profile...','Building your brand identity...','Selecting your premium template...','Injecting your content...','Polishing every detail...','Generating your Design Brief...','Wrapping it in a Bentley...'];
  let mi = 0;
  const iv = setInterval(() => { mi = (mi + 1) % MSGS.length; updateSpinner(MSGS[mi]); }, 2200);
  try {
    const first = await fetch('/.netlify/functions/ai4-agent-pipeline', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ rawAnswers:answers }) });
    if (!first.ok) throw new Error(`HTTP ${first.status}`);
    const fr = await first.json();
    if (!fr.success) throw new Error(fr.error||'Pipeline failed');
    updateSpinner(`Loading ${fr.brand.templateKey} template...`);
    const tmplHTML = await loadTemplate(fr.brand.templateKey);
    let final = fr;
    if (tmplHTML) {
      updateSpinner('Injecting your content into the template...');
      const second = await fetch('/.netlify/functions/ai4-agent-pipeline', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ rawAnswers:answers, templateHTML:tmplHTML }) });
      if (second.ok) { const sr = await second.json(); if (sr.success) final = sr; }
    }
    clearInterval(iv);
    updateSpinner('Your site is ready. Opening your Brief...');
    try {
      sessionStorage.setItem('ai4_design_brief', JSON.stringify(final.brief));
      if (final.builtHTML) sessionStorage.setItem('ai4_built_html', final.builtHTML);
      sessionStorage.setItem('ai4_pipeline_result', JSON.stringify({ templateKey:final.brand.templateKey, accentColor:final.profile.accentColor, qaPass:final.qa?.passed, unresolvedTokens:final.qa?.unresolvedTokens }));
    } catch(e) {}
    await new Promise(r => setTimeout(r, 900));
    hideSpinner();
    window.location.href = 'brief.html';
  } catch (err) {
    clearInterval(iv);
    updateSpinner('Finalising your brief...');
    try {
      sessionStorage.setItem('ai4_design_brief', JSON.stringify({ businessName:answers.name||'Your Business', businessType:answers.type==='0'?'Service':'Product', city:answers.city||'', phone:answers.phone||'', email:answers.email||'', heroHeadline:answers.headline||'', statements:answers.stmts||[], service1:answers.stmts?.[0]||'', service2:answers.stmts?.[1]||'', service3:answers.stmts?.[2]||'', hours:answers.hours||'', accentColor:answers.color||'#4F6EF7', recommendedTemplate:'Professional', pages:['Home','Services','Contact'], features:['Intake Form','Stripe Payments','Mobile Responsive'], contentAssets:'Content captured from intake.', timeline:'Ready to launch immediately.' }));
    } catch(e) {}
    await new Promise(r => setTimeout(r, 600));
    hideSpinner();
    window.location.href = 'brief.html';
  }
}

window.launchPipeline = async function() {
  if (typeof A !== 'undefined') { await runPipeline(A); } else { window.location.href = 'brief.html'; }
};

window.saveSiteToSupabase = async function(email, brief, builtHTML) {
  try {
    const res = await fetch('/.netlify/functions/save-build', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ email, name:brief.businessName, phone:brief.phone, brand_name:brief.businessName, built_html:builtHTML, template:brief.recommendedTemplate, palette:brief.accentColor, answers:brief }) });
    const data = await res.json();
    return data.site_id || null;
  } catch(e) { return null; }
};
