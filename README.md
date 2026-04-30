# Prompt Arena

Classroom prompt-engineering exercise. Students are given a data-analytics
scenario and a dataset, iterate locally in RStudio with Microsoft Copilot
(or any other coding assistant) until they have a polished prompt, and submit
the final prompt here once. The app generates the R code that prompt would
elicit, simulates the output, runs binary mechanical checks, and adds a
holistic editor's verdict. Both scores are shown side-by-side on a class
leaderboard.

Built at the QAME Lab, Institute of Applied Data Science & Finance, BFH-W.
Same shape as Litmus: static frontend on GitHub Pages, Cloudflare Worker as
a stateless API proxy, no student data collected beyond a self-chosen
display name.

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

The worker (Cloudflare) and the frontend (GitHub Pages) deploy
independently. The order below matters — the frontend depends on the
worker URL, and the worker needs CORS to allow the frontend origin.

| Step | What it touches | Where it lives | Reversible? |
|:--:|---|---|:--:|
| 1 | KV namespace | Cloudflare | Yes (delete the namespace) |
| 2 | Worker secrets (OpenRouter, password) | Cloudflare | Yes (`wrangler secret delete`) |
| 3 | Worker code | Cloudflare | Yes (redeploy any earlier version) |
| 4 | `PROD_JUDGE_ENDPOINT` in `app.js` | GitHub repo | Yes (edit + push) |
| 5 | `ALLOWED_ORIGINS` in `worker/src/index.js` | Cloudflare (after redeploy) | Yes |
| 6 | GitHub Pages activation | GitHub repo settings | Yes |
| 7 | First deploy + smoke test | Pages + Cloudflare | n/a |

### 1. Create the KV namespace

The leaderboard lives in Cloudflare KV. Create both a production and a
preview namespace from inside `worker/`:

```bash
cd worker
npx wrangler kv:namespace create LEADERBOARD
npx wrangler kv:namespace create LEADERBOARD --preview
```

Each command prints an id (a 32-character hex string). Paste both into
`worker/wrangler.toml`, replacing the `0000...` placeholders:

```toml
[[kv_namespaces]]
binding    = "LEADERBOARD"
id         = "<production id>"     # used by `wrangler deploy`
preview_id = "<preview id>"        # used by `wrangler dev` if you ever run with --remote
```

The two ids are independent — the preview namespace is a separate
sandbox so dev traffic doesn't pollute the live leaderboard.

### 2. Set the worker secrets

```bash
npx wrangler secret put OPENROUTER_API_KEY    # paste your sk-or-... key
npx wrangler secret put ACCESS_PASSWORD       # the password students will type
```

Wrangler reads each secret from stdin and stores it encrypted on
Cloudflare; you cannot read either back later, only overwrite them. The
local `.dev.vars` file is for `wrangler dev` only and is gitignored.

The classroom password is the only gate between random internet visitors
and your OpenRouter bill — pick something the room will recognise (e.g.
the course code + semester, a memorable phrase from the first lecture)
but that a casual scraper won't guess.

To verify the secrets are set:

```bash
npx wrangler secret list
```

You should see `OPENROUTER_API_KEY` and `ACCESS_PASSWORD` (values are
not shown — Cloudflare cannot reveal them once stored).

### 3. Deploy the worker

```bash
npm run deploy
```

Wrangler prints the assigned URL on success, e.g.
`https://prompt-arena-judge.<your-subdomain>.workers.dev`. Note this
URL — you'll need it in step 4. A quick sanity check from the command
line:

```bash
curl -X POST https://prompt-arena-judge.<your-subdomain>.workers.dev/verify \
     -H "Content-Type: application/json" \
     -d '{"password":"the-classroom-password"}'
# → {"ok":true}    when the password matches
```

### 4. Wire the frontend to the deployed worker

Edit `app.js`, replace the placeholder in `PROD_JUDGE_ENDPOINT`:

```js
const PROD_JUDGE_ENDPOINT = "https://prompt-arena-judge.<your-subdomain>.workers.dev";
```

The page automatically uses `LOCAL_JUDGE_ENDPOINT` when served from
`localhost` / `127.0.0.1`; everywhere else (including GitHub Pages) it
uses the prod URL.

### 5. Allow the Pages origin in CORS

Edit `worker/src/index.js` and add your GitHub Pages origin to
`ALLOWED_ORIGINS`. Pages URLs follow `https://<user>.github.io` for a
user/organisation site or `https://<user>.github.io/<repo>` for a
project site — but **the origin is just protocol + host**, never the
path:

```js
const ALLOWED_ORIGINS = [
  "http://localhost:8000",          // local python http.server
  "http://localhost:5173",           // local vite, in case you ever switch
  "https://umatter.github.io",       // <-- your Pages origin
];
```

Redeploy the worker (`npm run deploy`) to pick up the change. The
worker silently falls back to `ALLOWED_ORIGINS[0]` for any origin not
on the list — if you ever see CORS errors in production, this list is
the first place to look.

