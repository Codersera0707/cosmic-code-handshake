import { useEffect, useRef, useState } from "react";
import { createCosmicIntro, type IntroHandle } from "./engine";
import { PHASES, T } from "./timeline";

interface CosmicIntroProps {
  /** Called once, right after the diamond's burst has faded. */
  onComplete?: () => void;
}

export function CosmicIntro({ onComplete }: CosmicIntroProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<IntroHandle | null>(null);
  const clockRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef(onComplete);
  doneRef.current = onComplete;
  const [phase, setPhase] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const handle = createCosmicIntro(canvas, {
      displayFont: '"Unbounded"',
      monoFont: '"JetBrains Mono"',
      startAt: reduced ? T.end : 0,
      onPhase: setPhase,
      onTick: (t, fps) => {
        if (clockRef.current)
          clockRef.current.textContent = `t = ${Math.min(t, T.end).toFixed(3).padStart(6, "0")}s · ${Math.round(fps)} fps`;
        if (barRef.current) barRef.current.style.transform = `scaleX(${Math.min(1, t / T.end)})`;
      },
      onComplete: () => {
        setDone(true);
        doneRef.current?.();
      },
    });
    handleRef.current = handle;
    return () => handle.destroy();
  }, []);

  const current = PHASES[phase];

  return (
    <div className="absolute inset-0 overflow-hidden bg-background">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />

      {!done && (
        <>
          <div className="hud-fade pointer-events-none absolute left-5 top-5 max-w-[calc(100vw-8.5rem)] sm:max-w-[34rem] font-mono sm:left-8 sm:top-8">
            {current && current.label && (
              <div key={current.id} className="animate-hud-in space-y-1.5">
                <p className="text-[11px] uppercase tracking-[0.3em] text-primary">{current.label}</p>
                <p className="text-xs text-muted-foreground">{current.caption}</p>
                {current.formulas.map((f) => (
                  <p key={f} className="text-[11px] text-accent/80 sm:text-xs">
                    {f}
                  </p>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => handleRef.current?.skip()}
            className="btn-hud absolute right-5 top-5 sm:right-8 sm:top-8"
          >
            skip ↵
          </button>

          <div className="pointer-events-none absolute inset-x-5 bottom-5 font-mono sm:inset-x-8 sm:bottom-8">
            <div className="flex items-end justify-between gap-4 text-[11px] text-muted-foreground">
              <span ref={clockRef}>t = 000.000s</span>
              <span className="hidden sm:inline">canvas2d · {"{"} particles: analytic(t) {"}"}</span>
            </div>
            <div className="mt-2 h-px w-full bg-border">
              <div ref={barRef} className="h-px w-full origin-left scale-x-0 bg-hud-progress" />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
