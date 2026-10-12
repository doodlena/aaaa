/**
 * The Lantern mark: a hand lantern with a mint flame. Pure inline SVG; colours come from CSS variables
 * (--mark-fg for the body, --mark-glass for the glass, --glow for the flame) so it works reversed on the
 * night-blue header and in blue on white grounds.
 */
export function LanternMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg className={`lantern-mark ${className || ''}`} viewBox="6 6.5 52 52" width={size} height={size} aria-hidden="true" focusable="false">
      {/* handle + cap */}
      <path d="M25 14a7 7 0 0 1 14 0" fill="none" stroke="var(--mark-fg, #14203f)" strokeWidth="3.5" strokeLinecap="round" />
      <rect x="20" y="13" width="24" height="7" rx="3.5" fill="var(--mark-fg, #14203f)" />
      {/* body + glass */}
      <rect x="16" y="19" width="32" height="34" rx="10" fill="var(--mark-fg, #14203f)" />
      <rect x="22.5" y="25" width="19" height="22" rx="6.5" fill="var(--mark-glass, #eaf8f1)" />
      {/* flame */}
      <path
        className="lantern-mark__flame"
        d="M32.6 27.5c.4 3.6 5.6 6.2 5.6 11.4a6 6 0 0 1-12 0c0-2.7 1.3-4.6 2.7-5.9.1 1.9.9 3.1 2.1 3.6-.9-3.6.2-6.8 1.6-9.1Z"
        fill="var(--glow, #7fd1ae)"
      />
      <path d="M32.2 35.2c.6 1.9 2.7 3.1 2.7 5.4a2.8 2.8 0 0 1-5.6 0c0-1.9 1.5-3.4 2.9-5.4Z" fill="#f2fbf6" />
      <rect x="31.4" y="44.6" width="1.4" height="2.4" rx="0.7" fill="#15233a" />
      {/* base */}
      <rect x="20" y="52" width="24" height="6" rx="3" fill="var(--mark-fg, #14203f)" />
    </svg>
  );
}

export function BrandLockup({ name, tagline }: { name: string; tagline?: string }) {
  return (
    <>
      <span className="brand__mark">
        <LanternMark size={36} />
      </span>
      <span className="brand__text">
        <span className="brand__name">{name}</span>
        {tagline && <span className="brand__region">{tagline}</span>}
      </span>
    </>
  );
}
