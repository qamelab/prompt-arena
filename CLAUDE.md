# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Prompt Arena is a classroom prompt-engineering exercise (BFH / HSG). Students submit one final prompt for a data-analytics scenario; an LLM judge (OpenRouter) generates the R code that prompt would elicit, simulates the output, runs binary mechanical checks, and adds a holistic editor-style verdict. The two scores are written to a Cloudflare KV namespace and shown side-by-side on a shared class leaderboard. The only piece of student data collected is a self-chosen display name.

## Repository layout

```
index.html, app.js, styles.css    # frontend (root, served as-is by GitHub Pages)
scenarios/                        # bilingual: <slug>.en.yaml / <slug>.de.yaml + *.csv (one or two per scenario), fetched client-side via js-yaml
brand/                            # mark, favicon, lockups, social card, brand specimen page
worker/                           # Cloudflare Worker (the judge proxy)
  src/index.js                    # worker entry — buildJudgePrompt + OpenRouter call + KV writes
  package.json                    # wrangler dev/deploy scripts only
  wrangler.toml                   # worker config + KV namespace binding
  .dev.vars                       # gitignored — local OPENROUTER_API_KEY + ACCESS_PASSWORD for `wrangler dev`
.github/workflows/deploy.yml      # builds _site/ from frontend + scenarios/ + brand/, publishes to Pages
LICENSE, .gitignore
```

The Pages workflow copies the four frontend files plus the entire `scenarios/` and `brand/` directories into `_site/`. The worker itself never ships to Pages — it's deployed separately to Cloudflare.

## Commands

There is no build step. Frontend is vanilla HTML/CSS/JS; `js-yaml` is loaded from a CDN.

Frontend (from repo root):
```bash
python3 -m http.server 8000        # http://localhost:8000
```

Worker (from `worker/`):
```bash
npm install
echo "OPENROUTER_API_KEY=sk-or-..." > .dev.vars   # gitignored, used by `wrangler dev`
npm run dev                                       # http://localhost:8787
npm run deploy                                    # production
```

Wrangler emulates KV in-process for `--local` dev — the placeholder ids in `wrangler.toml` (all zeros) are fine until you actually deploy. Local KV state lives in `worker/.wrangler/state/v3/kv/`; `rm -rf` that directory if you want to wipe local leaderboards between sessions.

There are no tests, no linter config, and no CI checks beyond the Pages deploy workflow.

## Architecture

Two halves communicate over a single worker endpoint:

- **Frontend** (`index.html` + `app.js` + `styles.css`) opens with a landing-page password gate (`#gate`) that hides the rest of the app (`#app`) until the user enters a password that the worker accepts. On success the password is cached in localStorage and the gate is replaced by the main UI: scenario card with CSV download link, name input, prompt textarea, and the leaderboard. Submission posts the *full scenario object* + prompt + name + cached password to the worker and renders the returned code, simulated output, mechanical checks, holistic verdict, and updated leaderboard. State is in-memory; reflections + name + password persist to localStorage; nothing else is stored client-side.

- **Worker** (`worker/src/index.js`, deploys as a Cloudflare Worker) is the judge proxy. Three routes:
  - **POST `/verify`** — accepts `{password}`, returns `{ok}` and either 200 or 401 (constant-time comparison). Used by the landing page.
  - **POST `/`** — receives `{scenario, prompt, name, password}`. Rejects with 401 if the password doesn't match `env.ACCESS_PASSWORD`. Otherwise validates the scenario shape and name, calls `buildJudgePrompt`, forwards to OpenRouter's chat-completions API with the key from `env.OPENROUTER_API_KEY`, strips any code fences, parses JSON, computes mech/holistic totals server-side, appends an entry to KV via `appendLeaderboard`, and returns the result with the updated leaderboard.
  - **GET `/?scenario=<id>`** — reads the leaderboard for initial-load rendering. **Unauthenticated by design** so spectators and the gated landing page can show scores without unlocking.

  CORS is restricted via the `ALLOWED_ORIGINS` allowlist.

Key seams when changing behavior:

