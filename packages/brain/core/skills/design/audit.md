---
name: design-audit
description: "Five-dimension technical quality check with P0-P3 severity. TRIGGER when: user says '/design audit', 'audit the UI', 'check accessibility', 'design quality check'."
user_invocable: true
---

# /design audit -- Technical Quality Check

Systematic quality audit across 5 dimensions. Scores each 0-4, assigns severity P0-P3 to every finding, and produces a structured report. This command documents problems; it does NOT fix them. Route findings to the appropriate `/design` fix commands.

---

## Workflow

### Step 1: Determine Scope

Accept one of:

- **File path**: `/design audit src/components/Button.tsx`
- **Directory**: `/design audit src/components/`
- **Component name**: `/design audit LoginForm`
- **Whole app**: `/design audit` (no argument, scans everything)

For whole-app audits, prioritize: pages/routes first, then shared components, then utilities. Cap at the most impactful 20 files to keep the report actionable.

### Step 2: Load Context

1. Read `PRODUCT.md` from project root (register, accessibility requirements, brand personality)
2. Read `DESIGN.md` from project root (tokens, visual system, do's and don'ts)
3. Load reference files based on findings: `_references/color-and-contrast.md`, `_references/responsive-design.md`, `_references/interaction-design.md`, `_references/typography.md`

If neither context file exists, note it in the report header and audit against WCAG AA + general best practices.

### Step 3: Run the Five Dimensions

Score each dimension 0-4. Assign every individual finding a severity level.

---

## Dimensions

### 1. Accessibility (0-4)

Check against WCAG 2.1 AA minimum (AAA if PRODUCT.md specifies it).

| Check             | What to Look For                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Contrast**      | Text contrast ratios (4.5:1 body, 3:1 large text). UI component contrast (3:1 against adjacent colors).                                     |
| **ARIA**          | Correct `role` attributes. `aria-label` on icon-only buttons. `aria-live` on dynamic content. No redundant ARIA on semantic HTML.           |
| **Keyboard**      | Tab order follows visual order. All interactive elements reachable. No keyboard traps. Escape closes modals/popovers.                       |
| **Semantic HTML** | Proper heading hierarchy (no skipped levels). Lists use `<ul>`/`<ol>`. Landmarks (`<main>`, `<nav>`, `<aside>`).                            |
| **Forms**         | Every input has a visible `<label>` (not just placeholder). Required fields marked. Error messages associated via `aria-describedby`.       |
| **Focus**         | Visible focus indicators on every interactive element. Custom focus styles meet 3:1 contrast. Focus ring not clipped by `overflow: hidden`. |
| **Skip links**    | Skip-to-content link present on pages with navigation.                                                                                      |
| **Alt text**      | Decorative images have `alt=""`. Informative images have descriptive alt text. Complex images have extended descriptions.                   |

**Scoring:**

- 4: Zero a11y violations found
- 3: Minor gaps (missing alt text on decorative images, slightly low contrast on non-critical elements)
- 2: Notable gaps (missing form labels, no skip link, some keyboard traps)
- 1: Significant violations (no focus indicators, heading hierarchy broken, interactive elements unreachable)
- 0: Critical failures (entire flows inaccessible, contrast below 3:1 on primary content)

### 2. Performance (0-4)

Evaluate design decisions that impact runtime performance.

| Check                    | What to Look For                                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Layout thrashing**     | Reading layout properties (offsetHeight, getBoundingClientRect) then writing styles in the same frame. Forced synchronous layouts.                     |
| **Expensive animations** | Animating `width`, `height`, `top`, `left`, `margin`, `padding` (triggers layout). Should use `transform` and `opacity` only.                          |
| **Lazy loading**         | Images below the fold missing `loading="lazy"`. Large component trees rendered eagerly when off-screen.                                                |
| **Bundle indicators**    | Heavy UI libraries imported for single components. Full icon library imports instead of tree-shaken individual icons.                                  |
| **Image optimization**   | Missing `width`/`height` attributes (causes layout shift). No `srcset` for responsive images. Uncompressed assets. Missing `next/image` or equivalent. |

**Scoring:**

