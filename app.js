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
  liveLeaderboard: [], // entries from worker KV (real submissions)
  lang: "de",          // overwritten in initLang() before any render
};

const NAME_KEY = "prompt-arena:name";
const PASSWORD_KEY = "prompt-arena:password";
const LANG_KEY = "prompt-arena:lang";

// ─── i18n string table ───
const STRINGS = {
  en: {
    round: "Round",
    single_shot: "Single shot · final submission",
    scenario_label: "Scenario",
    loading: "Loading…",
    file_label: "File",
    rows_label: "Rows",
    iterate_callout: "Iterate freely in RStudio with Microsoft Copilot. When you're sure, paste your final prompt below — submission locks it in.",
    name_label: "Display name",
    name_placeholder: "Shown on the class leaderboard",
    prompt_label: "Your final prompt",
    prompt_placeholder: "Paste your final, polished prompt…",
    submit_btn: "Lock in & submit",
    final_score_label: "Final score",
    out_of_100: "out of 100",
    mech_checks_head: "Mechanical checks",
    editor_verdict_label: "Editor's verdict",
    holistic_sub: "/ 30 · holistic",
    code_label: "R code your prompt produced",
    output_label: "Result of running it",
    reflection_label: "Reflection · optional",
    reflection_prompt: "Looking at the editor's verdict, what would you change about your prompt next time?",
    reflection_sub: "Not graded — for your own notes.",
    reflection_placeholder: "One or two sentences…",
    reflection_btn: "Save reflection",
    leaderboard_label: "Class leaderboard · this round",
    lb_rank: "#",
    lb_student: "Student",
    lb_mech: "Mech",
    lb_edit: "Edit",
    lb_total: "Total",
    footer_brand: "Prompt Arena · QAME · BFH / HSG",
    footer_data: "No student data is collected.",
    could_not_load: "Could not load scenario",
    failed_fetch: "Failed to fetch",
    enter_name_first: "Enter a display name first.",
    empty_prompt: "Empty prompt — type something first.",
    evaluating_btn: "Evaluating…",
    evaluating_status: "Generating code, simulating output, judging…",
    submitted_btn: "Submitted",
    submitted_status: "Submission locked.",
    failed_status_prefix: "Failed: ",
    failed_status_suffix: ". Submission was NOT locked — try again.",
    access_expired: "Access expired — refresh and re-enter the password.",
    saved_btn: "Saved",
    saved_status: "Saved locally.",
    tier_A: "Excellent",
    tier_B: "Solid",
    tier_C: "Needs work",
    tier_F: "Failed",
    gate_tag: "Score the prompt, not the student.",
    gate_desc: "A classroom prompt-engineering exercise. You'll get one data-analytics scenario and one dataset; iterate on your prompt locally in RStudio with Microsoft Copilot, then submit your final, polished version here once. Two scores come back: seven binary mechanical checks and one editor's verdict in the voice of the scenario's audience. Both land on the class leaderboard.",
    gate_password_placeholder: "Access password",
    gate_submit: "Enter",
    gate_checking: "Checking…",
    gate_error: "That password isn't right — try again.",
    gate_foot: "QAME · BFH / HSG",
  },
  de: {
    round: "Runde",
    single_shot: "Einzelversuch · finale Abgabe",
    scenario_label: "Szenario",
    loading: "Lädt…",
    file_label: "Datei",
    rows_label: "Zeilen",
    iterate_callout: "Iterieren Sie frei in RStudio mit Microsoft Copilot. Wenn Sie sicher sind, fügen Sie Ihren finalen Prompt unten ein — die Abgabe wird damit fixiert.",
    name_label: "Anzeigename",
    name_placeholder: "Erscheint in der Klassen-Bestenliste",
    prompt_label: "Ihr finaler Prompt",
    prompt_placeholder: "Fügen Sie Ihren ausgefeilten Prompt ein…",
    submit_btn: "Festlegen & abschicken",
    final_score_label: "Endpunktzahl",
    out_of_100: "von 100",
    mech_checks_head: "Mechanische Prüfungen",
    editor_verdict_label: "Urteil der Redaktion",
    holistic_sub: "/ 30 · holistisch",
    code_label: "Vom Prompt erzeugter R-Code",
    output_label: "Ausführungsergebnis",
    reflection_label: "Reflexion · optional",
    reflection_prompt: "Was würden Sie bei Ihrem nächsten Prompt anders machen, wenn Sie das Urteil der Redaktion zugrunde legen?",
    reflection_sub: "Wird nicht bewertet — für Ihre Notizen.",
    reflection_placeholder: "Ein oder zwei Sätze…",
    reflection_btn: "Reflexion speichern",
    leaderboard_label: "Klassen-Bestenliste · diese Runde",
    lb_rank: "#",
    lb_student: "Studierende",
    lb_mech: "Mech",
    lb_edit: "Red.",
    lb_total: "Total",
    footer_brand: "Prompt Arena · QAME · BFH / HSG",
    footer_data: "Es werden keine Studierendendaten erhoben.",
    could_not_load: "Szenario konnte nicht geladen werden",
    failed_fetch: "Fehler beim Laden von",
    enter_name_first: "Geben Sie zuerst einen Anzeigenamen ein.",
    empty_prompt: "Leerer Prompt — schreiben Sie zuerst etwas.",
    evaluating_btn: "Wird bewertet…",
    evaluating_status: "Code wird erzeugt, Ausgabe simuliert, bewertet…",
    submitted_btn: "Abgegeben",
    submitted_status: "Abgabe fixiert.",
    failed_status_prefix: "Fehler: ",
    failed_status_suffix: ". Die Abgabe wurde NICHT fixiert — bitte erneut versuchen.",
    access_expired: "Zugang abgelaufen — Seite neu laden und Passwort erneut eingeben.",
    saved_btn: "Gespeichert",
    saved_status: "Lokal gespeichert.",
    tier_A: "Sehr gut",
    tier_B: "Solide",
    tier_C: "Überarbeitung nötig",
    tier_F: "Nicht bestanden",
    gate_tag: "Bewertet wird der Prompt, nicht die Person.",
    gate_desc: "Eine Übung zum Prompt-Engineering im Klassenraum. Sie erhalten ein Datenanalyse-Szenario und einen Datensatz; iterieren Sie Ihren Prompt lokal in RStudio mit Microsoft Copilot und reichen Sie hier einmalig die finale, ausgefeilte Version ein. Sie erhalten zwei Punktzahlen zurück: sieben binäre mechanische Prüfungen und ein Urteil der Redaktion im Stil der Zielgruppe des Szenarios. Beide erscheinen in der Klassen-Bestenliste.",
    gate_password_placeholder: "Zugangspasswort",
    gate_submit: "Eintreten",
    gate_checking: "Wird geprüft…",
    gate_error: "Das Passwort ist nicht korrekt — bitte erneut versuchen.",
    gate_foot: "QAME · BFH / HSG",
  },
};

