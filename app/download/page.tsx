'use client';

// The page the app band lands on.
//
// Drawn, not screenshotted. A real screenshot dates the moment the UI changes and reads as a
// stock asset at small sizes; a hand-built SVG of the one thing the app does (a question, a
// live line, two answers) stays true and stays sharp at any width. Same palette as the site,
// so this reads as another room in the same building rather than a landing page bolted on.
import Header from '@/components/Header';
import YosukuMark from '@/components/YosukuMark';

const TESTFLIGHT = 'https://testflight.apple.com/join/7AxcFCf5';

/** The app, drawn: one question, the live price, two ways to answer. */
function PhoneArt() {
  return (
    <svg className="dl-art" viewBox="0 0 320 620" role="img" aria-label="The Yosuku app on iPhone, showing a Bitcoin round with an up and a down button">
      <defs>
        <linearGradient id="dlGlow" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#E04D26" stopOpacity="0.20" />
          <stop offset="100%" stopColor="#E04D26" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="dlFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#34D399" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#34D399" stopOpacity="0" />
        </linearGradient>
        <clipPath id="dlScreen"><rect x="14" y="14" width="292" height="592" rx="38" /></clipPath>
      </defs>

      {/* device */}
      <rect x="2" y="2" width="316" height="616" rx="50" fill="#0B0B0D" stroke="rgba(255,255,255,0.14)" strokeWidth="1.5" />
      <rect x="14" y="14" width="292" height="592" rx="38" fill="#050505" />

      <g clipPath="url(#dlScreen)">
        <rect x="14" y="14" width="292" height="150" fill="url(#dlGlow)" />
        {/* status + notch */}
        <rect x="120" y="24" width="80" height="20" rx="10" fill="#000" />
        <text x="38" y="40" className="dl-t-mono" fill="#8A8A8A">9:41</text>

        {/* the question */}
        <text x="38" y="96" className="dl-t-h">BTC above</text>
        <text x="38" y="124" className="dl-t-h">$64,200<tspan fill="#E04D26">?</tspan></text>

        {/* live price + countdown */}
        <text x="38" y="160" className="dl-t-lbl" fill="#6E6E6E">BTC NOW</text>
        <text x="38" y="184" className="dl-t-num" fill="#FAFAFA">$64,287</text>
        <text x="282" y="160" className="dl-t-lbl" fill="#6E6E6E" textAnchor="end">CLOSES IN</text>
        <text x="282" y="184" className="dl-t-num" fill="#E04D26" textAnchor="end">04:12</text>

        {/* the line */}
        <path d="M38 300 L64 292 L84 302 L104 286 L126 294 L148 268 L170 276 L192 252 L214 262 L238 240 L262 232 L282 226 L282 330 L38 330 Z" fill="url(#dlFill)" />
        <path d="M38 300 L64 292 L84 302 L104 286 L126 294 L148 268 L170 276 L192 252 L214 262 L238 240 L262 232 L282 226" fill="none" stroke="#34D399" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="282" cy="226" r="4.5" fill="#34D399" />
        <circle cx="282" cy="226" r="10" fill="#34D399" opacity="0.18" />
        <path d="M38 268 L282 268" stroke="#E04D26" strokeWidth="1.5" strokeDasharray="5 6" opacity="0.7" />

        {/* two answers */}
        <rect x="38" y="372" width="116" height="52" rx="26" fill="rgba(52,211,153,0.10)" stroke="#34D399" strokeWidth="1.5" />
        <text x="96" y="404" className="dl-t-btn" fill="#34D399" textAnchor="middle">UP</text>
        <rect x="166" y="372" width="116" height="52" rx="26" fill="rgba(251,113,133,0.08)" stroke="rgba(251,113,133,0.55)" strokeWidth="1.5" />
        <text x="224" y="404" className="dl-t-btn" fill="#FB7185" textAnchor="middle">DOWN</text>

        {/* stake → payout */}
        <text x="38" y="470" className="dl-t-lbl" fill="#6E6E6E">YOU BET</text>
        <text x="38" y="496" className="dl-t-num" fill="#FAFAFA">5.00</text>
        <text x="282" y="470" className="dl-t-lbl" fill="#6E6E6E" textAnchor="end">COULD WIN</text>
        <text x="282" y="496" className="dl-t-num" fill="#34D399" textAnchor="end">9.20</text>

        <rect x="38" y="528" width="244" height="50" rx="25" fill="#E04D26" />
        <text x="160" y="559" className="dl-t-btn" fill="#FFFFFF" textAnchor="middle">Place bet</text>
      </g>
    </svg>
  );
}

export default function DownloadPage() {
  return (
    <>
      <Header />
      <main className="dl">
        <section className="dl-hero">
          <div className="dl-copy">
            <div className="section-eyebrow">Yosuku for iPhone</div>
            <h1 className="dl-title">
              Call it in <em>ten seconds.</em>
            </h1>
            <p className="dl-line">
              Will Bitcoin be higher or lower when the round closes? Pick a side, pick an amount,
              and the payout lands back in your account the moment it settles. No gas to buy, no
              seed phrase to write down, and only you can cash out.
            </p>

            <a href={TESTFLIGHT} target="_blank" rel="noreferrer" className="dl-cta" data-cursor="hover">
              Get the app
              <svg viewBox="0 0 24 24" aria-hidden="true" className="dl-cta-arrow">
                <path d="M12 4v12m0 0l-5-5m5 5l5-5M5 20h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>

            <ul className="dl-meta">
              <li><b>TestFlight</b><span>Apple&rsquo;s beta app</span></li>
              <li><b>iPhone</b><span>iOS 16 and up</span></li>
              <li><b>Testnet</b><span>practice money, real mechanics</span></li>
            </ul>
          </div>

          <div className="dl-stage" aria-hidden="false">
            <div className="dl-halo" />
            <PhoneArt />
          </div>
        </section>

        <section className="dl-points">
          <article>
            <span className="dl-pt-mark"><YosukuMark figure="currentColor" /></span>
            <h3>Sign in and go</h3>
            <p>Use your Google account. There is no seed phrase to copy out and nothing to install a wallet for.</p>
          </article>
          <article>
            <span className="dl-pt-mark"><YosukuMark figure="currentColor" /></span>
            <h3>Rounds all day</h3>
            <p>New questions open every minute. Take one on the walk to work, or sit one out.</p>
          </article>
          <article>
            <span className="dl-pt-mark"><YosukuMark figure="currentColor" /></span>
            <h3>Paid on the close</h3>
            <p>Settlement reads the same price feed you watched. Win and it is credited to you, without asking anyone.</p>
          </article>
        </section>

        <p className="dl-foot">
          Yosuku runs on Sui testnet while it is in beta, so you are playing with practice funds.
          Everything else is real: real markets, real settlement, real code.
        </p>
      </main>
    </>
  );
}