### 6. Enable GitHub Pages

Repo settings → **Pages** → Source: **GitHub Actions**. The
`.github/workflows/deploy.yml` workflow builds `_site/` from
`index.html`, `styles.css`, `app.js`, and the entire `scenarios/` and
`brand/` directories, then publishes it. The worker is not part of
this build — it deploys separately via wrangler.

> **Private repo note**: Pages on private repos requires a paid GitHub
> plan. If the repo is private and you're on the free tier, flip it
> public before enabling Pages.

### 7. Push and smoke-test

```bash
git push
```

The workflow runs on every push to `main`. Watch it under the **Actions**
tab; once green, visit your Pages URL and run through the full flow:

1. Landing page shows up with the brand mark.
2. Wrong password → "That password isn't right" appears.
3. Correct password → main app appears, scenario card loads.
4. Submit a test prompt with a recognisable display name (e.g. "Smoke
   Test").
5. The result renders, and the leaderboard at the bottom shows your row.
6. Open the same URL in a second browser, enter the password, switch
   to the same scenario — your "Smoke Test" row should be visible
   without re-submitting.

If any step fails, see **Troubleshooting** below.

## Operations after deploy

Day-2 changes you'll likely want to make. Anything in `worker/`
requires a re-deploy with `npm run deploy`; anything in
`index.html` / `app.js` / `styles.css` / `scenarios/` / `brand/`
requires a `git push` (the workflow handles the rest).

### Rotate the access password

When you start a new semester, or whenever the password leaks beyond the
classroom:

```bash
cd worker
npx wrangler secret put ACCESS_PASSWORD     # type the new password
```

The change takes effect on the next request — no redeploy needed. Any
student with the old password cached in localStorage will get a 401 on
their next submission, which makes the frontend clear its cache and
bounces them back to the landing page. They'll just need to re-enter
the new password.

To force-clear the gate cache for a specific student (e.g. when
debugging together), have them open DevTools → Application → Local
Storage and delete the `prompt-arena:password` key.

### Rotate the OpenRouter key

If you regenerate the OpenRouter key (because of suspected leak, scope
change, or just hygiene):

```bash
cd worker
npx wrangler secret put OPENROUTER_API_KEY  # paste the new sk-or-... key
```

Effective immediately. No redeploy. Any in-flight request that was
already validated will complete on the old key; new requests use the
new key.

### Switch the LLM model

The model id is a constant in `worker/src/index.js`:

```js
const MODEL = "anthropic/claude-sonnet-4.5";
```

Common alternatives on OpenRouter:
- `anthropic/claude-opus-4` — slower, pricier, better at nuanced
  holistic verdicts
- `anthropic/claude-haiku-4.5` — much cheaper, often good enough for
  the mechanical checks; the holistic verdict can read flatter
- `openai/gpt-4o`, `openai/gpt-4o-mini` — different judging style;
  worth pilot-testing before a real classroom session

Edit, then `npm run deploy`. Score calibration may shift — if the new
model is more lenient, raise the anti-leniency hint in `buildJudgePrompt`
or tighten the holistic anchors in each scenario's YAML.

### Adjust `MAX_TOKENS`

```js
const MAX_TOKENS = 10000;
```

Bump this if the judge response gets truncated (you'll see "Failed:
Unexpected end of JSON input" in the UI). Lower it to save cost if your
scenarios are simpler than the shipped five. Edit + `npm run deploy`.

### Add a Pages origin

If you also serve the frontend from a custom domain or a different
GitHub user/org, add the new origin to `ALLOWED_ORIGINS` in
`worker/src/index.js` and `npm run deploy`. **Remember it's just
protocol + host**, no path — `https://example.com`, not
`https://example.com/prompt-arena/`.

### Wipe the leaderboard

Per-scenario (e.g. fresh start of a semester for one round):

```bash
cd worker
npx wrangler kv:key delete --binding=LEADERBOARD lb:swiss-cantons-tax
npx wrangler kv:key delete --binding=LEADERBOARD lb:sbb-delays
# ... etc.
```

To list everything in the namespace before deleting:

```bash
npx wrangler kv:key list --binding=LEADERBOARD
```

Wipe **all** leaderboards in one shot:

```bash
npx wrangler kv:key list --binding=LEADERBOARD --output json \
  | jq -r '.[].name' \
  | while read k; do npx wrangler kv:key delete --binding=LEADERBOARD "$k"; done
```

For local dev, `rm -rf worker/.wrangler/state/v3/kv/` resets all
leaderboards in the wrangler emulator.

### Add a new scenario

1. Drop `scenarios/new-scenario.en.yaml` AND `scenarios/new-scenario.de.yaml`
   into `scenarios/`. Both must declare the same `id` so they share
   one KV leaderboard.
2. Drop the dataset CSV(s) — one per language if any category column
   has language-specific values, otherwise a single CSV that both
   YAMLs reference. Filenames must match each YAML's `dataset.filename`.
3. (Optional) Smoke-test locally by visiting
   `http://localhost:8000/?scenario=new-scenario` with both servers
   running, and toggling DE/EN in the masthead to verify both load.
4. `git add scenarios/new-scenario.*.yaml scenarios/<your_data>*.csv`
5. `git push`. The Pages workflow picks them up automatically; no
   worker change is required because the worker validates whatever
   scenario object the client posts.

See **Authoring new scenarios** below for the YAML shape.

### Edit an existing scenario

Same flow — change the YAML or CSV, push, Pages redeploys. The
old leaderboard for that scenario id stays in KV; if the rubric
changed in a way that makes old scores incomparable, also wipe
that scenario's KV key (see above).

### Update brand assets

Drop replacement SVGs into `brand/logos/`, push. The Pages workflow
copies the entire `brand/` directory. If you add a new SVG, also
update any `<link rel>` or `og:image` references in `index.html`.

### Tail worker logs in real time

```bash
cd worker
npx wrangler tail
```

Useful when diagnosing 401s, CORS issues, or JSON-parse failures
during a live session. Each request to the worker shows up as a
line; press Ctrl-C to stop.

### Watch OpenRouter spend

OpenRouter dashboard → **Activity**. You can also set a per-key
spending cap on the OpenRouter key page so a runaway scenario can't
exceed your budget.

## Troubleshooting

**"Submissions return 401 even with the right password."** Most likely
the `ACCESS_PASSWORD` secret was never set in production. Check
`wrangler secret list` from inside `worker/` — both `OPENROUTER_API_KEY`
and `ACCESS_PASSWORD` need to appear.

**"The landing page accepts the password but the first submission fails
with `Failed: Unauthorized`."** The frontend cached an old password
from a previous deploy where the password was different. Have the
student clear `localStorage` (DevTools → Application → Storage →
`prompt-arena:password`) or just re-enter the password — a 401 from
the worker now triggers an automatic cache-clear on the next reload.

**"CORS errors in the browser console after deploy."** The Pages
origin isn't in `ALLOWED_ORIGINS` in `worker/src/index.js`. Add it,
`npm run deploy`. Origin is just protocol + host — no trailing slash,
no path.

**"`Failed: Unexpected end of JSON input` on a real submission."**
The judge response was truncated. Bump `MAX_TOKENS` in
`worker/src/index.js`, redeploy. The shipped 10000 is enough for the
five included scenarios; a much larger custom scenario might need
more.

**"Pages workflow succeeded but the page is blank or 404."** Confirm
Settings → Pages → Source is set to **GitHub Actions** (not "Deploy
from a branch"). Also check that the deploy workflow ran successfully
under the **Actions** tab.

**"Leaderboard shows seeded fake names instead of real submissions."**
Either no real submissions have landed yet (in which case the seeded
names are fallback by design) or the GET to the worker is failing.
Open DevTools → Network and look for the GET to your worker URL — a
non-200 response or a CORS error there is the culprit.

**"Old scores still appear after I changed the rubric."** The KV
entries for that scenario are stale. Wipe them with
`wrangler kv:key delete --binding=LEADERBOARD lb:<scenario-id>`.

**"`wrangler dev` fails with `Error: The package "@cloudflare/workerd-linux-64" could not be found`."**
Optional dependencies were skipped during `npm install`. From `worker/`,
`rm -rf node_modules package-lock.json && npm install --include=optional`
fixes it.

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

## Internationalisation (DE / EN)

The whole app is bilingual. German is the default for the BFH-W
audience; English is one toggle click away (top-right of the masthead
or on the landing page).

What gets translated:

- **Static UI** (masthead, callouts, button labels, status messages,
  tier names, footer): from a `STRINGS` table in `app.js`. Toggling the
  language re-renders every element marked `data-i18n` / `data-i18n-placeholder`.
- **Scenarios**: each scenario ships as `<slug>.en.yaml` and
  `<slug>.de.yaml`. Both languages target the same `id` so the
  KV-backed leaderboard is shared regardless of which language a
  student submitted in.
- **Datasets**: only translated when a column has language-dependent
  values. `swiss-cantons` uses one CSV (canton codes / numbers).
  `sbb-delays`, `apartment-rent`, `stock-returns` and
  `saas-product-lines` ship `<file>.en.csv` / `<file>.de.csv` pairs;
  each YAML's `dataset.filename` points at its own language's CSV.

Toggling the language refetches the scenario and resets any in-flight
submission so the judge feedback never mixes languages with the UI.

The default language on first load is German. The choice persists
to `localStorage` (`prompt-arena:lang`).

## Authoring new scenarios

A scenario is at minimum two YAML files (`.en.yaml` + `.de.yaml`) plus
one or two CSVs. Drop them all in `scenarios/`:

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
