# Prompt Arena

Classroom prompt-engineering exercise. Students are given a data-analytics
scenario and a dataset, iterate locally in RStudio with Microsoft Copilot
(or any other coding assistant) until they have a polished prompt, and submit
the final prompt here once. The app generates the R code that prompt would
elicit, simulates the output, runs binary mechanical checks, and adds a
holistic editor's verdict. Both scores are shown side-by-side on a class
leaderboard.

Built for BFH / HSG. Same shape as Litmus: static frontend on GitHub Pages,
Cloudflare Worker as a stateless API proxy, no student data collected beyond
a self-chosen display name.

## Architecture

```
┌────────────────┐    POST {scenario, prompt, name}   ┌──────────────────┐
│  index.html    │ ───────────────────────────────────▶  Cloudflare      │
│  styles.css    │                                    │  Worker          │
│  app.js        │ ◀── {code, checks, leaderboard} ───│  (judge)         │
│  scenarios/*   │                                    └──┬───────────┬───┘
│  brand/*       │                                       │           │
│ (GitHub Pages) │                          ┌────────────▼─┐    ┌────▼──────┐
└────────────────┘                          │  OpenRouter  │    │   KV      │
                                            │  chat-API    │    │ namespace │
                                            └──────────────┘    └───────────┘
```

Frontend is pure HTML / CSS / vanilla JS — no build step. Scenarios live in
`scenarios/*.yaml` and are loaded client-side. The worker holds the API key,
builds the judge prompt server-side from the scenario the client sends,
calls OpenRouter, and writes the resulting score to a Cloudflare KV namespace
that backs the shared class leaderboard.

## Local development

Two halves run independently. Both work without an internet connection except
for the OpenRouter API call.

**Frontend** — from the repo root:
```bash
python3 -m http.server 8000
# visit http://localhost:8000
```
The page auto-detects `localhost` and points itself at `http://localhost:8787`
for the worker.

**Worker** — from `worker/`:
```bash
npm install
cat > .dev.vars <<EOF                             # gitignored
OPENROUTER_API_KEY=sk-or-...
ACCESS_PASSWORD=your-classroom-password
EOF
npm run dev                                       # http://localhost:8787
```
For local dev, wrangler emulates KV in-process — the placeholder ids in
`wrangler.toml` are fine. The local KV state is written to
`worker/.wrangler/state/v3/kv/`; delete that directory if you want to reset
all leaderboards between sessions.

The frontend opens a landing page that asks for the password before any
prompt can be submitted. The first valid entry is cached in localStorage
so returning students go straight through.

## Deploying to production

This is the full checklist for a first deploy. The worker and the frontend
are deployed independently.

### 1. Create the KV namespace

```bash
cd worker
npx wrangler kv:namespace create LEADERBOARD
npx wrangler kv:namespace create LEADERBOARD --preview
```

Each command prints an id; paste both into `worker/wrangler.toml`, replacing
the `0000...` placeholders:

```toml
[[kv_namespaces]]
binding    = "LEADERBOARD"
id         = "<production id>"
preview_id = "<preview id>"
```

### 2. Set the secrets in production

```bash
npx wrangler secret put OPENROUTER_API_KEY    # paste your sk-or-... key
npx wrangler secret put ACCESS_PASSWORD       # the password students will type
```
The local `.dev.vars` file is for `wrangler dev` only — production reads
secrets from the deploy environment. The classroom password is the only
gate between random internet visitors and your OpenRouter bill, so pick
something the room will know but a casual scraper won't guess.

### 3. Deploy the worker

```bash
npm run deploy
```
Wrangler prints the assigned URL, e.g.
`https://prompt-arena-judge.<your-subdomain>.workers.dev`.

### 4. Wire the frontend to the deployed worker

Edit `app.js`, replace the placeholder in `PROD_JUDGE_ENDPOINT`:

```js
const PROD_JUDGE_ENDPOINT = "https://prompt-arena-judge.<your-subdomain>.workers.dev";
```

The page picks `LOCAL_JUDGE_ENDPOINT` automatically when served from
`localhost`; everywhere else it uses the prod URL.

### 5. Allow the Pages origin in CORS

Edit `worker/src/index.js`, add your GitHub Pages origin to `ALLOWED_ORIGINS`,
e.g.:

```js
const ALLOWED_ORIGINS = [
  "http://localhost:8000",
  "http://localhost:5173",
  "https://umatter.github.io",
];
```

Redeploy the worker (`npm run deploy`) to pick up the change.

### 6. Enable GitHub Pages

Settings → Pages → Source: **GitHub Actions**. The
`.github/workflows/deploy.yml` workflow builds `_site/` from `index.html`,
`styles.css`, `app.js`, and the entire `scenarios/` and `brand/` directories,
then publishes it.

