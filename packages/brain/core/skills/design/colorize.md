---
name: design-colorize
description: "Add strategic color to monochrome interfaces. OKLCH-based palette generation, tinted neutrals, semantic mapping. TRIGGER when: user says '/design colorize', 'add color', 'fix the palette', 'too gray', 'color feels off'."
user_invocable: true
---

# /design colorize -- Strategic Color, Not Decoration

Fixes the gray, lifeless interface by introducing color with purpose. Color isn't paint you splash on at the end; it's a communication layer that tells users what's interactive, what's urgent, what's related, and what's ambient. Colorize builds a complete palette from a single brand hue using perceptually uniform color math.

---

## When to Use

- The interface is all gray / monochrome and feels clinical
- Colors were picked randomly and don't form a coherent system
- The palette screams "AI made this" (purple-to-pink gradients, neon cyan, random bright accents)
- Semantic colors are missing or wrong (no distinction between success/warning/error)
- Neutral backgrounds feel cold or lifeless (pure gray with no tint)

**Not for:** Typography hierarchy (use `/design typeset`), spacing and layout (use `/design layout`), dark mode implementation (use `/design polish` or a dedicated theming pass).

---

## What It Loads

**Always:**

- `_references/color-and-contrast.md` (palette construction, contrast ratios, semantic color, WCAG thresholds)

**When text contrast needs verification:**

- `_references/typography.md` (text sizes determine contrast ratio requirements: 4.5:1 for body, 3:1 for large text)

**Also reads if they exist:**

- `PRODUCT.md` (brand personality, register, anti-references)
- `DESIGN.md` (existing palette, color tokens, dark mode strategy)

---

## The Algorithm

### Step 1: Find the Brand Hue

The entire palette grows from one hue. Find it:

1. **PRODUCT.md** or **DESIGN.md** exists with a primary color defined: use that hue
2. **Existing code** has a dominant accent color: extract its OKLCH hue
3. **Neither exists:** Ask. "What's your brand color? A hex code, a color name, or even 'blue but not corporate blue' works."

Never guess. Never default to purple or blue. The hue must come from intent.

### Step 2: Build the Primary Scale

Using OKLCH (not HSL, not hex math):

```
Primary palette (single hue, varying lightness + chroma):

50:   oklch(0.97  0.01  H)   -- tinted background
100:  oklch(0.93  0.03  H)   -- subtle highlight
200:  oklch(0.87  0.06  H)   -- light accent
300:  oklch(0.78  0.10  H)   -- medium-light
400:  oklch(0.68  0.14  H)   -- medium
500:  oklch(0.58  0.16  H)   -- primary action (buttons, links)
600:  oklch(0.48  0.14  H)   -- hover state
700:  oklch(0.39  0.12  H)   -- active/pressed state
800:  oklch(0.30  0.08  H)   -- dark accent
900:  oklch(0.20  0.05  H)   -- near-black tinted
950:  oklch(0.13  0.03  H)   -- darkest tinted
```

**Why OKLCH:** Equal lightness steps look perceptually equal. HSL lies; HSL 50% lightness for yellow looks nothing like 50% for blue. OKLCH fixes this. Every step in the scale has predictable visual weight.

### Step 3: Build Secondary Accents

Pick 1-2 supporting hues. Methods:

| Method                  | Hue Relationship | When to Use                                              |
| ----------------------- | ---------------- | -------------------------------------------------------- |
| **Complementary**       | H + 180          | High contrast; bold brand moments                        |
| **Analogous**           | H +/- 30         | Harmonious; subtle differentiation                       |
| **Triadic**             | H + 120, H + 240 | Rich palette; multiple distinct categories               |
| **Split-complementary** | H + 150, H + 210 | Balanced contrast without the intensity of complementary |

**Rules for secondary colors:**

- Lower chroma than primary (0.08-0.12 at the midpoint, vs. 0.14-0.16 for primary)
- Used for categories, tags, badges, charts, not for primary actions
- Never compete with the primary for attention

### Step 4: Build Semantic Colors

These don't come from the brand hue. They come from universal conventions:

| Role        | Hue Range            | OKLCH Midpoint         |
| ----------- | -------------------- | ---------------------- |
| **Success** | Green (140-160)      | `oklch(0.55 0.14 150)` |
| **Warning** | Amber/Orange (70-85) | `oklch(0.70 0.14 80)`  |
| **Error**   | Red (20-30)          | `oklch(0.55 0.16 25)`  |
| **Info**    | Blue (230-250)       | `oklch(0.58 0.12 240)` |

