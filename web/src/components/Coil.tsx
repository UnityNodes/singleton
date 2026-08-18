import { cn } from "@/lib/utils";

/**
 * The mark's geometry at scale.
 *
 * The logo's "o" is a groove coiled around one centre, which is the product
 * stated in one glyph: many claims, exactly one record at the middle. Drawn here
 * rather than scaled from the SVG, so it can breathe, rotate slowly, and hold a
 * live record at its centre without the logo being stretched or recoloured.
 */
export function Coil({ className, rings = 26 }: { className?: string; rings?: number }) {
  const size = 1000;
  const c = size / 2;

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
        {Array.from({ length: rings }, (_, i) => {
          const r = 26 + i * ((c - 40) / rings);
          return <circle key={i} cx={c} cy={c} r={r} strokeWidth={i % 6 === 0 ? 2.2 : 1} />;
        })}
        {/* the tail hooks out of the coil the way the mark's does, and stops:
            run it to the edge and it reads as a stray rule, not as the mark */}
        <path d={`M ${c + 26} ${c} A 26 26 0 0 1 ${c} ${c + 26} L ${c} ${c + 190}`} strokeWidth="2.4" />
        <circle cx={c} cy={c} r="9" fill="currentColor" stroke="none" />
      </g>
    </svg>
  );
}
