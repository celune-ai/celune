---
name: design-document
description: "Generate a spec-compliant DESIGN.md that captures your visual system. Scans codebase for tokens and patterns. TRIGGER when: user says '/design document', 'generate design.md', 'document the design system'."
user_invocable: true
---

# /design document -- Generate DESIGN.md

Scans your codebase for existing design tokens and patterns, then writes a `DESIGN.md` following the Google Stitch format. Two modes: **Scan** (default) and **Seed** (for greenfield projects).

---

## Mode Detection

- **Scan mode** (default): Discovers tokens and patterns from existing code. Use when the project has CSS, components, or config files.
- **Seed mode** (`/design document --seed`): For projects with no code yet. Asks 5 strategic questions and writes a scaffold DESIGN.md with sensible defaults.

If `DESIGN.md` already exists at the project root, ask before overwriting. Offer to update or regenerate specific sections.

---

## Scan Mode Workflow

### Step 1: Discover Design Assets

Scan the codebase in priority order. Stop as soon as you have enough signal for each token category.

1. **CSS custom properties**: `:root`, `@theme`, `--color-*`, `--spacing-*`, `--font-*`, `--radius-*`, `--shadow-*`
2. **Tailwind config**: `tailwind.config.js` or `tailwind.config.ts`, focus on the `theme` and `extend` sections
3. **CSS-in-JS themes**: styled-components `ThemeProvider`, Chakra UI theme object, MUI `createTheme`, Mantine theme
4. **Design token files**: `tokens.json`, `design-tokens.*`, `theme.css`, `variables.css`, `_variables.scss`
5. **Component source**: Recurring patterns across components (buttons, cards, inputs, modals, badges, avatars)
6. **Existing DESIGN.md or style guides**: Any prior documentation of the visual system
7. **PRODUCT.md**: Pull register, brand personality, and design principles if available

Use `ctx_batch_execute` to run discovery commands in a single call. Typical commands:

```
- glob for: **/*.css, **/*.scss, **/tailwind.config.*, **/theme.*, **/tokens.*
- grep for: --color, --spacing, --font, --radius, --shadow, @theme, :root
- grep for: ThemeProvider, createTheme, extendTheme
- read: tailwind.config.ts, PRODUCT.md, DESIGN.md (if they exist)
```

### Step 2: Extract and Organize

Group all findings into the 6 DESIGN.md sections:

| Section            | What to Extract                                                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| 1. Overview        | Creative north star, register (from PRODUCT.md), design philosophy                                                           |
| 2. Colors          | Full palette with values, semantic roles (primary, secondary, accent, success, warning, error, neutrals), dark mode variants |
| 3. Typography      | Font stack (display, body, mono), type scale with sizes/weights/line-heights, hierarchy rules                                |
| 4. Elevation       | Shadow scale (flat through high), usage guidance                                                                             |
| 5. Components      | Key patterns found: button variants, card types, input styles, modal patterns, badges                                        |
| 6. Do's and Don'ts | Explicit guidance derived from codebase conventions and anti-patterns observed                                               |

Rules for extraction:

- **Colors**: Convert to OKLCH when possible (perceptually uniform). Keep original values as comments.
- **Typography**: Note whether fluid `clamp()` or fixed `rem` values are used. Preserve the existing approach.
- **Spacing**: Identify the base unit (typically 4px or 8px) and derive the scale.
- **Components**: Focus on variants and states, not implementation details.
- **Do's and Don'ts**: Derive from patterns you see (consistency signals) and anti-patterns you detect.

### Step 3: Write DESIGN.md

Write to project root. The file has two parts: YAML frontmatter (machine-readable tokens) and Markdown body (human-readable rationale).

**YAML Frontmatter** contains raw token values:

```yaml
---
colors:
  primary: 'oklch(65% 0.18 250)'
  secondary: 'oklch(55% 0.12 280)'
  accent: 'oklch(70% 0.20 30)'
  success: 'oklch(65% 0.15 145)'
  warning: 'oklch(75% 0.15 85)'
  error: 'oklch(60% 0.20 25)'
  neutral-50: 'oklch(98% 0.005 250)'
  neutral-100: 'oklch(95% 0.005 250)'
  neutral-200: 'oklch(90% 0.005 250)'
  neutral-300: 'oklch(80% 0.01 250)'
  neutral-400: 'oklch(65% 0.01 250)'
  neutral-500: 'oklch(50% 0.01 250)'
  neutral-600: 'oklch(40% 0.01 250)'
  neutral-700: 'oklch(30% 0.01 250)'
  neutral-800: 'oklch(20% 0.01 250)'
  neutral-900: 'oklch(15% 0.01 250)'
typography:
  display: 'Denim, serif'
  body: 'Inter, sans-serif'
  mono: 'JetBrains Mono, monospace'
  scale: [3rem, 2.25rem, 1.5rem, 1.25rem, 1rem, 0.875rem]
spacing:
  unit: 8
  scale: [4, 8, 12, 16, 24, 32, 48, 64, 96]
elevation:
  flat: 'none'
  low: '0 1px 2px oklch(0% 0 0 / 0.05)'
  medium: '0 4px 12px oklch(0% 0 0 / 0.1)'
  high: '0 12px 32px oklch(0% 0 0 / 0.15)'
radius:
  sm: '4px'
  md: '8px'
  lg: '16px'
  full: '9999px'
---
```

