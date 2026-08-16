const { createCanvas } = require('canvas');
const fs = require('fs');

const W = 1600, H = 1600;
const N_PARTICLES = 700;
const N_TICKS = 1200;
const SAMPLE_EVERY = 4;
const SEED = 20260901;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function runSimulation(anchorPositions, margin) {
  const rand = mulberry32(SEED);
  const particles = [];
  for (let i = 0; i < N_PARTICLES; i++) {
    particles.push({
      id: i,
      x: margin + rand() * (W - 2 * margin),
      y: margin + rand() * (H - 2 * margin),
      vx: (rand() - 0.5) * 0.6,
      vy: (rand() - 0.5) * 0.6,
      settleTime: 200 + rand() * 900,
      resolved: false,
      anchorX: null,
      anchorY: null,
    });
  }
  const anchors = anchorPositions.map(([fx, fy]) => ({ x: fx * W, y: fy * H }));

  function nearestAnchor(p) {
    let best = null, bestD = Infinity;
    for (const a of anchors) {
      const d = Math.hypot(p.x - a.x, p.y - a.y);
      if (d < bestD) { bestD = d; best = a; }
    }
    return best;
  }

  const candidates = [];
  for (let tick = 0; tick < N_TICKS; tick++) {
    for (const p of particles) {
      if (!p.resolved && tick >= p.settleTime && rand() < 0.65) {
        p.resolved = true;
        const a = nearestAnchor(p);
        p.anchorX = a.x + (rand() - 0.5) * 36;
        p.anchorY = a.y + (rand() - 0.5) * 36;
        p.settledAt = tick;
      }
      if (p.resolved) {
        p.x += (p.anchorX - p.x) * 0.035;
        p.y += (p.anchorY - p.y) * 0.035;
      } else {
        p.vx += (rand() - 0.5) * 0.05;
        p.vy += (rand() - 0.5) * 0.05;
        p.vx = Math.max(-1.2, Math.min(1.2, p.vx));
        p.vy = Math.max(-1.2, Math.min(1.2, p.vy));
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0) p.x += W; if (p.x > W) p.x -= W;
        if (p.y < 0) p.y += H; if (p.y > H) p.y -= H;
      }
    }
    if (tick % SAMPLE_EVERY === 0) {
      const resolved = particles.filter(p => p.resolved);
      const cc = resolved.length === 0 ? 0 :
        resolved.reduce((s, p) => s + Math.max(0, 1 - Math.hypot(p.x - p.anchorX, p.y - p.anchorY) / 55), 0) / resolved.length;
      const uf = (N_PARTICLES - resolved.length) / N_PARTICLES;
      candidates.push({
        tick, score: cc * uf, cc, uf,
        snapshot: particles.map(p => ({ x: p.x, y: p.y, resolved: p.resolved, settledAt: p.settledAt || 0 })),
      });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0];
}

function render(winner, opts) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#08080a';
  ctx.fillRect(0, 0, W, H);

  const grad = ctx.createRadialGradient(W/2, H/2, W*0.05, W/2, H/2, W*0.75);
  grad.addColorStop(0, 'rgba(255,255,255,0.04)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  for (const pt of winner.snapshot) {
    if (pt.resolved) {
      const r = opts.resolvedSize;
      if (opts.glow) {
        const g = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, r * 4);
        g.addColorStop(0, 'rgba(200,220,255,0.35)');
        g.addColorStop(1, 'rgba(200,220,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(pt.x, pt.y, r * 4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = 'rgba(215, 228, 255, 0.9)';
      ctx.beginPath(); ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2); ctx.fill();
    } else {
      const r = opts.unresolvedSize;
      if (opts.glow) {
        const g = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, r * 4.5);
        g.addColorStop(0, 'rgba(255,140,80,0.4)');
        g.addColorStop(1, 'rgba(255,140,80,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(pt.x, pt.y, r * 4.5, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = 'rgba(255, 150, 90, 0.95)';
      ctx.beginPath(); ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2); ctx.fill();
    }
  }
  return canvas;
}

// --- Variant A: fewer, larger, deliberately placed clusters + glow ---
const anchorsA = [[0.28,0.32],[0.72,0.26],[0.5,0.55],[0.25,0.72],[0.75,0.7]];
const winnerA = runSimulation(anchorsA, 220);
const canvasA = render(winnerA, { resolvedSize: 7, unresolvedSize: 6, glow: true });

// --- Variant B: single dominant cluster off-center (rule of thirds), rest drifting ---
const anchorsB = [[0.66,0.38],[0.6,0.42],[0.7,0.35]]; // tight group = one dominant mass
const winnerB = runSimulation(anchorsB, 180);
const canvasB = render(winnerB, { resolvedSize: 6.5, unresolvedSize: 5.5, glow: true });

// --- Variant C: many small clusters, denser field, smaller/more numerous points, less glow (more "data-like" / Sara-Sauer-protocol reading) ---
const anchorsC = [[0.2,0.2],[0.5,0.18],[0.8,0.22],[0.22,0.5],[0.5,0.5],[0.78,0.5],[0.2,0.8],[0.5,0.82],[0.8,0.8]];
const winnerC = runSimulation(anchorsC, 160);
const canvasC = render(winnerC, { resolvedSize: 4.5, unresolvedSize: 4, glow: false });

fs.mkdirSync('/mnt/user-data/outputs', { recursive: true });
fs.writeFileSync('/mnt/user-data/outputs/variant_A.png', canvasA.toBuffer('image/png'));
fs.writeFileSync('/mnt/user-data/outputs/variant_B.png', canvasB.toBuffer('image/png'));
fs.writeFileSync('/mnt/user-data/outputs/variant_C.png', canvasC.toBuffer('image/png'));

// --- side-by-side comparison grid ---
const gridCanvas = createCanvas(W * 3 + 40, H + 20);
const gctx = gridCanvas.getContext('2d');
gctx.fillStyle = '#000'; gctx.fillRect(0, 0, gridCanvas.width, gridCanvas.height);
gctx.drawImage(canvasA, 0, 10);
gctx.drawImage(canvasB, W + 20, 10);
gctx.drawImage(canvasC, W * 2 + 40, 10);
fs.writeFileSync('/mnt/user-data/outputs/variants_grid.png', gridCanvas.toBuffer('image/png'));

console.log('A:', winnerA.tick, winnerA.score.toFixed(4));
console.log('B:', winnerB.tick, winnerB.score.toFixed(4));
console.log('C:', winnerC.tick, winnerC.score.toFixed(4));
