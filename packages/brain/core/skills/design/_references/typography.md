# Typography Reference

> Type scales, font selection, hierarchy, readability, and fluid typography for production interfaces.
> This file powers the /design skill's typographic decisions. Every font choice, size, weight, and line-height should trace back to these principles.

---

## Core Principle: Typography Is the Interface

80% of a typical interface is text. Typography isn't decoration layered onto a layout; it IS the layout. Get the type right and the design is 80% done. Get it wrong and no amount of color, spacing, or animation will save it.

---

## Modular Type Scales

A modular scale creates mathematical harmony between type sizes. Each step is the previous size multiplied by the ratio.

### Scale Ratios

| Ratio | Name           | Character                     | Best for                         |
| ----- | -------------- | ----------------------------- | -------------------------------- |
| 1.125 | Major second   | Barely perceptible steps      | Dense data UIs                   |
| 1.200 | Minor third    | Subtle, professional          | Product dashboards               |
| 1.250 | Major third    | Clear hierarchy, not dramatic | **Product default**              |
| 1.333 | Perfect fourth | Confident, readable           | **Brand/marketing**              |
| 1.414 | Aug. fourth    | Bold contrast                 | Editorial, magazines             |
| 1.500 | Perfect fifth  | Dramatic hierarchy            | Landing pages                    |
| 1.618 | Golden ratio   | Maximum drama                 | Hero-only (too extreme for body) |

### Product Scale (ratio 1.250)

Base: 16px

| Step | Size | Use                             |
| ---- | ---- | ------------------------------- |
| -1   | 13px | Captions, metadata, helper text |
| 0    | 16px | Body text (the base)            |
| 1    | 20px | Large body, card titles         |
| 2    | 25px | Section headings (h3)           |
| 3    | 31px | Page headings (h2)              |
| 4    | 39px | Page titles (h1)                |
| 5    | 49px | Display (hero-level, rare)      |

### Brand Scale (ratio 1.333)

Base: 18px

| Step | Size | Use                            |
| ---- | ---- | ------------------------------ |
| -1   | 14px | Legal text, fine print         |
| 0    | 18px | Body text                      |
| 1    | 24px | Large body, subheadings        |
| 2    | 32px | Section headings               |
| 3    | 43px | Major headings                 |
| 4    | 57px | Hero headlines                 |
| 5    | 76px | Display headlines (full-bleed) |

---

## Font Selection

### The Two-Family Rule

Most interfaces need exactly two font families: one for display (headings, hero text, brand moments) and one for body (paragraphs, labels, inputs, captions). Three families is the maximum; beyond that, you're creating visual noise, not variety.

### Display Fonts: Make a Statement

The display font carries the brand personality. It should be distinctive enough to be recognizable at a glance.

**Good display fonts (by personality):**

- **Technical/modern:** Space Grotesk, DM Sans, Outfit, Sora
- **Warm/humanist:** Fraunces, Literata, Source Serif 4
- **Bold/geometric:** Clash Display, Satoshi, General Sans, Cabinet Grotesk
- **Editorial/elegant:** Playfair Display, Cormorant, Newsreader
- **Monospace accent:** JetBrains Mono, Berkeley Mono, Geist Mono

### Body Fonts: Disappear Into Content

The body font should be invisible. The reader should absorb the words without noticing the typeface. Optimize for readability at 16-18px across long paragraphs.

**Reliable body fonts:**

- **Sans-serif:** Inter (only if paired with a strong display font), DM Sans, Source Sans 3, Nunito Sans
- **Serif:** Literata, Lora, Newsreader, Source Serif 4
- **Monospace (for code):** JetBrains Mono, Fira Code, Berkeley Mono

### Pairing Rules

1. **Contrast in structure, harmony in spirit.** A geometric display font pairs well with a humanist body font. Two geometric fonts feel redundant. Two humanist fonts feel muddled.
2. **Match x-heights.** When two fonts have similar x-heights, they feel naturally harmonious at the same size.
3. **Weight range matters.** Your display font needs at least Regular and Bold. Your body font needs Regular, Medium, and optionally SemiBold.
4. **Variable fonts preferred.** One file, infinite weights. Better performance, more design flexibility.

