# Color and Contrast Reference

> Color science, palette construction, theming, dark mode, and accessibility for production interfaces.
> This file powers the /design skill's color decisions. Every palette, contrast ratio, and theme choice should trace back to these principles.

---

## Core Principle: Color Is Functional First

Color communicates meaning before it communicates brand. Red means danger or error. Green means success. Blue means interactive. These conventions exist because billions of users have internalized them. Fight these conventions only with extreme intentionality and clear rationale.

---

## OKLCH: The Right Color Space

Use OKLCH (OK Lightness, Chroma, Hue) for all palette construction. HSL is intuitive but perceptually broken: HSL "50% lightness" blue looks much darker than HSL "50% lightness" yellow. OKLCH corrects this by making lightness perceptually uniform.

### OKLCH vs HSL

```css
/* HSL: these look like wildly different brightness levels */
--blue-hsl: hsl(220, 80%, 50%); /* looks dark */
--yellow-hsl: hsl(50, 80%, 50%); /* looks bright */

/* OKLCH: these actually look like the same brightness */
--blue-oklch: oklch(60% 0.15 250); /* perceptually 60% light */
--yellow-oklch: oklch(60% 0.15 90); /* perceptually 60% light */
```

### OKLCH Anatomy

- **L (Lightness):** 0% = black, 100% = white. Perceptually uniform.
- **C (Chroma):** 0 = gray, 0.4+ = maximum saturation. Chroma capacity varies by hue.
- **H (Hue):** 0-360 degree color wheel. 0 = pink/red, 90 = yellow, 150 = green, 250 = blue, 310 = purple.

---

## Palette Construction

### Step 1: Choose Brand Hue

Start with a single hue angle that represents the brand. This is the anchor for the entire palette.

### Step 2: Generate Primary Scale

Create a 10-step lightness scale from that hue, keeping chroma consistent within a usable range:

```css
/* Primary scale: Blue (hue ~250) */
--primary-50: oklch(97% 0.01 250); /* near-white tint */
--primary-100: oklch(93% 0.03 250); /* lightest usable bg */
--primary-200: oklch(85% 0.06 250); /* light bg, hover state */
--primary-300: oklch(75% 0.1 250); /* borders, inactive */
--primary-400: oklch(65% 0.14 250); /* secondary actions */
--primary-500: oklch(55% 0.17 250); /* primary brand color */
--primary-600: oklch(48% 0.17 250); /* hover on primary */
--primary-700: oklch(40% 0.15 250); /* active/pressed */
--primary-800: oklch(30% 0.12 250); /* dark text on light bg */
--primary-900: oklch(22% 0.08 250); /* near-black shade */
--primary-950: oklch(15% 0.05 250); /* darkest shade */
```

### Step 3: Secondary Palette (Muted)

The secondary palette uses the same hue but reduced chroma (0.04-0.08 instead of 0.10-0.17). It's for backgrounds, borders, and surfaces that need to feel "in family" without competing with the primary.

### Step 4: Tinted Neutrals

Never use pure gray. Tint your neutrals toward the brand hue with very low chroma (0.005-0.015):

```css
/* Tinted neutrals: warm blue-gray (hue ~250, barely perceptible) */
--neutral-50: oklch(98% 0.005 250);
--neutral-100: oklch(95% 0.007 250);
--neutral-200: oklch(90% 0.008 250);
--neutral-300: oklch(82% 0.01 250);
--neutral-400: oklch(70% 0.01 250);
--neutral-500: oklch(55% 0.01 250);
--neutral-600: oklch(45% 0.01 250);
--neutral-700: oklch(35% 0.008 250);
--neutral-800: oklch(25% 0.007 250);
--neutral-900: oklch(18% 0.005 250);
--neutral-950: oklch(12% 0.004 250);
```

Pure gray (0 chroma) feels clinical and lifeless. Tinted neutrals feel warm and cohesive without being noticeable.

### Step 5: Semantic Colors

