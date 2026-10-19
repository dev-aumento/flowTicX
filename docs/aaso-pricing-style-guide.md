# Aaso pricing page — style guide

Source frame: [Updated Pricing page — 24/9](https://www.figma.com/design/11EuVL05gqcjrE8RG0jQLA/Aaso-pricing-page?node-id=1-50)  
File key: `11EuVL05gqcjrE8RG0jQLA`  
Node: `1:50`  
Captured: 16 Oct 2026

Use this file as the visual source of truth when a new pricing section is designed from a screenshot. Match these tokens, the 1440px content column, and the section patterns below. Do not invent a second palette.

Colors in this file are hardcoded on the canvas. The only bound variables on the frame are `stroke weight/1` = 1 and `item spacing/xs` = 8.

## Canvas

| Token | Value |
| --- | --- |
| Artboard | 1920 × 5396 |
| Content column | 1440px, inset 240px from each side |
| Header height | 80px |
| Page surface | Pale cool white. Hero, pricing, feature, FAQ, and trust sections are transparent and sit on that canvas |
| Footer surface | `#000000` |

## Color

| Role | Value | Where it shows up |
| --- | --- | --- |
| Brand blue | `#2563eb` | Active nav, primary buttons, headline accent, links, icon tiles |
| Deep annotation blue | `#0037b0` | Handwritten notes |
| Ink | `#000000` | Headlines, plan names, prices, FAQ questions |
| Body | `#434655` | Plan descriptions, feature lines, support copy |
| Muted | `#8c9dac` | Nav, subcopy, footer links, inactive toggle |
| Placeholder | `#9ca3af` | Email field placeholder |
| White | `#ffffff` | Header, default cards, FAQ rows, inverse CTA label |
| Eyebrow fill | `#dce9ff` | “Simple pricing” chip |
| Chip / soft fill | `#eff4ff` | Industry pills, email field |
| Hairline blue | `#e5eeff` | Card borders, pill borders, dividers |
| Blue wash 10% | `rgba(37, 99, 235, 0.1)` | Secondary buttons, icon tiles, comparison collapse button |
| Blue wash 20% | `rgba(37, 99, 235, 0.2)` | Popular plan card, small label pills |
| Soft panel | `rgba(239, 244, 255, 0.7)` | Comparison header, payment bar |
| Toggle track | `rgba(140, 157, 172, 0.14)` | Monthly / Yearly track |
| Inactive segment | `#e9ecf3` | Unselected Yearly segment |
| Success ink | `#047857` | “Save up to 20%” note |
| Success ink, soft | `rgba(4, 120, 87, 0.9)` | “with yearly billing” |
| Neutral hairline | `rgba(196, 197, 215, 0.3)` | Trust card and payment badges |
| Neutral badge | `#d5e0e9` | “FREE TIER” and “TAILORED PLAN” badges (black label) |
| Ambient glow | `rgba(220, 225, 255, 0.3)` → `rgba(229, 238, 255, 0.2)` → transparent | Hero blob, 850 × 380, blur 32, radius 12 |

Payment wordmarks, used only inside badge chips: Visa `#1e40af`, Razorpay `#0c2340`, PayPal `#003087`, UPI `#097939`, Stripe `#635bff`. Mastercard is two 24px circles, `#ef4444` and `#f59e0b`, overlapping.

## Type

| Style | Family | Weight | Size / line-height | Use |
| --- | --- | --- | --- | --- |
| Display | Plus Jakarta Sans | ExtraBold | 52 / normal | Hero headline only |
| Section title | Plus Jakarta Sans | ExtraBold | 36 / normal | FAQ, comparison, closing banner |
| Plan price | Inter | Bold | 32 / normal | `$59` and the other prices |
| Card title | Inter | Medium or Bold | 20 / normal | Plan names, benefit titles |
| Social proof title | Inter | Semi Bold | 24 / normal | “Loved by 500+ teams” |
| Body large | Inter | Regular | 18 / 30 | Hero subcopy |
| Body | Inter | Regular | 16 / 24 | Descriptions, footer, FAQ support line |
| UI / button | Inter | Semi Bold | 16 / 20 | Nav actions, buttons, industry pills |
| Nav link | Inter | Regular | 16 / normal | Header links |
| Eyebrow | Inter | Semi Bold | 14 / normal, uppercase | Section kickers, in brand blue |
| Feature line | Inter | Regular | 13 / normal | Checklist rows inside plan cards |
| Seat line | Inter | Semi Bold | 15 / normal | “Up to 25 team members” |
| Handwriting, hero | Caveat | Bold | 32 / 30, tracking 0.6px | “Build / Manage / Grow Together”, rotated about 6° |
| Handwriting, save | Caveat | Bold | 25.5 / 31.875 and 22.5 / 28.125 | Yearly savings note |
| Handwriting, trust | Caveat | Bold | 30 / 37.5 | “Built for Service Businesses”, rotated about 2° |
| Badge | Plus Jakarta Sans | Medium | 14, uppercase | “MOST POPULAR” |
| Footer heading | Plus Jakarta Sans | Semi Bold | 16 | Product, Resources, Company, “STAY UP TO DATE” |

Hero headline is black except the words **Entire Business**, which are `#2563eb`.

## Radius, shadow, and stroke

| Element | Radius | Shadow / stroke |
| --- | --- | --- |
| Header | square | Blur 12px, `0 1px 4px rgba(0,0,0,0.04)` |
| Primary button | 8px | `0 2px 5px rgba(29,78,216,0.2)` on the header button |
| Strong CTA button | 10px | `0 24px 35px rgba(9,20,35,0.28)` or `0 24px 70px rgba(9,20,35,0.28)` |
| Secondary button | 8px | 1px `#2563eb` border, 10% blue fill, blue label |
| Ghost button on blue | 10px | 1px white border, transparent fill, white label |
| Industry pill | 100px | 1.5px `#e5eeff`, fill `#eff4ff`, padding 17.5 × 10 |
| Eyebrow chip | 16px on top-left and bottom-right only | Fill `#dce9ff`, `0 1px 1px rgba(0,0,0,0.05)`, padding 14 × 10 |
| Plan card | 12px | 1.5px `#e5eeff`. Default shadow `0 1.5px 1.5px rgba(0,0,0,0.05)`. Popular card uses `0 1.5px 3px rgba(0,0,0,0.05)` |
| Benefit card | 24px | Same 1.5px border and light shadow, padding 31.5px |
| Icon tile | 12px | 50 × 50, fill `rgba(37,99,235,0.1)` |
| Label pill | 18px | Fill `rgba(37,99,235,0.2)`, padding 12 × 6 |
| Popular badge | 84px | Solid `#2563eb`, white label, height 24, overlaps the card top |
| Neutral badge | 84px | `#d5e0e9`, black label, same size and position as the popular badge (Free, Enterprise) |
| Billing toggle | track 10px, selected segment 8px | Selected segment is solid blue with `0 9px 24.5px rgba(9,20,35,0.08)` |
| FAQ row | 8px | White, `0 1px 1px rgba(0,0,0,0.05)`, padding 16 × 18 |
| Closing banner | 24px | Solid `#2563eb`, `0 25px 50px -12px rgba(0,0,0,0.25)`, padding 64 |
| Comparison header | 16px on the top corners | Fill `rgba(239,244,255,0.7)` |
| Email field | 8px | Fill `#eff4ff`, height 48. Join button inside is radius 6 |
| Payment badge | 6px | White, 1.5px neutral hairline |

Default stroke on cards and pills is **1.5px**, not 1px. The 1px variable is not what the visible cards use.

## Spacing

- Side inset for header, footer, trust strip, and the main column: **240px**.
- Hero inner column: **896px**, centered, with 60px vertical padding and 40px between the headline block and the industry pills.
- Headline stack gap: **18px**. Industry label to pills: **20px**. Pill gap: **16px**.
- Plan cards: **280px** wide, **16px** gap, **16px** inner padding, **678px** tall. Six cards sit in one row (1760px including the side breathing room of the section).
- Inside a plan card, stacks use **20px**, **16px**, and **8px**. Checklist icon is 16px with an 8px gap.
- Benefit row: four **342px** cards, **24px** gap.
- FAQ rows: **16px** gap. Section title block gap: **16px**, then **40px** down to the list.
- Footer: padding top 60, bottom 24, column gap 40, link gap 20.

## Components

### Header

White bar, logo left (mark + “aaso” wordmark), nav centered, actions right.

Nav: Product, Solutions, Features, **Pricing** (brand blue), Resources. Idle links are `#8c9dac`.

Actions: text button **Sign In** in brand blue, then solid **Start Free Trial**.

### Buttons

| Variant | Fill | Label | Border |
| --- | --- | --- | --- |
| Primary | `#2563eb` | White, Inter Semi Bold 16 | none, or 1px same blue on cards |
| Secondary | `rgba(37,99,235,0.1)` | `#2563eb` | 1px `#2563eb` |
| Inverse on the blue banner | `#ffffff` | `#2563eb` | none |
| Ghost on the blue banner | transparent | White | 1px white |

Card CTAs are full width, padding 20 × 10, radius 8. Banner CTAs use padding 20 × 15 and radius 10.

### Billing toggle

Track fill `rgba(140,157,172,0.14)`, padding 6, radius 10.

- Selected: **Monthly**, solid blue, white label, radius 8, padding 20 × 15.5.
- Unselected: **Yearly**, `#e9ecf3`, muted label, radius 4.

A green Caveat note sits to the right, with a curved arrow aimed at Yearly: “Save up to 20%” / “with yearly billing”.

### Plan card

Top to bottom:

1. Optional badge, overlapping the top edge (only Growth shows **MOST POPULAR**).
2. Plan name, 20px.
3. One- or two-line description in `#434655`, 14 / 20.
4. 1.5px divider.
5. Price in 32px bold, with “/ month” in 16px `#434655` on the baseline.
6. Seat line, 15px semi bold.
7. Full-width CTA.
8. Checklist, 13px, 16px check icons, 16px row gap. A second divider splits the list into a core group and an extended group.

Default card: white fill, secondary CTA labeled **Start Free Trial**.  
Popular card (Growth): fill `rgba(37,99,235,0.2)`, primary CTA labeled **Get Started Now**.

### Benefit card

White, radius 24. Top row is a 50px icon tile and a small pill. Title 20px. Body 16 / 24 in `#434655`. Footer is a top border and a 14px semi bold brand-blue line.

### FAQ row

White, radius 8, question in Inter Semi Bold 18 / 24, chevron on the right. Rows in this frame are collapsed.

### Handwritten notes

Use Caveat, brand or green ink, a slight rotation, and a simple curved arrow. They are annotations, not UI controls. Do not set them in Inter.

## Page structure

Order on the frame, top to bottom:

1. **Header** — 80px.
2. **Hero** — 560px. Eyebrow “SIMPLE PRICING. COMPLETE SOLUTION.” Headline “One Platform for Your Entire Business”. Subcopy: “Projects. People. Clients. Time. Finance. AI. All included. No separate apps. No hidden fees. Just real value.” Then “TAILORED FOR YOUR INDUSTRY & TEAM:” and pills: Project Management, CRM, Client Portal, Time Tracking, HR & People, Finance & Invoicing, AI Assistant. Handwritten note at the upper right: Build / Manage / Grow Together.
3. **Plans** — 900px. Billing toggle, then six cards.
4. **Everything included** — four benefit cards.
5. **Detailed comparison** — 1320px table.
6. **Trust and payments** — social proof card, then payment bar.
7. **FAQ** — five questions.
8. **Closing banner** — blue, radius 24.
9. **Footer** — black.

### Plans (monthly, as drawn)

| Plan | Audience | Price | Seats | CTA |
| --- | --- | --- | --- | --- |
| Free | Freelancers and small teams exploring AASO | $0 / month | Up to 5 | Get Started Free |
| Starter | Boutique service agencies and growing consultancies | $29 / month | Up to 10 | Start Free Trial |
| Growth | Scaling firms that need pipeline automation and client billing | $59 / month | Up to 25 | Get Started Now. Badge: MOST POPULAR |
| Business | Established multi-team agencies and operational leaders | $99 / month | Up to 50 | Start Free Trial |
| Scale | High-throughput organizations with strict security needs | $199 / month | Up to 100 | Start Free Trial treatment |
| Enterprise | Custom workflows, massive volume, and bespoke compliance | Custom / month. “Tailored pricing for your scale” | 100+ | Contact Sales |

Starter checklist: Unlimited projects & clients; Tasks, Kanban & interactive Gantt; Time tracking & team timesheets; Full client portal with file share; then Attendance & leave tracking; Basic CRM & client contact book; Financial summaries & dashboards; Mobile & desktop native apps; 5 GB secure cloud storage; Standard email support (24h response).

Growth checklist: Everything in Starter; Advanced CRM & pipeline deals; Project profitability & margin forecasting; Automated invoicing & Stripe sync; No-code workflow automations; then Expense & vendor receipt tracking; AI summaries & predictive workload; Deep integrations (Slack, Google, Zoom); 25 GB fast cloud storage; Priority live chat & email support.

### Benefit cards

| Pill | Title | Footer line |
| --- | --- | --- |
| Zero Seat Cost | Clients are always free | Unlimited portal accounts |
| Total Freedom | No long-term contracts | Cancel or upgrade anytime |
| Dedicated Humans | 24/7 Priority support | < 5 min median response |
| Unified Stack | All in one platform | Zero third-party add-on fees |

### Comparison table

Kicker **DEEP DIVE**. Title “Detailed Feature Comparison”. Support line: “Everything you need to select the right operational tier for your firm.” Right action: **Collapse Comparison Table**, secondary button, radius 10, with an up chevron.

Columns: Feature Area, Free, Starter, Growth, Business, Scale, Enterprise.

Groups and rows:

- Workspace & user seats — Team Member Limit, Active Projects, Cloud File Storage
- Client management & portals — Unlimited Client Guests, White-label Custom Domain Portal, Client Approvals & E-Signatures
- Time, billing & profitability — Timesheets & Live Timer, Multi-Currency Invoicing & Stripe Sync, Project Profitability & Margin Forecasting
- Security, compliance & support — SAML 2.0 Single Sign-On (SSO), Dedicated Account Manager & SLA

Row styling: the column header row is white, “Feature Area” in Inter Bold 20. Group rows (for example “WORKSPACE & USER SEATS”) are Inter Semi Bold 18, uppercase, padding 20, about 62px tall. Data rows are white, 62–64px tall, with labels in Inter Medium 18, inset 20px. Values in the Growth column are in brand blue, which matches the popular card.

Visible cell pattern: limits as short labels (“5 members”, “3 projects”, “1 GB”), inclusion as “✓ Included”, and absence as an em dash. Higher tiers replace the dash with Included, Advanced, Advanced + AI, Real-time, Optional SLA, or a custom phrase such as “Full Custom CSS” and “99.99% Custom SLA”.

### Trust and payments

White card, radius 24. Left: four overlapping 60px portraits, radius 18, 3px white ring, 12px overlap. Then five stars, **4.9/5**, “Loved by 500+ teams worldwide”, and “Accelerating delivery, client clarity & billables”. Right of that: **Start Your Free Trial** and “No credit card required • 30 day full access”. Far right, handwritten: “Built for / Service Businesses”.

Second bar, soft panel, radius 24: lock icon tile, “Accepted Payment Methods & Currencies”, “Instant activation • Subscriptions in USD ($) or INR (₹) with compliant tax invoices”, then badges for Visa, Mastercard, Razorpay, PayPal, UPI, and Stripe, plus “256-bit SSL Encrypted”.

### FAQ

Kicker **GOT QUESTIONS?** Title “Frequently Asked Questions”. Support: “Clear answers to help you make an effortless decision.”

1. Can I change or upgrade my plan at any point?
2. How does the 'Clients are always free' policy actually work?
3. Are there any hidden fees, implementation costs, or contract lock-ins?
4. What payment methods and currencies are supported?
5. What happens when my 30 day free trial ends?

### Closing banner

Kicker, white, 14px uppercase: “READY TO MODERNIZE YOUR OPERATIONS?”  
Title, 36px ExtraBold: “Start your 30 day free trial now”.  
Body, 16 / 24: “Experience how 500+ service organizations eliminate app fatigue, accelerate billables, and delight their clients.”  
Buttons: **Talk to a Specialist** (ghost) and **Start Free Trial** (white).

### Footer

Black. Logo and this line: “Unified modern infrastructure for precision time tracking, project operations, and customer relationship workflows in high-velocity teams.”

Newsletter: **STAY UP TO DATE**, field placeholder `work@company.com`, button **Join**.

Columns, with vertical dividers: Product (Tasks, Time Tracking, Activity Monitoring, Analytics), Resources (Help Center, Guides), Company (About, Contact, Privacy, Terms).

Bottom bar: “© 2026 aaso Inc. Built for focused teams.” LinkedIn and Instagram marks on the right.

## Hidden layers — do not design from these

These layers are on the frame and turned off. A new section should not revive them.

- Hero eyebrow “INTRODUCING AASO 2.0 • BUILT FOR FOCUSED TEAMS”
- Alternate hero line about losing billable hours
- A second Monthly / Yearly toggle inside the hero
- “MOST POPULAR” on the Business card (Growth is the only visible popular plan)
- Footer Solutions column and the Facebook / LinkedIn / X icon row
- Leftover list rows named Booking Management, Itinerary & Packages, Customers & Leads, Payments & Invoicing

Rupee price strings exist in the layer tree. The card components that render on the canvas show USD monthly prices.

## Hero overrides (newer design, not in Figma file)

The user supplied a newer hero design on 16 Oct 2026. It differs from frame `1:50`, and it wins for the hero (built in `src/components/billing/PricingHero.tsx`):

- Headline and pill text are navy `#0b1c30` rather than black. The headline line height is 66px.
- The label reads “BUILT FOR EVERY TEAM & WORKFLOW:”, with a 16px gap down to the pills. There are five pills: Project Management, Client Portal, Time Tracking, HR & People, Finance & Invoicing.
- The subtext is about 620px wide and wraps to three lines.
- The handwritten note is `#2563eb` (text and arrow), Caveat Bold 36 / 45, rotated 6°. Lines are staggered left-aligned: “Build” indented 62px, “Manage” 39px, “Grow Together” 0.
- The note is anchored to the word “Entire”. Arrow ink sits +62px right and +51px below the word's cap top. “Build” sits at +110 / +122.
- A soft glow sits behind the note: a radial `rgba(121,152,212,0.38)` core fading out over about 300px, centered about 330px right of “Entire”.

## Implementing in this repo

- Stack: React + TypeScript + Tailwind (shadcn-style tokens in `tailwind.config.js`). Write the Figma hex values as Tailwind arbitrary values (`bg-[#2563eb]`, `border-[1.5px] border-[#e5eeff]`). Do not remap them onto the shadcn `primary` / `muted` tokens, because those carry the app theme, not this page.
- Fonts are already loaded in `src/index.css` (Inter, Plus Jakarta Sans 400–800, Caveat 700). Use `font-['Plus_Jakarta_Sans']` and `font-['Caveat']` for those faces. Inter is the body default.
- The existing pricing page is `src/pages/RenewPricing.tsx`. The billing interval comes from `PlanIntervalTabs` (`src/components/billing/PlanIntervalTabs`), so a new toggle should restyle or wrap that component instead of duplicating its state.
- Figma draws at 1920px. Build with `max-w-[1440px] mx-auto` and responsive padding instead of a fixed 240px inset, and let fixed-width rows (six plan cards, four benefit cards) wrap or scroll below desktop widths.

## Rules for the next section

When a screenshot arrives, build only that section, and keep it inside this system:

- Stay on the pale canvas. Use white cards, brand blue for the one primary action, and `#434655` / `#8c9dac` for supporting text.
- Keep the section inside the 1440px column (240px side inset on a 1920 canvas) unless it is a full-bleed bar like the header, footer, or blue banner.
- Use Plus Jakarta Sans ExtraBold for a section title at 36px, Inter Semi Bold 14px uppercase in `#2563eb` for the kicker, and Inter Regular 16 / 24 in `#8c9dac` for the support line.
- Reuse plan-card, benefit-card, pill, FAQ-row, or banner styling when the screenshot is the same kind of block. Do not introduce a new radius, a new blue, or a new font.
- Primary action text stays in the existing set: Start Free Trial, Get Started Now, Get Started Free, Contact Sales, Talk to a Specialist, Join.
- Handwritten Caveat notes are optional accents. Use them only when the screenshot shows one, in `#0037b0` or `#047857`, with a slight rotation.
