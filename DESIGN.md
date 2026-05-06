# YOSUKU — Design System Brief

> Claude Design instructions for building the Yosuku prediction markets platform.
> Aesthetic: Pure black & white. Gallery-grade. Obsessively smooth.

---

## 1. Brand Identity

**Name**: Yosuku (予測 — Japanese for "prediction")
**Tagline**: See what's next.
**What it is**: On-chain binary prediction markets on the Sui blockchain, powered by DeepBook Predict.
**Who it's for**: Crypto-native traders who appreciate precision and craft.

### Personality
Think: Comme des Garcons catalog meets a Bloomberg terminal. Swiss typography poster meets Apple product page. It is artistic but never decorative — every element earns its place. The design is the feature.

**References / Mood**:
- Linear.app — micro-interactions, monochrome discipline
- Stripe.com — editorial smoothness, typographic hierarchy
- Vercel.com — black/white contrast, developer elegance
- Aesop.com — whitespace as luxury, restrained palette
- Dieter Rams — "Less, but better"

### Brand Voice
- Quiet confidence. Never shouts.
- Short declarative copy: "Your positions.", "Markets close in 14m.", "Settled."
- No emoji in UI. No exclamation marks. Period-terminated statements.
- Japanese characters (予測) can appear as subtle decorative elements

### Logo
- Wordmark: "YOSUKU" in Sora ExtraBold or Satoshi Black — geometric, wide
- Alternate: "予測" in a refined serif for editorial moments
- Mark: A single clean circle with a vertical bisecting line (split/binary metaphor)
- Pure white on black, pure black on white. No color variants.
- Must be razor-sharp at 14px and cinematic at 400px

---

## 2. Color System

### The Rule: Black. White. Nothing else.

Color is earned. Only financial data (profit/loss) gets color, and even then it's muted.

### Palette

| Token | Value | Usage |
|---|---|---|
| `--black` | `#000000` | Primary background |
| `--white` | `#FFFFFF` | Primary text, primary buttons |
| `--gray-50` | `#FAFAFA` | Inverted section backgrounds |
| `--gray-100` | `#F5F5F5` | Light surface (rare, cards in light sections) |
| `--gray-200` | `#E5E5E5` | Borders on light backgrounds |
| `--gray-300` | `#D4D4D4` | Disabled text on dark |
| `--gray-400` | `#A3A3A3` | Secondary text |
| `--gray-500` | `#737373` | Tertiary text, labels |
| `--gray-600` | `#525252` | Subtle borders on dark |
| `--gray-700` | `#404040` | Card backgrounds on dark |
| `--gray-800` | `#262626` | Elevated surface |
| `--gray-900` | `#171717` | Deep background |
| `--gray-950` | `#0A0A0A` | Deepest black |

### Financial Colors (the only exceptions)
| Token | Value | Usage |
|---|---|---|
| `--profit` | `#22C55E` | Profit values, UP/YES wins — used ONLY on numbers |
| `--loss` | `#EF4444` | Loss values, DOWN/NO losses — used ONLY on numbers |

### Rules
- NO brand colors. No teal, no mint, no blue, no purple. Black and white only.
- Financial green/red appear ONLY on numerical values ("+42.50", "-18.30"), never on backgrounds or borders
- Borders are always `white/[0.06]` to `white/[0.12]` on dark, `black/[0.06]` to `black/[0.1]` on light
- Shadows are black with very low opacity: `shadow-[0_2px_20px_rgba(0,0,0,0.08)]`
- Hover states shift opacity, not color: `hover:bg-white/[0.04]` on dark

---

## 3. Typography

### Font Stack

| Role | Font | Weight | Why |
|---|---|---|---|
| Display | **Sora** | 700–800 | Geometric, wide, futuristic — hero text, page titles |
| Body | **Inter** | 400–600 | Neutral perfection — readable at any size |
| Mono | **JetBrains Mono** | 400–600 | Technical precision — prices, addresses, countdowns |

**Fallback**: If Sora unavailable, use **Satoshi** or **General Sans**.

### Type Scale

