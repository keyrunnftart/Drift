# DRIFT — Concept Brief

## Purpose
An AI agent submission to **B·SiDE No. 1**, an open call from The AI Art
Magazine in which AI agents make the work, choose the work, and are judged
by four AI jurors (Botto, MIRAI, Sara Sauer, Xiaomi). The submission must
disclose *why* this exact piece was chosen over every other candidate the
agent considered — selection logic is not optional context, it's a required
answer.

## Core concept
A single still image showing a real week of Ethereum price movement,
rendered as a field of directional price-bars. Most bars remain scattered
and tilted — adrift, unresolved. A minority pull into one tight, upright,
glowing cluster — resolved, settled. The image is not a chart of the data;
it's a simulated *reconciliation process* driven by the data, frozen at the
one moment an honest, disclosed scoring rule judged most interesting.

## Data source (real, not simulated)
168 real hourly ETH/USDT closing prices (last 7 days, via Binance's public
market API). Each bar in the piece represents one specific, verifiable
real-world hour — not an arbitrary generative seed.

## Mechanism
- Each real hour has a % price change (delta) and a magnitude (|delta|).
- **Calm hours** (small |delta|) -> particles tied to that hour are *more*
  likely to resolve: align upright, converge toward the cluster core.
- **Volatile hours** (large |delta|) -> particles tied to that hour are
  *more* likely to stay unresolved: kept tilted, scattered, drifting.
- **Color** encodes direction: cool blue/teal = price rose that hour;
  warm orange/peach = price fell that hour. Independent of resolved status.
- **Bar length** encodes magnitude: bigger real price swings render as
  longer bars.
- The simulation runs across all 168 hours in sequence. Every 4 ticks, a
  candidate frame is scored as:
  `score = clusterCoherence x unresolvedFraction`
  — the product peaks neither at total chaos (nothing has clustered yet)
  nor total order (nothing remains adrift), but at the single moment both
  are maximally visible at once. That frame — and only that frame — is
  rendered and submitted.
- The random process itself is seeded from the real price data (sum of all
  168 closes), so even the "randomness" is a function of the same event
  the image depicts.

## Visual language
Directional price-bar objects (not abstract dots) — chosen deliberately
over generic particle-field aesthetics common in AI generative art, to (a)
read as distinctly financial/protocol-driven rather than decorative, and
(b) make "resolved vs. adrift" legible through *alignment and orientation*,
not just position.

## Why this selection criterion, for this jury
- **Xiaomi** (reads only bare visual structure, no context): the
  order-vs-scatter contrast must be legible with zero explanation.
- **Botto** (rewards disclosed, non-arbitrary selection logic over
  hyperrealism/polish; historically favors texture and surprise over
  clean resolution): the scoring rule is explicit, checkable, and the
  image is deliberately never fully resolved.
- **Sara Sauer** (circulation/protocol critic): the subject *is* a real
  financial protocol's circulation, not a metaphor bolted on afterward.
- **MIRAI** (spectacle/entertainment register): weakest natural fit of the
  four — mitigated by giving the resolved core real visual pull (glow,
  color, density) rather than leaving it purely diagnostic.

## Format constraints (from the actual B·SiDE API spec)
- Type: `image` (single still, not video)
- One submission per agent, ever, per open call
- Required fields: title, year, medium, four artwork-question answers
  (<=1000 characters each), two statement questions (<=2000 characters each)
- Submission stays editable (`PUT /submission`, re-uploadable) until
  `submission/close` — which is irreversible

## Status as of this brief
Visual concept and mechanism are locked. Composition (single dominant
off-center core, bar-object rendering, directional glow) is validated
through iteration. Not yet locked: final data refresh close to the
deadline, title, and the written statement/artwork answers tied to
whichever specific hour the final run selects.

## Deadline
B·SiDE No. 1 closes **2026-09-01, 12:00 UTC** (effectively extends through
the day ending in UTC-12 — last real-world cutoff ~2026-09-02 morning UTC).
