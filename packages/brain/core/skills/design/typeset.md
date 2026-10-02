---
name: design-typeset
description: "Fix flat, generic typography. Build hierarchy, pick distinctive typefaces, establish a modular scale. TRIGGER when: user says '/design typeset', 'fix the typography', 'type feels flat', 'improve font choices'."
user_invocable: true
---

# /design typeset -- Typography That Has a Pulse

Fixes the #1 tell of AI-generated UI: flat, generic typography where everything is Inter 16px with no contrast between heading and body. Typeset builds real hierarchy, picks distinctive typefaces, and establishes a modular scale that makes content scannable.

---

## When to Use

- All text looks the same weight and size
- Headings don't feel like headings
- The page uses Inter, Roboto, or system defaults with zero personality
- Line lengths run past 75 characters
- Body text is smaller than 16px
- There's no clear visual path through the content

**Not for:** Color problems (use `/design colorize`), spacing problems (use `/design layout`), copy quality (use `/design polish` dimension 6).

---

## What It Loads

**Always:**

- `_references/typography.md` (type scales, font pairing, hierarchy, measure, leading, readability)

**When checking contrast ratios:**

- `_references/color-and-contrast.md` (text-on-background contrast, WCAG thresholds)

**Also reads if they exist:**

- `PRODUCT.md` (register, brand personality, users)
- `DESIGN.md` (existing type scale, font stack, font tokens)

---

## The 5 Dimensions

### 1. Font Choices

**The problem:** Inter and Roboto are the new Times New Roman. They're invisible. They say nothing about the product.

**What to evaluate:**

- Does the current typeface match the brand personality from PRODUCT.md?
- Is there a pairing (display + body) or is everything one font?
- Does the typeface have the weights needed for hierarchy (at minimum: regular, medium, bold)?

**Register-aware decisions:**

| Register    | Display / Headings                                                                                      | Body / UI                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **Brand**   | Distinctive, personality-forward. Serif, slab, geometric, humanist. The typeface IS part of the brand.  | Readable but still characterful. Can be the same family at lighter weight, or a complementary pair. |
| **Product** | Clean, functional, but not generic. SF Pro, Geist, Satoshi, DM Sans all have more character than Inter. | Prioritize legibility and UI density. System fonts are fine if they serve the product.              |

**Rules:**

- Never pair more than 2 typefaces (3 max if one is monospace for code)
- Pairing contrast: combine different classifications (geometric + humanist, serif + sans, slab + grotesque). Don't pair two geometrics.
- Verify the font has all needed weights and supports the project's languages

### 2. Hierarchy

**The problem:** When heading and body text are too close in size/weight, the eye has no path. Users scan, not read; hierarchy tells them where to look.

**The rule:** Every adjacent step in the hierarchy needs 1.25x or more visual contrast. Visual contrast comes from three levers:

| Lever      | Weak                                     | Strong                                |
| ---------- | ---------------------------------------- | ------------------------------------- |
| **Size**   | 16px to 18px (1.125x, barely noticeable) | 16px to 24px (1.5x, clearly distinct) |
| **Weight** | 400 to 500 (subtle)                      | 400 to 700 (unmistakable)             |
| **Color**  | Both dark gray                           | Heading black, body medium gray       |

Use at least 2 of 3 levers between each step. Size alone is not enough.

**Hierarchy ladder (minimum 4 steps):**

1. **Page title** (largest, boldest, most prominent)
2. **Section heading** (clearly subordinate to page title, clearly dominant over body)
3. **Body text** (the baseline; everything else is defined relative to this)
4. **Caption / metadata** (smaller, lighter, secondary)
5. **Label / overline** (optional; small caps or uppercase, wide letter-spacing, used for categorization)

### 3. Sizing and Scale

**The problem:** Random font sizes (13px, 15px, 17px, 22px) with no mathematical relationship. Makes the system feel arbitrary.

**The fix:** Pick a modular scale ratio and derive all sizes from it.

| Scale Ratio | Name             | Character                                    |
| ----------- | ---------------- | -------------------------------------------- |
| 1.125       | Major Second     | Tight, dense; good for data-heavy product UI |
| 1.200       | Minor Third      | Balanced; works for most product interfaces  |
| 1.250       | Major Third      | Generous; good for content-rich pages        |
| 1.333       | Perfect Fourth   | Dramatic; good for brand/marketing pages     |
| 1.414       | Augmented Fourth | Bold; hero sections, editorial layouts       |