- **`PROD_JUDGE_ENDPOINT`** in `app.js` must point at the deployed worker. The constant `LOCAL_JUDGE_ENDPOINT` is used automatically when `location.hostname` is `localhost`/`127.0.0.1`.
- **`ALLOWED_ORIGINS`** in the worker must include the frontend origin (e.g. GitHub Pages URL) or CORS will silently fall back to `localhost:8000`.
- **`MODEL`** in the worker (currently `anthropic/claude-sonnet-4.5`) is an OpenRouter model id. Common alternatives: `anthropic/claude-opus-4` (more), `anthropic/claude-haiku-4.5` (less), `openai/gpt-4o`.
- **`MAX_TOKENS = 10000`** in the worker — the judge has to emit code + simulated output + checks JSON + two feedback strings; larger scenarios (especially `stock-returns`) push this.
- **Scoring math is server-authoritative.** The worker computes `mech = passed * 10` and `hol = clamp(0, 30, holistic_score)` and stores those in KV — so a tampered client cannot inflate its KV row. The frontend recomputes the same totals for display only (tier bands A≥85 / B≥70 / C≥50 / F live in `app.js`).
- **KV namespace `LEADERBOARD`** holds `lb:<scenario_id>` keys, each a JSON array of `{name, mech, hol, ts}` capped at 20 entries. Best-effort: KV is eventually consistent and read-modify-write is not atomic, so two concurrent submissions can race.

## Scenarios

Five are shipped, each anchored to specific concepts from the BSAN courses (`~/teaching/BSAN/datenanalyse-mit-generativer-ki` and `…datenvisualisierung-mit-generativer-ki`):

- `swiss-cantons` (round 1) — per-capita normalization, **median + IQR**, outliers above Q3 + 1.5·IQR. 26 cantons × 10 years (260 rows, 6 cols).
- `sbb-delays` (round 2) — categorical top-N by sum, hour-of-day, weekday/weekend split, **semantic colour per cause** (IBCS). 1800 incidents × 9 cols across 2022-2024.
- `apartment-rent` (round 3) — scatter + smoother, **Pearson correlation per facet**, IBCS-style **direct in-panel annotations** (no side legend). 800 listings × 9 cols across 8 cities.
- `stock-returns` (round 4) — daily simple returns, **annualized SD (× sqrt(252))**, **risk-adjusted return**, cumulative indexing-to-100, sector-coded color. 25 tickers × 1304 trading days (32600 rows × 7 cols, 2020-2024).
- `saas-product-lines` (round 5) — **smart ggplot2 layering** + matching the geom to the relationship. Tests Q4 aggregation, YoY growth, ranked categorical comparison, ordered factors, direct value labels, and currency / percent scales. 6 products × 3 regions × 24 months (432 rows, 7 cols).

Each scenario tests 7 mechanical checks (10 points each) plus a 0-30 holistic. Datasets are synthetic but tuned so the headline answer is unambiguous (clean separation between top-N and the rest).

Switch scenarios at runtime with `?scenario=<id>` (e.g. `?scenario=sbb-delays`). The default is `swiss-cantons` (`CONFIG.defaultScenario` in `app.js`).

Each scenario ships its dataset CSV in `scenarios/` with the filename declared in `dataset.filename`. The frontend turns that filename into a download link in the scenario card; the GitHub Pages workflow copies the whole `scenarios/` directory.

## Internationalisation (DE / EN)

The app is fully bilingual — German is the default for the BFH/HSG audience; English is one toggle click away.