| Level | Size | Weight | Tracking | Usage |
|---|---|---|---|---|
| Display XL | `clamp(3rem, 8vw, 7rem)` | 800 | `-0.04em` | Landing hero |
| Display | `clamp(2rem, 5vw, 3.5rem)` | 700 | `-0.03em` | Page titles |
| Heading | `1.5rem` (24px) | 700 | `-0.02em` | Section heads |
| Subhead | `1.125rem` (18px) | 600 | `-0.01em` | Card titles |
| Body | `0.9375rem` (15px) | 400 | `0` | Paragraphs |
| Caption | `0.8125rem` (13px) | 500 | `0.01em` | Labels, metadata |
| Micro | `0.6875rem` (11px) | 600 | `0.08em` | Uppercase tags, status pills |
| Mono Data | `1.25rem` (20px) | 500 | `-0.02em` | Prices, stats |

### Rules
- Display text uses negative letter-spacing (tight). Always.
- Uppercase is ONLY for micro labels and status tags. Headings are sentence case.
- Line height: Display `1.05`, Body `1.6`, Captions `1.4`
- Paragraphs max-width `42ch` for readability
- Numbers are ALWAYS in JetBrains Mono — mixing number fonts is forbidden

---

## 4. Layout & Spacing

### Grid System
- 12-column grid, `max-w-[1280px]`, centered
- Gutter: `24px` (mobile `16px`)
- Page padding: `px-6` desktop, `px-4` mobile

### Spacing Scale (8px base)
| Token | Value | Usage |
|---|---|---|
| `xs` | `4px` | Tight gaps, icon-to-text |
| `sm` | `8px` | Intra-component spacing |
| `md` | `16px` | Card padding, form gaps |
| `lg` | `24px` | Section sub-gaps |
| `xl` | `48px` | Section separators |
| `2xl` | `80px` | Major section breaks |
| `3xl` | `120px` | Hero vertical breathing |

### Whitespace Philosophy
- Whitespace IS the design. When in doubt, add more space.
- Cards have generous internal padding (`p-8` desktop, `p-5` mobile)
- Sections separated by `120px` vertical space on desktop
- No element should feel cramped. Let things breathe like a gallery wall.

### Header
- Fixed top, full-width, transparent until scroll → `bg-black/80 backdrop-blur-xl`
- Height: `64px`
- Left: Logo wordmark. Right: nav links + wallet button
- Nav links are sentence-case, `text-sm`, `text-gray-400`, hover → `text-white`
- Active link: `text-white` with animated underline (2px, white, slides in from left)
- On scroll: slim `1px` bottom border fades in (`border-white/[0.06]`)

---

## 5. Micro-Interactions Catalog

This is core to the identity. Every touchable element responds.

### 5.1 Cursor Interactions
- **Magnetic buttons**: Primary CTAs subtly pull toward cursor within 80px radius (use `framer-motion` `useMotionValue` + `useTransform`)
- **Custom cursor**: Replace default cursor with a small white circle (`12px`) that scales up to `40px` on hover over interactive elements, with smooth spring transition
- **Cursor trail**: Faint white dot trail (3-4 dots, fading opacity) follows cursor on hero section only

### 5.2 Hover Effects
- **Cards**: On hover, the entire card lifts with `translateY(-2px)` and a soft shadow deepens. Border brightens from `white/[0.06]` to `white/[0.15]`. Transition: `300ms cubic-bezier(0.4, 0, 0.2, 1)`
- **Buttons**: Background inverts — white button gets a subtle `scale(1.02)` and `shadow-[0_0_30px_rgba(255,255,255,0.06)]`
- **Text links**: Underline draws from left to right on hover (`scaleX(0)` → `scaleX(1)`, `transform-origin: left`)
- **Table rows**: Background shifts to `white/[0.02]`, row slides right by `2px`
- **Nav links**: Letter-spacing loosens slightly on hover (`tracking-normal` → `tracking-wide`, spring transition)

### 5.3 Click/Tap Feedback
- **Buttons**: `scale(0.97)` on press, spring back. Duration: `150ms`
- **Cards**: `scale(0.985)` on press
- **Tabs**: Active tab background slides to new position using `layoutId` animation (shared layout)
- **Toggle (UP/DOWN)**: Selected side scales in with a white fill that expands from center like a ripple

### 5.4 Scroll Interactions
- **Parallax text**: Hero display text moves at `0.85x` scroll speed
- **Fade-in on scroll**: Elements enter with `opacity: 0, y: 30px` → `opacity: 1, y: 0` as they enter viewport (IntersectionObserver or framer `whileInView`)
- **Progress bar**: Thin `1px` white line at very top of page showing scroll progress
- **Number count-up**: Stats/prices animate from 0 to final value when they scroll into view (use `useSpring` with `duration: 1200ms`)
- **Sticky sections**: On the landing page, feature sections stick and crossfade as user scrolls through

