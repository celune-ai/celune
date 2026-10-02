---
name: design-extract
description: "Consolidate design drift into reusable primitives. Discovers repeated values and proposes tokens, components, and patterns. TRIGGER when: user says '/design extract', 'extract tokens', 'consolidate patterns', 'find design drift'."
user_invocable: true
---

# /design extract -- Consolidate Drift Into Primitives

Every codebase drifts. A color gets hardcoded here, a card pattern gets reimplemented there, spacing values multiply without a scale. Extract discovers repeated values with the same intent (3+ usages), proposes reusable primitives, and migrates callers.

This is for projects that have shipped enough to reveal patterns. Don't extract prematurely from a codebase with two components. Wait until drift is visible, then consolidate.

---

## When to Use

- The codebase has 10+ components and no formal design system
- Colors, spacing, or type sizes are hardcoded in multiple places with slight variations
- The same UI pattern (card, form row, toolbar) is implemented differently across pages
- A design review reveals inconsistency across features built at different times
- Before starting a design system; extract discovers what the system should codify

---

## How It Works

Scan the codebase for repeated values across five categories. For each, discover patterns, propose primitives, and plan migration.

### Category 1: Tokens (Design Variables)

Values that appear 3+ times with the same semantic intent.

**Scan for:**

- **Colors:** hex values, rgb/hsl values, opacity patterns. Group by intent (background, text, border, accent).
- **Spacing:** margin and padding values. Identify the implicit scale (are they multiples of 4? 8? random?).
- **Border radius:** how many distinct values exist? Are they consistent?
- **Shadows:** box-shadow declarations. How many levels of elevation?
- **Transitions:** duration and easing values. Are they consistent?

**Propose:**

- A token file (CSS custom properties, Tailwind config, or design system format) with semantic names
- Color tokens: `--color-surface`, `--color-text-primary`, `--color-accent`, not `--blue-500`
- Spacing scale: normalize to a consistent base (4px, 8px recommended). Map existing values to the nearest scale step.
- Name by intent, not value: `--radius-card` not `--radius-12`

### Category 2: Components

UI elements that appear 3+ times with the same purpose but different implementations.

**Scan for:**

- **Buttons:** how many variants exist? Are they consistent in size, padding, border-radius?
- **Cards:** how many card-like containers exist? Do they share padding, shadow, radius?
- **Inputs:** text fields, selects, checkboxes. Consistent height, border, focus state?
- **Modals/dialogs:** consistent backdrop, sizing, close behavior?
- **Badges/pills:** consistent height, padding, font-size?

**Propose:**

- Canonical component for each pattern with defined variants (size, color, state)
- Migration plan: which existing implementations become which variant
- Flag edge cases: implementations that are close but intentionally different

### Category 3: Composition Patterns

Layout patterns that repeat across pages.

**Scan for:**

- **Form rows:** label + input + help text. Same layout structure, different implementations?
- **Toolbar groups:** action buttons in a horizontal row. Consistent spacing and alignment?
- **List items:** repeated row structures in lists and tables. Same information density?
- **Page headers:** title + description + actions. Same structure across pages?
- **Empty states:** consistent or ad-hoc?

**Propose:**

- Layout primitives: `FormRow`, `Toolbar`, `PageHeader` as composable patterns
- Not necessarily React components; could be CSS patterns, utility classes, or documented conventions
- Show the canonical version and the variations that exist

### Category 4: Type Styles

Typography combinations that repeat.

**Scan for:**

- Heading styles: how many size/weight/color combinations are used for headings?
- Body text: is body text consistent across pages?
- Metadata text: timestamps, secondary info, captions. Consistent size and color?
- Monospace/code text: consistent treatment?

**Propose:**

- Type scale: a defined set of text styles with semantic names (heading-1, body, caption, metadata)
- Map each existing usage to a scale step. Flag outliers.
- Include line-height and letter-spacing, not just size and weight

### Category 5: Animation Patterns

Motion treatments that repeat.

**Scan for:**

- Entrance animations: fade in, slide in, scale in. Consistent or varied?
- Hover transitions: what changes on hover, at what speed?
- Page transitions: consistent or page-specific?
- Loading states: skeleton, spinner, shimmer. Consistent treatment?

**Propose:**

- Animation tokens: standard durations (fast: 100ms, normal: 200ms, slow: 300ms) and easing curves
- Standard animation patterns: `fadeIn`, `slideUp`, `scaleIn` as reusable definitions
- Reduce to the minimum set. If 5 different fade-in durations exist, propose 2.

---

## The 3+ Rule

The threshold for extraction is 3+ usages with the same intent. Below that, it might be coincidence. At 3, it's a pattern.

**Same intent** means the usages serve the same purpose, not just the same value. Two `#3b82f6` usages where one is a link color and one is a chart color are not the same intent, even though they're the same hex.

**Exception:** if 2 usages exist and a 3rd is clearly coming (a pattern that will be needed in the next feature), it's reasonable to extract early. But flag it as pre-emptive.

---

## Process

1. **Scan the codebase.** Use automated tools where possible: grep for hex values, find spacing patterns, list component files.
2. **Group by intent.** Same value does not mean same token. Group by what the value does, not what it is.
3. **Propose primitives.** For each category, present: the primitive name, its definition, and the callers that would migrate to it.
4. **Prioritize by impact.** Tokens with 10+ usages matter more than tokens with 3. Components used on every page matter more than one-offs.
5. **Get approval.** Extraction changes many files. Present the proposal and get buy-in before migrating.
6. **Migrate callers.** Replace hardcoded values with the new primitives. One category at a time.
7. **Update DESIGN.md.** The extracted primitives are the design system. Document them.

---

## Rules

1. **3+ usages, same intent.** Don't extract coincidences. Extract patterns.
2. **Name by intent, not value.** `--color-surface` not `--color-white`. `--spacing-section` not `--spacing-32`. Values change; intent persists.
3. **Don't extract prematurely.** Two components and a landing page is too early. Wait until drift is visible and patterns are proven.
4. **Group by intent, not value.** Two identical hex values with different purposes are two different tokens.
5. **Migration is part of extraction.** Proposing tokens without migrating callers is half the job. Plan the migration.
6. **Preserve intentional variation.** Not every difference is drift. Some components are intentionally different. Ask before consolidating.
7. **Update DESIGN.md.** Extracted primitives that aren't documented will drift again. Close the loop.

---

## DO

- Scan all five categories before proposing changes
- Group by semantic intent, not raw value
- Present a migration plan alongside proposed primitives
- Prioritize high-usage patterns over edge cases
- Update DESIGN.md with extracted tokens and patterns

## DON'T

- Extract from a two-component codebase; wait for patterns to emerge
- Name tokens by their current value (`--blue-500`); name by intent (`--color-accent`)
- Consolidate intentionally different implementations
- Propose primitives without a migration plan
- Extract animation patterns before colors and spacing; foundations first