### The Inter Problem

Inter is the most common AI-generated font choice. It's a fine font, but when everything uses Inter, nothing has personality. If Inter is your body font, pair it with a distinctive display font. Never use Inter as both display and body; the result is aggressively generic.

---

## Type Hierarchy

Hierarchy is how users scan. Without it, every piece of text demands equal attention, which means nothing gets attention.

### The Three Levers

Hierarchy is created by combining three properties. You need at least two levers per step to create clear distinction.

1. **Size** - the most powerful lever. Minimum 1.25x ratio between hierarchical steps.
2. **Weight** - Regular (400) for body, Medium (500) for emphasis, SemiBold (600) or Bold (700) for headings.
3. **Color** - Primary text (high contrast), secondary text (reduced contrast), tertiary/disabled (low contrast).

### Hierarchy System

```css
/* Level 1: Display / Hero */
.display {
  font-family: var(--font-display);
  font-size: 49px; /* scale step 5 */
  font-weight: 700;
  line-height: 1.1;
  letter-spacing: -0.02em;
  color: var(--text-primary);
}

/* Level 2: Page title */
.title {
  font-family: var(--font-display);
  font-size: 31px; /* scale step 3 */
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: -0.01em;
  color: var(--text-primary);
}

/* Level 3: Section heading */
.heading {
  font-family: var(--font-display);
  font-size: 25px; /* scale step 2 */
  font-weight: 600;
  line-height: 1.3;
  color: var(--text-primary);
}

/* Level 4: Subheading / card title */
.subheading {
  font-family: var(--font-body);
  font-size: 20px; /* scale step 1 */
  font-weight: 500;
  line-height: 1.4;
  color: var(--text-primary);
}

/* Level 5: Body */
.body {
  font-family: var(--font-body);
  font-size: 16px; /* scale step 0 */
  font-weight: 400;
  line-height: 1.6;
  color: var(--text-primary);
}

/* Level 6: Secondary body */
.body-secondary {
  font-family: var(--font-body);
  font-size: 16px;
  font-weight: 400;
  line-height: 1.6;
  color: var(--text-secondary); /* reduced contrast */
}

/* Level 7: Caption / metadata */
.caption {
  font-family: var(--font-body);
  font-size: 13px; /* scale step -1 */
  font-weight: 400;
  line-height: 1.5;
  color: var(--text-tertiary);
}
```

### Minimum Contrast Between Steps

Adjacent hierarchy levels must differ by at least 1.25x in size OR differ by at least two weight steps AND a color shift. If two headings look the same at a glance, they're not different hierarchy levels; they're the same level.

---

## Readability

### Body Text Rules

- **Minimum body font size: 16px.** 14px is too small for sustained reading. 14px is acceptable only for captions, metadata, and helper text.
- **Line length: 45-75 characters.** The optimal range for comfortable reading. Under 45ch feels choppy. Over 75ch causes the eye to lose track of line starts.
- **Line height: 1.5 to 1.7 for body text.** Tighter (1.2-1.3) for headings. Looser for small text.
- **Paragraph spacing: roughly 1 blank line** (equal to line-height, or use margin-bottom equal to font-size).

### Line Length Implementation

```css
/* Constrain prose content */
.prose {
  max-width: 68ch; /* targets ~65 characters per line */
}

/* Input fields should also respect line length */
.input-text {
  max-width: 40ch; /* shorter for inputs */
}

/* Full-width containers with internal constraint */
.section {
  width: 100%;
  padding: 0 24px;
}
.section-content {
  max-width: 68ch;
  margin: 0 auto;
}
```

### Heading Text Rules

- **Line height: 1.1 to 1.3.** Headings are short, so they need tighter leading.
- **Letter spacing: -0.01em to -0.03em for display sizes.** Large text optically looks too loose at default tracking.
- **Max width: 20-25 characters for hero headlines.** Short, punchy, scannable.

---

## Fluid Typography

For brand surfaces and marketing pages, use `clamp()` to fluidly scale typography between viewport sizes. This eliminates jarring size jumps at breakpoints.

