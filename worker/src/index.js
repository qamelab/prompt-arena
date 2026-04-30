// Prompt Arena — judge worker
// Stateless Cloudflare Worker that builds the judge prompt server-side and
// calls the OpenRouter chat-completions API. The API key never touches the client.
//
// Deploy with: wrangler deploy
// Set the secret with: wrangler secret put OPENROUTER_API_KEY

// OpenRouter model id. Override per environment by editing this constant.
// Common alternatives: "anthropic/claude-opus-4" (higher quality, pricier),
// "anthropic/claude-haiku-4.5" (cheaper/faster), "openai/gpt-4o", etc.
const MODEL = "anthropic/claude-sonnet-4.5";
const MAX_TOKENS = 10000;

const ALLOWED_ORIGINS = [
  "http://localhost:8000",
  "http://localhost:5173",
  "https://qamelab.github.io",     // GitHub Pages default URL
  "https://qamelab.org",            // custom domain
  "https://www.qamelab.org",        // www variant of custom domain
];

const MAX_NAME_LEN = 30;
const MAX_LEADERBOARD = 20;

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

// Constant-time string comparison so a wrong password can't be probed
// character-by-character via timing differences.
function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function checkPassword(input, env) {
  if (!env.ACCESS_PASSWORD) return false;
  return constantTimeEqual(input, env.ACCESS_PASSWORD);
}

function sanitizeName(s) {
  if (typeof s !== "string") return null;
  // strip control chars, collapse whitespace, cap length
  const cleaned = s.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LEN);
  return cleaned || null;
}

function lbKey(scenarioId) {
  return `lb:${scenarioId}`;
}

async function readLeaderboard(env, scenarioId) {
  if (!env.LEADERBOARD || typeof scenarioId !== "string" || !scenarioId) return [];
  const raw = await env.LEADERBOARD.get(lbKey(scenarioId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Best-effort append. KV is eventually consistent and there is no CAS, so
// concurrent writers can lose entries — acceptable for a classroom-scale
// leaderboard. The trim happens on read AND write so a runaway list still
// stays bounded.
async function appendLeaderboard(env, scenarioId, entry) {
  if (!env.LEADERBOARD || !scenarioId) return [];
  const current = await readLeaderboard(env, scenarioId);
  current.push(entry);
  current.sort((a, b) => (b.mech + b.hol) - (a.mech + a.hol));
  const trimmed = current.slice(0, MAX_LEADERBOARD);
  await env.LEADERBOARD.put(lbKey(scenarioId), JSON.stringify(trimmed));
  return trimmed;
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

async function callJudge(judgePrompt, apiKey) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      // Optional but recommended by OpenRouter for analytics/attribution.
      "HTTP-Referer": "https://github.com/qamelab/prompt-arena",
      "X-Title": "Prompt Arena",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{ role: "user", content: judgePrompt }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenRouter error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const text = (data.choices?.[0]?.message?.content || "").trim();

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

    const url = new URL(request.url);

    // GET ?scenario=<id> — read current leaderboard for a scenario.
    // Reading is unauthenticated so a returning student sees scores
    // before the gate completes verification.
    if (request.method === "GET") {
      const scenarioId = url.searchParams.get("scenario");
      if (!scenarioId) {
        return jsonResponse({ error: "Missing ?scenario=<id>" }, 400, origin);
      }
      const rows = await readLeaderboard(env, scenarioId);
      return jsonResponse({ leaderboard: rows }, 200, origin);
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

    // POST /verify — landing-page password check. Returns 200 {ok:true}
    // on a valid password and 401 otherwise.
    if (url.pathname === "/verify") {
      const ok = checkPassword(body?.password, env);
      return jsonResponse({ ok }, ok ? 200 : 401, origin);
    }

    // POST / — judge submission. Requires a valid password.
    if (!checkPassword(body?.password, env)) {
      return jsonResponse({ error: "Unauthorized" }, 401, origin);
    }

    const { scenario, prompt, name } = body;
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

    const cleanName = sanitizeName(name);
    if (!cleanName) {
      return jsonResponse({ error: "Display name is required" }, 400, origin);
    }

    if (!env.OPENROUTER_API_KEY) {
      return jsonResponse({ error: "Server not configured" }, 500, origin);
    }

    try {
      const judgePrompt = buildJudgePrompt(scenario, prompt);
      const result = await callJudge(judgePrompt, env.OPENROUTER_API_KEY);

      // Compute mech/hol totals identically to the frontend so KV is
      // authoritative even if the client tampers with the rendered display.
      const checks = result.checks || {};
      let passed = 0;
      for (const c of scenario.mechanical_checks) if (checks[c.key]) passed++;
      const mech = passed * 10;
      const hol = Math.max(0, Math.min(30, Math.round(Number(result.holistic_score) || 0)));

      let leaderboard = [];
      if (typeof scenario.id === "string" && scenario.id) {
        leaderboard = await appendLeaderboard(env, scenario.id, {
          name: cleanName,
          mech,
          hol,
          ts: Date.now(),
        });
      }

      return jsonResponse({ ...result, leaderboard }, 200, origin);
    } catch (e) {
      return jsonResponse({ error: e.message }, 500, origin);
    }
  },
};