**Markdown Body** uses exactly 6 sections, in this fixed order with these fixed names:

```markdown
## 1. Overview

**Creative North Star:** _"[Evocative phrase that captures the visual identity]."_

[Register: Brand or Product. Design philosophy in 2-3 sentences. What makes this visual system distinctive. Pull from PRODUCT.md if available.]

## 2. Colors

### Palette

[Full color palette organized by role: primary, secondary, accent, semantic (success/warning/error), neutrals.]
[OKLCH values preferred. Include hex fallbacks in comments.]
[Light and dark mode variants where they exist.]

### Usage

[When to use which color. Neutral tinting strategy (tint toward brand hue, not pure gray). Background hierarchy (surface, elevated, sunken).]

## 3. Typography

### Font Stack

[Display, body, mono fonts with full fallback chains.]

### Type Scale

[Scale with sizes, weights, line-heights. Note whether fluid clamp() or fixed rem.]

### Hierarchy

[What each level is for: h1 = page title, h2 = section header, h3 = card title, body = content, caption = metadata.]

## 4. Elevation

[Shadow scale from flat to high with specific values. When elevation appears: interaction states (hover, focus), layering (modals, popovers, dropdowns). Elevation is functional, not decorative.]

## 5. Components

[Key component patterns found in the codebase. For each: name, variants, states, usage notes.]

[Common components to document: buttons (primary, secondary, ghost, destructive), cards (interactive, static, nested), inputs (text, select, checkbox, radio), modals/dialogs, badges/tags, avatars, navigation patterns.]

## 6. Do's and Don'ts

[Explicit guidance with examples drawn from the codebase.]

[Format as pairs:]

- DO: [positive guidance with rationale]
- DON'T: [anti-pattern with explanation]

[Cover: color usage, typography pairing, spacing consistency, component composition, accessibility.]
```

**The 6 sections are FIXED, in FIXED ORDER, with FIXED NAMES.** Do NOT add extra top-level sections (Layout Principles, Responsive Behavior, Motion, Icons, etc.). Fold that content into the six spec sections where it naturally belongs:

- Layout guidance goes in **Components** or **Do's and Don'ts**
- Responsive behavior goes in **Components** or **Do's and Don'ts**
- Motion goes in **Components** (as state descriptions) or **Elevation** (as interaction cues)
- Iconography goes in **Components**

---

## Seed Mode Workflow

Triggered by `/design document --seed`. For projects with no code yet.

### Step 1: Ask 5 Questions

Present these in a single message. Wait for answers before proceeding.

1. **Color strategy:** "Warm, cool, or neutral? Any brand colors already decided? (hex values or descriptions)"
2. **Type direction:** "Editorial/serif, clean/sans-serif, technical/mono, or mixed?"
3. **Motion energy:** "Minimal (product UI), moderate (marketing + product), or cinematic (brand experience)?"
4. **References:** "Name 2-3 products whose visual style you admire."
5. **Anti-references:** "Name 2-3 visual styles to actively avoid."

### Step 2: Generate Scaffold

Write a DESIGN.md with:

- Sensible defaults derived from the answers
- OKLCH color palette based on the stated strategy
- Type scale using the chosen direction
- Standard spacing scale (8px base)
- Standard elevation scale
- Component patterns appropriate for the register
- Do's and Don'ts tailored to the stated anti-references

Mark scaffold values with `<!-- SCAFFOLD: replace with final value -->` comments so they're easy to find and update later.

### Step 3: Inform

Tell the user: "Scaffold written to DESIGN.md. Refine token values as the visual direction solidifies. Run `/design document` again after building components to update with real values."

---

## Important Notes

- **DESIGN.md is the visual companion to PRODUCT.md.** Strategy lives in PRODUCT.md, visuals in DESIGN.md. Do not duplicate strategic content.
- **YAML frontmatter is machine-readable.** Tools and agents can parse it to enforce token consistency. Keep values precise and parseable.
- **Markdown body is human-readable rationale.** Explain _why_, not just _what_. Tokens without context are useless.
- **OKLCH for colors** when possible. It's perceptually uniform, meaning equal numeric steps produce equal visual steps. Include hex fallbacks for tools that don't support OKLCH.
- **The creative north star should be evocative and memorable.** Not "clean and modern" (that describes everything). Something like "A well-lit workshop; warm wood, sharp tools, nothing wasted."
- **Cross-check the Anti-Pattern list** from the main `/design` skill. If the discovered tokens violate any anti-pattern (e.g., no focus states, body text under 16px), note it in the Do's and Don'ts section.
- **If PRODUCT.md exists**, pull register, brand personality, and anti-references into the Overview section. These inform the creative north star.
- **Partial updates**: When updating an existing DESIGN.md, preserve sections the user hasn't asked to change. Only regenerate what's requested.