### 5.5 Loading & Transitions
- **Page transitions**: Content fades out (`opacity: 0, y: -10`) and new page fades in (`opacity: 0, y: 10` → visible). Duration: `400ms`
- **Skeleton loading**: Pulsing gradient sweep (left→right shine) on `bg-gray-800` rectangles matching content shapes
- **Spinner**: Single thin white arc rotating. Not a circle — an arc (`border-t-white border-r-transparent`)
- **Data refresh**: Numbers cross-fade when updating (old value fades, new slides in from below)
- **Toast notifications**: Slide in from top-right, `backdrop-blur`, auto-dismiss with shrinking progress bar

### 5.6 Signature Interactions
- **Market card flip**: On detail page entry, card does a subtle 3D perspective tilt (`rotateX(2deg)`) then settles flat
- **Trade confirmation**: After placing a trade, a white circle expands from the button center to fill the card momentarily, then contracts — like a camera shutter
- **Countdown urgency**: When market <5 min from expiry, the countdown digits get a subtle `scale` pulse every second (1.0 → 1.03 → 1.0)
- **Probability bar**: The fill bar animates width with a spring curve, slightly overshoots then settles

---

## 6. Component Patterns

### Cards
```css
bg-gray-900/50
border border-white/[0.06]
rounded-2xl
p-8
transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]
hover:border-white/[0.12]
hover:-translate-y-0.5
hover:shadow-[0_8px_40px_rgba(0,0,0,0.3)]
```
- No colored borders. No glows. Just elevation and border brightness changes.
- Optional: very subtle `backdrop-blur-sm` for overlapping content

### Buttons — Primary
```css
bg-white text-black
font-semibold text-sm tracking-wide
rounded-full px-8 py-3
transition-all duration-200
hover:shadow-[0_0_30px_rgba(255,255,255,0.08)]
hover:scale-[1.02]
active:scale-[0.97]
```
- Always `rounded-full` (pill shape). Never square. Never rounded-lg.
- Magnetic pull effect on desktop (see micro-interactions)

### Buttons — Secondary
```css
bg-transparent text-white
border border-white/[0.12]
rounded-full px-8 py-3
hover:bg-white/[0.04] hover:border-white/[0.2]
active:scale-[0.97]
```

### Buttons — Ghost
```css
bg-transparent text-gray-400
rounded-full px-6 py-2
hover:text-white
transition-colors duration-200
```
- Text-only, no border. Underline animates on hover.

### Input Fields
```css
bg-transparent
border-b border-white/[0.12]
px-0 py-3
text-white text-lg font-mono
placeholder:text-gray-600
focus:border-white
transition-colors duration-300
```
- Bottom-border-only inputs (no box). Clean editorial style.
- Focus: border goes full white, placeholder slides up and shrinks into a label (floating label pattern)
- Amount inputs: large font (`text-2xl font-mono`)

### Tabs
```css
/* Container */
flex gap-1 p-1 rounded-full bg-white/[0.03] border border-white/[0.06]

/* Tab */
px-5 py-2 rounded-full text-sm text-gray-500
transition-all duration-200

/* Active tab — animated with layoutId */
bg-white text-black font-semibold
```
- The active pill slides between tabs using framer `layoutId` — this is the signature interaction

### Status Pills / Tags
```css
rounded-full px-3 py-1
text-[11px] font-semibold uppercase tracking-[0.06em]
border
```
| State | Style |
|---|---|
| Live | `border-white/20 bg-white/[0.04] text-white` + pulsing white dot |
| Settled | `border-white/[0.06] bg-transparent text-gray-500` |
| Expiring | `border-white/20 bg-white/[0.06] text-white` + animated countdown |
| Your position | `border-white/30 bg-white/[0.08] text-white` |

### Tables / Lists
- No visible grid lines. Rows separated by `1px` border (`border-white/[0.04]`)
- Row hover: `bg-white/[0.02]` + subtle rightward shift (`translateX(2px)`)
- Header row: `text-[11px] uppercase tracking-[0.08em] text-gray-500`
- Cell data: `font-mono text-white`

