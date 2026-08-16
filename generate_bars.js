const { createCanvas } = require('canvas');
const fs = require('fs');

// ---------- LOAD REAL DATA ----------
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
const N_PARTICLES = 1008; // 6 per real hour — thinner peripheral field
const PER_HOUR = Math.floor(N_PARTICLES / HOURS);
const TICKS_PER_HOUR = 8;
const N_TICKS = HOURS * TICKS_PER_HOUR;
const SAMPLE_EVERY = 4;

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

function normAngle(a) {
  a = ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  return a;
}

// ---------- PARTICLES: one per (hour, replicate) pair ----------
const particles = [];
let pid = 0;
for (let h = 0; h < HOURS; h++) {
  for (let k = 0; k < PER_HOUR; k++) {
    particles.push({
      id: pid++,
      hourIdx: h,
      x: margin + rand() * (W - 2 * margin),
      y: margin + rand() * (H - 2 * margin),
      vx: (rand() - 0.5) * 0.7,
      vy: (rand() - 0.5) * 0.7,
      angle: rand() * Math.PI * 2,
      va: (rand() - 0.5) * 0.05,
      settleTime: Math.floor(N_TICKS * 0.10 + rand() * N_TICKS * 0.82),
      resolved: false,
      anchorX: null, anchorY: null, settledAt: null,
    });
  }
}

// ---------- SIMULATE ----------
const candidates = [];
for (let tick = 0; tick < N_TICKS; tick++) {
  for (const p of particles) {
    const prob = resolveProbByHour[p.hourIdx]; // each bar's own hour decides its fate
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
      p.angle += normAngle(0 - p.angle) * 0.07; // ease upright
    } else {
      p.vx += (rand() - 0.5) * 0.06;
      p.vy += (rand() - 0.5) * 0.06;
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
      tick, score: cc * uf, cc, uf,
      snapshot: particles.map(p => ({
        x: p.x, y: p.y, angle: p.angle, resolved: p.resolved,
        hourIdx: p.hourIdx,
        recency: p.resolved ? (tick - p.settledAt) : null,
      })),
    });
  }
}

candidates.sort((a, b) => b.score - a.score);
const winner = candidates[0];
const winnerHour = candidates[0].snapshot[0] ? null : null; // placeholder unused
const repHourIdx = Math.floor(winner.tick / TICKS_PER_HOUR);
const repPrice = prices[Math.min(HOURS - 1, repHourIdx)];
const pctFromStart = ((repPrice - prices[0]) / prices[0] * 100).toFixed(2);

console.log(`Sampled ${candidates.length} candidates. Winner tick ${winner.tick} (~hour ${repHourIdx}, ETH $${repPrice}, ${pctFromStart}% from window start)`);
console.log(`Score ${winner.score.toFixed(4)} (cc=${winner.cc.toFixed(3)}, uf=${winner.uf.toFixed(3)})`);

// ---------- RENDER ----------
const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d');
ctx.fillStyle = '#07070a';
ctx.fillRect(0, 0, W, H);

const vignette = ctx.createRadialGradient(W*0.62, H*0.41, W*0.05, W*0.62, H*0.41, W*0.75);
vignette.addColorStop(0, 'rgba(255,255,255,0.05)');
vignette.addColorStop(0.5, 'rgba(255,255,255,0.015)');
vignette.addColorStop(1, 'rgba(0,0,0,0)');
ctx.fillStyle = vignette;
ctx.fillRect(0, 0, W, H);

function drawBar(pt) {
  const delta = deltas[pt.hourIdx];
  const mag = absDeltas[pt.hourIdx] / maxAbsDelta;
  const up = delta >= 0;
  const barLen = 14 + mag * 80;
  const barW = 6;

  let alpha, color, shadowBlur, shadowAlpha;
  if (pt.resolved) {
    const recencyBoost = Math.max(0.45, 1 - pt.recency / (N_TICKS * 0.5));
    alpha = 0.88 + 0.1 * recencyBoost;
    shadowBlur = 6 + recencyBoost * 26;
    shadowAlpha = 0.55 * Math.pow(recencyBoost, 1.4);
    color = up ? [205, 224, 255] : [255, 205, 170];
  } else {
    alpha = 0.88;
    shadowBlur = 5;
    shadowAlpha = 0.25;
    color = up ? [140, 210, 230] : [255, 150, 90];
  }
  const [r, g, b] = color;

  ctx.save();
  ctx.translate(pt.x, pt.y);
  ctx.rotate(pt.angle);
  ctx.shadowColor = `rgba(${r},${g},${b},${shadowAlpha})`;
  ctx.shadowBlur = shadowBlur;
  ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
  const rad = 2.5;
  ctx.beginPath();
  ctx.moveTo(-barW/2 + rad, -barLen/2);
  ctx.arcTo(barW/2, -barLen/2, barW/2, -barLen/2 + rad, rad);
  ctx.lineTo(barW/2, barLen/2 - rad);
  ctx.arcTo(barW/2, barLen/2, barW/2 - rad, barLen/2, rad);
  ctx.lineTo(-barW/2 + rad, barLen/2);
  ctx.arcTo(-barW/2, barLen/2, -barW/2, barLen/2 - rad, rad);
  ctx.lineTo(-barW/2, -barLen/2 + rad);
  ctx.arcTo(-barW/2, -barLen/2, -barW/2 + rad, -barLen/2, rad);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

for (const pt of winner.snapshot) drawBar(pt);

fs.mkdirSync('/mnt/user-data/outputs', { recursive: true });
fs.writeFileSync('/mnt/user-data/outputs/drift_bars.png', canvas.toBuffer('image/png'));

fs.writeFileSync('/mnt/user-data/outputs/drift_bars_log.json', JSON.stringify({
  totalCandidates: candidates.length,
  totalRealHours: HOURS,
  winnerTick: winner.tick,
  approxHourIdx: repHourIdx,
  approxEthClose: repPrice,
  pctFromWindowStart: pctFromStart,
  score: winner.score, clusterCoherence: winner.cc, unresolvedFraction: winner.uf,
  dataSeed,
}, null, 2));

console.log('Saved: /mnt/user-data/outputs/drift_bars.png');