const t = (key) => STRINGS[state.lang][key] ?? STRINGS.en[key] ?? key;

function applyLang(lang) {
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  document.querySelectorAll(".lang-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.lang === lang);
  });
}

function initLang() {
  let lang = "de";
  try { lang = localStorage.getItem(LANG_KEY) || lang; } catch {}
  if (lang !== "de" && lang !== "en") lang = "de";
  state.lang = lang;
  applyLang(lang);
}

async function setLang(lang) {
  if (lang !== "de" && lang !== "en") return;
  if (lang === state.lang) return;
  state.lang = lang;
  try { localStorage.setItem(LANG_KEY, lang); } catch {}
  applyLang(lang);
  // Re-fetch the scenario in the new language and re-render.
  state.locked = false;
  state.yourMech = null;
  state.yourHol = null;
  $("results")?.classList.add("hidden");
  $("submit-btn").disabled = false;
  $("submit-btn").textContent = t("submit_btn");
  $("submit-status").textContent = "";
  $("prompt-input").disabled = false;
  await loadScenario();
}

// ─── DOM helpers ───
const $ = (id) => document.getElementById(id);
const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ─── Scenario loading ───
async function loadScenario() {
  const params = new URLSearchParams(window.location.search);
  const slug = params.get("scenario") || CONFIG.defaultScenario;
  const url = `${CONFIG.scenariosDir}/${slug}.${state.lang}.yaml`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    state.scenario = jsyaml.load(text);
    renderScenario();
    renderLeaderboard();
    fetchLeaderboard();
  } catch (e) {
    $("scenario-title").textContent = t("could_not_load");
    $("scenario-task").textContent = `${t("failed_fetch")} ${url} — ${e.message}`;
  }
}

function renderScenario() {
  const s = state.scenario;
  document.title = `Prompt Arena · ${s.title}`;
  $("round-pill").textContent = `${t("round")} ${s.round}`;
  $("scenario-title").textContent = s.title;
  $("scenario-briefing").textContent = s.briefing.trim();
  $("scenario-task").textContent = s.task.trim();
  $("scenario-schema").textContent = s.dataset.schema_preview.trim();
  const fileLink = $("meta-filename");
  fileLink.textContent = s.dataset.filename;
  fileLink.href = `${CONFIG.scenariosDir}/${s.dataset.filename}`;
  $("meta-rows").textContent = s.dataset.rows;
}

// ─── Leaderboard fetch ───
async function fetchLeaderboard() {
  if (!state.scenario?.id) return;
  try {
    const url = `${CONFIG.judgeEndpoint}?scenario=${encodeURIComponent(state.scenario.id)}`;
    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();
    state.liveLeaderboard = Array.isArray(data.leaderboard) ? data.leaderboard : [];
    renderLeaderboard();
  } catch {
    // Silent — leaderboard is best-effort. Seeded fallback still renders.
  }
}

