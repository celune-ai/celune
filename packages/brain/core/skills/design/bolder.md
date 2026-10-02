---
name: design-bolder
description: "Push safe designs toward impact. Amplifies scale, weight, color, and composition. TRIGGER when: user says '/design bolder', 'make this bolder', 'more impact', 'push it further'."
user_invocable: true
---

# /design bolder -- Push Toward Impact

Most AI-generated designs are safe. Centered layouts, medium weights, muted colors, symmetrical grids. Competent and forgettable. This skill amplifies four axes to move a design from "fine" toward "memorable."

Use this for marketing pages, hero sections, landing pages, brand moments. NOT for dashboards, admin panels, or data-heavy interfaces. If the register is Product, this is almost always the wrong command. Use `/design quieter` as the counterweight when you overshoot.

---

## When to Use

- A design is technically correct but emotionally flat
- Hero sections that don't stop the scroll
- Marketing pages that look like app UI
- Brand register work that needs more personality
- After `/design craft` when the result feels timid

---

## How It Works

Load `PRODUCT.md` and `DESIGN.md` if they exist. Identify the current state across four axes, then push each one deliberately.

### Axis 1: Scale

Safe designs use modest heading sizes. Bolder designs use display type that owns the viewport.

**Assessment:** Find the largest text element. If it's under `2.5rem`, there's room to push.

**Amplification:**

- Heading scale to `clamp(3rem, 6vw, 6rem)` or higher for hero text
- Consider viewport-relative units for display type
- Let headings breathe; increase line-height to 1.0-1.1 for large display sizes
- Scale contrast between heading and body should be dramatic, not incremental

### Axis 2: Weight Contrast

Safe designs stay in the 400-600 weight range. Everything looks the same importance.

**Assessment:** Check the weight range in use. If the spread is under 300 (e.g., 400 to 600), it's too narrow.

**Amplification:**

- Body text at 300-400, headings at 700-800
- Use the full weight spectrum: light for secondary, bold for primary, black for display
- Weight contrast creates hierarchy faster than size alone
- Pair light weights with generous tracking for elegance

### Axis 3: Color Commitment

Safe designs use accent colors at 10% opacity or as thin borders. The palette is technically present but visually absent.

**Assessment:** Find the largest area of accent/brand color. If it's a border, a small badge, or a tinted background, the design is uncommitted.

**Amplification:**

- Full-strength accent on primary CTAs; no transparency, no tinting
- Color blocking: large areas of solid brand color as section backgrounds
- Dark sections with light text for rhythm breaks
- Let one color own the page; don't distribute equally across the palette

### Axis 4: Compositional Confidence

Safe designs center everything in a single column. Symmetry is a crutch.

**Assessment:** Is the layout a centered stack? Does every section follow the same structure?

**Amplification:**

- Asymmetric layouts: text left, image bleeding right (or vice versa)
- Off-grid moments: a pullquote that breaks the column width
- Overlapping elements: images that cross section boundaries
- Varied section structures: not every section needs the same template
- Full-bleed images or color blocks between contained content sections

---

## Process

1. **Assess current state.** Score each axis (1-5, where 3 is "competent default"). Note which axes have the most room.
2. **Pick the leading axis.** Usually one axis will create the most impact. Push that one first and hardest.
3. **Amplify.** Apply changes across all four axes, with the leading axis getting the most dramatic shift.
4. **Check the register.** If PRODUCT.md says Brand register, push further. If it says Product register, question whether bolder is the right skill.
5. **Test legibility.** Bold doesn't mean unreadable. Contrast ratios still apply. Large display type can be lighter weight precisely because it's large.
6. **Present the delta.** Show before-state assumptions and after-state changes. Make the shift visible.

---

## Pairing

- `/design bolder` then `/design quieter` to find the sweet spot (push too far, then pull back)
- `/design bolder` then `/design audit` to verify accessibility wasn't sacrificed
- `/design bolder` after `/design craft` when the first pass is safe

---

## Rules

1. **Brand register only.** Bolder is for marketing, hero sections, landing pages, brand experiences. If the interface is a dashboard, admin panel, or data tool, the answer is almost never "bolder." Ask before proceeding.
2. **Push all four axes, lead with one.** Don't just make text bigger. Scale, weight, color, and composition work together. But one axis should be the star.
3. **Bold is not loud.** A single enormous heading with generous whitespace is bolder than five competing elements at medium size. Amplification through restraint.
4. **Legibility is non-negotiable.** Large type can use thinner weights. Color blocks need sufficient contrast. Push visual impact, not readability off a cliff.
5. **Know when to stop.** If three of four axes are already at 4-5, the design doesn't need bolder. It needs refinement. Don't push what's already pushed.
6. **Pair with quieter.** The fastest way to find the right level of impact is to overshoot, then pull back with `/design quieter`. Encourage this workflow.
7. **Respect existing tokens.** Amplify within the design system. Use the palette's boldest colors, the type scale's largest sizes, the weight range's extremes. Don't invent new tokens to go bolder.

---

## DO

- Use `clamp()` for fluid display type that scales with the viewport
- Create weight contrast of 400+ between body and display text
- Use full-strength brand color on large surfaces, not just accents
- Break the grid intentionally for compositional energy
- Show the before/after delta so the user can evaluate the shift

## DON'T

- Apply to Product register interfaces (dashboards, admin, data tools)
- Make every element bold; that's not bold, it's noise
- Sacrifice contrast ratios for visual impact
- Ignore the existing design system to "go bigger"
- Push all four axes to maximum simultaneously; that's chaos, not confidence
