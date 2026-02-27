/**
 * SingLab app logo — microphone + waveform + spectrum bars in brand gradient.
 */
export function SingLabLogo(): React.ReactElement {
  return (
    <svg
      viewBox="0 0 80 80"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="h-16 w-16"
      aria-hidden="true"
    >
      {/* Outer circle */}
      <circle
        cx="40"
        cy="40"
        r="37"
        stroke="url(#logoGrad)"
        strokeWidth="2.5"
      />

      {/* Waveform — left side */}
      <path
        d="M7 40 Q11 29 15 40 Q19 51 23 40 Q27 29 31 40"
        stroke="url(#logoGrad)"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />

      {/* Microphone body */}
      <rect
        x="35"
        y="24"
        width="10"
        height="15"
        rx="5"
        stroke="url(#logoGrad)"
        strokeWidth="2"
        fill="none"
      />
      {/* Microphone stand arc */}
      <path
        d="M30 37c0 5.5 4.5 10 10 10s10-4.5 10-10"
        stroke="url(#logoGrad)"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
      {/* Stand pole */}
      <line
        x1="40"
        y1="47"
        x2="40"
        y2="54"
        stroke="url(#logoGrad)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {/* Stand base */}
      <line
        x1="35"
        y1="54"
        x2="45"
        y2="54"
        stroke="url(#logoGrad)"
        strokeWidth="2"
        strokeLinecap="round"
      />

      {/* Spectrum bars — right side */}
      <rect
        x="54"
        y="33"
        width="3"
        height="11"
        rx="1.5"
        fill="url(#logoGrad)"
        opacity="0.9"
      />
      <rect
        x="59"
        y="27"
        width="3"
        height="17"
        rx="1.5"
        fill="url(#logoGrad)"
        opacity="0.8"
      />
      <rect
        x="64"
        y="36"
        width="3"
        height="8"
        rx="1.5"
        fill="url(#logoGrad)"
        opacity="0.7"
      />
      <rect
        x="69"
        y="30"
        width="3"
        height="14"
        rx="1.5"
        fill="url(#logoGrad)"
        opacity="0.6"
      />

      {/* Music note accent */}
      <circle cx="50" cy="50" r="2.5" fill="url(#noteGrad)" />
      <line
        x1="52.5"
        y1="50"
        x2="52.5"
        y2="44"
        stroke="url(#noteGrad)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <line
        x1="52.5"
        y1="44"
        x2="56"
        y2="45.5"
        stroke="url(#noteGrad)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />

      <defs>
        <linearGradient
          id="logoGrad"
          x1="0"
          y1="0"
          x2="80"
          y2="80"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#4F46E5" />
          <stop offset="100%" stopColor="#A855F7" />
        </linearGradient>
        <linearGradient
          id="noteGrad"
          x1="0"
          y1="0"
          x2="80"
          y2="80"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#A855F7" />
          <stop offset="100%" stopColor="#EC4899" />
        </linearGradient>
      </defs>
    </svg>
  );
}