These are fixed by convention and should not be reinterpreted:

```css
/* Semantic: use standard hue associations */
--success: oklch(55% 0.15 145); /* green: success, complete, positive */
--warning: oklch(65% 0.18 80); /* amber: caution, attention, pending */
--error: oklch(55% 0.2 25); /* red: error, danger, destructive */
--info: oklch(55% 0.15 250); /* blue: informational, neutral action */
```

Each semantic color needs its own 3-step mini-scale: light (background), medium (border/icon), dark (text).

---

## Contrast Requirements (WCAG)

### Minimum Ratios

| Element Type                           | Minimum Ratio  | Standard |
| -------------------------------------- | -------------- | -------- |
| Body text (< 24px)                     | 4.5:1          | WCAG AA  |
| Large text (>= 24px bold or >= 18.5px) | 3:1            | WCAG AA  |
| UI components (borders, icons)         | 3:1            | WCAG AA  |
| Decorative elements                    | No requirement | -        |

### Contrast Testing Pattern

```
OKLCH Lightness Shortcut:
- Light mode text on white: L < 45% guarantees 4.5:1 on white
- Dark mode text on dark bg: L > 75% guarantees 4.5:1 on L=15% bg
- These are approximations. Always verify with a contrast checker.
```

### Common Failures

- Light gray text on white background (looks "elegant" but fails AA)
- Placeholder text in inputs (typically way too low contrast)
- Disabled state text (should still be 3:1 minimum against background)
- Colored text on colored background (two saturated colors often fail)
- Focus rings that don't contrast with both the element and the background

---

## Dark Mode

Dark mode is not "invert all the colors." It requires its own design decisions.

### Principles

