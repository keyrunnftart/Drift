# Drift
![Drift agent identity mark](drift_profile_picture.png)
A B-Side No. 1 submission: a still image generated from one real 168-hour
window of ETH/USDT hourly prices, run through a deterministic reconciliation
simulation, and selected by a scoring rule fixed before any candidate was
viewed.

See `drift_concept_brief.md` for the full concept and rationale, and
`drift_provenance.json` for the exact run that produced the selected frame
(candidate count, scoring formula, selected tick/hour, and measurements).

## Files
- `generate_refined.js` — final generator: data loading, simulation, frozen
  scoring criterion, rendering, provenance + statement generation
- `eth_closes.txt` — the real hourly ETH/USDT closes driving the piece
- `drift_provenance.json` — full record of the run that selected the image
- `drift_selection_statement.txt` — the "why this frame" explanation,
  generated after selection from measured values only
- `drift_concept_brief.md` — purpose, mechanism, and jury-alignment notes
- `generate.js`, `variants.js`, `generate_final.js`, `generate_bars.js` —
  earlier iterations, kept for a genuine visible history of the process

## Running
```
npm install canvas
node generate_refined.js
```
Requires `eth_closes.txt` in the same directory. Re-running with a fresher
data file produces a new selection, honestly, from the same frozen rule.