### Market Cards
```
rounded-2xl border border-white/[0.06] bg-black p-6
hover:border-white/[0.12] hover:-translate-y-0.5
```
- **Top**: Asset tag (micro text) + countdown (mono)
- **Middle**: Question in `text-lg font-semibold` — "BTC above $95,000?"
- **Bottom**: Two side-by-side buttons (YES / NO)
  - YES: `border-white/[0.08] bg-white/[0.02]` — on hover: `bg-white text-black` (full inversion)
  - NO: Same base — on hover: `bg-white text-black`
  - Each shows probability: `67c` in mono
  - Probability fill bar: `h-[2px] bg-white` width = probability%
- No colored backgrounds on YES/NO. The inversion IS the interaction.

### Stat Cards
```
bg-transparent border border-white/[0.06] rounded-2xl p-6
```
- Label: `text-[11px] uppercase tracking-[0.08em] text-gray-500`
- Value: `text-3xl font-mono font-bold text-white`
- Animates on mount: number counts up from 0

---

## 7. Pages

### 7.1 Landing Page (`/`)

**Hero** (full viewport):
- Pure black background
- Center-aligned display text: "See what's next." in `clamp(3rem, 8vw, 7rem)`, white
- Below: one-line descriptor in `text-gray-500`
- Live BTC price in `font-mono`, updating in real-time with cross-fade
- Single CTA button: "Enter markets" (white pill, magnetic)
- Subtle decorative: "予測" in very large (`20vw`), very faint (`opacity-[0.02]`) text behind hero
- Scroll indicator: thin animated line pulsing downward

**How It Works** (3 steps):
- Horizontal layout on desktop, vertical on mobile
- Each step: large step number (`text-[120px] font-bold text-white/[0.03]`) behind the content
- Step title + one sentence description
- Connected by a thin horizontal line (`1px white/[0.06]`)

**Features** (sticky scroll):
- 3-4 features, each takes the full viewport as user scrolls
- Text fades and slides in, previous fades out
- Feature titles are large display text
- Minimal illustration: thin white line art or geometric shapes (no photos, no gradients)

**Footer**:
- Full-width, border-top `1px white/[0.06]`
- 3-column: Brand | Links | Social
- Bottom: massive `YOSUKU` watermark text (`text-[20vw] text-white/[0.02]`)
- Copyright in `text-[11px] text-gray-600`

### 7.2 Markets Page (`/markets`)

**Top section**:
- Page title: "Markets" in display font
- Wallet balance inline (mono)
- DUSDC faucet button (secondary/ghost)

**Market sections** (grouped by time):
- Section labels: "Closing soon" / "Next hour" / "Later" / "Recently settled"
- 3-column grid on desktop
- Each card is a MarketCard component
- Closing soon cards have the countdown pulse micro-interaction

**Empty state**:
- Large centered text: "No markets right now"
- Subtext: "New rounds every 15 minutes"
- Subtle breathing animation on the text

### 7.3 Market Detail (`/markets/[id]`)

**Layout**: Content left (60%) + Trading panel right (40%), sticky on desktop

**Content side**:
- Asset name, strike range, countdown
- Spot price + forward price in large mono text
- Chart placeholder (simple line, white on black, no grid)
- Market metadata in a clean key-value list

**Trading panel**:
- UP / DOWN toggle (pill tabs, `layoutId` slide)
- Amount input (bottom-border style, large mono text)
- Quick amounts: `+25  +50  +100  +250` as ghost buttons in a row
- Balance shown in gray-500
- Potential payout in white, large
- Submit button: full-width white pill
- After trade: shutter animation (see micro-interactions)

### 7.4 Portfolio (`/portfolio`)

**Stats row**: 4 stat cards in a grid
- Wallet Balance, Manager Balance, Open Positions, Reputation
- Each number counts up on mount

**Manager card**: Subtle bordered card with object ID (mono, truncated) and Suiscan link

**Positions table**:
- Clean table with sortable columns
- Row hover interaction (shift + highlight)
- Redeem button on settled positions (ghost style → fills white on hover)
- Empty state: "No positions yet" + CTA to markets

### 7.5 Leaderboard (`/leaderboard`)

**Tabs**: Category (Volume / Profit / Accuracy) + Period (Week / Month / All)
- Both use the sliding pill tab pattern

**Your rank**: Highlighted card at top if wallet connected
- Slightly brighter border (`white/[0.12]`)