- 4: No performance-impacting design decisions found
- 3: Minor opportunities (a few images without lazy loading, one non-critical animation on layout property)
- 2: Notable issues (multiple layout-triggering animations, no image optimization strategy)
- 1: Significant problems (layout thrashing in scroll handlers, full library imports, no lazy loading)
- 0: Critical (animations cause visible jank, massive unoptimized images, layout shift on every page load)

### 3. Theming (0-4)

Evaluate token discipline and design system compliance.

| Check                    | What to Look For                                                                                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hardcoded values**     | Inline hex/rgb/hsl colors instead of CSS variables or theme tokens. Magic numbers for spacing. Raw font sizes.                                              |
| **Dark mode**            | If dark mode exists: coverage gaps (components that break or look wrong). Missing semantic color mapping. Hardcoded white/black that should be token-based. |
| **Token consistency**    | Are the same values expressed the same way everywhere? Mixed units (px vs rem). Inconsistent variable naming.                                               |
| **DESIGN.md compliance** | If DESIGN.md exists: do actual values in code match declared tokens? Drift between documented system and implementation.                                    |

**Scoring:**

- 4: All values use tokens, dark mode complete, zero drift from DESIGN.md
- 3: Occasional hardcoded value, dark mode mostly complete, minor drift
- 2: Mixed token/hardcoded usage, dark mode has visible gaps, some drift
- 1: Mostly hardcoded, dark mode broken in places, significant drift from system
- 0: No token usage, no dark mode support despite being declared, DESIGN.md is fiction

### 4. Responsive (0-4)

Evaluate behavior across viewport sizes.

| Check                 | What to Look For                                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Breakpoints**       | Defined breakpoint strategy. Content doesn't break between breakpoints. No horizontal scroll at any standard viewport.                            |
| **Touch targets**     | Interactive elements are at least 44x44px on touch viewports. Adequate spacing between adjacent targets.                                          |
| **Viewport handling** | No fixed-width containers that overflow mobile. `<meta name="viewport">` present. No zoom-blocking (`maximum-scale=1`).                           |
| **Fluid vs fixed**    | Appropriate use of fluid widths. Text containers have `max-width` for readability. Images scale proportionally.                                   |
| **Content priority**  | Critical content visible without scrolling on mobile. Progressive disclosure on smaller screens. Navigation adapts (hamburger, bottom nav, etc.). |

**Scoring:**

- 4: Fully responsive, all touch targets correct, fluid and adaptive
- 3: Works well across viewports, minor touch target issues, mostly fluid
- 2: Some breakpoint gaps, several undersized touch targets, some fixed-width issues
- 1: Significant mobile problems, layout breaks at common viewports, tiny touch targets
- 0: Not responsive, broken on mobile, unusable on touch devices

### 5. Anti-patterns (0-4)

Run the deterministic detector and map results.

**Execution:**

```
python3 {SKILLS_PATH}/design/_scripts/detect.py [scope_path]
```

Parse the JSON output. Each detection has a severity (`critical`, `high`, `medium`, `low`). Map to audit severity:

| Detector Severity | Audit Severity |
| ----------------- | -------------- |
| critical          | P0             |
| high              | P1             |
| medium            | P2             |
| low               | P3             |

Also manually check for the 10 anti-patterns from the main `/design` skill that the detector might not catch (generic copy, missing focus states, uniform padding). Add any manually-found anti-patterns to the findings.

**Scoring:**

- 4: Zero anti-patterns detected (automated + manual)
- 3: Only P3 findings (minor polish items)
- 2: Some P2 findings (theming drift, optimization opportunities)
- 1: P1 findings present (poor contrast, missing states)
- 0: P0 findings present (accessibility violations, broken on mobile, AI slop)

---

## Severity Definitions

| Severity | Meaning                                                                                                                                            | Timeline                  |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| **P0**   | Blocks release. Accessibility violations that lock users out, layouts broken on primary viewports, critical anti-patterns (AI slop in production). | Fix before shipping.      |
| **P1**   | Fix this sprint. Poor contrast that passes technically but harms readability, missing interaction states, significant theming gaps.                | Fix within current cycle. |
| **P2**   | Next cycle. Theming drift that doesn't break UX, performance optimizations, minor responsive issues on uncommon viewports.                         | Schedule for next sprint. |
| **P3**   | Polish. Minor inconsistencies, small spacing deviations, opportunities for improvement that don't impact usability.                                | Backlog / opportunistic.  |

