/**
 * Cosmic intro engine — pure Canvas 2D, no React.
 * Every particle's position is a closed-form function of time t, except nothing: even the burst is analytic.
 */
import { T, phaseIndexAt } from "./timeline";
import {
  brainPoints,
  diamondPoints,
  handshakePoints,
  mulberry32,
  pick,
  shuffle,
  textPoints,
  type Pt,
  type Pt3,
} from "./shapes";

export interface IntroHandle {
  destroy(): void;
  skip(): void;
}

export interface IntroOptions {
  displayFont: string;
  monoFont: string;
  startAt?: number;
  onPhase?: (index: number) => void;
  onTick?: (t: number, fps: number) => void;
  onComplete?: () => void;
}

type Spine = { p: [Pt, Pt, Pt, Pt]; rays: number; turns: number; amp: number; hue: number };

interface Particle {
  side: 0 | 1;
  sp: Spine;
  k: number;
  rel: number;
  v: number;
  tx: number;
  ty: number;
  gx: number;
  gy: number;
  hx: number;
  hy: number;
  ms: number;
  jx: number;
  jy: number;
  r0: number;
  th0: number;
  ds: number;
  dx: number;
  dy: number;
  dz: number;
  bj: number;
  bs: number;
  size: number;
  ph: number;
  hue: number;
  // per-frame output
  x: number;
  y: number;
  a: number;
  h: number;
  light: 0 | 1;
  sz: number;
  px: number;
  py: number;
}

interface Star {
  r: number;
  a0: number;
  size: number;
  tw: number;
  ph: number;
  base: number;
}

const TAU = Math.PI * 2;
const D1 = 1.2; // spiral into the neck
const D2 = 0.95; // neck → diamond
const TILT = 0.38;
const TC = Math.cos(TILT);
const TS = Math.sin(TILT);
const HUES = 24;
const ALPHAS = 5;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, v: number) => {
  const x = clamp01((v - a) / (b - a));
  return x * x * (3 - 2 * x);
};
const easeIO = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpHue = (a: number, b: number, t: number) => {
  const d = ((b - a + 540) % 360) - 180;
  return (a + d * t + 360) % 360;
};