1. **Background is dark gray, not black.** Pure black (#000) causes halation (text glows) and feels harsh. Use `oklch(12-15% 0.005 hue)` as the darkest surface.

2. **Surfaces are layered by elevation.** Higher surfaces are lighter. This communicates depth.

   ```css
   --surface-base: oklch(12% 0.005 250); /* page background */
   --surface-raised: oklch(16% 0.006 250); /* cards, panels */
   --surface-overlay: oklch(20% 0.007 250); /* modals, dropdowns */
   --surface-elevated: oklch(24% 0.008 250); /* popovers, tooltips */
   ```

3. **Reduce chroma as lightness drops.** Saturated colors on dark backgrounds vibrate and cause eye strain. Drop chroma by 20-30% for dark mode.

   ```css
   /* Light mode primary */
   --primary-light: oklch(55% 0.17 250);

   /* Dark mode primary: same hue, reduced chroma, slightly lighter */
   --primary-dark: oklch(65% 0.13 250);
   ```

4. **Text is off-white, not pure white.** Pure white on dark gray is too high contrast and causes eye fatigue. Use `oklch(90-92%)` for primary text.

5. **Semantic colors adjust.** Error red, success green, warning amber all need lighter, less saturated variants for dark mode.

### Implementation: CSS Custom Properties

```css
:root {
  color-scheme: light dark;

  /* Light mode (default) */
  --bg-primary: oklch(99% 0.003 250);
  --bg-secondary: oklch(96% 0.005 250);
  --text-primary: oklch(15% 0.005 250);
  --text-secondary: oklch(40% 0.008 250);
  --border: oklch(88% 0.008 250);
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg-primary: oklch(13% 0.005 250);
    --bg-secondary: oklch(17% 0.006 250);
    --text-primary: oklch(91% 0.005 250);
    --text-secondary: oklch(68% 0.008 250);
    --border: oklch(28% 0.008 250);
  }
}
```

---

## The "AI Color Palette" Anti-Pattern

Every AI-generated interface defaults to the same palette: purple-to-pink gradients, cyan accents, dark mode with neon glow, glass morphism. This has become the visual language of "AI product" and is now a cliche. Avoid:

- **Purple-to-pink gradients** as the primary brand color
- **Cyan/teal neon** accents on dark backgrounds
- **Glassmorphism** (frosted glass effect) as a primary surface treatment
- **Dark mode by default** with no light mode option
- **Gradient text** (accessibility nightmare and visual cliche)
- **Animated gradient backgrounds** (distracting, battery-draining)

These aren't inherently bad design choices. They're overused to the point of being generic. If the brand genuinely calls for purple, use it, but be aware of the association.

---

## Palette Sizing: Less Is More

### The One-Accent Rule

Commit to one primary accent color. Use it for primary buttons, active states, links, and focus rings. Everything else should be semantic (success/warning/error) or neutral.

Adding a second accent color requires a clear, distinct purpose (e.g., primary = action, secondary = navigation). Adding a third is almost always a mistake.

### Maximum Colors in a UI

| Category    | Light mode                        | Dark mode              |
| ----------- | --------------------------------- | ---------------------- |
| Backgrounds | 3-4                               | 4-5 (elevation layers) |
| Text        | 3 (primary, secondary, tertiary)  | 3                      |
| Accent      | 1 primary + 1 optional secondary  | Same                   |
| Semantic    | 4 (success, warning, error, info) | 4                      |
| Borders     | 2 (default, strong)               | 2                      |

Total unique color values: 15-20. If your palette has 40+ tokens, you have too many colors.

---

## DO

- Use OKLCH for palette construction (perceptually uniform)
- Start with one brand hue and derive the entire palette from it
- Tint neutrals toward the brand hue (chroma 0.005-0.015)
- Commit to one primary accent color
- Test all text/background combinations for WCAG AA (4.5:1)
- Reduce chroma in dark mode (20-30% less than light mode)
- Use dark gray (not black) as the darkest surface in dark mode
- Layer dark mode surfaces by elevation (lighter = higher)
- Create a complete semantic color set (success, warning, error, info)
- Test with color blindness simulators (protanopia, deuteranopia, tritanopia)
- Use `color-scheme: light dark` on `:root` for native form controls

## DON'T

- Use pure gray neutrals (0 chroma) for backgrounds and borders
- Use HSL for palette generation (perceptually non-uniform lightness)
- Use more than 6 accent colors (your palette is a rainbow)
- Apply gradient text (accessibility failure, visual cliche)
- Use purple-to-pink as the default "tech" palette
- Invert light mode colors for dark mode (this is not how dark mode works)
- Use pure black (#000) or pure white (#fff) as background colors
- Rely on color alone to communicate state (always pair with icon/text)
- Match lightness across hues using HSL (perceptually wrong)
- Skip contrast testing on colored backgrounds (most failures happen here)

---

## Anti-Patterns

### The "Rainbow Dashboard" Problem

Each chart/category gets a different saturated color: red, blue, green, orange, purple, teal. The result is visual chaos with no hierarchy. Instead, use a single hue at different lightness levels, or analogous hues (within 30 degrees of each other).

### The "Dark Mode Afterthought" Problem

Building the entire app in light mode, then adding `filter: invert(1)` or manually inverting every color. The result is harsh contrasts, wrong semantic colors (success becomes red), and broken images. Design dark mode intentionally from the start.

### The "Inconsistent Lightness" Problem

Primary blue at OKLCH 55% lightness, primary green at 65% lightness, primary red at 45% lightness. They feel like they belong to different palettes. Match lightness across semantic colors for visual harmony.

---

## Register Variants

### Product Register

- Conservative palette: 1 accent + 4 semantic + tinted neutrals
- Light mode default with dark mode as preference
- High contrast: err on the side of higher contrast ratios (5:1+)
- No gradients on interactive elements
- Solid, predictable colors for states

### Brand Register

- Expressive palette: can push chroma higher for hero moments
- Gradient backgrounds for sections (not text)
- Dark mode can be the default for dramatic brands
- Can use a second accent color for visual interest
- Illustration palettes can be broader than UI palettes
- Allow more creative semantic mappings (e.g., amber instead of green for success in a warm brand)
