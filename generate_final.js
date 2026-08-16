const { createCanvas } = require('canvas');
const fs = require('fs');

// ---------- LOAD REAL DATA ----------
const raw = fs.readFileSync('/home/claude/drift/eth_closes.txt', 'utf8').trim();
const prices = raw.split('\n').map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
const HOURS = prices.length; // 168

const deltas = [0]; // hour 0 has no prior delta
for (let i = 1; i < HOURS; i++) {
  deltas.push((prices[i] - prices[i - 1]) / prices[i - 1]);
}
const absDeltas = deltas.map(Math.abs);
const mean = absDeltas.reduce((a, b) => a + b, 0) / absDeltas.length;
const variance = absDeltas.reduce((a, b) => a + (b - mean) ** 2, 0) / absDeltas.length;
const std = Math.sqrt(variance);

// resolveProb per hour: calmer hours (low |delta|) -> higher chance to settle;
// volatile hours (high |delta|) -> lower chance, more stays adrift.
const BASE_PROB = 0.62, SENSITIVITY = 0.18;
const resolveProbByHour = absDeltas.map(d => {
  const z = std === 0 ? 0 : (d - mean) / std;
  return Math.max(0.12, Math.min(0.92, BASE_PROB - SENSITIVITY * z));
});

// seed derived from the real data itself — the run's randomness is a
// function of the same prices that drive its outcome
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

// ---------- CONFIG ----------
const W = 4000, H = 4000;
const N_PARTICLES = 1400;
const TICKS_PER_HOUR = 8;
const N_TICKS = HOURS * TICKS_PER_HOUR; // 1344
const SAMPLE_EVERY = 4;

// composition: ONE dominant core only (rule of thirds), tight anchor cluster
// so there is no competing focal point
const anchorsFrac = [
  [0.62, 0.40], [0.60, 0.43], [0.645, 0.385], [0.615, 0.415], [0.635, 0.42],
];
const margin = 0.10 * W;
const anchors = anchorsFrac.map(([fx, fy]) => ({ x: fx * W, y: fy * H }));

function nearestAnchor(p) {
  let best = null, bestD = Infinity;
  for (const a of anchors) {
    const d = Math.hypot(p.x - a.x, p.y - a.y);
    if (d < bestD) { bestD = d; best = a; }
  }
  return best;
}

// ---------- PARTICLES ----------
const particles = [];
for (let i = 0; i < N_PARTICLES; i++) {
  particles.push({
    id: i,
    x: margin + rand() * (W - 2 * margin),
    y: margin + rand() * (H - 2 * margin),
    vx: (rand() - 0.5) * 0.7,
    vy: (rand() - 0.5) * 0.7,
    settleTime: Math.floor(N_TICKS * 0.12 + rand() * N_TICKS * 0.8),
    resolved: false,
    anchorX: null, anchorY: null,
    settledAt: null,
  });
}

// ---------- SIMULATE + SCORE CANDIDATES ----------
const candidates = [];
for (let tick = 0; tick < N_TICKS; tick++) {
  const hourIdx = Math.min(HOURS - 1, Math.floor(tick / TICKS_PER_HOUR));
  const prob = resolveProbByHour[hourIdx];

  for (const p of particles) {
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
    } else {
      p.vx += (rand() - 0.5) * 0.06;
      p.vy += (rand() - 0.5) * 0.06;
      p.vx = Math.max(-1.4, Math.min(1.4, p.vx));
      p.vy = Math.max(-1.4, Math.min(1.4, p.vy));
      p.x += p.vx; p.y += p.vy;
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
      tick, hourIdx, score: cc * uf, cc, uf,
      snapshot: particles.map(p => ({
        x: p.x, y: p.y, resolved: p.resolved,
        recency: p.resolved ? (tick - p.settledAt) : null,
      })),
    });
  }
}

