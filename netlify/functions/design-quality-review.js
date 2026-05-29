const PURPOSE_VALID_SYSTEMS = {
  "Business Website": ["Executive Presence System", "Modern Trust System", "Luxury Reveal System"],
  "Personal Brand Website": ["Personal Brand Authority System", "Luxury Reveal System", "Executive Presence System"],
  "Portfolio Website": ["Cinematic Portfolio System", "Artist Showcase System", "Personal Brand Authority System"],
  "Blog / Publication": ["Digital Magazine System", "Personal Brand Authority System"],
  "Creator / Influencer Website": ["Creator Spotlight System", "Personal Brand Authority System", "Digital Magazine System"],
  "Event / Invitation Website": ["Event Invitation System"],
  "Product / Launch Page": ["Product Launch System", "Futuristic Interface System", "Executive Presence System"],
  "Nonprofit / Cause Website": ["Nonprofit Story System", "Modern Trust System"],
  "Resume / Career Website": ["Personal Brand Authority System", "Cinematic Portfolio System"],
  "Course / Education Website": ["Personal Brand Authority System", "Modern Trust System", "Product Launch System"],
  "Community / Membership Website": ["Modern Trust System", "Creator Spotlight System"],
  "Artist / Music / Creative Showcase": ["Artist Showcase System", "Cinematic Portfolio System", "Luxury Reveal System"],
  "Real Estate / Property Showcase": ["Luxury Reveal System", "Executive Presence System"],
  "Restaurant / Hospitality Website": ["Luxury Reveal System", "Modern Trust System"],
  "Local Service Website": ["Modern Trust System", "Executive Presence System"],
  "Ecommerce / Product Catalog": ["Product Launch System", "Luxury Reveal System"],
  "Custom / Other": [],
};

const GOAL_CTA_ALIGNMENT = {
  "Get customers or leads": ["Contact me", "Book a call", "Start here", "Learn more"],
  "Showcase my work": ["View portfolio", "Learn more", "Start here"],
  "Promote myself": ["Contact me", "Book a call", "Join the list", "Learn more", "Start here"],
  "Publish content": ["Read the blog", "Join the list", "Learn more", "Start here"],
  "Sell a product": ["Buy now", "Start here", "Learn more"],
  "Announce an event": ["Register", "Learn more", "Start here", "Book a call"],
  "Build authority": ["Book a call", "Contact me", "Learn more", "Join the list"],
  "Tell a story": ["Learn more", "Join the list", "Donate", "Start here"],
  "Collect signups": ["Join the list", "Register", "Start here"],
  "Create an online presence": ["Contact me", "Learn more", "Start here", "View portfolio"],
};

const MIN_SECTIONS = {
  "Business Website": 4, "Portfolio Website": 3, "Blog / Publication": 3,
  "Event / Invitation Website": 3, "Nonprofit / Cause Website": 4,
  "Product / Launch Page": 3, "Artist / Music / Creative Showcase": 3,
  "Ecommerce / Product Catalog": 4,
};

function evaluate(brief, answers) {
  const flags = [], recommendations = [];
  let score = 100;
  const purpose = answers.purpose || "", goal = answers.goal || "", cta = answers.cta || "";
  const sections = Array.isArray(answers.sections) ? answers.sections : [];
  const ds = brief.recommendedDesignSystem || "", vi = brief.visualIdentity || {};
  const direction = brief.creativeDirection || "", motif = vi.visualMotif || "", typography = vi.typography || "", colorMood = vi.colorMood || "";
  const validSystems = PURPOSE_VALID_SYSTEMS[purpose] || [];
  if (validSystems.length > 0 && !validSystems.includes(ds)) { score -= 18; flags.push(`Design system "${ds}" is not the strongest match for "${purpose}". Recommended: ${validSystems.slice(0, 2).join(" or ")}.`); }
  else if (validSystems.length > 0 && validSystems[0] === ds) { score = Math.min(100, score + 2); }
  const minSections = MIN_SECTIONS[purpose] || 3;
  if (sections.length < minSections) { score -= 12; flags.push(`Only ${sections.length} section(s) selected. "${purpose}" needs at least ${minSections}.`); }
  const validCTAs = GOAL_CTA_ALIGNMENT[goal] || [];
  if (validCTAs.length > 0 && !validCTAs.includes(cta)) { score -= 10; flags.push(`CTA "${cta}" doesn't align well with goal "${goal}". Better: ${validCTAs.slice(0, 3).join(", ")}.`); }
  if (!motif || motif.trim().length < 18) { score -= 9; flags.push("Visual motif is not sufficiently defined."); }
  if (!typography || typography.trim().length < 12) { score -= 9; flags.push("Typography direction is vague."); }
  if (!colorMood || colorMood.trim().length < 12) { score -= 7; flags.push("Color mood is underspecified."); }
  if (direction.length < 80) { score -= 8; flags.push("Creative direction statement is too brief."); }
  if (sections.length === 1) { score -= 6; flags.push("A single-section website cannot create a compelling experience."); }
  score = Math.max(0, Math.min(100, Math.round(score)));
  let status;
  if (score >= 90) status = "approved";
  else if (score >= 75) status = "needs_polish";
  else if (score >= 60) status = "redesign";
  else status = "reject";
  if (flags.length === 0) {
    flags.push("All quality gate checks passed — design direction meets the premium standard.");
    flags.push("Purpose, design system, CTA, and visual identity are strongly aligned.");
    flags.push("Section plan supports a complete and logical visitor journey.");
  }
  return { score, status, flags, recommendations };
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST, OPTIONS" }, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON body" }) }; }
  const { brief = {}, answers = {} } = body;
  if (!brief.recommendedDesignSystem) return { statusCode: 400, body: JSON.stringify({ error: "Missing brief.recommendedDesignSystem" }) };
  const result = evaluate(brief, answers);
  return { statusCode: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(result) };
};
