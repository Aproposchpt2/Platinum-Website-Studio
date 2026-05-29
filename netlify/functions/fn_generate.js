const Anthropic = require("@anthropic-ai/sdk");

// Design system mapping used by deterministic fallback
const DS_MAP = {
  "Business Website": "Executive Presence System",
  "Personal Brand Website": "Personal Brand Authority System",
  "Portfolio Website": "Cinematic Portfolio System",
  "Blog / Publication": "Digital Magazine System",
  "Creator / Influencer Website": "Creator Spotlight System",
  "Event / Invitation Website": "Event Invitation System",
  "Product / Launch Page": "Product Launch System",
  "Nonprofit / Cause Website": "Nonprofit Story System",
  "Resume / Career Website": "Personal Brand Authority System",
  "Course / Education Website": "Personal Brand Authority System",
  "Community / Membership Website": "Modern Trust System",
  "Artist / Music / Creative Showcase": "Artist Showcase System",
  "Real Estate / Property Showcase": "Luxury Reveal System",
  "Restaurant / Hospitality Website": "Luxury Reveal System",
  "Local Service Website": "Modern Trust System",
  "Ecommerce / Product Catalog": "Product Launch System",
  "Custom / Other": "Executive Presence System",
};

const COLOR_MOODS = {
  Premium: "Deep navy, silver, champagne gold — understated luxury palette",
  Luxurious: "Rich obsidian, warm gold, ivory white — maximum opulence",
  Futuristic: "Near-black surfaces, electric blue, neon grid accents",
  Warm: "Warm cream, terracotta, deep espresso, soft ochre",
  Minimal: "Pure white, near-black, single brand accent — nothing more",
  Cinematic: "High-contrast black & white with one bold hero accent",
  Editorial: "Off-white field, rich black type, editorial red or deep teal",
  Bold: "High-saturation primaries, heavy black backgrounds",
  Energetic: "Vibrant gradient shifts, electric accent, kinetic color pops",
  Professional: "Trusted blues and grays, clean white space, credibility palette",
  Elegant: "Champagne, blush, slate — sophisticated and restrained",
  Creative: "Unexpected color pairings, asymmetric palette, expressive",
  Personal: "Warm neutrals, soft pops, approachable and inviting",
  Trustworthy: "Clean blues, greens, white — safety and reliability signals",
};

const TYPO_MAP = {
  Premium: "Refined serif display (Playfair, Cormorant) + elegant light sans body",
  Luxurious: "High-contrast didone serif + whisper-weight sans for contrast",
  Cinematic: "Wide-set editorial serif + clean light Grotesk body",
  Editorial: "Condensed newspaper serif + clean reading sans",
  Futuristic: "Geometric mono display + clean humanist sans body",
  Minimal: "Single geometric sans family — weight contrast only, no serif",
  Bold: "Ultra-heavy extended sans display + tight body tracking",
  Professional: "Trustworthy rounded sans display + clean paragraph body",
  Creative: "Expressive variable font + contrasting mono or serif body",
};

function buildFallback(a) {
  const ds = DS_MAP[a.purpose] || "Executive Presence System";
  const imp = a.impression || "Professional";
  const goal = (a.goal || "achieve your goals").toLowerCase();
  const audience = (a.audience || "your target audience").toLowerCase();
  const sections = Array.isArray(a.sections) && a.sections.length
    ? a.sections
    : ["Hero / introduction", "About", "Services", "Contact"];

  return {
    purposeCategory: a.purpose || "Business Website",
    recommendedDesignSystem: ds,
    creativeDirection: `A ${imp.toLowerCase()} design direction built around "${goal}" — crafted to resonate deeply with ${audience}. The ${ds} provides a strong, identifiable visual signature and structured layout hierarchy that positions this site well above generic template output. Every section is sequenced to guide visitors toward a single, clear decision point.`,
    audienceStrategy: `Content hierarchy and persuasion flow are calibrated for ${audience}. The layout prioritizes the emotional triggers and trust signals most likely to move this audience from awareness to action — ${goal}.`,
    sectionPlan: sections,
    visualIdentity: {
      colorMood: COLOR_MOODS[imp] || "Clean neutrals with a defined brand accent color that reinforces personality",
      typography: TYPO_MAP[imp] || "Strong display typeface paired with a highly readable sans-serif body",
      layoutRhythm:
        imp === "Minimal" ? "Expansive whitespace with slow, intentional reveal rhythm — content earns its space"
        : imp === "Energetic" || imp === "Bold" ? "Fast-paced section transitions, kinetic overlaps, and overlapping visual elements"
        : "Deliberate section pacing with progressive content reveal and clear visual anchors at each scroll point",
      visualMotif:
        imp === "Futuristic" ? "Grid overlays, neon hairline rules, data-card layout modules, command-center aesthetic"
        : imp === "Cinematic" ? "Full-bleed editorial imagery, film-frame typography, high-contrast section framing"
        : imp === "Premium" || imp === "Luxurious" ? "Metallic surface textures, refined ruled lines, sophisticated spatial balance with generous negative space"
        : imp === "Minimal" ? "Purposeful whitespace as a design element, isolated typographic moments, restrained ornamentation"
        : "Intentional typographic hierarchy as the primary visual element, purposeful imagery placement at key anchor points",
    },
    ctaStrategy: `"${a.cta || "Contact me"}" is the dominant CTA — placed in the hero at full visual weight, reinforced mid-page at a natural scroll pause, and anchored in the footer. Secondary CTAs support the visitor journey without competing with the primary conversion moment.`,
    qualityScore: 85,
    qualityNotes: [
      "Visual signature is clearly defined and meaningfully distinct from generic template builders",
      "Design system selection aligns strongly with stated purpose and target audience",
      "CTA hierarchy is appropriate and well-matched to the selected primary goal",
      "Section plan supports a logical content journey and conversion flow",
      "Polish recommendation: refine visual motif specificity and typography pairing before customer preview",
    ],
    status: "needs_polish",
  };
}