export function createCosmicIntro(canvas: HTMLCanvasElement, opts: IntroOptions): IntroHandle {
  const maybeCtx = canvas.getContext("2d");
  const scene = document.createElement("canvas");
  const maybeS = scene.getContext("2d");
  const b1 = document.createElement("canvas");
  const b2 = document.createElement("canvas");
  const maybeB1 = b1.getContext("2d");
  const maybeB2 = b2.getContext("2d");
  if (!maybeCtx || !maybeS || !maybeB1 || !maybeB2) return { destroy() {}, skip() {} };
  const ctx = maybeCtx;
  const sctx = maybeS;
  const b1ctx = maybeB1;
  const b2ctx = maybeB2;

  const styles: string[] = [];
  for (let l = 0; l < 2; l++)
    for (let h = 0; h < HUES; h++)
      for (let a = 1; a <= ALPHAS; a++)
        styles.push(`hsla(${h * (360 / HUES) + 7},95%,${l ? 88 : 64}%,${(a / ALPHAS).toFixed(2)})`);
  const buckets: Particle[][] = styles.map(() => []);

  let W = 0;
  let H = 0;
  let dpr = 1;
  let S = 0;
  let C: Pt = { x: 0, y: 0 };
  let DC: Pt = { x: 0, y: 0 };
  let N: Pt = { x: 0, y: 0 };
  let D = 0;
  let groups: [Pt, Pt] = [C, C];
  let labelOff: [number, number] = [0, 0];
  let spines: Spine[] = [];
  let parts: Particle[] = [];
  let links: [Particle, Particle, number][] = [];
  let stars: Star[] = [];
  let nebula: HTMLCanvasElement | null = null;

  let t = opts.startAt ?? 0;
  let last = 0;
  let fps = 60;
  let raf = 0;
  let destroyed = false;
  let completed = false;
  let phase = -1;
  let sceneCleared = false;
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;

  const R = { x: 0, y: 0, depth: 0 };
  const Q = { x: 0, y: 0, z: 0 };
  const B = { x: 0, y: 0, tx: 0, ty: 0 };

  function bez(sp: Spine, s: number) {
    const [a, b, c, d] = sp.p;
    const u = 1 - s;
    const w0 = u * u * u;
    const w1 = 3 * u * u * s;
    const w2 = 3 * u * s * s;
    const w3 = s * s * s;
    B.x = w0 * a.x + w1 * b.x + w2 * c.x + w3 * d.x;
    B.y = w0 * a.y + w1 * b.y + w2 * c.y + w3 * d.y;
    const d0 = 3 * u * u;
    const d1 = 6 * u * s;
    const d2 = 3 * s * s;
    B.tx = d0 * (b.x - a.x) + d1 * (c.x - b.x) + d2 * (d.x - c.x);
    B.ty = d0 * (b.y - a.y) + d1 * (c.y - b.y) + d2 * (d.y - c.y);
  }

  /** Helix braid around a Bézier spine: P(s) = B(s) + A(s)·sin θ·N̂(s). */
  function rayPos(sp: Spine, k: number, s: number, time: number) {
    bez(sp, s);
    const len = Math.hypot(B.tx, B.ty) || 1;
    const nx = -B.ty / len;
    const ny = B.tx / len;
    const theta = TAU * sp.turns * s - time * 1.8 + (TAU * k) / sp.rays;
    const amp = sp.amp * (0.25 + 0.75 * Math.sin(Math.PI * s));
    const off = amp * Math.sin(theta);
    R.x = B.x + nx * off;
    R.y = B.y + ny * off;
    R.depth = Math.cos(theta);
  }

  function diamondXY(p: Particle, rc: number, rs: number, pulse: number) {
    const x1 = p.dx * rc + p.dz * rs;
    const z1 = -p.dx * rs + p.dz * rc;
    const y2 = p.dy * TC - z1 * TS;
    const z2 = p.dy * TS + z1 * TC;
    const s = 3.4 / (3.4 + z2);
    Q.x = DC.x + x1 * s * D * pulse;
    Q.y = DC.y + y2 * s * D * pulse;
    Q.z = z2;
  }

  function build() {
    const rect = canvas.getBoundingClientRect();
    W = Math.max(1, rect.width);
    H = Math.max(1, rect.height);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    scene.width = canvas.width;
    scene.height = canvas.height;
    b1.width = Math.max(1, Math.round(canvas.width / 4));
    b1.height = Math.max(1, Math.round(canvas.height / 4));
    b2.width = Math.max(1, Math.round(canvas.width / 12));
    b2.height = Math.max(1, Math.round(canvas.height / 12));
    sceneCleared = false;

    const rand = mulberry32(20261120);
    S = Math.min(W, H);
    const landscape = W / H > 1.05;
    C = { x: W / 2, y: H / 2 };
    const L: Pt = landscape ? { x: W * 0.27, y: H * 0.5 } : { x: W * 0.5, y: H * 0.29 };
    const Rr: Pt = landscape ? { x: W * 0.73, y: H * 0.5 } : { x: W * 0.5, y: H * 0.69 };
    groups = [L, Rr];
    const wordW = landscape ? Math.min(W * 0.36, 640) : Math.min(W * 0.86, 520);
    const brainSize = landscape ? Math.min(W * 0.27, H * 0.55, 480) : Math.min(W * 0.62, H * 0.3);
    labelOff = [wordW * 0.13 + 26, brainSize * 0.5 + 22];
    const handSize = landscape ? Math.min(S * 0.8, 640) : Math.min(W * 0.92, 520);
    D = Math.min(S * 0.24, 220);
    DC = { x: C.x, y: C.y - 0.26 * D };
    N = { x: C.x, y: DC.y - 0.42 * D };
    const density = W * H > 700000 ? 1 : 0.62;
    const NL = Math.round(2000 * density);
    const NR = Math.round(2200 * density);

    spines = landscape
      ? [
          {
            p: [
              { x: -0.06 * W, y: 1.02 * H },
              { x: 0.04 * W, y: 0.22 * H },
              { x: 0.16 * W, y: 0.95 * H },
              L,
            ],
            rays: 7,
            turns: 2.6,
            amp: S * 0.045,
            hue: 42,
          },
          {
            p: [
              { x: 1.06 * W, y: -0.02 * H },
              { x: 0.96 * W, y: 0.78 * H },
              { x: 0.86 * W, y: 0.08 * H },
              Rr,
            ],
            rays: 3,
            turns: 1.7,
            amp: S * 0.06,
            hue: 192,
          },
        ]
      : [
          {
            p: [
              { x: -0.1 * W, y: -0.05 * H },
              { x: 0.6 * W, y: 0.02 * H },
              { x: 0.1 * W, y: 0.2 * H },
              L,
            ],
            rays: 7,
            turns: 2.6,
            amp: S * 0.05,
            hue: 42,
          },
          {
            p: [
              { x: 1.1 * W, y: 1.05 * H },
              { x: 0.4 * W, y: 0.98 * H },
              { x: 0.95 * W, y: 0.82 * H },
              Rr,
            ],
            rays: 3,
            turns: 1.7,
            amp: S * 0.065,
            hue: 192,
          },
        ];

    const word = textPoints("BUSINESS", opts.displayFont, wordW, 2);
    const nEdge = Math.round(NL * 0.55);
    const wordPts = [...pick(word.edge, nEdge, rand), ...pick(word.fill, NL - nEdge, rand)];
    const brainPts = brainPoints(NR, brainSize, rand);
    const hands = handshakePoints(handSize, 2);
    const lEdge = Math.round(NL * 0.7);
    const rEdge = Math.round(NR * 0.7);
    const leftHand = [...pick(hands.left.edge, lEdge, rand), ...pick(hands.left.core, NL - lEdge, rand)];
    const rightHand = [
      ...pick(hands.right.edge, rEdge, rand),
      ...pick(hands.right.core, NR - rEdge, rand),
    ];
    const wordMinX = -wordW / 2;
    const handC: Pt = { x: C.x, y: C.y - handSize * 0.02 };

    parts = [];
    const mk = (side: 0 | 1, target: Pt, hand: Pt): Particle => {
      const sp = spines[side] as Spine;
      const g = groups[side];
      let rel: number;
      if (side === 0) {
        const nx = clamp01((target.x - wordMinX) / wordW);
        rel = lerp(T.releaseStart, T.releaseEnd, 0.65 * nx + 0.35 * rand());
      } else {
        const nd = clamp01(Math.hypot(target.x, target.y) / (brainSize * 0.55));
        rel = lerp(T.releaseStart + 0.4, T.releaseEnd + 0.2, 0.5 * rand() + 0.5 * nd);
      }
      const gauss = () => (rand() + rand() + rand() - 1.5) / 1.5;
      return {
        side,
        sp,
        k: Math.floor(rand() * sp.rays),
        rel,
        v: 0.26 + rand() * 0.1,
        tx: g.x + target.x,
        ty: g.y + target.y,
        gx: g.x,
        gy: g.y,
        hx: handC.x + hand.x,
        hy: handC.y + hand.y,
        ms: T.morph + rand() * 0.7,
        jx: gauss() * S * 0.09,
        jy: gauss() * S * 0.09,
        r0: 0,
        th0: 0,
        ds: 0,
        dx: 0,
        dy: 0,
        dz: 0,
        bj: (rand() - 0.5) * 0.6,
        bs: S * (0.4 + Math.pow(rand(), 1.8) * 2.4),
        size: 1 + rand() * 1.25,
        ph: rand() * TAU,
        hue: sp.hue + (rand() - 0.5) * 14,
        x: 0,
        y: 0,
        a: 0,
        h: 0,
        light: 0,
        sz: 1,
        px: NaN,
        py: NaN,
      };
    };
    wordPts.forEach((p, i) => parts.push(mk(0, p, leftHand[i] ?? { x: 0, y: 0 })));
    brainPts.forEach((p, i) => parts.push(mk(1, p, rightHand[i] ?? { x: 0, y: 0 })));

    // Drain order: closest to the neck drains first, like water at a bottle neck.
    let rmax = 1;
    for (const p of parts) {
      p.r0 = Math.max(1, Math.hypot(p.hx - N.x, p.hy - N.y));
      p.th0 = Math.atan2(p.hy - N.y, p.hx - N.x);
      rmax = Math.max(rmax, p.r0);
    }
    for (const p of parts) p.ds = T.drain + (p.r0 / rmax) * 1.0 + rand() * 0.25;

    // First particles through the neck settle at the bottom of the diamond: it fills like liquid.
    const dpts: Pt3[] = diamondPoints(parts.length, rand).sort((a, b) => b.y - a.y);
    const byDrain = parts.slice().sort((a, b) => a.ds - b.ds);
    byDrain.forEach((p, i) => {
      const d = dpts[i] ?? { x: 0, y: 0, z: 0 };
      p.dx = d.x;
      p.dy = d.y;
      p.dz = d.z;
    });

    // Neural links between nearby brain particles.
    links = [];
    const brain = parts.filter((p) => p.side === 1);
    if (brain.length > 2) {
      for (let i = 0; i < 130; i++) {
        const a = brain[Math.floor(rand() * brain.length)] as Particle;
        let best: Particle | null = null;
        let bd = Infinity;
        for (let c = 0; c < 50; c++) {
          const b = brain[Math.floor(rand() * brain.length)] as Particle;
          const d = Math.hypot(a.tx - b.tx, a.ty - b.ty);
          if (d > brainSize * 0.04 && d < brainSize * 0.18 && d < bd) {
            bd = d;
            best = b;
          }
        }
        if (best) links.push([a, best, rand()]);
      }
    }

    // Stars on a disc wide enough to cover the corners while rotating.
    const diag = Math.hypot(W, H);
    stars = shuffle(
      Array.from({ length: Math.round(320 * density) }, () => ({
        r: Math.sqrt(rand()) * diag * 0.56,
        a0: rand() * TAU,
        size: 0.4 + Math.pow(rand(), 3) * 1.6,
        tw: 0.6 + rand() * 2.4,
        ph: rand() * TAU,
        base: 0.25 + rand() * 0.7,
      })),
      rand,
    );

    // Nebula, rendered once at half resolution.
    const nb = document.createElement("canvas");
    nb.width = Math.max(1, Math.round(W / 2));
    nb.height = Math.max(1, Math.round(H / 2));
    const n = nb.getContext("2d");
    if (n) {
      n.scale(0.5, 0.5);
      n.fillStyle = "#03050c";
      n.fillRect(0, 0, W, H);
      const blob = (x: number, y: number, r: number, c: string) => {
        const g = n.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, c);
        g.addColorStop(1, "rgba(0,0,0,0)");
        n.fillStyle = g;
        n.fillRect(0, 0, W, H);
      };
      blob(W * 0.5, H * 0.5, S * 0.9, "rgba(30,60,140,0.16)");
      blob(W * 0.16, H * 0.72, S * 0.7, "rgba(255,160,60,0.09)");
      blob(W * 0.84, H * 0.26, S * 0.7, "rgba(40,200,230,0.09)");
      blob(W * 0.7, H * 0.85, S * 0.5, "rgba(20,120,160,0.06)");
      for (let i = 0; i < 1400 * density; i++) {
        n.fillStyle = `rgba(200,215,255,${(0.03 + rand() * 0.12).toFixed(3)})`;
        n.fillRect(rand() * W, rand() * H, 0.8, 0.8);
      }
    }
    nebula = nb;
  }

  function update(
    p: Particle,
    f: {
      rc: number;
      rs: number;
      pulse: number;
      brc: number;
      brs: number;
      bpulse: number;
      flare: number;
      breath: number;
      drift: number;
      fadeIn: number;
      tick: number;
    },
  ) {
    p.light = 0;
    p.sz = 1;
    p.h = p.hue;

    if (t < p.ds) {
      // Formation along twisting rays.
      const s = 0.82 + (t - p.rel) * p.v;
      if (s < 0) {
        p.a = 0;
        return;
      }
      let x = p.tx + Math.sin(t * 1.3 + p.ph) * 0.7;
      let y = p.ty + Math.cos(t * 1.1 + p.ph * 1.7) * 0.7;
      let a = 1;
      if (t < p.rel + 0.9) {
        rayPos(p.sp, p.k, Math.min(s, 1), t);
        const e = t < p.rel ? 0 : easeIO((t - p.rel) / 0.9);
        x = lerp(R.x, x, e);
        y = lerp(R.y, y, e);
        a = lerp((0.45 + 0.55 * (R.depth * 0.5 + 0.5)) * smooth(0, 0.05, s), 1, e);
        if (e < 0.3 && R.depth > 0.7) p.light = 1;
      }
      x += (C.x - p.gx) * f.drift;
      y += (C.y - p.gy) * f.drift;
      a *= f.fadeIn;

      if (t >= p.ms) {
        // Convergence: quadratic Bézier through the light at the centre.
        const m = easeIO(clamp01((t - p.ms) / 2.3));
        const bx = C.x + (p.hx - C.x) * f.breath;
        const by = C.y + (p.hy - C.y) * f.breath;
        const cx = lerp((x + bx) / 2, C.x, 0.6) + p.jx;
        const cy = lerp((y + by) / 2, C.y, 0.6) + p.jy;
        const u = 1 - m;
        x = u * u * x + 2 * u * m * cx + m * m * bx;
        y = u * u * y + 2 * u * m * cy + m * m * by;
        a = 1;
        p.sz = 1 + 0.35 * f.flare;
        if (f.flare > 0.5 && ((p.ph * 1000) | 0) % 3 === 0) p.light = 1;
      }
      p.x = x;
      p.y = y;
      p.a = a;
      return;
    }

    if (t < p.ds + D1) {
      // Vortex: angular speed grows as the radius shrinks (ω ∝ 1/r²).
      const u = clamp01((t - p.ds) / D1);
      const e = u * u * (3 - 2 * u);
      const rr = p.r0 * (1 - e);
      const th = p.th0 + 2.6 * (1 / (rr / p.r0 + 0.12) - 1 / 1.12);
      const flat = 1 - 0.5 * smooth(0, 0.6, u);
      p.x = N.x + Math.cos(th) * rr;
      p.y = N.y + Math.sin(th) * rr * flat;
      p.a = 0.85;
      p.sz = 1 - 0.3 * e;
      if (u > 0.78) p.light = 1;
      return;
    }

    const prism = (Math.atan2(p.dz, p.dx) / TAU) * 360 + t * 50 + p.dy * 80 + 720;
    if (t < T.burst) {
      // Pour through the neck into the rotating crystal.
      const u = clamp01((t - p.ds - D1) / D2);
      const e = easeIO(u);
      diamondXY(p, f.rc, f.rs, f.pulse);
      p.x = lerp(N.x, Q.x, e) + Math.sin(Math.PI * u) * p.jx * 0.12;
      p.y = lerp(N.y, Q.y, e);
      p.h = lerpHue(p.hue, prism % 360, smooth(0.2, 1, u));
      p.a = lerp(1, 0.5 + 0.5 * (0.5 - Q.z * 0.5), smooth(0.6, 1, u));
      const charge = smooth(T.burst - 1.2, T.burst, t);
      p.a = Math.min(1, p.a + charge * 0.5);
      const spark = Math.sin((p.ph * 977 + f.tick) * 12.9898) * 43758.5453;
      if (u < 0.15 || spark - Math.floor(spark) > 0.985 - charge * 0.2) p.light = 1;
      p.sz = 1 + charge * 0.3;
      return;
    }

    // Supernova: x(τ) = x₀ + v(1 − e^{−kτ})/k.
    const tau = t - T.burst;
    diamondXY(p, f.brc, f.brs, f.bpulse);
    const ang = Math.atan2(Q.y - C.y, Q.x - C.x) + p.bj;
    const dist = (p.bs * (1 - Math.exp(-2.4 * tau))) / 2.4;
    p.x = Q.x + Math.cos(ang) * dist;
    p.y = Q.y + Math.sin(ang) * dist;
    p.a = 1 - smooth(0.1, 1.7, tau);
    p.h = (Math.atan2(p.dz, p.dx) / TAU) * 360 + T.burst * 50 + p.dy * 80 + 720;
    p.h %= 360;
    p.light = tau < 0.35 ? 1 : 0;
    p.sz = 1.25;
  }

  function drawStars(flare: number) {
    const rot = t * 0.008;
    for (const s of stars) {
      const a = s.a0 + rot;
      const x = C.x + Math.cos(a) * s.r;
      const y = C.y + Math.sin(a) * s.r;
      if (x < -2 || y < -2 || x > W + 2 || y > H + 2) continue;
      const al = s.base * (0.6 + 0.4 * Math.sin(t * s.tw + s.ph)) * (1 - 0.5 * flare);
      ctx.fillStyle = `rgba(215,228,255,${al.toFixed(3)})`;
      ctx.fillRect(x, y, s.size, s.size);
    }
  }

  function drawSpineHandles(env: number) {
    if (env <= 0.01) return;
    ctx.save();
    ctx.font = `500 10px ${opts.monoFont}`;
    ctx.lineWidth = 1;
    for (const sp of spines) {
      ctx.strokeStyle = `hsla(${sp.hue},70%,70%,${(env * 0.35).toFixed(3)})`;
      ctx.fillStyle = `hsla(${sp.hue},70%,75%,${(env * 0.6).toFixed(3)})`;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      sp.p.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      ctx.stroke();
      ctx.setLineDash([]);
      sp.p.forEach((q, i) => {
        ctx.beginPath();
        ctx.arc(q.x, q.y, 3, 0, TAU);
        ctx.stroke();
        const right = q.x > W * 0.75;
        ctx.textAlign = right ? "right" : "left";
        const ly = Math.min(H - 70, Math.max(110, q.y + (q.y < H / 2 ? 18 : -8)));
        if (W >= 700)
          ctx.fillText(`P${i} (${Math.round(q.x)}, ${Math.round(q.y)})`, q.x + (right ? -8 : 8), ly);
      });
    }
    ctx.restore();
  }

  function drawLabels(env: number) {
    if (env <= 0.01) return;
    ctx.save();
    ctx.font = `500 11px ${opts.monoFont}`;
    ctx.textAlign = "center";
    const [l, r] = groups;
    ctx.fillStyle = `hsla(42,90%,72%,${(env * 0.75).toFixed(3)})`;
    ctx.fillText("Σ business(t)", l.x, l.y + labelOff[0]);
    ctx.fillStyle = `hsla(192,90%,72%,${(env * 0.75).toFixed(3)})`;
    ctx.fillText("∇ intelligence(x, y)", r.x, r.y + labelOff[1]);
    ctx.restore();
  }

  function drawPolarGrid(env: number) {
    if (env <= 0.01) return;
    ctx.save();
    ctx.translate(N.x, N.y);
    ctx.scale(1, 0.5);
    ctx.strokeStyle = `rgba(160,200,255,${(env * 0.14).toFixed(3)})`;
    ctx.lineWidth = 1;
    for (let r = S * 0.06; r < S * 0.6; r *= 1.45) {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TAU);
      ctx.stroke();
    }
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * TAU + t * 0.4;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * S * 0.04, Math.sin(a) * S * 0.04);
      ctx.lineTo(Math.cos(a) * S * 0.6, Math.sin(a) * S * 0.6);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawRays(env: number) {
    if (env <= 0.01) return;
    sctx.lineCap = "round";
    for (const sp of spines) {
      for (let k = 0; k < sp.rays; k++) {
        sctx.beginPath();
        for (let i = 0; i <= 90; i++) {
          rayPos(sp, k, (i / 90) * 0.97, t);
          if (i) sctx.lineTo(R.x, R.y);
          else sctx.moveTo(R.x, R.y);
        }
        sctx.strokeStyle = `hsla(${sp.hue},95%,62%,${(env * 0.07).toFixed(3)})`;
        sctx.lineWidth = 5;
        sctx.stroke();
        sctx.strokeStyle = `hsla(${sp.hue},95%,72%,${(env * 0.3).toFixed(3)})`;
        sctx.lineWidth = 1.1;
        sctx.stroke();
      }
    }
  }

  function drawLinks(env: number) {
    if (env <= 0.01 || links.length === 0) return;
    sctx.lineWidth = 0.7;
    sctx.strokeStyle = `hsla(190,95%,70%,${(env * 0.22).toFixed(3)})`;
    sctx.beginPath();
    for (const [a, b] of links) {
      if (a.a <= 0 || b.a <= 0) continue;
      sctx.moveTo(a.x, a.y);
      sctx.lineTo(b.x, b.y);
    }
    sctx.stroke();
    sctx.fillStyle = `hsla(185,100%,88%,${(env * 0.9).toFixed(3)})`;
    sctx.beginPath();
    for (const [a, b, o] of links) {
      if (a.a <= 0 || b.a <= 0) continue;
      const q = (t * 0.9 + o) % 1;
      sctx.rect(lerp(a.x, b.x, q) - 1.2, lerp(a.y, b.y, q) - 1.2, 2.4, 2.4);
    }
    sctx.fill();
  }

  function drawFlare(flare: number, neck: number, charge: number) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    if (flare > 0.01) {
      const r = S * (0.25 + 0.55 * flare);
      const g = ctx.createRadialGradient(C.x, C.y, 0, C.x, C.y, r);
      g.addColorStop(0, `rgba(255,246,225,${(0.55 * flare).toFixed(3)})`);
      g.addColorStop(0.22, `rgba(255,205,140,${(0.22 * flare).toFixed(3)})`);
      g.addColorStop(0.55, `rgba(90,200,255,${(0.08 * flare).toFixed(3)})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      // Anamorphic streak.
      ctx.save();
      ctx.translate(C.x, C.y);
      ctx.scale(1, 0.015);
      const sg = ctx.createRadialGradient(0, 0, 0, 0, 0, W * 0.65);
      sg.addColorStop(0, `rgba(255,240,215,${(0.7 * flare).toFixed(3)})`);
      sg.addColorStop(0.4, `rgba(120,210,255,${(0.18 * flare).toFixed(3)})`);
      sg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.arc(0, 0, W * 0.65, 0, TAU);
      ctx.fill();
      ctx.restore();
      // Rotating god-rays.
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * TAU + t * 0.06;
        const len = S * 0.85 * flare;
        ctx.beginPath();
        ctx.moveTo(C.x, C.y);
        ctx.lineTo(C.x + Math.cos(a - 0.025) * len, C.y + Math.sin(a - 0.025) * len);
        ctx.lineTo(C.x + Math.cos(a + 0.025) * len, C.y + Math.sin(a + 0.025) * len);
        ctx.closePath();
        ctx.fillStyle = `rgba(255,230,190,${(0.035 * flare).toFixed(3)})`;
        ctx.fill();
      }
    }
    const glow = Math.max(neck, charge);
    if (glow > 0.01) {
      const at = neck >= charge ? N : C;
      const r = S * (0.08 + 0.3 * charge);
      const g = ctx.createRadialGradient(at.x, at.y, 0, at.x, at.y, r);
      g.addColorStop(0, `rgba(240,250,255,${(0.6 * glow).toFixed(3)})`);
      g.addColorStop(0.4, `rgba(140,220,255,${(0.18 * glow).toFixed(3)})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(at.x - r, at.y - r, r * 2, r * 2);
    }
    ctx.restore();
  }

  function drawBurstFx() {
    const tau = t - T.burst;
    if (tau < 0 || tau > 2) return;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const rings: [number, string][] = [
      [0, "255,225,170"],
      [0.12, "120,220,255"],
    ];
    for (const [delay, rgb] of rings) {
      const u = clamp01((tau - delay) / 1.4);
      if (u <= 0 || u >= 1) continue;
      const r = S * 1.3 * (1 - Math.pow(1 - u, 3));
      ctx.strokeStyle = `rgba(${rgb},${((1 - u) * 0.75).toFixed(3)})`;
      ctx.lineWidth = 1 + 7 * (1 - u);
      ctx.beginPath();
      ctx.arc(C.x, C.y, r, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
    const flash = Math.exp(-tau * 4.5) * 0.85;
    if (flash > 0.01) {
      ctx.fillStyle = `rgba(255,250,240,${flash.toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function render() {
    const cw = canvas.width;
    const ch = canvas.height;
    const flare = smooth(5.7, 7.6, t) * (1 - smooth(8.8, 10.3, t));
    const neck = smooth(9.9, 10.6, t) * (1 - smooth(12.2, 13.0, t));
    const charge = t < T.burst ? smooth(T.burst - 1.4, T.burst, t) : 0;
    const active = t < T.burst + 1.9;

    // Background.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    if (nebula) ctx.drawImage(nebula, 0, 0, cw, ch);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawStars(flare);
    drawSpineHandles(smooth(0.2, 1.2, t) * (1 - smooth(4.0, 5.4, t)));
    drawLabels(smooth(4.6, 5.3, t) * (1 - smooth(5.9, 6.5, t)));
    drawPolarGrid(neck);

    if (active) {
      sceneCleared = false;
      // Scene is redrawn from scratch each frame; motion trails are analytic streaks, so nothing ghosts.
      sctx.setTransform(1, 0, 0, 1, 0, 0);
      sctx.globalCompositeOperation = "source-over";
      sctx.clearRect(0, 0, scene.width, scene.height);
      sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      sctx.globalCompositeOperation = "lighter";

      drawRays(smooth(0.1, 1.2, t) * (1 - smooth(4.6, 6.0, t)));

      const rot = t * 0.55 + Math.pow(smooth(T.crystal, T.burst, t), 2) * 2.4;
      const brot = T.burst * 0.55 + 2.4;
      const pulse = (1 - 0.14 * smooth(T.burst - 0.4, T.burst, t)) * (1 + 0.02 * Math.sin(t * 6));
      const f = {
        rc: Math.cos(rot),
        rs: Math.sin(rot),
        pulse,
        brc: Math.cos(brot),
        brs: Math.sin(brot),
        bpulse: 0.86,
        flare,
        breath: 1 + 0.012 * Math.sin(t * 2.2) * smooth(8.5, 9.2, t) * (1 - smooth(T.drain - 0.6, T.drain, t)),
        drift: 0.12 * smooth(T.drift, T.morph + 0.6, t),
        fadeIn: smooth(0, 0.8, t),
        tick: Math.floor(t * 8),
      };
      for (const p of parts) {
        update(p, f);
        if (p.a <= 0.02) {
          p.x = NaN;
          continue;
        }
        const hb = Math.floor((((p.h % 360) + 360) % 360) / (360 / HUES)) % HUES;
        const al = Math.min(ALPHAS, Math.max(1, Math.ceil(p.a * ALPHAS)));
        buckets[(p.light * HUES + hb) * ALPHAS + al - 1]?.push(p);
      }
      drawLinks(smooth(3.8, 5.0, t) * (1 - smooth(6.4, 7.4, t)));
      const streakK = t > T.drain ? 3.2 : 2.2;
      const maxStreak = S * 0.12;
      buckets.forEach((list, i) => {
        if (list.length === 0) return;
        const style = styles[i] ?? "#fff";
        sctx.fillStyle = style;
        sctx.beginPath();
        for (const p of list) {
          const s = p.size * p.sz;
          sctx.rect(p.x - s / 2, p.y - s / 2, s, s);
        }
        sctx.fill();
        sctx.strokeStyle = style;
        sctx.lineWidth = 0.9;
        sctx.beginPath();
        for (const p of list) {
          const vx = p.x - p.px;
          const vy = p.y - p.py;
          const d = Math.hypot(vx, vy);
          if (!(d > 0.6) || d * streakK > maxStreak) continue;
          sctx.moveTo(p.x, p.y);
          sctx.lineTo(p.x - vx * streakK, p.y - vy * streakK);
        }
        sctx.stroke();
        list.length = 0;
      });
      for (const p of parts) {
        p.px = p.x;
        p.py = p.y;
      }

      // Composite scene + cheap two-level bloom.
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = "lighter";
      ctx.drawImage(scene, 0, 0);
      b1ctx.clearRect(0, 0, b1.width, b1.height);
      b1ctx.drawImage(scene, 0, 0, b1.width, b1.height);
      b2ctx.clearRect(0, 0, b2.width, b2.height);
      b2ctx.drawImage(b1, 0, 0, b2.width, b2.height);
      ctx.globalAlpha = 0.8;
      ctx.drawImage(b1, 0, 0, cw, ch);
      ctx.globalAlpha = 0.9;
      ctx.drawImage(b2, 0, 0, cw, ch);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    } else if (!sceneCleared) {
      sctx.setTransform(1, 0, 0, 1, 0, 0);
      sctx.clearRect(0, 0, scene.width, scene.height);
      sceneCleared = true;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawFlare(flare, neck, charge);
    drawBurstFx();
  }

  function frame(now: number) {
    if (destroyed) return;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
    last = now;
    t += dt;
    fps = lerp(fps, 1 / Math.max(dt, 0.001), 0.06);
    render();
    const idx = phaseIndexAt(t);
    if (idx !== phase) {
      phase = idx;
      opts.onPhase?.(idx);
    }
    opts.onTick?.(t, fps);
    if (!completed && t >= T.end) {
      completed = true;
      opts.onComplete?.();
    }
    raf = requestAnimationFrame(frame);
  }

  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!destroyed) build();
    }, 150);
  };

  void (async () => {
    try {
      await Promise.race([
        document.fonts.load(`800 100px ${opts.displayFont}`),
        new Promise((r) => setTimeout(r, 1500)),
      ]);
    } catch {
      /* fall back to whatever font is available */
    }
    if (destroyed) return;
    build();
    window.addEventListener("resize", onResize);
    raf = requestAnimationFrame(frame);
  })();

  return {
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      clearTimeout(resizeTimer);
      window.removeEventListener("resize", onResize);
    },
    skip() {
      t = Math.max(t, T.end);
    },
  };
}
