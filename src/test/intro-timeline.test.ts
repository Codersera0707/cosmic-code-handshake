import { describe, expect, it } from "vitest";
import { PHASES, T, phaseIndexAt } from "@/components/intro/timeline";

describe("intro storyline", () => {
  it("plays business/brain, then handshake, then drain, then diamond, then burst", () => {
    expect(PHASES.map((p) => p.id)).toEqual(["genesis", "convergence", "vortex", "crystal", "burst", "end"]);
  });

  it("each phase starts after the previous one", () => {
    PHASES.slice(1).forEach((p, i) => expect(p.start).toBeGreaterThan(PHASES[i]?.start ?? Infinity));
  });

  it("the intro ends only after the diamond has burst", () => {
    expect(T.end).toBeGreaterThan(T.burst);
    expect(PHASES[phaseIndexAt(T.burst + 0.01)]?.id).toBe("burst");
    expect(PHASES[phaseIndexAt(T.end)]?.id).toBe("end");
  });
});
