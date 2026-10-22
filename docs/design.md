---
name: Enterprise Trust & Velocity
colors:
  surface: '#f8f9ff'
  surface-dim: '#cbdbf5'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e5eeff'
  surface-container-high: '#dce9ff'
  surface-container-highest: '#d3e4fe'
  on-surface: '#0b1c30'
  on-surface-variant: '#434651'
  inverse-surface: '#213145'
  inverse-on-surface: '#eaf1ff'
  outline: '#747782'
  outline-variant: '#c4c6d3'
  surface-tint: '#395ca8'
  primary: '#00225a'
  on-primary: '#ffffff'
  primary-container: '#093782'
  on-primary-container: '#83a4f5'
  inverse-primary: '#b1c5ff'
  secondary: '#455d95'
  on-secondary: '#ffffff'
  secondary-container: '#a8c0ff'
  on-secondary-container: '#354d84'
  tertiary: '#002061'
  on-tertiary: '#ffffff'
  tertiary-container: '#003490'
  on-tertiary-container: '#84a2ff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dae2ff'
  primary-fixed-dim: '#b1c5ff'
  on-primary-fixed: '#001946'
  on-primary-fixed-variant: '#1c438e'
  secondary-fixed: '#d9e2ff'
  secondary-fixed-dim: '#b0c6ff'
  on-secondary-fixed: '#001945'
  on-secondary-fixed-variant: '#2c457c'
  tertiary-fixed: '#dbe1ff'
  tertiary-fixed-dim: '#b4c5ff'
  on-tertiary-fixed: '#00174b'
  on-tertiary-fixed-variant: '#003ea8'
  background: '#f8f9ff'
  on-background: '#0b1c30'
  surface-variant: '#d3e4fe'
typography:
  headline-xl:
    fontFamily: Plus Jakarta Sans
    fontSize: 2.25rem
    fontWeight: '700'
    lineHeight: 2.75rem
    letterSpacing: -0.025em
  headline-xl-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 1.75rem
    fontWeight: '700'
    lineHeight: 2.25rem
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 1.75rem
    fontWeight: '700'
    lineHeight: 2.25rem
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 1.25rem
    fontWeight: '600'
    lineHeight: 1.75rem
    letterSpacing: -0.015em
  headline-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 1.125rem
    fontWeight: '600'
    lineHeight: 1.5rem
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 1rem
    fontWeight: '400'
    lineHeight: 1.5rem
    letterSpacing: 0em
  body-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 0.875rem
    fontWeight: '400'
    lineHeight: 1.375rem
    letterSpacing: 0em
  body-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 0.75rem
    fontWeight: '400'
    lineHeight: 1.125rem
    letterSpacing: 0.01em
  label-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 0.875rem
    fontWeight: '600'
    lineHeight: 1.25rem
    letterSpacing: -0.005em
  label-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 0.8125rem
    fontWeight: '500'
    lineHeight: 1.125rem
    letterSpacing: 0em
  label-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 0.75rem
    fontWeight: '500'
    lineHeight: 1rem
    letterSpacing: 0.02em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1.5rem
  gutter-mobile: 1rem
  margin: 2rem
  margin-mobile: 1rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.5rem
---

## Brand & Style
The design system reflects institutional authority, technical precision, and modern SaaS efficiency. Tailored for onboarding flows, authentication, and secure registration portals, it inspires confidence and clarity at the critical first point of user conversion.

The visual style blends **Corporate Modern** with **High-Precision Functionalism**. The aesthetic emphasizes crisp structure, deliberate whitespaces, subtle tonal depth, and tactile focus states that reassure enterprise buyers, technical decision-makers, and business professionals. Extraneous decoration is stripped away in favor of purposeful layout hierarchy, razor-sharp forms, and immediate visual validation.

## Colors
The color architecture establishes an immutable sense of security and professional gravitas through high-contrast structural values:

- **Primary (`#093782`)**: Deep Royal Blue acts as the core brand anchor, applied to primary call-to-actions, focused input indicators, and key structural marks.
- **Secondary / Interactive Dark (`#06265C`)**: Deepened midnight navy reserved strictly for hover, active, and pressed states of primary elements.
- **Tertiary (`#2563EB`)**: High-visibility cobalt blue used selectively for inline hyperlinks, secondary action accents, and progress metadata.
- **Neutrals & Surfaces**:
  - `Surface Base`: `#FFFFFF` for main form cards, modal panels, and field interiors.
  - `Surface Subdued / Canvas`: `#F8FAFC` for page backdrops, split-screen brand sidebars, and structural framing.
  - `Text Primary`: `#111827` (slate-black) for headlines, input text, and high-emphasis labels.
  - `Text Secondary`: `#64748B` (slate-gray) for helper text, placeholders, subheadings, and legal disclaimers.
  - `Border Default`: `#D1D5DB` for idle input boundaries and quiet dividers.
  - `Border Focus`: `#093782` paired with an accessible outer focus ring.
  - `Feedback / Semantic`: Success `#059669`, Error `#DC2626`, Warning `#D97706`.

## Typography
Typographic scale and letterforms are driven by **Plus Jakarta Sans**, offering geometric rigor with optimized legibility across dense authentication screens.