// ─── Submission ───
async function submitPrompt() {
  if (state.locked) return;
  const name = $("name-input").value.trim();
  if (!name) {
    $("submit-status").textContent = t("enter_name_first");
    $("name-input").focus();
    return;
  }
  const prompt = $("prompt-input").value.trim();
  if (!prompt) {
    $("submit-status").textContent = t("empty_prompt");
    return;
  }
  try { localStorage.setItem(NAME_KEY, name); } catch {}

  const btn = $("submit-btn");
  btn.disabled = true;
  btn.textContent = t("evaluating_btn");
  $("submit-status").textContent = t("evaluating_status");
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
      body: JSON.stringify({
        scenario: state.scenario,
        prompt,
        name: $("name-input").value.trim(),
        password: localStorage.getItem(PASSWORD_KEY) || "",
      }),
    });

    // If the stored password no longer works (server-side change),
    // drop it and bounce the user back to the gate.
    if (res.status === 401) {
      try { localStorage.removeItem(PASSWORD_KEY); } catch {}
      $("submit-status").textContent = t("access_expired");
      btn.disabled = false;
      btn.textContent = t("submit_btn");
      $("prompt-input").disabled = false;
      return;
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Judge returned HTTP ${res.status}`);
    }

    const result = await res.json();
    renderResult(result);
    state.locked = true;
    btn.textContent = t("submitted_btn");
    $("submit-status").textContent = t("submitted_status");
  } catch (e) {
    $("submit-status").textContent = `${t("failed_status_prefix")}${e.message}${t("failed_status_suffix")}`;
    btn.disabled = false;
    btn.textContent = t("submit_btn");
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

  // Leaderboard — prefer KV-backed list returned with the result
  state.yourMech = mechScore;
  state.yourHol = holistic;
  if (Array.isArray(result.leaderboard)) {
    state.liveLeaderboard = result.leaderboard;
  }
  renderLeaderboard();
}

// ─── Leaderboard ───
function renderLeaderboard() {
  if (!state.scenario) return;
  const live = (state.liveLeaderboard || []).map((r) => ({ ...r }));
  // Seed entries are only a fallback for an empty class — once any real
  // submission lands, the placeholder names disappear.
  const seed = live.length === 0
    ? (state.scenario.leaderboard_seed || []).map((r) => ({ ...r, seed: true }))
    : [];
  const rows = [...seed, ...live].map((r) => ({
    ...r,
    total: Math.min(100, (r.mech || 0) + (r.hol || 0)),
  }));

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
  btn.textContent = t("saved_btn");
  $("reflection-status").textContent = t("saved_status");
}

// ─── Helpers ───
function tier(score) {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 50) return "C";
  return "F";
}
function tierLabel(tier) {
  return t(`tier_${tier}`);
}
function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

// ─── Landing-page password gate ───
function showGate() {
  $("gate").classList.remove("hidden");
  $("app").classList.add("hidden");
}
function hideGate() {
  $("gate").classList.add("hidden");
  $("app").classList.remove("hidden");
}

async function verifyPassword(pw) {
  if (!pw) return false;
  try {
    const res = await fetch(`${CONFIG.judgeEndpoint}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function gateSubmit(e) {
  e.preventDefault();
  const pw = $("gate-password").value;
  if (!pw) return;
  const btn = $("gate-submit");
  btn.disabled = true;
  btn.textContent = t("gate_checking");
  $("gate-error").classList.add("hidden");
  const ok = await verifyPassword(pw);
  if (ok) {
    try { localStorage.setItem(PASSWORD_KEY, pw); } catch {}
    hideGate();
    initApp();
  } else {
    $("gate-error").classList.remove("hidden");
    $("gate-password").value = "";
    btn.disabled = false;
    btn.textContent = t("gate_submit");
    $("gate-password").focus();
  }
}

function initApp() {
  loadScenario();
  try {
    const stored = localStorage.getItem(NAME_KEY);
    if (stored) $("name-input").value = stored;
  } catch {}
  $("submit-btn").addEventListener("click", submitPrompt);
  $("reflection-save").addEventListener("click", saveReflection);
}

// ─── Bootstrap ───
document.addEventListener("DOMContentLoaded", async () => {
  initLang();
  document.querySelectorAll(".lang-btn").forEach((btn) => {
    btn.addEventListener("click", () => setLang(btn.dataset.lang));
  });
  $("gate-form").addEventListener("submit", gateSubmit);
  const stored = (() => { try { return localStorage.getItem(PASSWORD_KEY); } catch { return null; } })();
  if (stored && await verifyPassword(stored)) {
    hideGate();
    initApp();
  } else {
    if (stored) { try { localStorage.removeItem(PASSWORD_KEY); } catch {} }
    showGate();
    $("gate-password").focus();
  }
});
