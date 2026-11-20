/** Seconds on the intro clock. The engine and the HUD both read from here. */
export const T = {
  releaseStart: 1.3,
  releaseEnd: 4.7,
  drift: 5.7,
  morph: 6.3,
  drain: 10.0,
  crystal: 12.6,
  burst: 14.2,
  end: 15.9,
} as const;

export interface Phase {
  id: "genesis" | "convergence" | "vortex" | "crystal" | "burst" | "end";
  start: number;
  label: string;
  caption: string;
  formulas: string[];
}

export const PHASES: Phase[] = [
  {
    id: "genesis",
    start: 0,
    label: "01 · genesis",
    caption: "light braids into business · rays weave a mind",
    formulas: [
      "P(s) = B(s) + A(s)·sin(2πωs + 2πk/n − φt)·N̂(s)",
      "g(x,y) = sin(8x + 2.4·sin 3.3y)·cos(7.2y),  |g| < ε",
    ],
  },
  {
    id: "convergence",
    start: 6.0,
    label: "02 · convergence",
    caption: "business ⟷ intelligence",
    formulas: ["B(u) = (1−u)²P₀ + 2u(1−u)C + u²P₁", "I(t) = e^{−(t−t₀)² / 2σ²}"],
  },
  {
    id: "vortex",
    start: T.drain,
    label: "03 · vortex",
    caption: "draining through the neck",
    formulas: ["ω(r) ∝ 1 / r²", "r(u) = r₀ · (1 − u)"],
  },
  {
    id: "crystal",
    start: T.crystal,
    label: "04 · crystal",
    caption: "pressure becomes structure",
    formulas: ["v′ = Rₓ(α) · R_y(θ) · v", "p = f · v′ / (f + z′)"],
  },
  {
    id: "burst",
    start: T.burst,
    label: "05 · supernova",
    caption: "release",
    formulas: ["x(τ) = x₀ + v · (1 − e^{−kτ}) / k"],
  },
  { id: "end", start: T.end, label: "", caption: "", formulas: [] },
];

export function phaseIndexAt(t: number): number {
  let idx = 0;
  PHASES.forEach((p, i) => {
    if (t >= p.start) idx = i;
  });
  return idx;
}
