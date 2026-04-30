# Prompt Arena · Brand Identity

The full identity system for Prompt Arena, the classroom prompt-engineering
exercise. Sibling to Litmus and dschyyra under the QAME family — same
orange-to-cyan accent palette, same DM Serif Display + IBM Plex pairing,
distinct personality.

## Quick view

Open `index.html` in any browser to see the complete brand specimen page —
hero lockup, mark variations, wordmark, colour palette, typography, and
applications. The page itself is a self-demonstration of the system.

## Concept

A chevron caught inside a ring. The chevron `>` is the universal symbol of
the prompt — every command line begins with one. The ring is the arena: the
bounded space where the prompt is judged. The orange-to-cyan gradient runs
through the chevron from input to verdict, mechanical to holistic.

The wordmark is set in DM Serif Display — the editorial voice of judgment,
balancing the technical voice of the chevron. Two halves of the brand:
input on one side, verdict on the other.

## Files

```
brand/
├── index.html              ← brand specimen (open this)
├── brand.css
├── README.md
└── logos/
    ├── mark-primary.svg    ← gradient on ink, default
    ├── mark-ink.svg        ← solid ink, single colour
    ├── mark-orange.svg     ← single-colour orange accent
    ├── mark-paper.svg      ← on dark surfaces
    ├── wordmark.svg        ← "Prompt Arena" only
    ├── lockup-horizontal.svg
    ├── lockup-vertical.svg
    ├── favicon.svg         ← simplified for 16–32px
    ├── app-icon.svg        ← 1024×1024 rounded square
    └── social-card.svg     ← Open Graph 1200×630
```

## Colour

| Role          | Hex       | RGB              |
| ------------- | --------- | ---------------- |
| Arena Orange  | `#F97316` | 249  115   22    |
| Verdict Cyan  | `#0891B2` | 8   145  178     |
| Ink           | `#0A0A0A` | 10   10   10     |
| Paper         | `#FAFAF7` | 250  250  247    |
| Soft          | `#F2F1EC` | 242  241  236    |

Gradient: linear, 90°, `#F97316` → `#0891B2`.

## Typography

- **DM Serif Display** — display, headlines, scenario titles. Regular only.
- **IBM Plex Sans** — body, UI, running text. 400 / 500 / 600.
- **IBM Plex Mono** — code, labels, technical metadata. 400 / 500.

All three available on Google Fonts. Loaded in the brand specimen via:

```html
<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet" />
```

## Mark geometry

The primary mark is constructed on a 200 × 200 grid:

- Outer circle: `cx=100 cy=100 r=88`, stroke `#0A0A0A`, stroke-width `8`, no fill
- Chevron: path `M 64 56 L 134 100 L 64 144`, stroke gradient, stroke-width `14`, `linejoin=round`, no fill

Geometry should not be modified. The 8px ring stroke and 14px chevron stroke
are calibrated against the circle's radius — changes break the optical
balance.

## Lockup spacing

- **Horizontal** — wordmark cap-height aligns to the mark's vertical centre.
  Spacing between mark and wordmark equals one chevron-width (≈ 22 grid units
  on the mark's 200-unit grid).
- **Vertical** — wordmark centred on the mark's vertical axis. Spacing
  equals two chevron-widths.

## Clear space and minimum size

- **Clear space** — at least ¼ of the mark's width on every side.
- **Minimum size** — primary mark `24px`. Below that, use `favicon.svg`
  (a simplified version with a filled background and stronger chevron).
  Wordmark minimum `14pt`.

## Don'ts

- Don't stretch the mark or wordmark.
- Don't re-colour outside the palette.
- Don't place on busy photography or low-contrast surfaces.
- Don't rotate the mark.
- Don't combine with other marks in the same lockup (use side-by-side with
  clear separation if you must show alongside another brand).
- Don't use the mark as a generic decoration — it must always reference the
  Prompt Arena product or context.

## Production notes

The wordmark SVGs reference DM Serif Display via `font-family`. This works
in browsers and any environment where the font is installed or loaded. For
print, embedding, or contexts where the font may not be available, **convert
text to outlines** before delivering:

- Inkscape: select text → `Path → Object to Path`
- Illustrator: select text → `Type → Create Outlines`
- Figma: right-click text → `Outline Stroke`

For favicons, the recommended setup uses the SVG file directly for modern
browsers plus a 32×32 PNG fallback rasterised from the SVG:

```html
<link rel="icon" type="image/svg+xml" href="logos/favicon.svg" />
<link rel="icon" type="image/png" sizes="32x32" href="logos/favicon-32.png" />
<link rel="apple-touch-icon" sizes="180x180" href="logos/app-icon-180.png" />
```

Generate the PNG fallbacks with a simple cairosvg command:

```bash
cairosvg logos/favicon.svg -W 32 -H 32 -o logos/favicon-32.png
cairosvg logos/app-icon.svg -W 180 -H 180 -o logos/app-icon-180.png
cairosvg logos/app-icon.svg -W 512 -H 512 -o logos/app-icon-512.png
```

## Family relationship

Prompt Arena sits in the QAME identity family alongside Litmus, dschyyra,
and the QAME working paper series. Family signals:

- Orange-to-cyan accent gradient
- DM Serif Display + IBM Plex pairing
- Paper-on-ink page treatment
- Geometric mark with chevron / circle / target structure
- Swiss / typographic-style layout

What's distinctive to Prompt Arena: the chevron-in-ring construction (more
sharp/competitive than Litmus's friendlier mark), the editorial weight on
the serif wordmark, and the "score" colour pairing where orange stands for
mechanical and cyan stands for holistic — these two roles reappear in the
app's scoring UI and should not be swapped or repurposed in derivative work.

## Licence

Design system © 2026 Ulrich Matter. Code released under MIT (see project
root `LICENSE`). The DM Serif Display and IBM Plex font families are open
source under the SIL Open Font License (Google Fonts).