Headlines employ tight negative tracking (`-0.025em` to `-0.015em`) with bold or semi-bold weights to convey firmness. Body copy stays open and readable with neutral tracking, optimizing field labels, form explanations, and terms of service. Labels and metadata prioritize medium to semi-bold weights with precise line-height matching to guarantee alignment next to form inputs, check icons, and status indicators.

## Layout & Spacing
The layout adheres strictly to an 8px base rhythm with a 4px sub-grid for micro-alignments (e.g., input icons, badges, helper text spacing).

- **Page Layout**: Centered standalone card modal (max-width `480px` to `520px`) for clean single-focus flows, or a split 50/50 responsive layout (form on one panel, brand endorsement and social validation on `#093782` or light neutral tint on the other).
- **Desktop (1024px+)**: Form containers maintain `2.5rem` (`space-xl`) internal padding; standard input row vertical gap is `1.25rem` to `1.5rem`.
- **Tablet (768px - 1023px)**: Container padding steps down to `2rem`, preserving side gutters of `1.5rem`.
- **Mobile (<768px)**: Card borders collapse gracefully into edge-to-edge layouts or a slim padded card with `1rem` outer margin, `1.25rem` internal padding, and full-width touch targets.

## Elevation & Depth
Elevation is achieved using quiet tonal layering coupled with multi-stop, soft-diffuse ambient drop shadows. The design system rejects heavy or harsh outlines in favor of structured boundary definition:

- **Level 0 (Flat)**: Background plane (`#F8FAFC`). No shadow.
- **Level 1 (Card / Container)**: Registration container on white (`#FFFFFF`) with subtle border (`1px solid #E2E8F0`) and an ambient shadow: `0 4px 6px -1px rgba(9, 55, 130, 0.04), 0 10px 15px -3px rgba(17, 24, 39, 0.05)`.
- **Level 2 (Dropdowns / Tooltips / Popovers)**: Password requirement flyouts and country selectors utilize `0 10px 25px -5px rgba(9, 55, 130, 0.08), 0 8px 10px -6px rgba(17, 24, 39, 0.04)`.
- **Focus Elevation**: Active input states elevate subtly via focus ring illumination: `box-shadow: 0 0 0 3px rgba(9, 55, 130, 0.15)`.

## Shapes
The shape language establishes a deliberate contrast between macro and micro containers:

- **Macro Containers (Main Sign-Up Card)**: Configured with `1.125rem` (18px) corner radius (within the 16px–20px range), delivering a smooth, contemporary silhouette without feeling informal.
- **Micro UI Elements (Input Fields, Buttons, Social Auth Badges)**: Sized with `0.625rem` (10px) corner radius (balanced within the 8px–12px spectrum), maintaining structural precision and crisp mechanical interaction points.
- **Micro Badges & Checkboxes**: Small tags and checkboxes use `4px` to `6px` radii for maximum functional clarity.

## Components

### 1. Primary Buttons
- **Default**: Background `#093782`, text `#FFFFFF`, radius `10px`, typography `label-lg`, height `48px`, horizontal padding `1.5rem`.
- **Hover**: Background `#06265C`, smooth transition `150ms cubic-bezier(0.4, 0, 0.2, 1)`.
- **Focus-Visible**: Outline `2px solid #093782`, outline-offset `2px`.
- **Disabled**: Background `#E2E8F0`, text `#94A3B8`, cursor `not-allowed`.

### 2. Secondary & Social Auth Buttons (Google, SSO, GitHub)
- **Structure**: Background `#FFFFFF`, border `1px solid #D1D5DB`, text `#111827`, height `48px`, radius `10px`.
- **Hover**: Background `#F8FAFC`, border color `#94A3B8`.
- **Active**: Background `#F1F5F9`.

### 3. Text Input Fields
- **Container**: Height `46px`, background `#FFFFFF`, border `1px solid #D1D5DB`, border-radius `10px`, padding `0 14px`, text color `#111827`, typography `body-md`.
- **Placeholder**: Color `#64748B`.
- **Focus**: Border color `#093782`, box-shadow `0 0 0 3px rgba(9, 55, 130, 0.15)`.
- **Error State**: Border color `#DC2626`, box-shadow `0 0 0 3px rgba(220, 38, 38, 0.15)`, trailing alert icon.
- **Password Toggle**: Inline trailing clickable icon button (`#64748B` default, `#111827` active).

### 4. Checkboxes & Radio Controls
- **Size**: 18px × 18px, border-radius `4px` (checkbox) / `50%` (radio), border `1.5px solid #D1D5DB`.
- **Checked**: Background `#093782`, border-color `#093782`, crisp white checkmark icon.
- **Focus**: Ring `3px rgba(9, 55, 130, 0.2)`.

### 5. Password Strength Meter & Requirement List
- **Bar Segment**: Height `4px`, radius `2px`, segmented into 4 progress steps transitioning from `#EF4444` (weak) to `#F59E0B` (medium) to `#059669` (strong).
- **Rule Items**: Typography `body-sm`, icon size `14px`; unfulfilled `#64748B` with empty ring, fulfilled `#059669` with check icon.

### 6. Sign-Up Card Container
- **Surface**: Background `#FFFFFF`, border `1px solid #E2E8F0`, border-radius `18px`, padding `2.5rem`, Level 1 ambient elevation. Includes an optional subtle enterprise security reassurance footer (e.g., SOC2 / 256-bit SSL encrypted lock badge).