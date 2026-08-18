import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/** SMIL ignores prefers-reduced-motion, so the pulse has to be gated in JS. */
function useStillness() {
  const [still, setStill] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setStill(q.matches);
    sync();
    q.addEventListener("change", sync);
    return () => q.removeEventListener("change", sync);
  }, []);
  return still;
}

/**
 * The mark's geometry at scale.
 *
 * The logo's "o" is a groove coiled around one centre, which is the product
 * stated in one glyph: many claims, exactly one record at the middle. Drawn here
 * rather than scaled from the SVG, so it can breathe, rotate slowly, and hold a
 * live record at its centre without the logo being stretched or recoloured.
 *
 * With pulse on, a ring leaves the centre every few seconds: the register is a
 * thing that is listening, and a still diagram does not say that.
 */
export function Coil({
  className,
  rings = 26,
  pulse = false,
  spin = false,
}: {
  className?: string;
  rings?: number;
  pulse?: boolean;
  spin?: boolean;
}) {
  const size = 1000;
  const c = size / 2;
  const still = useStillness();
  const beats = pulse && !still ? [0, 3.2, 6.4] : [];

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className={cn("pointer-events-none select-none", className)}
      aria-hidden
      role="presentation"
    >
      <defs>
        <radialGradient id="coil-fade" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="white" stopOpacity="0.85" />
          <stop offset="62%" stopColor="white" stopOpacity="0.32" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </radialGradient>
        <mask id="coil-mask">
          <rect width={size} height={size} fill="url(#coil-fade)" />
        </mask>
      </defs>

      <g mask="url(#coil-mask)" fill="none" stroke="currentColor">
        <g className={cn(spin && !still && "spin-slow")} style={{ transformOrigin: "50% 50%" }}>
          {Array.from({ length: rings }, (_, i) => {
            const r = 26 + i * ((c - 40) / rings);
            return <circle key={i} cx={c} cy={c} r={r} strokeWidth={i % 6 === 0 ? 2.2 : 1} />;
          })}
          {/* the tail hooks out of the coil the way the mark's does, and stops:
              run it to the edge and it reads as a stray rule, not as the mark */}
          <path
            d={`M ${c + 26} ${c} A 26 26 0 0 1 ${c} ${c + 26} L ${c} ${c + 190}`}
            strokeWidth="2.4"
          />
        </g>

        {beats.map((begin) => (
          <circle key={begin} cx={c} cy={c} r="26" strokeWidth="2.6" opacity="0">
            <animate
              attributeName="r"
              values={`26;${c - 30}`}
              dur="9.6s"
              begin={`${begin}s`}
              repeatCount="indefinite"
            />
            <animate
              attributeName="opacity"
              values="0;0.85;0"
              keyTimes="0;0.12;1"
              dur="9.6s"
              begin={`${begin}s`}
              repeatCount="indefinite"
            />
          </circle>
        ))}

        <circle cx={c} cy={c} r="9" fill="currentColor" stroke="none" />
      </g>
    </svg>
  );
}
