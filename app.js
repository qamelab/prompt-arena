// Prompt Arena — frontend controller
// All app state is local. Only the prompt + scenario context is sent to the
// worker. No student data is collected or stored remotely.

// Edit PROD_JUDGE_ENDPOINT to your deployed worker URL before pushing to Pages.
const LOCAL_JUDGE_ENDPOINT = "http://localhost:8787";
const PROD_JUDGE_ENDPOINT = "https://prompt-arena-judge.<your-subdomain>.workers.dev";

const isLocalHost =
  location.hostname === "localhost" ||
  location.hostname === "127.0.0.1" ||
  location.hostname === "";

const CONFIG = {
  judgeEndpoint: isLocalHost ? LOCAL_JUDGE_ENDPOINT : PROD_JUDGE_ENDPOINT,
  // Path to the scenario file to load on page open. Add a query string
  // ?scenario=foo to switch between scenarios in /scenarios/foo.yaml.
  defaultScenario: "swiss-cantons",
  scenariosDir: "scenarios",
};

const state = {
  scenario: null,
  locked: false,
  yourMech: null,
  yourHol: null,
};

// ─── DOM helpers ───
const $ = (id) => document.getElementById(id);
const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ─── Scenario loading ───
async function loadScenario() {
  const params = new URLSearchParams(window.location.search);
  const slug = params.get("scenario") || CONFIG.defaultScenario;
  const url = `${CONFIG.scenariosDir}/${slug}.yaml`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    state.scenario = jsyaml.load(text);
    renderScenario();
    renderLeaderboard();
  } catch (e) {
    $("scenario-title").textContent = "Could not load scenario";
    $("scenario-task").textContent = `Failed to fetch ${url} — ${e.message}`;
  }
}

function renderScenario() {
  const s = state.scenario;
  document.title = `Prompt Arena · ${s.title}`;
  $("round-pill").textContent = `Round ${s.round}`;
  $("scenario-title").textContent = s.title;
  $("scenario-briefing").textContent = s.briefing.trim();
  $("scenario-task").textContent = s.task.trim();
  $("scenario-schema").textContent = s.dataset.schema_preview.trim();
  $("meta-filename").textContent = s.dataset.filename;
  $("meta-rows").textContent = s.dataset.rows;
}

// ─── Submission ───
async function submitPrompt() {
  if (state.locked) return;
  const prompt = $("prompt-input").value.trim();
  if (!prompt) {
    $("submit-status").textContent = "Empty prompt — type something first.";
    return;
  }

  const btn = $("submit-btn");
  btn.disabled = true;
  btn.textContent = "Evaluating…";
  $("submit-status").textContent = "Generating code, simulating output, judging…";
  $("prompt-input").disabled = true;
  $("results").classList.remove("hidden");
  resetResults();

  // Send to the worker. Only the public scenario fields + the prompt go over.
  // Mechanical checks and holistic anchors are also sent — the worker uses
  // them to build the judge prompt server-side. The "hidden rubric" is hidden
  // from the UI, not cryptographically; this is fine for classroom use.
  try {
    const res = await fetch(CONFIG.judgeEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario: state.scenario, prompt }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Judge returned HTTP ${res.status}`);
    }

    const result = await res.json();
    renderResult(result);
    state.locked = true;
    btn.textContent = "Submitted";
    $("submit-status").textContent = "Submission locked.";
  } catch (e) {
    $("submit-status").textContent = `Failed: ${e.message}. Submission was NOT locked — try again.`;
    btn.disabled = false;
    btn.textContent = "Lock in & submit";
    $("prompt-input").disabled = false;
  }
}

function resetResults() {
  $("total-score").textContent = "…";
  $("total-score").className = "score-big";
  $("tier-pill").textContent = "";
  $("tier-pill").className = "tier-pill";
  $("score-breakdown").textContent = "";
  $("checks-list").innerHTML = "";
  $("holistic-num").textContent = "—";
  $("holistic-text").textContent = "";
  $("mech-feedback").textContent = "";
  $("generated-code").textContent = "";
  $("generated-output").textContent = "";
}

function renderResult(result) {
  const checks = result.checks || {};
  const checkDefs = state.scenario.mechanical_checks;

  let passed = 0;
  for (const c of checkDefs) if (checks[c.key]) passed++;
  const mechScore = passed * 10;
  const holistic = clamp(Math.round(Number(result.holistic_score) || 0), 0, 30);
  const total = Math.min(100, mechScore + holistic);

  // Score & tier
  const t = tier(total);
  $("total-score").textContent = total;
  $("total-score").className = `score-big tier-${t}`;
  $("tier-pill").textContent = tierLabel(t);
  $("tier-pill").className = `tier-pill tier-${t}`;
  $("score-breakdown").textContent = `${mechScore} mech + ${holistic} editor`;

  // Checks
  $("checks-list").innerHTML = checkDefs
    .map((c) => {
      const passed = !!checks[c.key];
      return `<li class="check-item ${passed ? "pass" : "fail"}">
        <span class="check-mark ${passed ? "pass" : "fail"}"></span>
        <span class="check-label">${escapeHtml(c.label)}</span>
      </li>`;
    })
    .join("");

  // Holistic + feedback
  $("holistic-num").textContent = holistic;
  $("holistic-text").textContent = result.holistic_feedback || "";
  $("mech-feedback").textContent = result.mech_feedback || "";

  // Code + simulated output
  $("generated-code").textContent = result.code || "";
  $("generated-output").textContent = result.output_description || "";

  // Reflection card
  $("reflection-card").classList.remove("hidden");

  // Leaderboard
  state.yourMech = mechScore;
  state.yourHol = holistic;
  renderLeaderboard();
}

// ─── Leaderboard ───
function renderLeaderboard() {
  if (!state.scenario) return;
  const seed = state.scenario.leaderboard_seed || [];
  const rows = seed.map((r) => ({ ...r, total: Math.min(100, r.mech + r.hol) }));

  if (state.yourMech !== null && state.yourHol !== null) {
    rows.push({
      name: "You",
      mech: state.yourMech,
      hol: state.yourHol,
      total: Math.min(100, state.yourMech + state.yourHol),
      you: true,
    });
  }
  rows.sort((a, b) => b.total - a.total);

  $("lb-body").innerHTML = rows
    .map(
      (r, i) => `<div class="lb-row${r.you ? " you" : ""}">
      <span class="lb-num">${i + 1}</span>
      <span>${escapeHtml(r.name)}</span>
      <span class="num mech">${r.mech}</span>
      <span class="num hol">${r.hol}</span>
      <span class="num">${r.total}</span>
    </div>`
    )
    .join("");
}

// ─── Reflection ───
function saveReflection() {
  const txt = $("reflection-input").value.trim();
  if (!txt) return;
  const key = `prompt-arena:reflection:${state.scenario?.id || "default"}`;
  try {
    localStorage.setItem(key, txt);
  } catch {
    // localStorage may be disabled in private mode; fall through silently
  }
  $("reflection-input").disabled = true;
  const btn = $("reflection-save");
  btn.disabled = true;
  btn.textContent = "Saved";
  $("reflection-status").textContent = "Saved locally.";
}

// ─── Helpers ───
function tier(score) {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 50) return "C";
  return "F";
}
function tierLabel(t) {
  return { A: "Excellent", B: "Solid", C: "Needs work", F: "Failed" }[t];
}
function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

// ─── Bootstrap ───
document.addEventListener("DOMContentLoaded", () => {
  loadScenario();
  $("submit-btn").addEventListener("click", submitPrompt);
  $("reflection-save").addEventListener("click", saveReflection);
});
