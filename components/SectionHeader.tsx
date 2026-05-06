interface SectionHeaderProps {
  number: string;
  title: string;
  jp?: string;
  desc?: string;
  count?: number;
  live?: boolean;
  meta?: string;
}

export default function SectionHeader({ number, title, jp, desc, count, live, meta }: SectionHeaderProps) {
  return (
    <div className="section-head">
      <div className="section-torii">
        <span className="pillar-l" />
        <span className="pillar-r" />
        <span className="num">{number}</span>
      </div>
      <div className="section-head-mid">
        <div className="section-head-row">
          <h2 className="section-title-2">{title}</h2>
          {jp && <span className="section-jp">{jp}</span>}
        </div>
        {desc && <p className="section-desc">{desc}</p>}
      </div>
      <div className="section-head-right">
        {live && (
          <span className="live-pill"><span className="dot" />Live</span>
        )}
        {meta && <span className="section-meta">{meta}</span>}
        {!meta && count !== undefined && (
          <span className="section-meta">{count} market{count !== 1 ? 's' : ''}</span>
        )}
      </div>
    </div>
  );
}
