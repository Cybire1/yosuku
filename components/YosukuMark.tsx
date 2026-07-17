// The Yosuku mark: an abstract celebrant, arms raised in a "V", a rounded
// torso, and a vermilion dot at the heart. This is the real brand figure,
// vector-traced from assets/brand/yosuku-logo-transparent.png so it stays
// crisp at any size and adapts to the theme (figure follows currentColor,
// so it is cream on a dark ground and ink on cream).
//
// Single source of truth. Every surface that shows the mark imports this.
export default function YosukuMark({
  className,
  figure = 'currentColor',
  dot = 'var(--vermilion, #E04D26)',
  title,
}: {
  className?: string;
  /** color of the figure (torso, arms, head, legs). defaults to currentColor. */
  figure?: string;
  /** color of the heart dot. defaults to the vermilion token. */
  dot?: string;
  /** accessible name; when omitted the mark is decorative (aria-hidden). */
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 266 322"
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      xmlns="http://www.w3.org/2000/svg"
    >
      {title ? <title>{title}</title> : null}
      {/* raised arms: two separate bars that stop shy of the body, so the
          armpits stay open the way the real mark reads */}
      <g stroke={figure} strokeLinecap="round" fill="none">
        <line x1="12" y1="15" x2="88" y2="94" strokeWidth="24" />
        <line x1="254" y1="15" x2="178" y2="94" strokeWidth="24" />
        {/* head and legs: thin bars that merge into the torso */}
        <line x1="132.5" y1="13" x2="132.5" y2="86" strokeWidth="14" />
        <line x1="132.5" y1="250" x2="132.5" y2="306" strokeWidth="14" />
      </g>
      {/* torso: the capsule body */}
      <rect x="99" y="78" width="67" height="166" rx="16" fill={figure} />
      {/* the heart: a single vermilion dot at the base of the torso */}
      <circle cx="132.5" cy="239" r="11" style={{ fill: dot }} />
    </svg>
  );
}
