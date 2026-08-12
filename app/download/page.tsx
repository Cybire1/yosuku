'use client';

// The page the app band lands on.
//
// It shows a real capture of the app. The first version drew the screen as an SVG, on the theory
// that a drawing stays sharp and never dates. Both true, and both beside the point: a drawing
// shows the app as intended rather than as built, and the distance between those two is exactly
// what someone arriving from this page will meet. Same palette as the site, so it still reads as
// another room in the same building rather than a landing page bolted on.
import Header from '@/components/Header';
import YosukuMark from '@/components/YosukuMark';

const TESTFLIGHT = 'https://testflight.apple.com/join/7AxcFCf5';

/** The app itself, captured on a phone.
 *
 *  This was a drawn SVG. A drawing is always a flattering guess: it shows the app as intended
 *  rather than as built, and the gap between those two is exactly what someone downloading it
 *  will find. A real capture cannot drift from the product.
 *
 *  FULL SCREEN, not a crop. The previous capture was framed from the card down to hide a back
 *  control that overlapped the question. That bug is fixed, and the crop had a cost: at 921x1433
 *  the image was 1:1.56, while a phone screen is 1:2.17. No amount of bezel makes a squat
 *  rectangle read as a phone, which is why the frame around it never convinced. This is the whole
 *  screen at 1170x2532, straight off the device.
 *
 *  TO REPLACE: capture at full device resolution and drop it at public/app/bet-screen.png. Set
 *  the status bar first so it reads as a product shot rather than a debug capture:
 *    xcrun simctl status_bar <device> override --time "9:41" --cellularBars 4 \
 *      --wifiBars 3 --batteryState charged --batteryLevel 100
 */
function PhoneShot() {
  return (
    <div className="dl-phone">
      {/* The side controls. Three nubs on the left, one on the right, in the real proportions
          and positions. They are what the eye actually uses to tell a phone from a rounded
          rectangle, more than the corner radius does. */}
      <span className="dl-phone-btn dl-btn-mute" aria-hidden="true" />
      <span className="dl-phone-btn dl-btn-volup" aria-hidden="true" />
      <span className="dl-phone-btn dl-btn-voldn" aria-hidden="true" />
      <span className="dl-phone-btn dl-btn-power" aria-hidden="true" />

      <div className="dl-phone-screen">
        <img
          src="/app/bet-screen.png"
          alt="The Yosuku app on a phone: a Bitcoin round showing the live price, the time left, an up and a down button, and the payout."
          // Intrinsic size of the asset: wrong values here reserve the wrong box and the
          // page jumps when the image lands.
          width={1170}
          height={2532}
        />
        {/* The island sits in the gap the status bar already leaves for it. A device screenshot
            has no cutout in it, so without this the top of the screen is a suspiciously empty
            band with the time pushed to one side and no reason why. */}
        <span className="dl-phone-island" aria-hidden="true" />
      </div>
    </div>
  );
}

export default function DownloadPage() {
  return (
    <>
      <Header />
      <main className="dl">
        <section className="dl-hero">
          <div className="dl-copy">
            <div className="section-eyebrow dl-eyebrow">Yosuku for iOS</div>
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
              <li><b className="dl-nocaps">iOS</b><span>version 16 and up</span></li>
              <li><b>Testnet</b><span>practice money, real mechanics</span></li>
            </ul>
          </div>

          <div className="dl-stage" aria-hidden="false">
            <PhoneShot />
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