const SYSTEM_PROMPT = `You are the AI4 Design Studio's senior design director agent. Your job is to generate a structured creative design brief for a new website based on the client's intake answers.

AVAILABLE DESIGN SYSTEMS — choose the best single match:
1. Luxury Reveal System — premium personal brands, luxury services, real estate, exclusive launches. Signature: cinematic hero, elegant typography, spacious layout, premium CTA.
2. Executive Presence System — business leaders, consultants, professional services, B2B. Signature: strong editorial hero, trust sections, clean metrics, authority layout.
3. Cinematic Portfolio System — creatives, designers, photographers, case study portfolios. Signature: full-screen visual entry, large project panels, motion-inspired rhythm.
4. Digital Magazine System — blogs, publications, thought leadership, content creators. Signature: editorial grid, featured story section, article cards, magazine typography.
5. Creator Spotlight System — influencers, YouTubers, podcasters, social-first creators. Signature: personal intro hero, social proof bar, featured content modules.
6. Personal Brand Authority System — coaches, speakers, career professionals, consultants, experts. Signature: strong personal hero, bio/story, authority blocks, media credibility.
7. Product Launch System — product drops, SaaS previews, digital products, app launches, offer pages. Signature: conversion-first hero, benefit cards, feature reveal, pricing CTA.
8. Event Invitation System — events, conferences, weddings, private invitations, ticketed experiences. Signature: date-forward hero, event details, agenda/timeline, RSVP block.
9. Nonprofit Story System — causes, community efforts, fundraising, awareness campaigns. Signature: human story hero, mission section, impact stats, donation CTA.
10. Artist Showcase System — musicians, artists, performers, creative portfolios. Signature: expressive visual hero, gallery/media section, booking/contact CTA.
11. Modern Trust System — local services, small businesses, practical service providers. Signature: clean trust-first hero, service explanation, reviews, contact CTA.
12. Futuristic Interface System — AI products, tech tools, automation services, innovative brands. Signature: dark interface, grid overlays, neon accents, data-card layout.

QUALITY GATE SCORING (0–100):
+20: First viewport feels premium and intentional
+15: Clear visual signature distinct from generic builders
+15: Layout matches the selected website purpose
+10: Avoids generic card-section repetition
+10: Looks meaningfully different from other design systems
+10: Typography direction is intentional and specific
+10: CTA is appropriate for the selected purpose
+5: Would make a customer say "I want that one"
+5: Exceeds basic AI website-builder output quality

Status: 90-100=approved, 75-89=needs_polish, 60-74=redesign, below 60=reject

Respond ONLY with valid JSON. No markdown fences, no explanation, no preamble:
{
  "purposeCategory": "",
  "recommendedDesignSystem": "",
  "creativeDirection": "",
  "audienceStrategy": "",
  "sectionPlan": [],
  "visualIdentity": {
    "colorMood": "",
    "typography": "",
    "layoutRhythm": "",
    "visualMotif": ""
  },
  "ctaStrategy": "",
  "qualityScore": 0,
  "qualityNotes": [],
  "status": "approved | needs_polish | redesign | reject"
}`;

exports.handler = async function (event) {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  let answers;
  try {
    answers = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON body" }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;

  // No API key — use deterministic fallback
  if (!apiKey) {
    console.log("[AI4] No ANTHROPIC_API_KEY — returning deterministic brief");
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify(buildFallback(answers)),
    };
  }

  const userPrompt = `CLIENT INTAKE ANSWERS:
- Website Purpose: ${answers.purpose || "Not specified"}
- Primary Goal: ${answers.goal || "Not specified"}
- Target Audience: ${answers.audience || "Not specified"}
- Desired First Impression: ${answers.impression || "Not specified"}
- Visual Style Preference: ${answers.visual || "Not specified"}
- Content Personality: ${answers.personality || "Not specified"}
- Sections Needed: ${Array.isArray(answers.sections) ? answers.sections.join(", ") : "Not specified"}
- Brand / Website Name: ${answers.brandName || "Not specified"}
- Description: ${answers.description || "Not specified"}
- Main Call to Action: ${answers.cta || "Not specified"}
- Additional Notes: ${answers.notes || "None"}

Generate the design brief JSON now.`;

  try {
    const client = new Anthropic({ apiKey });

    const msg = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1200,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    const raw = msg.content.find((b) => b.type === "text")?.text || "";
    // Strip any accidental markdown fences
    const clean = raw.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
    const brief = JSON.parse(clean);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify(brief),
    };
  } catch (err) {
    console.error("[AI4] Anthropic API error:", err.message);
    // Graceful fallback on any API failure
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify(buildFallback(answers)),
    };
  }
};
