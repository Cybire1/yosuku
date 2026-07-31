// X uses the same card as everything else. The renderer is imported rather than copied so
// the two can never drift; the route config is declared here because Next needs those
// values to be statically analysable and cannot follow a re-export.
import OGImage from './opengraph-image';

export const alt = 'Yosuku — bet on Bitcoin from wherever you already are';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const revalidate = 900;

export default OGImage;