**Table**: Rank | Trader | Volume | Profit | Trades | Accuracy
- #1 gets a subtle white glow behind rank number
- #2, #3 slightly less
- Rest are standard rows
- Mobile: collapses to card-per-trader layout

---

## 8. Dark Mode Only

Pure black (`#000000`) is the foundation. There is no light mode. This is not "dark theme" — black IS the brand. White elements on black are the entire visual language.

---

## 9. Responsive Design

| Breakpoint | Behavior |
|---|---|
| `< 640px` | Single column. Stacked cards. Bottom-sheet modals. Header: logo + wallet + hamburger |
| `640–1024px` | 2-column grids. Inline nav. Trading panel below content |
| `> 1024px` | 3-column grids. Sticky sidebar trading panel. Full nav. Magnetic cursor |

### Mobile Menu
- Full-screen black overlay
- Links stagger in from left (`opacity: 0, x: -40` → visible)
- Each link: large display text (`text-4xl`), white
- Close button: white circle with X, `hover:rotate-90` transition
- Background: single very faint white radial gradient at center

### Touch
- All tap targets minimum `44px`
- Swipe-to-dismiss on bottom sheets
- Haptic-style visual feedback (quick scale bounce on tap)

---

## 10. Iconography

### Library: Lucide React
### Style: `strokeWidth={1.5}` — thinner than default for editorial feel

All icons are white or gray. Never colored.

| Context | Icons |
|---|---|
| Logo | Custom mark (circle + line) |
| Nav | Menu, X, ArrowUpRight |
| Markets | Clock, TrendingUp, TrendingDown, Activity, BarChart3 |
| Trading | ArrowUp, ArrowDown, Wallet, Lock |
| Portfolio | PieChart, Coins, Trophy |
| Leaderboard | Crown, Medal, Award |
| Status | Check, AlertCircle, Loader |

---

## 11. Special Effects

- **Grain/noise**: Very subtle film grain overlay over entire page (`opacity: 0.015`). Adds analog texture to the digital black.
- **Scroll progress**: `1px` white line at top of viewport, width = scroll percentage
- **Cursor glow**: On hero section, a soft `120px` white radial gradient follows the cursor at `opacity: 0.03` — barely visible, subconsciously felt
- **Text reveal**: On landing page, hero text reveals character-by-character with staggered opacity animation
- **Divider lines**: Sections separated by thin white lines that draw themselves in (left to right) as they enter viewport
- **Number morphing**: When stat values change, digits individually transition (old digit slides up and fades, new digit slides in from below)

---

## 12. Data Display

| Data Type | Format | Font | Example |
|---|---|---|---|
| Wallet address | Truncated, monospaced | JetBrains Mono | `0x1a2b...f4e9` |
| DUSDC amounts | 2 decimals, unit after | JetBrains Mono | `125.50 DUSDC` |
| BTC price | Dollar, no decimals, comma-separated | JetBrains Mono | `$95,420` |
| Probability | Cents notation | JetBrains Mono | `67c` |
| Countdown | Colon-separated | JetBrains Mono | `02:14:33` |
| Profit | Signed, green | JetBrains Mono | `+42.50` |
| Loss | Signed, red | JetBrains Mono | `-18.30` |
| Accuracy | One decimal percent | JetBrains Mono | `73.2%` |
| Volume | Abbreviated with unit | JetBrains Mono | `12.5K` |

---

## 13. Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router) |
| Styling | Tailwind CSS v4 |
| Animation | Framer Motion |
| Icons | Lucide React |
| Fonts | Sora (display), Inter (body), JetBrains Mono (data) |
| Blockchain | Sui (@mysten/dapp-kit, @mysten/sui) |
| Wallet | Sui dapp-kit ConnectButton |

---

## Summary for Claude Design

**Yosuku** is a prediction markets platform that should feel like walking into a Tadao Ando building — concrete, light, silence, precision. The palette is exclusively black and white. Typography does all the heavy lifting: Sora for cinematic headings, Inter for invisible body text, JetBrains Mono for financial data. Every interactive element responds with carefully tuned micro-interactions — magnetic buttons, sliding tab pills, number morphing, scroll-triggered reveals, and a custom cursor that scales on hover. The design is artistic but never decorative. There are no gradients, no colored backgrounds, no visual noise beyond a barely-visible film grain. White on black. Type and space. Motion and rest. That's it.