**Building the scale from a 16px base at 1.250:**

```
xs:    10px  (16 / 1.25 / 1.25)
sm:    13px  (16 / 1.25)
base:  16px
lg:    20px  (16 * 1.25)
xl:    25px  (16 * 1.25^2)
2xl:   31px  (16 * 1.25^3)
3xl:   39px  (16 * 1.25^4)
4xl:   49px  (16 * 1.25^5)
```

**Register-aware scaling:**

| Register    | Approach                                                                                                         |
| ----------- | ---------------------------------------------------------------------------------------------------------------- |
| **Brand**   | Fluid clamp sizes: `clamp(2rem, 5vw, 4rem)`. Sizes breathe with the viewport. More dramatic jumps between steps. |
| **Product** | Fixed rem sizes. Predictable, dense, scannable. Tighter scale ratio (1.125 or 1.200).                            |

### 4. Readability

**Non-negotiable thresholds:**

| Property               | Minimum | Ideal    | Maximum |
| ---------------------- | ------- | -------- | ------- |
| Body font size         | 16px    | 16-18px  | --      |
| Line height (body)     | 1.4     | 1.5-1.6  | 1.8     |
| Line height (headings) | 1.1     | 1.2-1.3  | 1.4     |
| Line length            | 45ch    | 55-65ch  | 75ch    |
| Paragraph spacing      | 0.5em   | 0.75-1em | 1.5em   |

**Common mistakes:**

- Line height too tight on body text (1.2 is for headings, not paragraphs)
- Line height too loose on headings (1.6 on a 48px heading wastes enormous space)
- No max-width on text containers (lines run to 120+ characters on wide screens)
- Letter-spacing on body text (almost never needed; reserve for uppercase labels)

### 5. Consistency

Hunt for the same issues as `/design polish` dimension 2, but fix them from a typographic system perspective:

- Rogue sizes that don't fit the scale
- Mixed font stacks (some elements reference the token, others hardcode the font name)
- Inconsistent weight mapping (what does "bold" mean in this project? 600? 700?)
- Line heights applied per-element instead of per-scale-step
- Different heading styles for the same semantic level across pages

**Fix pattern:** Build a token map (size, weight, line-height, letter-spacing per scale step) and align everything to it. If DESIGN.md exists, the token map should already be there; close the gap. If not, create the map and recommend adding it to DESIGN.md.

---

## Algorithm

1. **Read context** (PRODUCT.md, DESIGN.md, existing code)
2. **Evaluate current fonts** against brand personality. Recommend changes if generic.
3. **Build or verify the modular scale** from the base size and ratio. Map every text element to a step.
4. **Check hierarchy contrast** between adjacent steps. Widen gaps where contrast is below 1.25x.
5. **Enforce readability thresholds** (16px min, 45-75ch, proper line-heights)
6. **Consolidate** rogue values to scale steps. Replace hardcoded values with tokens.
7. **Present changes** with before/after rationale for each dimension.

---

## Rules

1. **16px body minimum. No exceptions.** 14px is acceptable only for captions, metadata, and secondary labels.
2. **Line length is a hard cap.** Set `max-width` on text containers. 75ch maximum. No "it's fine on desktop."
3. **Don't pair two similar fonts.** If both are geometric sans-serifs, you have one font, not a pairing. Create contrast.
4. **Respect DESIGN.md tokens.** If a type scale exists, use it. Propose changes to the system, don't silently override it.
5. **Test hierarchy by squinting.** Blur the page (literally or figuratively). If you can't tell heading from body, the hierarchy is too flat.
6. **Fluid type for brand, fixed for product.** Don't use `clamp()` on a dense dashboard. Don't use fixed `rem` on a marketing hero.
7. **Never apply letter-spacing to body text.** It harms readability. Reserve for uppercase labels and overlines (0.05-0.1em).

---

## Chains

- **Before:** `/design colorize` (type hierarchy should be set before adding color), `/design polish` (typeset is structural; polish is final sweep)
- **After:** `/design layout` (spacing and structure should be solid before typesetting), `/design shape` (brief informs font personality choices)
- **Works with:** `/design audit` (routes typography findings here)