Build a 3-step scale for each: light (background), medium (border/icon), dark (text):

```
error-light:  oklch(0.93 0.04 25)    -- background tint
error-mid:    oklch(0.55 0.16 25)    -- icon, border
error-dark:   oklch(0.35 0.12 25)    -- text on light bg
```

Verify contrast: error-dark on error-light must meet 4.5:1.

### Step 5: Tint the Neutrals

**The secret weapon.** Pure gray (`oklch(L 0 0)`) feels cold and lifeless. Tinting neutrals with a whisper of the brand hue makes the interface feel cohesive without anyone knowing why.

```
Tinted neutrals (brand hue H, extremely low chroma):

neutral-50:   oklch(0.97  0.005  H)
neutral-100:  oklch(0.93  0.007  H)
neutral-200:  oklch(0.87  0.008  H)
neutral-300:  oklch(0.78  0.010  H)
neutral-400:  oklch(0.62  0.010  H)
neutral-500:  oklch(0.50  0.008  H)
neutral-600:  oklch(0.40  0.007  H)
neutral-700:  oklch(0.32  0.006  H)
neutral-800:  oklch(0.23  0.005  H)
neutral-900:  oklch(0.16  0.004  H)
neutral-950:  oklch(0.10  0.003  H)
```

Chroma range: 0.003 to 0.010. Anything above 0.015 starts looking colored, not neutral.

### Step 6: Map Colors to Roles

| Role                                               | Token                 | Source          |
| -------------------------------------------------- | --------------------- | --------------- |
| **Primary action** (buttons, links, active states) | `primary-500`         | Primary scale   |
| **Primary hover**                                  | `primary-600`         | Primary scale   |
| **Primary active**                                 | `primary-700`         | Primary scale   |
| **Background (base)**                              | `neutral-50` or white | Tinted neutrals |
| **Background (elevated)**                          | white                 | Pure or tinted  |
| **Background (sunken)**                            | `neutral-100`         | Tinted neutrals |
| **Text (primary)**                                 | `neutral-900`         | Tinted neutrals |
| **Text (secondary)**                               | `neutral-600`         | Tinted neutrals |
| **Text (tertiary)**                                | `neutral-400`         | Tinted neutrals |
| **Border (default)**                               | `neutral-200`         | Tinted neutrals |
| **Border (strong)**                                | `neutral-300`         | Tinted neutrals |

---

## Anti-Patterns to Avoid

1. **Purple-to-pink gradients.** The AI color palette. Screams "generated." Use the actual brand hue.
2. **Too many saturated colors.** If everything is bright, nothing stands out. One saturated primary; everything else is muted.
3. **HSL-based palette math.** HSL lightness is perceptually uneven. Use OKLCH.
4. **Neon accents on white.** Low contrast, eye strain, unprofessional. Keep interactive colors at lightness 0.45-0.60 on white backgrounds.
5. **Gray that ignores the brand.** Pure `#6B7280` gray next to warm brand colors feels disconnected. Tint it.
6. **Semantic colors from the brand palette.** Error red should be red, not your brand orange at a darker shade. Users have learned what red/green/yellow mean.

---

## Rules

1. **OKLCH, not HSL.** All palette math happens in OKLCH. Convert to hex/rgb for output if the codebase requires it.
2. **One brand hue to start.** Don't ask for a full palette. Ask for one color and build the system from it.
3. **Verify every contrast pair.** Primary on white, text on backgrounds, semantic text on semantic backgrounds. WCAG AA minimum (4.5:1 body, 3:1 large text, 3:1 UI components).
4. **Tinted neutrals are mandatory.** Pure gray is a design smell. Even 0.005 chroma makes a difference.
5. **Secondary accents are quieter than primary.** Lower chroma, used for categorization, not action.
6. **Respect existing DESIGN.md tokens.** If a palette exists, evolve it. Don't replace it without discussion.
7. **Dark mode is a separate pass.** Colorize builds the light palette. Inverting it for dark mode requires its own attention (lightness/chroma adjustments, not just swapping 50 and 900).

---

## Chains

- **Before:** `/design polish` (palette should be set before the final consistency sweep)
- **After:** `/design typeset` (type hierarchy should be established before color is layered on), `/design layout` (spatial structure should exist before color communicates hierarchy)
- **Works with:** `/design audit` (routes color/contrast findings here)