---

## Output Format

Present the report in this exact structure:

```
## /design audit [scope]

**Overall: [weighted average] / 4**

| Dimension | Score | P0 | P1 | P2 | P3 |
|-----------|-------|----|----|----|----|
| Accessibility | X/4 | N | N | N | N |
| Performance | X/4 | N | N | N | N |
| Theming | X/4 | N | N | N | N |
| Responsive | X/4 | N | N | N | N |
| Anti-patterns | X/4 | N | N | N | N |

---

### P0 Findings (Blocks Release)

**[AX-001] [Title]** — Accessibility
`src/components/Button.tsx:42`
[Description of the issue. What's wrong, why it matters, who it affects.]
→ Route: `/design harden`

---

### P1 Findings (Fix This Sprint)

[Same format]

---

### P2 Findings (Next Cycle)

[Same format]

---

### P3 Findings (Polish)

[Same format]

---

### Routing Summary

| Route | Count | Findings |
|-------|-------|----------|
| `/design harden` | N | AX-001, AX-003, ... |
| `/design optimize` | N | PF-001, PF-002, ... |
| `/design polish` | N | TH-001, TH-004, ... |
| `/design adapt` | N | RS-001, RS-002, ... |
```

### Finding ID Convention

Each finding gets a short ID for cross-referencing:

| Prefix | Dimension     |
| ------ | ------------- |
| AX     | Accessibility |
| PF     | Performance   |
| TH     | Theming       |
| RS     | Responsive    |
| AP     | Anti-patterns |

Number sequentially within each prefix: AX-001, AX-002, PF-001, etc.

### Overall Score Calculation

Weighted average of the 5 dimensions:

- Accessibility: weight 1.5 (most critical)
- Performance: weight 1.0
- Theming: weight 0.8
- Responsive: weight 1.2
- Anti-patterns: weight 0.5

Formula: `(AX * 1.5 + PF * 1.0 + TH * 0.8 + RS * 1.2 + AP * 0.5) / 5.0`

---

## Routing Guide

Audit findings route to the fix command best suited for the work:

| Finding Type                                                                               | Route To           | When                                                  |
| ------------------------------------------------------------------------------------------ | ------------------ | ----------------------------------------------------- |
| Accessibility gaps, missing states, error handling, i18n                                   | `/design harden`   | ARIA, keyboard, focus, semantic HTML, form validation |
| Layout-triggering animations, missing lazy loading, bundle weight, image optimization      | `/design optimize` | Anything that impacts runtime performance             |
| Hardcoded colors, token drift, dark mode gaps, DESIGN.md non-compliance                    | `/design polish`   | Visual consistency and system adherence               |
| Breakpoint failures, undersized touch targets, viewport issues, content priority on mobile | `/design adapt`    | Anything related to responsive behavior               |

If a finding spans multiple routes (e.g., a component that's both inaccessible AND non-responsive), list it under the primary route and note the secondary route.

---

## Rules

1. **Audit, don't fix.** This command produces a report. It does not modify any files. Fixing happens via the routed commands.
2. **Every finding needs a file:line reference.** Vague findings ("some components lack focus states") are useless. Point to the exact location.
3. **Run the detector.** Always execute `detect.py` for the Anti-patterns dimension. Don't skip it and do a manual-only check.
4. **Respect PRODUCT.md accessibility requirements.** If the project declares WCAG AAA, audit against AAA, not just AA.
5. **Don't inflate scores.** A 4/4 means genuinely excellent, not "I didn't find anything in my quick scan." Be honest about coverage limitations.
6. **Note what you couldn't check.** If the scope doesn't include certain pages or the project lacks a test environment, say so. Partial audits are fine; pretending they're complete is not.
7. **P0 means P0.** Only use P0 for issues that genuinely block release. If a sighted keyboard user can't complete a primary flow, that's P0. A slightly low contrast ratio on a footer link is P1 at most.
