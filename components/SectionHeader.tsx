interface SectionHeaderProps {
  number: string;
  title: string;
  jp?: string;
  desc?: string;
  count?: number;
  live?: boolean;
  meta?: string;
  cadences?: string[];
}

// A crisp torii mark — kasagi (top beam) carries the vermilion accent, posts
// splay outward like the real gate. Replaces the old spindly CSS-bar version.
function ToriiMark() {
  return (
    <svg width="30" height="24" viewBox="0 0 30 24" fill="none" aria-hidden="true" className="section-torii-svg">
      <path d="M2 5 Q4.5 2.4 7 4 L23 4 Q25.5 2.4 28 5" stroke="var(--vermilion)" strokeWidth="2.2" strokeLinecap="round" fill="none" />
      <path d="M6.5 8.6 H23.5" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M9 5 L7.7 23" stroke="rgba(255,255,255,0.62)" strokeWidth="2.1" strokeLinecap="round" />
      <path d="M21 5 L22.3 23" stroke="rgba(255,255,255,0.62)" strokeWidth="2.1" strokeLinecap="round" />
    </svg>
  );
}

export default function SectionHeader({ number, title, jp, desc, count, live, meta, cadences }: SectionHeaderProps) {
  return (
    <div className="section-head">
      <div className="section-index">
        <ToriiMark />
        <span className="section-index-num">{number}</span>
      </div>

      <div className="section-head-mid">
        <div className="section-head-row">
          <h2 className="section-title-2">{title}</h2>
          {jp && <span className="section-jp">{jp}</span>}
          {live && (
            <span className="live-pill">
              <span className="dot" />
              Live
            </span>
          )}
        </div>
        {desc && <p className="section-desc">{desc}</p>}
      </div>

      <div className="section-head-right">
        {cadences && cadences.length > 0 ? (
          <div className="cadence-chips">
            {cadences.map((c) => (
              <span key={c} className="cadence-chip">{c}</span>
            ))}
            <span className="cadence-note">rolling</span>
          </div>
        ) : meta ? (
          <span className="section-meta">{meta}</span>
        ) : count !== undefined ? (
          <span className="section-meta">{count} market{count !== 1 ? 's' : ''}</span>
        ) : null}
      </div>
    </div>
  );
}
