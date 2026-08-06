'use client';

// The thin promo tape above everything else.
//
// It sits ABOVE the price ticker on purpose. The ticker is data and belongs next to the product;
// this is an invitation and belongs at the edge of the page, where a reader's eye lands before
// it starts working. Every fixed offset below it is driven off --appstrip so the stack stays
// honest at any height, including the slimmer phone value.
//
// Hidden on /download, because a strip inviting you to the page you are already reading is noise.
import { usePathname } from 'next/navigation';

const CELLS = ['Try our mobile app', 'Limited slots'];

export default function AppStrip() {
  const pathname = usePathname();
  if (pathname?.startsWith('/download')) return null;

  return (
    <a className="appstrip" href="/download" aria-label="Try the Yosuku mobile app" data-cursor="hover">
      {/* Two identical halves: the track travels -50%, so the second copy is what hides the seam. */}
      <div className="appstrip-track">
        {[0, 1].map((half) => (
          <div className="appstrip-half" key={half} aria-hidden={half === 1}>
            {Array.from({ length: 6 }).map((_, i) => (
              <span className="appstrip-cell" key={i}>
                <span>{CELLS[i % CELLS.length]}</span>
                <i className="appstrip-dot" />
              </span>
            ))}
          </div>
        ))}
      </div>
      <span className="appstrip-cta">
        Get it
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </a>
  );
}
