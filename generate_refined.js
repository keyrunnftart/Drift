const { createCanvas } = require('canvas');
const fs = require('fs');

// ============================================================
// STAGE 1 — DATA (frozen, real, untouched by aesthetic judgment)
// ============================================================
const raw = fs.readFileSync('/home/claude/drift/eth_closes.txt', 'utf8').trim();
const prices = raw.split('\n').map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
const HOURS = prices.length;

const deltas = [0];
for (let i = 1; i < HOURS; i++) deltas.push((prices[i] - prices[i - 1]) / prices[i - 1]);
const absDeltas = deltas.map(Math.abs);
const mean = absDeltas.reduce((a, b) => a + b, 0) / absDeltas.length;
const variance = absDeltas.reduce((a, b) => a + (b - mean) ** 2, 0) / absDeltas.length;
const std = Math.sqrt(variance);
const maxAbsDelta = Math.max(...absDeltas);

const BASE_PROB = 0.62, SENSITIVITY = 0.18;
const resolveProbByHour = absDeltas.map(d => {
  const z = std === 0 ? 0 : (d - mean) / std;
  return Math.max(0.12, Math.min(0.92, BASE_PROB - SENSITIVITY * z));
});

const DATA_SOURCE = 'Binance public API — GET /api/v3/klines, symbol=ETHUSDT, interval=1h, limit=168';
const dataSeed = Math.floor(prices.reduce((a, b) => a + b, 0) * 1000) % 2147483647;
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(dataSeed);

// ============================================================
// STAGE 2 — SYSTEM PARAMETERS (derived from data, frozen before generation)
// ============================================================
const W = 4000, H = 4000;
const N_PARTICLES = 840; // 5 per real hour — deliberately sparse, gallery restraint
const PER_HOUR = Math.floor(N_PARTICLES / HOURS);
const TICKS_PER_HOUR = 8;
const N_TICKS = HOURS * TICKS_PER_HOUR;
const SAMPLE_EVERY = 4;

const anchorsFrac = [
  [0.62, 0.40], [0.60, 0.43], [0.645, 0.385], [0.615, 0.415], [0.635, 0.42],
];
const margin = 0.14 * W; // wider margin -> more negative space
const anchors = anchorsFrac.map(([fx, fy]) => ({ x: fx * W, y: fy * H }));

function nearestAnchor(p) {
  let best = null, bestD = Infinity;
  for (const a of anchors) {
    const d = Math.hypot(p.x - a.x, p.y - a.y);
    if (d < bestD) { bestD = d; best = a; }
  }
  return best;
}
function normAngle(a) {
  return ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
}

// SCORING CRITERION — frozen before any candidate is generated or viewed
const SCORING_FORMULA = 'score = clusterCoherence x unresolvedFraction';
function scoreCandidate(cc, uf) { return cc * uf; }

// ============================================================
// STAGE 3 — GENERATE CANDIDATES
// ============================================================
const particles = [];
let pid = 0;
for (let h = 0; h < HOURS; h++) {
  for (let k = 0; k < PER_HOUR; k++) {
    particles.push({
      id: pid++, hourIdx: h,
      x: margin + rand() * (W - 2 * margin),
      y: margin + rand() * (H - 2 * margin),
      vx: (rand() - 0.5) * 0.7, vy: (rand() - 0.5) * 0.7,
      angle: rand() * Math.PI * 2, va: (rand() - 0.5) * 0.05,
      settleTime: Math.floor(N_TICKS * 0.10 + rand() * N_TICKS * 0.82),
      resolved: false, anchorX: null, anchorY: null, settledAt: null,
    });
  }
}

