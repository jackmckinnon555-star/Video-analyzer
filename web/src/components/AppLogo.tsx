/** Inline TRA video logo mark. Matches /public/favicon.svg. */
export function AppLogo({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
    >
      <rect width="64" height="64" rx="12" fill="#0B2A4A" />
      <path d="M24 18 L48 32 L24 46 Z" fill="#C7A35A" />
      <text
        x="32"
        y="58"
        textAnchor="middle"
        fontFamily="Inter, system-ui, sans-serif"
        fontWeight={700}
        fontSize={10}
        letterSpacing={1.5}
        fill="#F6F4EF"
      >
        TRA
      </text>
    </svg>
  );
}
