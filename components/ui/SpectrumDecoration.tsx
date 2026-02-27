/** Vertical spectrum bars used as a background decoration. */
export function SpectrumDecoration({
  className,
}: {
  className?: string;
}): React.ReactElement {
  const bars = [55, 80, 40, 95, 65, 50, 85, 35, 70, 60, 75, 45] as const;

  return (
    <svg
      viewBox="0 0 204 100"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {bars.map((h, i) => (
        <rect
          key={i}
          x={i * 17 + 1}
          y={100 - h}
          width={12}
          height={h}
          rx="3"
          fill={`url(#specGrad${i % 3})`}
          opacity={0.15 + (i % 4) * 0.07}
        />
      ))}
      <defs>
        <linearGradient
          id="specGrad0"
          x1="0"
          y1="0"
          x2="0"
          y2="100"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#7C3AED" />
          <stop offset="100%" stopColor="#4F46E5" />
        </linearGradient>
        <linearGradient
          id="specGrad1"
          x1="0"
          y1="0"
          x2="0"
          y2="100"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#A855F7" />
          <stop offset="100%" stopColor="#7C3AED" />
        </linearGradient>
        <linearGradient
          id="specGrad2"
          x1="0"
          y1="0"
          x2="0"
          y2="100"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#60A5FA" />
          <stop offset="100%" stopColor="#4F46E5" />
        </linearGradient>
      </defs>
    </svg>
  );
}