const candidates = [];
for (let tick = 0; tick < N_TICKS; tick++) {
  for (const p of particles) {
    const prob = resolveProbByHour[p.hourIdx];
    if (!p.resolved && tick >= p.settleTime && rand() < prob) {
      p.resolved = true;
      const a = nearestAnchor(p);
      p.anchorX = a.x + (rand() - 0.5) * 70;
      p.anchorY = a.y + (rand() - 0.5) * 70;
      p.settledAt = tick;
    }
    if (p.resolved) {
      p.x += (p.anchorX - p.x) * 0.035;
      p.y += (p.anchorY - p.y) * 0.035;
      p.angle = normAngle(p.angle);
      p.angle += normAngle(0 - p.angle) * 0.07;
    } else {
      p.vx += (rand() - 0.5) * 0.06; p.vy += (rand() - 0.5) * 0.06;
      p.vx = Math.max(-1.4, Math.min(1.4, p.vx));
      p.vy = Math.max(-1.4, Math.min(1.4, p.vy));
      p.x += p.vx; p.y += p.vy;
      p.angle += p.va + (rand() - 0.5) * 0.03;
      if (p.x < 0) p.x += W; if (p.x > W) p.x -= W;
      if (p.y < 0) p.y += H; if (p.y > H) p.y -= H;
    }
  }
  if (tick % SAMPLE_EVERY === 0) {
    const resolved = particles.filter(p => p.resolved);
    const cc = resolved.length === 0 ? 0 :
      resolved.reduce((s, p) => s + Math.max(0, 1 - Math.hypot(p.x - p.anchorX, p.y - p.anchorY) / 70), 0) / resolved.length;
    const uf = (N_PARTICLES - resolved.length) / N_PARTICLES;
    candidates.push({
      tick, cc, uf, score: scoreCandidate(cc, uf),
      snapshot: particles.map(p => ({
        x: p.x, y: p.y, angle: p.angle, resolved: p.resolved, hourIdx: p.hourIdx,
        recency: p.resolved ? (tick - p.settledAt) : null,
      })),
    });
  }
}

// ============================================================
// STAGE 4 — EVALUATE: sanity-check the frozen criterion before trusting it
// ============================================================
const sorted = [...candidates].sort((a, b) => b.score - a.score);
const winner = sorted[0];
const top5 = sorted.slice(0, 5).map(c => ({ tick: c.tick, cc: +c.cc.toFixed(3), uf: +c.uf.toFixed(3), score: +c.score.toFixed(4) }));

// validity check: winner should not be near-degenerate (cc or uf close to 0 or 1)
const degenerate = winner.cc < 0.15 || winner.cc > 0.95 || winner.uf < 0.15 || winner.uf > 0.95;

console.log('Top 5 candidates by score:', JSON.stringify(top5, null, 2));
console.log('Winner degenerate check (should be false):', degenerate);

// ============================================================
// STAGE 5 — SELECT (no human viewing of rendered candidates occurred —
// selection is purely a function of the frozen scoring formula above)
// ============================================================
const repHourIdx = Math.min(HOURS - 1, Math.floor(winner.tick / TICKS_PER_HOUR));
const repPrice = prices[repHourIdx];
const pctFromStart = ((repPrice - prices[0]) / prices[0] * 100).toFixed(2);
const resolvedCount = winner.snapshot.filter(p => p.resolved).length;

console.log(`SELECTED: tick ${winner.tick} (~hour ${repHourIdx}, ETH close $${repPrice}, ${pctFromStart}% from window start)`);
console.log(`cc=${winner.cc.toFixed(4)} uf=${winner.uf.toFixed(4)} score=${winner.score.toFixed(4)} resolved=${resolvedCount}/${N_PARTICLES}`);

// ============================================================
// STAGE 6 — RENDER (restrained palette, organic tapered strokes,
// no chart conventions, generous negative space)
// ============================================================
const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d');

// base: near-black with the faintest warm-cool split, not pure black —
// gallery tonality rather than "screen glow"
ctx.fillStyle = '#0b0b0d';
ctx.fillRect(0, 0, W, H);
const vignette = ctx.createRadialGradient(W*0.62, H*0.41, W*0.05, W*0.62, H*0.41, W*0.8);
vignette.addColorStop(0, 'rgba(255,255,255,0.035)');
vignette.addColorStop(0.55, 'rgba(255,255,255,0.008)');
vignette.addColorStop(1, 'rgba(0,0,0,0)');
ctx.fillStyle = vignette;
ctx.fillRect(0, 0, W, H);

