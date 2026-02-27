/** Continuous audio waveform used as a background decoration. */
export function WaveformDecoration({
  className,
}: {
  className?: string;
}): React.ReactElement {
  return (
    <svg
      viewBox="0 0 800 80"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      preserveAspectRatio="none"
    >
      {/* Primary wave */}
      <path
        d="M0 40 Q50 10 100 40 Q150 70 200 40 Q250 10 300 40 Q350 70 400 40
           Q450 10 500 40 Q550 70 600 40 Q650 10 700 40 Q750 70 800 40"
        stroke="url(#waveGrad)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {/* Secondary wave (offset) */}
      <path
        d="M0 40 Q40 25 80 40 Q120 55 160 40 Q200 25 240 40 Q280 55 320 40
           Q360 25 400 40 Q440 55 480 40 Q520 25 560 40 Q600 55 640 40
           Q680 25 720 40 Q760 55 800 40"
        stroke="url(#waveGrad)"
        strokeWidth="1"
        strokeLinecap="round"
        opacity="0.5"
      />
      <defs>
        <linearGradient
          id="waveGrad"
          x1="0"
          y1="0"
          x2="800"
          y2="0"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#4F46E5" stopOpacity="0.1" />
          <stop offset="50%" stopColor="#7C3AED" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#A855F7" stopOpacity="0.1" />
        </linearGradient>
      </defs>
    </svg>
  );
}