> **Private repo note**: Pages on private repos requires a paid GitHub plan.
> If the repo is private and you're on a free plan, flip it public before
> enabling Pages.

### 7. Push and verify

```bash
git push
```
The workflow runs on push to `main`. Once it's green, visit your Pages URL,
submit a test prompt, and confirm the entry shows up on the leaderboard.

## Scoring model

Every submission is scored on two layers, computed server-side by the worker
and stored in KV:

- **Mechanical checks** — 7 binary pass/fail criteria specific to the scenario,
  10 points each (max 70). Defined in the scenario's `mechanical_checks` block.
- **Editor's verdict** — a flexible 0–30 holistic judgment in the voice of
  the scenario's `holistic.audience`. Anchored 0-9 (unusable) / 10-19 (rework) /
  20-26 (publish with edits) / 27-30 (publication-ready).

Total = mech + holistic, capped at 100. Tier bands (set in `app.js`):
A ≥ 85, B ≥ 70, C ≥ 50, F < 50.

The two scores are shown separately in the leaderboard so students can see
the trade-off — a verbose prompt can pass all mechanical checks and still
bomb the editor's verdict, and vice versa.

## Shipped scenarios

Five rounds, each anchored to specific concepts from the BSAN courses
(`Datenanalyse mit Generativer KI` / `Datenvisualisierung mit Generativer KI`):

| Round | Slug | Skills exercised |
|:--:|---|---|
| 1 | `swiss-cantons` | per-capita normalization; **median + IQR**; outliers above Q3 + 1.5·IQR |
| 2 | `sbb-delays` | top-N by sum; hour-of-day × weekday faceting; **semantic colour per cause** (IBCS) |
| 3 | `apartment-rent` | scatter + smoother; **Pearson correlation per facet**; **direct in-panel labels** |
| 4 | `stock-returns` | daily returns; **annualized SD** via × sqrt(252); **risk-adjusted return**; cumulative indexing-to-100 |
| 5 | `saas-product-lines` | smart ggplot2 layering; geom-fits-relationship; ranked categorical comparison; YoY growth |

Switch at runtime with `?scenario=<slug>` (default is `swiss-cantons`).

## Authoring new scenarios

Drop a new YAML in `scenarios/` and a matching CSV alongside it:

```yaml
id: my-scenario
title: My scenario title
round: 6

briefing: |
  Set the scene. Two or three sentences in second person; name the audience
  and the constraint that shapes the answer (column space, board attention,
  homepage layout, etc.).

task: |
  State the analytical task plainly. Then add a "Things to think about"
  paragraph that explains why the technique fits, names common wrong
  choices, and flags any decoy columns.

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
  # 7 checks is the canonical count (10 points each = 70 max).

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

Sanity-check that solving the task on your synthetic data produces a clear,
defensible answer (otherwise the holistic verdict gets noisy). The dataset
CSV must be in `scenarios/` with the exact filename declared in
`dataset.filename`; the frontend turns the filename into a download link.

## Brand assets

`brand/` contains the full identity system: chevron-in-ring mark, favicon,
app icon, lockups, social card, and a self-demonstrating brand specimen
page reachable at `/brand/` after deploy. Geometry and palette are
documented in `brand/README.md`. Don't restyle the mark or wordmark
without checking those notes — the proportions are calibrated.

## Design choices for v1

- **Shared leaderboard via KV.** Submissions write to a Cloudflare KV
  namespace keyed by scenario id; the GET endpoint returns the top-20 per
  scenario. The seeded names in each YAML are a fallback that disappears
  as soon as the first real submission lands.
- **Hidden rubric is hidden in the UI, not cryptographically.** The scenario
  YAML is fetched by the client. Students could peek at the source. For a
  classroom context this is fine — peeking would teach them the rubric, which
  is the goal anyway. v2 could move judging fully server-side.
- **Reflection persists to localStorage.** Optional textarea after submission,
  saved per-scenario in the browser. Never POSTed.
- **Single shot per page load.** Refreshing the page resets the lock. For a
  real classroom, that's fine — the discipline comes from the social contract
  ("submit once"), not from technical enforcement.
- **Server-authoritative scoring.** The worker recomputes mechanical and
  holistic totals before writing to KV, so a tampered client cannot inflate
  its row.
- **Shared classroom password.** The worker rejects judge submissions
  without a valid `ACCESS_PASSWORD`. The frontend opens with a landing
  page that captures the password and caches it in localStorage on
  success. The leaderboard GET is unauthenticated so spectators (and
  the gated landing page itself) can see scores without unlocking.

## License

MIT. See `LICENSE`.
