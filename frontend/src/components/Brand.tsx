/**
 * The Lantern mark: a hand lantern with a warm amber flame and a soft pool of light. Pure inline SVG; colours come from
 * CSS variables (--mark-bg, --mark-fg, --glow) so it works on the night-blue header and on light grounds.
 */
export function LanternMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg className={`lantern-mark ${className || ''}`} viewBox="0 0 32 32" width={size} height={size} aria-hidden="true" focusable="false">
      <rect x="1" y="1" width="30" height="30" rx="8" fill="var(--mark-bg, #14203f)" />
      {/* pool of light */}
      <circle cx="16" cy="17" r="10.5" fill="var(--glow, #f5b23c)" opacity="0.22" />
      {/* handle + cap */}
      <path d="M13 7.2a3 3 0 0 1 6 0" fill="none" stroke="var(--mark-fg, #f2f4fa)" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M10.2 10.6h11.6l-2-3.2h-7.6z" fill="var(--mark-fg, #f2f4fa)" />
      {/* glass */}
      <rect x="11.2" y="10.6" width="9.6" height="11.4" rx="2.2" fill="none" stroke="var(--mark-fg, #f2f4fa)" strokeWidth="1.8" />
      {/* flame */}
      <path
        className="lantern-mark__flame"
        d="M16 12.6c1.9 2.1 2.7 3.5 2.7 4.9a2.7 2.7 0 0 1-5.4 0c0-1.4.8-2.8 2.7-4.9z"
        fill="var(--glow, #f5b23c)"
      />
      {/* base */}
      <rect x="9.4" y="22" width="13.2" height="2.8" rx="1.2" fill="var(--mark-fg, #f2f4fa)" />
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
