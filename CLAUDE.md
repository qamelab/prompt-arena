# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Prompt Arena is a classroom prompt-engineering exercise (BFH / HSG). Students submit one final prompt for a data-analytics scenario; an LLM judge generates the R code that prompt would elicit, simulates the output, runs binary mechanical checks, and adds a holistic editor-style verdict. Two scores are shown side-by-side on a per-browser leaderboard. No student data is collected.

## Repository layout

```
index.html, app.js, styles.css    # frontend (root, served as-is by GitHub Pages)
scenarios/*.yaml                  # scenarios fetched client-side via js-yaml
worker/                           # Cloudflare Worker (the judge proxy)
  src/index.js                    # worker entry — buildJudgePrompt + Anthropic call
  package.json                    # wrangler dev/deploy scripts only
  wrangler.toml                   # name = prompt-arena-judge, main = src/index.js
.github/workflows/deploy.yml      # builds _site/ from index.html+styles.css+app.js+scenarios/, publishes to Pages
LICENSE, .gitignore
prompt-arena.tar.gz               # snapshot of the above; redundant once the repo is initialized
```

Note: the Pages workflow deliberately copies only the four frontend artifacts into `_site/` — the worker never ships to Pages. If you add a new top-level file the frontend needs, update `.github/workflows/deploy.yml` too.

## Commands

There is no build step. Frontend is vanilla HTML/CSS/JS; `js-yaml` is loaded from a CDN. Both halves run independently.

Frontend (from repo root):
```bash
python3 -m http.server 8000        # http://localhost:8000
```

Worker (from `worker/`):
```bash
npm install
npx wrangler login
npx wrangler secret put ANTHROPIC_API_KEY    # paste sk-ant-... key
npm run dev                                   # http://localhost:8787
npm run deploy                                # production
```

There are no tests, no linter config, and no CI checks beyond the Pages deploy workflow.

## Architecture

Two halves communicate over a single `POST {scenario, prompt}` request:

- **Frontend** (`index.html` + `app.js` + `styles.css`) loads a scenario YAML client-side via `js-yaml`, renders briefing/task/schema, accepts one prompt submission, posts the *full scenario object* + prompt to the worker, and renders the returned code, simulated output, mechanical checks, and holistic verdict. State is in-memory only; the leaderboard is per-browser (seeded classmates from the YAML + "You").

- **Worker** (`index.js`, deploys as a Cloudflare Worker) is a stateless judge proxy. It receives `{scenario, prompt}`, calls `buildJudgePrompt` to assemble a four-part instruction (generate code → simulate output → score mechanical+holistic → write feedback), forwards to the Anthropic Messages API with the key from `env.ANTHROPIC_API_KEY`, strips any code fences, and returns parsed JSON. CORS is restricted via the `ALLOWED_ORIGINS` allowlist.

Key seams when changing behavior:

- **`CONFIG.judgeEndpoint`** in `app.js` must point at the deployed worker. Default is `http://localhost:8787` for local dev.
- **`ALLOWED_ORIGINS`** in the worker must include the frontend origin (e.g. GitHub Pages URL) or CORS will silently fall back to `localhost:8000`.
- **`MODEL`** in the worker (currently `claude-sonnet-4-6`) controls cost/quality. `claude-opus-4-7` for quality, `claude-haiku-4-5-20251001` for cheap/fast.
- **Scoring math lives in the frontend, not the worker.** The worker returns booleans + a 0–30 holistic; `app.js` computes `mechScore = passed * 10`, `total = min(100, mech + holistic)`, and tier bands A≥85 / B≥70 / C≥50 / F. If you change the rubric, change both the YAML's `mechanical_checks` block (so the judge instructions are updated) and verify the frontend's tier thresholds still make sense.

## Adding scenarios

Drop a YAML in `scenarios/` matching the shape in `swiss-cantons.yaml`: public fields (`briefing`, `task`, `dataset`) are shown to students; `mechanical_checks`, `holistic.evaluation_lens`, and `holistic.anchors` are sent to the judge but visible to students who view source ("hidden in the UI, not cryptographically" — acceptable for classroom use). The frontend assumes 7 mechanical checks (10 points each = 70 max); changing the count requires only that the leaderboard math still produces ≤100, but you'll likely want to revisit the tier thresholds.

The judge instruction in `buildJudgePrompt` has anti-leniency calibration ("Be discriminative — most prompts should land between 45 and 80") and explicitly tells the judge not to silently fix prompt omissions. Preserve that intent when editing the prompt template, otherwise scores will drift toward 100.

## Design constraints (intentional, from README)

- Per-browser leaderboard, no shared state. Cross-student aggregation would require KV / Durable Objects.
- Single shot per page load — refreshing resets the lock. Discipline is social, not enforced.
- Reflection textarea is local-only and never POSTed.
- Worker enforces `prompt` ≤ 4000 chars and rejects missing fields, but otherwise trusts the client-supplied scenario object (the worker doesn't load the YAML itself).
