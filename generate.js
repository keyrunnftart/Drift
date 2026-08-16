// DRIFT — candidate generation + selection
// Simulates N particles undergoing "reconciliation": each particle either
// finds a partner and settles into a calm, aligned cluster, or remains
// unmatched and keeps drifting. We sample many frames across the run,
// score each one by a disclosed criterion, and render only the winner.

const { createCanvas } = require('canvas');
const fs = require('fs');

// ---------- CONFIG ----------
const W = 2400, H = 2400;           // output resolution (print-safe, square)
const N_PARTICLES = 900;
const N_TICKS = 1200;               // total simulation steps
const SAMPLE_EVERY = 4;             // candidate frame every N ticks -> ~300 candidates
const SEED = 20260901;              // deterministic run, tied to the deadline date

// simple seeded RNG so the run is reproducible
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);

// ---------- PARTICLE MODEL ----------
// Each particle starts scattered. At a random tick (its "settle time"),
// if it has a nearby unclaimed partner, both pair off and drift toward
// a shared resting point (a "cluster anchor"). If not, it keeps drifting
// loosely — unresolved.
class Particle {
  constructor(id) {
    this.id = id;
    this.x = rand() * W;
    this.y = rand() * H;
    this.vx = (rand() - 0.5) * 0.6;
    this.vy = (rand() - 0.5) * 0.6;
    this.settleTime = 200 + rand() * 900; // when it becomes eligible to pair
    this.partnerId = null;
    this.resolved = false;
    this.anchorX = null;
    this.anchorY = null;
  }
}

const particles = [];
for (let i = 0; i < N_PARTICLES; i++) particles.push(new Particle(i));

// cluster anchors: a handful of attractor points representing "settled accounts"
const N_ANCHORS = 14;
const anchors = [];
for (let i = 0; i < N_ANCHORS; i++) {
  anchors.push({
    x: W * 0.15 + rand() * W * 0.7,
    y: H * 0.15 + rand() * H * 0.7,
  });
}

function nearestAnchor(p) {
  let best = null, bestD = Infinity;
  for (const a of anchors) {
    const d = Math.hypot(p.x - a.x, p.y - a.y);
    if (d < bestD) { bestD = d; best = a; }
  }
  return best;
}

// ---------- SIMULATION + CANDIDATE SCORING ----------
const candidates = [];

function step(tick) {
  for (const p of particles) {
    if (!p.resolved && tick >= p.settleTime) {
      // 65% chance it finds resolution when eligible; 35% stays adrift
      if (rand() < 0.65) {
        p.resolved = true;
        const a = nearestAnchor(p);
        p.anchorX = a.x + (rand() - 0.5) * 40;
        p.anchorY = a.y + (rand() - 0.5) * 40;
      }
    }
    if (p.resolved) {
      // ease toward its anchor, velocity damps out
      p.x += (p.anchorX - p.x) * 0.03;
      p.y += (p.anchorY - p.y) * 0.03;
      p.vx *= 0.9; p.vy *= 0.9;
    } else {
      // unresolved: keep drifting, gentle random walk, wrap at edges
      p.vx += (rand() - 0.5) * 0.05;
      p.vy += (rand() - 0.5) * 0.05;
      p.vx = Math.max(-1.2, Math.min(1.2, p.vx));
      p.vy = Math.max(-1.2, Math.min(1.2, p.vy));
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0) p.x += W; if (p.x > W) p.x -= W;
      if (p.y < 0) p.y += H; if (p.y > H) p.y -= H;
    }
  }
}

// clustering measure: average, over resolved particles, of how tightly
// they sit around their anchor (tighter = higher score, capped at 1)
function clusterCoherence() {
  const resolved = particles.filter(p => p.resolved);
  if (resolved.length === 0) return 0;
  let sum = 0;
  for (const p of resolved) {
    const d = Math.hypot(p.x - p.anchorX, p.y - p.anchorY);
    sum += Math.max(0, 1 - d / 60); // within 60px of anchor = fully "settled"
  }
  return sum / resolved.length;
}

function unresolvedFraction() {
  const unresolved = particles.filter(p => !p.resolved).length;
  return unresolved / particles.length;
}

for (let tick = 0; tick < N_TICKS; tick++) {
  step(tick);
  if (tick % SAMPLE_EVERY === 0) {
    const cc = clusterCoherence();
    const uf = unresolvedFraction();
    const score = cc * uf; // the disclosed criterion
    candidates.push({
      tick,
      clusterCoherence: cc,
      unresolvedFraction: uf,
      score,
      snapshot: particles.map(p => ({
        x: p.x, y: p.y, resolved: p.resolved,
      })),
    });
  }
}

// pick the peak
candidates.sort((a, b) => b.score - a.score);
const winner = candidates[0];

console.log(`Sampled ${candidates.length} candidate frames.`);
console.log(`Winner: tick ${winner.tick}, score ${winner.score.toFixed(4)} ` +
  `(clusterCoherence=${winner.clusterCoherence.toFixed(3)}, ` +
  `unresolvedFraction=${winner.unresolvedFraction.toFixed(3)})`);

// ---------- RENDER WINNER ----------
const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d');

// background
ctx.fillStyle = '#0a0a0c';
ctx.fillRect(0, 0, W, H);

// subtle vignette
const grad = ctx.createRadialGradient(W/2, H/2, W*0.1, W/2, H/2, W*0.7);
grad.addColorStop(0, 'rgba(255,255,255,0.03)');
grad.addColorStop(1, 'rgba(0,0,0,0)');
ctx.fillStyle = grad;
ctx.fillRect(0, 0, W, H);

for (const pt of winner.snapshot) {
  if (pt.resolved) {
    ctx.fillStyle = 'rgba(210, 225, 255, 0.85)'; // cool, settled
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 4.5, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = 'rgba(255, 150, 90, 0.9)'; // warm, unresolved
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 6, 0, Math.PI * 2);
    ctx.fill();
    // soft glow trail for drifters
    ctx.fillStyle = 'rgba(255, 150, 90, 0.15)';
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 14, 0, Math.PI * 2);
    ctx.fill();
  }
}

const outPath = '/mnt/user-data/outputs/drift.png';
fs.mkdirSync('/mnt/user-data/outputs', { recursive: true });
const buf = canvas.toBuffer('image/png');
fs.writeFileSync(outPath, buf);

// also save the candidate log (for the Q3 answer's "[N]" and honesty check)
fs.writeFileSync(
  '/mnt/user-data/outputs/drift_candidate_log.json',
  JSON.stringify({
    totalCandidates: candidates.length,
    winner: { tick: winner.tick, score: winner.score,
      clusterCoherence: winner.clusterCoherence,
      unresolvedFraction: winner.unresolvedFraction },
    seed: SEED,
  }, null, 2)
);

console.log('Saved:', outPath);