```css
/* Fluid hero headline: 32px at 320px viewport, 64px at 1200px viewport */
.hero-headline {
  font-size: clamp(2rem, 1rem + 3.6vw, 4rem);
}

/* Fluid body: 16px at 320px viewport, 20px at 1200px viewport */
.body-fluid {
  font-size: clamp(1rem, 0.9rem + 0.45vw, 1.25rem);
}

/* Fluid section heading: 24px to 40px */
.section-heading {
  font-size: clamp(1.5rem, 1rem + 1.8vw, 2.5rem);
}
```

**Rules for fluid type:**

- Only use fluid sizing on brand/marketing surfaces. Product UI should use fixed sizes from the scale.
- Set sensible minimum and maximum bounds. Text should never be smaller than 16px body or larger than 96px display.
- Test at 320px, 768px, and 1440px to verify the fluid scaling feels natural.

---

## Font Loading

### Performance Strategy

```css
/* System font stack as fallback (instant render) */
--font-fallback: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;

/* Display font: swap for visible text immediately */
@font-face {
  font-family: 'Display Font';
  src: url('/fonts/display.woff2') format('woff2');
  font-display: swap;
  font-weight: 100 900; /* variable font */
}

/* Preload the most critical weight */
/* <link rel="preload" href="/fonts/display.woff2" as="font" type="font/woff2" crossorigin> */
```

- Always use `woff2` format (best compression).
- Subset fonts to needed character ranges (Latin is usually sufficient).
- Use `font-display: swap` to avoid invisible text during load.
- Preload the one most-used font file.

---

## DO

- Start with a modular scale ratio and generate all sizes from it
- Use exactly two font families (display + body), max three
- Choose a display font with personality, not just legibility
- Set body text to 16px minimum
- Constrain line length to 45-75 characters
- Use negative letter-spacing on display text (24px+)
- Use `clamp()` for fluid type on marketing surfaces
- Test font rendering on both Mac (subpixel antialiasing) and Windows (ClearType)
- Use `font-display: swap` for web fonts
- Create a type scale and reference it by token, not raw pixel values

## DON'T

- Use Inter or Roboto as your only font (zero personality)
- Set body text below 14px (13px is the absolute floor for captions only)
- Exceed 75 characters per line for reading content
- Use more than 3 font families
- Apply all-caps to paragraphs (headings and labels only, with letter-spacing: 0.05-0.1em)
- Use font-weight below 400 for body text (300 is too light on most screens)
- Mix font sizes that aren't on the scale (ad hoc sizes destroy rhythm)
- Use the same font weight for headings and body (no hierarchy)
- Set line-height below 1.4 for body text
- Forget to test with long content (German and Finnish words break layouts)

---

## Anti-Patterns

### The "Every Text is 14px" Problem

Fear of large text leads to everything being 14px with weight as the only differentiator. Headings are 14px bold. Body is 14px regular. Labels are 14px medium. Result: no visual hierarchy, users can't scan the page.

### The "Font Buffet" Problem

Using 4-5 different font families because each "feels right" for a different section. Result: the page feels like a ransom note. Stick to two families and create variety through weight, size, and color.

### The "Wall of Text" Problem

Long paragraphs with no line-length constraint, spanning full viewport width on large screens. At 1440px, that's 120+ characters per line. The user's eyes lose track of line starts. Always constrain to 68ch max.

### The "Bold Everything" Problem

When everything is bold, nothing is bold. Reserve bold (700) for headings and critical emphasis. Use Medium (500) for subtle emphasis. Regular (400) for everything else.

---

## Register Variants

### Product Register

- Fixed type scale (no fluid sizing)
- 1.200 or 1.250 ratio
- Prioritize readability and density
- System font stack is acceptable if brand distinction isn't critical
- Monospace for code, data, and technical content

### Brand Register

- Fluid typography with `clamp()`
- 1.333 or higher ratio
- Display font carries the brand personality
- Larger body text (18-20px)
- Negative letter-spacing on display sizes
- Consider serif or slab-serif for warmth and editorial feel
- Optical sizing (`font-optical-sizing: auto`) for variable fonts
