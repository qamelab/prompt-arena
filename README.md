# Prompt Arena

Classroom prompt-engineering exercise. Students are given a data-analytics
scenario and a dataset; they iterate locally in RStudio with Microsoft Copilot
(or any other coding assistant) until they have a polished prompt; they submit
the final prompt here once. The app generates the R code that prompt would
elicit, simulates the output, runs binary mechanical checks against the code,
and adds a holistic editor's verdict. Both scores are shown side-by-side on a
class leaderboard.

Built for BFH / HSG. Same shape as Litmus: static frontend on GitHub Pages,
Cloudflare Worker as a stateless API proxy, no student data collected.

## Architecture

```
┌────────────────┐    POST {scenario, prompt}    ┌──────────────────┐
│  index.html    │ ─────────────────────────────▶│  Cloudflare      │
│  styles.css    │                               │  Worker          │
│  app.js        │ ◀─── {code, checks, ...} ─────│  (judge)         │
│  scenarios/*   │                               └────────┬─────────┘
│ (GitHub Pages) │                                        │
└────────────────┘                              ┌─────────▼────────┐
                                                │  OpenRouter API  │
                                                └──────────────────┘
```

Frontend is pure HTML/CSS/vanilla-JS — no build step. Scenarios live in
`scenarios/*.yaml` and are loaded client-side. The worker holds the API key
and builds the judge prompt server-side from the scenario the client sends.

## Quick start

### 1. Worker (judge proxy)

```bash
cd worker
npm install
npx wrangler login
npx wrangler secret put OPENROUTER_API_KEY   # paste your sk-or-... key
npm run dev                                   # local: http://localhost:8787
# or
npm run deploy                                # production
```

After deploy, note the worker URL (e.g. `https://prompt-arena-judge.<your-subdomain>.workers.dev`).

### 2. Frontend

Edit `app.js`, set `CONFIG.judgeEndpoint` to the deployed worker URL.

Edit `worker/src/index.js`, add your GitHub Pages origin to `ALLOWED_ORIGINS`
(e.g. `"https://umatter.github.io"`), then redeploy the worker.

For local development, just serve the directory:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

For production, push to GitHub and enable Pages on the `main` branch root.
The `.github/workflows/deploy.yml` workflow is also included if you'd rather
deploy from a `dist/` build later.

## Scoring model

Every submission is scored on two layers:

- **Mechanical checks** — 7 binary pass/fail criteria specific to the scenario,
  10 points each (max 70). Defined in the scenario's `mechanical_checks` block.
- **Editor's verdict** — a flexible 0–30 holistic judgment in the voice of
  the scenario's `holistic.audience`. Anchored 0-9 (unusable) / 10-19 (rework) /
  20-26 (publish with edits) / 27-30 (publication-ready).

Total = mech + holistic, capped at 100. Tiers: A ≥ 85, B ≥ 70, C ≥ 50, F < 50.

The two scores are shown separately in the leaderboard so students can see the
trade-off — a verbose prompt can pass all mechanical checks and still bomb the
editor's verdict, and vice versa.

## Authoring new scenarios

Drop a new YAML file in `scenarios/`:

```yaml
id: my-scenario
title: My scenario title
round: 2

briefing: |
  Set the scene. One short paragraph in second person.
task: |
  State the analytical task plainly. One paragraph.

dataset:
  filename: my_data.csv
  rows: 200
  schema_preview: |
    col1  col2  col3
    ...
  description: |
    Description fed to the judge. Be precise.

mechanical_checks:
  - key: short_snake_case
    label: Short label shown to students
    description: Precise instruction to the judge for what passes
  # ... 5–8 checks total work well

holistic:
  audience: who is the consumer of the output
  voice: how should the judge speak in feedback
  evaluation_lens:
    - bullet of what to consider
  anchors:
    "0-9":   description
    "10-19": description
    "20-26": description
    "27-30": description

leaderboard_seed:
  - {name: "...", mech: 60, hol: 27}
```

Switch scenarios at runtime with `?scenario=my-scenario` in the URL.

## Design choices for v1

A few intentional limits in this first version:

- **Per-browser leaderboard.** Each student sees the seeded classmates plus
  their own score. No cross-student aggregation. v2 would add session-based
  shared state via Worker KV or Durable Objects if needed.
- **Hidden rubric is hidden in the UI, not cryptographically.** The scenario
  YAML is fetched by the client. Students *could* peek at the source. For a
  classroom context this is fine — peeking would teach them the rubric, which
  is the goal anyway. v2 could move judging fully server-side.
- **Reflection is local only.** Optional textarea after submission, saved to
  the page state. No persistence. If you want to collect reflections for a
  teaching note, v2 could POST them to a separate write-only endpoint.
- **Single shot per page load.** Refreshing the page resets the lock. For a
  real classroom, that's fine — the discipline comes from the social contract
  ("submit once"), not from technical enforcement.

## License

MIT. See `LICENSE`.
