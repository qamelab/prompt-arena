// Prompt Arena — judge worker
// Stateless Cloudflare Worker that builds the judge prompt server-side and
// calls the Anthropic API. The API key never touches the client.
//
// Deploy with: wrangler deploy
// Set the secret with: wrangler secret put ANTHROPIC_API_KEY

const MODEL = "claude-sonnet-4-6";  // adjust to claude-opus-4-7 for higher quality, or claude-haiku-4-5-20251001 for cheaper/faster
const MAX_TOKENS = 4000;

const ALLOWED_ORIGINS = [
  "http://localhost:8000",
  "http://localhost:5173",
  // Add your GitHub Pages origin here, e.g.:
  // "https://umatter.github.io",
];

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function jsonResponse(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(origin),
    },
  });
}

function validateScenario(s) {
  if (!s || typeof s !== "object") return "scenario must be an object";
  if (typeof s.briefing !== "string") return "scenario.briefing missing";
  if (typeof s.task !== "string") return "scenario.task missing";
  if (!s.dataset || typeof s.dataset.description !== "string") return "scenario.dataset.description missing";
  if (!Array.isArray(s.mechanical_checks) || s.mechanical_checks.length === 0) return "scenario.mechanical_checks must be a non-empty array";
  for (const c of s.mechanical_checks) {
    if (!c || typeof c.key !== "string" || typeof c.description !== "string") {
      return "each mechanical_checks entry needs a string key and description";
    }
  }
  if (!s.holistic || typeof s.holistic.voice !== "string") return "scenario.holistic.voice missing";
  if (!Array.isArray(s.holistic.evaluation_lens) || s.holistic.evaluation_lens.length === 0) return "scenario.holistic.evaluation_lens must be a non-empty array";
  if (!s.holistic.anchors || typeof s.holistic.anchors !== "object") return "scenario.holistic.anchors missing";
  return null;
}

function buildJudgePrompt(scenario, studentPrompt) {
  const checksList = scenario.mechanical_checks
    .map((c) => `    - ${c.key}: ${c.description}`)
    .join("\n");

  const lens = scenario.holistic.evaluation_lens
    .map((l) => `      - ${l}`)
    .join("\n");

  const anchors = Object.entries(scenario.holistic.anchors)
    .map(([range, desc]) => `      ${range} = ${desc}`)
    .join("\n");

  return `You are grading a student's prompt-engineering attempt in a university data-analytics class. Students iterate locally in RStudio with Microsoft Copilot, then submit ONE final prompt. Be discriminative — most prompts should land between 45 and 80.

SCENARIO:
Briefing: ${scenario.briefing.trim()}

Task: ${scenario.task.trim()}

Dataset: ${scenario.dataset.description.trim()}

STUDENT PROMPT:
"""
${studentPrompt}
"""

Your job has FOUR parts:

PART 1 — Generate the code.
Produce the R code a competent Copilot-style assistant would most plausibly write given EXACTLY this prompt. Do not silently fix omissions: if the prompt does not specify per-capita, do not compute per-capita; if it does not request a chart, do not chart. Reflect prompt quality faithfully.

PART 2 — Simulate the output.
Describe (3-5 sentences) what running the code on the dataset would produce: object structure, key values, errors/warnings, what the chart looks like (encoding, labels, legend, readability).

PART 3 — Score in two layers.

  (A) Mechanical checks — strict pass/fail, no partial credit. Each worth 10 points. These check the code, not the prompt.
${checksList}

  (B) Holistic verdict — flexible 0-30. Imagine you are a ${scenario.holistic.voice}, evaluating the result on these dimensions:
${lens}
    Anchors:
${anchors}
    A prompt can pass all mechanical checks and still get only 15 here if the result is misframed. A prompt can fail one mechanical check and still earn 24 if the analytical insight comes through cleanly.

PART 4 — Two short feedback strings:
  - mech_feedback: 1-2 sentences naming the most important mechanical issue (or strength).
  - holistic_feedback: 2-3 sentences in the voice of the ${scenario.holistic.voice} — what works, what would need rework, what the prompt could have done differently.

Return ONLY valid JSON, no markdown fences, in EXACTLY this shape:
{"code": "string", "output_description": "string", "checks": {${scenario.mechanical_checks.map((c) => `"${c.key}": false`).join(", ")}}, "holistic_score": 0, "mech_feedback": "string", "holistic_feedback": "string"}`;
}

async function callAnthropic(judgePrompt, apiKey) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{ role: "user", content: judgePrompt }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const text = data.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();

  // Strip any accidental code fences
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  return JSON.parse(cleaned);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405, origin);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON" }, 400, origin);
    }

    const { scenario, prompt } = body;
    if (!scenario || !prompt) {
      return jsonResponse({ error: "Missing scenario or prompt" }, 400, origin);
    }

    if (typeof prompt !== "string" || prompt.length > 4000) {
      return jsonResponse({ error: "Prompt must be a string under 4000 chars" }, 400, origin);
    }

    const scenarioErr = validateScenario(scenario);
    if (scenarioErr) {
      return jsonResponse({ error: `Invalid scenario: ${scenarioErr}` }, 400, origin);
    }

    if (!env.ANTHROPIC_API_KEY) {
      return jsonResponse({ error: "Server not configured" }, 500, origin);
    }

    try {
      const judgePrompt = buildJudgePrompt(scenario, prompt);
      const result = await callAnthropic(judgePrompt, env.ANTHROPIC_API_KEY);
      return jsonResponse(result, 200, origin);
    } catch (e) {
      return jsonResponse({ error: e.message }, 500, origin);
    }
  },
};
