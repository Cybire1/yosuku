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

export default function SectionHeader({ number, title, jp, desc, count, live, meta, cadences }: SectionHeaderProps) {
  return (
    <div className="section-head">
      <div className="section-index">
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