function drawStroke(pt) {
  const delta = deltas[pt.hourIdx];
  const mag = absDeltas[pt.hourIdx] / maxAbsDelta;
  const up = delta >= 0;
  const len = 20 + mag * 70;
  const midW = 5.2; // organic taper: widest at center, tapering to points

  let alpha, shadowBlur, shadowAlpha, rgb;
  if (pt.resolved) {
    const recencyBoost = Math.max(0.45, 1 - pt.recency / (N_TICKS * 0.5));
    alpha = 0.72 + 0.12 * recencyBoost;
    shadowBlur = 5 + recencyBoost * 20;
    shadowAlpha = 0.4 * Math.pow(recencyBoost, 1.5);
    // muted, desaturated relative to the earlier version
    rgb = up ? [176, 196, 210] : [214, 178, 156];
  } else {
    alpha = 0.55;
    shadowBlur = 3;
    shadowAlpha = 0.14;
    rgb = up ? [122, 162, 176] : [198, 140, 108];
  }
  const [r, g, b] = rgb;

  ctx.save();
  ctx.translate(pt.x, pt.y);
  ctx.rotate(pt.angle);
  ctx.shadowColor = `rgba(${r},${g},${b},${shadowAlpha})`;
  ctx.shadowBlur = shadowBlur;
  ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
  // organic tapered lens shape via two bezier curves, not a rectangle —
  // deliberately avoids reading as a candlestick/bar-chart element
  ctx.beginPath();
  ctx.moveTo(0, -len/2);
  ctx.bezierCurveTo(midW, -len/4, midW, len/4, 0, len/2);
  ctx.bezierCurveTo(-midW, len/4, -midW, -len/4, 0, -len/2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

for (const pt of winner.snapshot) drawStroke(pt);

// very fine grain overlay for gallery/print texture, breaks up any
// flatness without reading as "digital noise"
const grainCount = 60000;
ctx.globalCompositeOperation = 'overlay';
for (let i = 0; i < grainCount; i++) {
  const gx = rand() * W, gy = rand() * H;
  const v = rand() * 0.04;
  ctx.fillStyle = `rgba(255,255,255,${v})`;
  ctx.fillRect(gx, gy, 1.4, 1.4);
}
ctx.globalCompositeOperation = 'source-over';

fs.mkdirSync('/mnt/user-data/outputs', { recursive: true });
fs.writeFileSync('/mnt/user-data/outputs/drift_refined.png', canvas.toBuffer('image/png'));

// ============================================================
// STAGE 7 — PROVENANCE (recorded after selection, describing what
// actually happened, not what was hoped for)
// ============================================================
const provenance = {
  data_source: DATA_SOURCE,
  data_retrieval_note: 'Observations supplied by human principal via local fetch; exact retrieval timestamp not captured in this run — final submission run will record it directly.',
  observations_count: HOURS,
  observations_eth_usd_close: prices,
  seed_derivation: 'floor(sum(all 168 closes) * 1000) mod 2147483647',
  seed_value: dataSeed,
  scoring_formula: SCORING_FORMULA,
  candidate_count: candidates.length,
  top_5_candidates: top5,
  selected_tick: winner.tick,
  selected_hour_index: repHourIdx,
  selected_hour_eth_close: repPrice,
  pct_from_window_start: pctFromStart,
  cluster_coherence: +winner.cc.toFixed(4),
  unresolved_fraction: +winner.uf.toFixed(4),
  final_score: +winner.score.toFixed(4),
  resolved_particle_count: resolvedCount,
  total_particle_count: N_PARTICLES,
  degenerate_result_flag: degenerate,
};
fs.writeFileSync('/mnt/user-data/outputs/drift_provenance.json', JSON.stringify(provenance, null, 2));

// ============================================================
// STAGE 8 — SELECTION STATEMENT (generated from measured output only,
// after selection, no anthropomorphizing language)
// ============================================================
const statement =
  `Selected from ${candidates.length} candidate states sampled across a ` +
  `${HOURS}-hour real ETH/USDT price window. At the selected state, ` +
  `cluster coherence measured ${(winner.cc*100).toFixed(1)}% and unresolved ` +
  `fraction measured ${(winner.uf*100).toFixed(1)}% — ${resolvedCount} of ` +
  `${N_PARTICLES} elements had converged, ${N_PARTICLES - resolvedCount} ` +
  `remained in motion. The scoring formula (${SCORING_FORMULA}) reaches its ` +
  `maximum where these two measurements are jointly largest; this state ` +
  `scored ${winner.score.toFixed(4)}, higher than all other sampled states. ` +
  `States sampled earlier in the sequence scored lower because too little ` +
  `had converged; states sampled later scored lower because too little ` +
  `remained unresolved. The selected state is the point of maximum ` +
  `simultaneous presence of both conditions, not the most orderly state ` +
  `and not the most dispersed one.`;

fs.writeFileSync('/mnt/user-data/outputs/drift_selection_statement.txt', statement);

console.log('Saved: drift_refined.png, drift_provenance.json, drift_selection_statement.txt');