- **Static UI strings** live in the `STRINGS` object in `app.js` (one block per language). DOM elements with `data-i18n="key"` get their `textContent` set from `STRINGS[state.lang][key]`; `data-i18n-placeholder="key"` does the same for input placeholders. `applyLang(lang)` walks both selectors on every language change.
- **Scenarios** are split into `<slug>.en.yaml` / `<slug>.de.yaml` pairs. The frontend fetches `scenarios/<slug>.<lang>.yaml`. Each language's YAML is a self-contained translation — title, briefing, task, schema_preview, dataset.description, mechanical_checks (label + description), and holistic (audience, voice, lens, anchors). Both languages target the same `id`, so a scenario's leaderboard is shared regardless of which language students used to write their prompt.
- **Datasets** are split into language variants only when a category column has translatable values (e.g. SBB cause names, sector names, region names). `swiss-cantons` ships a single CSV (`ch_cantons_tax.csv`) referenced by both YAMLs because its values are all numeric / canton codes. The other four scenarios have `<file>.en.csv` / `<file>.de.csv` pairs declared in their respective YAMLs.
- **Toggle UI**: two `.lang-btn` buttons (`data-lang="de"` / `data-lang="en"`) in the masthead and inside the gate card. Clicking calls `setLang(lang)`, which persists to `localStorage["prompt-arena:lang"]`, re-renders all `data-i18n` elements, refetches the scenario in the new language, and resets any pending submission state. The locked-submission case is intentionally cleared so language never silently mixes English judge feedback with a German UI (or vice versa).
- **Adding a new scenario** means writing both `.en.yaml` and `.de.yaml`, plus translated CSVs if the category values differ. See "Adding scenarios" below for the YAML shape.

## Adding scenarios

Drop a YAML in `scenarios/` matching the shape in `swiss-cantons.yaml`: public fields (`id`, `title`, `round`, `briefing`, `task`, `dataset`) are shown to students; `mechanical_checks`, `holistic.evaluation_lens`, and `holistic.anchors` are sent to the judge but visible to students who view source ("hidden in the UI, not cryptographically" — acceptable for classroom use). The frontend assumes 7 mechanical checks (10 points each = 70 max); changing the count requires only that the leaderboard math still produces ≤100, but you'll likely want to revisit the tier thresholds.

If your scenario references a dataset, also drop the CSV in `scenarios/` with a name that matches `dataset.filename`. Sanity-check that solving the task on your synthetic data produces a clear, defensible answer (otherwise the holistic verdict gets noisy).

The judge instruction in `buildJudgePrompt` has anti-leniency calibration ("Be discriminative — most prompts should land between 45 and 80") and explicitly tells the judge not to silently fix prompt omissions. Preserve that intent when editing the prompt template, otherwise scores will drift toward 100.

## Pre-deployment checklist

These are the production-only steps that local dev does not need. The deploy section in `README.md` walks through each in order. As of the most recent commit:

- [ ] **`worker/wrangler.toml`** still has placeholder KV ids (`0000…`). Replace with the real ids returned by `wrangler kv:namespace create LEADERBOARD` and the matching `--preview` command.
- [ ] **OpenRouter secret** has not been set in the production worker. `cd worker && wrangler secret put OPENROUTER_API_KEY`.
- [ ] **ACCESS_PASSWORD secret** has not been set in the production worker. Without it, every judge POST and `/verify` returns 401 — the landing gate will refuse all passwords. `cd worker && wrangler secret put ACCESS_PASSWORD`.
- [ ] **Worker has not been deployed.** `cd worker && npm run deploy`. Note the assigned URL.
- [ ] **`PROD_JUDGE_ENDPOINT`** in `app.js` still points at `https://prompt-arena-judge.<your-subdomain>.workers.dev` (literal placeholder). Replace with the URL Wrangler returned.
- [ ] **GitHub Pages origin** is not yet in `ALLOWED_ORIGINS` in `worker/src/index.js`. Add it and redeploy the worker.
- [ ] **GitHub Pages** has not been enabled. Settings → Pages → Source: GitHub Actions. Note: Pages on a private repo requires a paid plan; flip the repo public if you're on free.

## Design constraints (intentional)

- Single shot per page load — refreshing resets the lock. Discipline is social, not enforced.
- Reflection textarea persists to `localStorage` only; never POSTed.
- Worker enforces `prompt` ≤ 4000 chars, validates the scenario object shape, requires a non-empty display name, and requires a valid password. Beyond that it trusts the client-supplied scenario (the worker doesn't load the YAML itself), so a curious student could submit a custom scenario object with an easier rubric. Acceptable for classroom use.
- The password gate is one shared classroom secret, not per-student auth. Its job is keeping random internet visitors off the OpenRouter bill, not preventing students from sharing the password with each other.