candidates.sort((a, b) => b.score - a.score);
const winner = candidates[0];
const winnerHour = winner.hourIdx;
const winnerPrice = prices[winnerHour];
const windowStartPrice = prices[0];
const pctFromStart = ((winnerPrice - windowStartPrice) / windowStartPrice * 100).toFixed(2);

console.log(`Sampled ${candidates.length} candidates across ${HOURS} real hourly data points.`);
console.log(`Winner: tick ${winner.tick} -> real hour index ${winnerHour} (ETH close: $${winnerPrice}, ${pctFromStart}% from window start)`);
console.log(`Score ${winner.score.toFixed(4)} (clusterCoherence=${winner.cc.toFixed(3)}, unresolvedFraction=${winner.uf.toFixed(3)})`);
console.log(`Data seed: ${dataSeed}`);

// ---------- RENDER ----------
const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d');

ctx.fillStyle = '#07070a';
ctx.fillRect(0, 0, W, H);

const vignette = ctx.createRadialGradient(W*0.63, H*0.42, W*0.05, W*0.63, H*0.42, W*0.75);
vignette.addColorStop(0, 'rgba(255,255,255,0.05)');
vignette.addColorStop(0.5, 'rgba(255,255,255,0.015)');
vignette.addColorStop(1, 'rgba(0,0,0,0)');
ctx.fillStyle = vignette;
ctx.fillRect(0, 0, W, H);

// glow pass first, additive, so overlaps brighten instead of muddying
ctx.globalCompositeOperation = 'lighter';
for (const pt of winner.snapshot) {
  if (pt.resolved) {
    const recencyBoost = Math.max(0.4, 1 - pt.recency / (N_TICKS * 0.5));
    // glow shrinks and dims much faster with age, so old particles don't
    // leave wide flat halos with no visible bright center
    const glowStrength = Math.pow(recencyBoost, 1.8);
    const r = (7 + recencyBoost * 13);
    const g = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, r * 2.2);
    g.addColorStop(0, `rgba(205,224,255,${0.32 * glowStrength})`);
    g.addColorStop(1, 'rgba(200,220,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(pt.x, pt.y, r * 2.2, 0, Math.PI * 2); ctx.fill();
  } else {
    const g = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, 26);
    g.addColorStop(0, 'rgba(255,140,80,0.16)');
    g.addColorStop(1, 'rgba(255,140,80,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(pt.x, pt.y, 26, 0, Math.PI * 2); ctx.fill();
  }
}
ctx.globalCompositeOperation = 'source-over';

// core points on top, crisp
for (const pt of winner.snapshot) {
  if (pt.resolved) {
    const recencyBoost = Math.max(0.5, 1 - pt.recency / (N_TICKS * 0.5));
    // solid core dot stays clearly visible and saturated regardless of age —
    // age affects glow (above), not the point's basic legibility
    const r = 6.5 + recencyBoost * 7;
    ctx.fillStyle = `rgba(216,228,255,${0.88 + 0.1 * recencyBoost})`;
    ctx.beginPath(); ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.fillStyle = 'rgba(255,150,90,0.92)';
    ctx.beginPath(); ctx.arc(pt.x, pt.y, 7, 0, Math.PI * 2); ctx.fill();
  }
}

fs.mkdirSync('/mnt/user-data/outputs', { recursive: true });
fs.writeFileSync('/mnt/user-data/outputs/drift_final.png', canvas.toBuffer('image/png'));

fs.writeFileSync('/mnt/user-data/outputs/drift_final_log.json', JSON.stringify({
  totalCandidates: candidates.length,
  totalRealHours: HOURS,
  winnerTick: winner.tick,
  winnerHourIndex: winnerHour,
  winnerEthClose: winnerPrice,
  pctFromWindowStart: pctFromStart,
  score: winner.score,
  clusterCoherence: winner.cc,
  unresolvedFraction: winner.uf,
  dataSeed,
}, null, 2));

console.log('Saved: /mnt/user-data/outputs/drift_final.png');
