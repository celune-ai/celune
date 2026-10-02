---
name: design-quieter
description: "Calm overstimulating interfaces. Reduces color, contrast extremes, decoration, and motion. TRIGGER when: user says '/design quieter', 'calm this down', 'too busy', 'reduce visual noise'."
user_invocable: true
---

# /design quieter -- Calm the Interface

The opposite of bolder. When a design is overstimulating, competing for attention everywhere, or just exhausting to look at, quieter dials it back across four axes. This is refinement, not neutralization. The goal is calm clarity, not bland nothingness.

Use this for any interface that feels busy, cluttered, or visually aggressive. Works on both Brand and Product register, though Product register interfaces need this more often than they need bolder.

---

## When to Use

- The interface is visually exhausting to scan
- Too many colors competing for attention
- Gratuitous shadows, borders, gradients, and decorative elements
- Animations that distract rather than guide
- After `/design bolder` when you overshot
- User says "it's too much" or "calm it down"

---

## How It Works

Load `PRODUCT.md` and `DESIGN.md` if they exist. Assess overstimulation across four axes, then reduce deliberately.

### Axis 1: Color

Overstimulation often starts with color. Too many hues, too much saturation, too much chroma competing.

**Assessment:** Count distinct hues on the page. If more than 3-4 (excluding neutrals), the palette is fighting itself.

**Reduction:**

- Desaturate secondary colors; keep one accent at full strength
- Lower chroma on backgrounds; move toward warm grays or cool neutrals
- Reduce the number of semantic colors visible simultaneously
- Use opacity and tinting instead of additional solid colors
- One dominant color, one accent, the rest neutral

### Axis 2: Contrast

Not all contrast is good. Harsh black-on-white with no intermediate values creates visual tension.

**Assessment:** Check if the page uses only pure black (#000) and pure white (#fff) with nothing in between.

**Reduction:**

- Soften extremes: paper (#fafaf9 to #f5f5f4) instead of pure white, ink (#1c1917 to #292524) instead of pure black
- Introduce a middle-value neutral for secondary content, borders, dividers
- Reduce contrast between content groups (not within them; text contrast stays WCAG AA)
- Softer borders: 1px solid with low-opacity neutrals instead of harsh lines

### Axis 3: Decoration

Every shadow, border, gradient, rounded corner, and background pattern adds visual weight. Most of them aren't earning their place.

**Assessment:** For each decorative element, ask: "What information does this communicate?" If the answer is "none," it's a candidate for removal.

**Reduction:**

- Remove shadows that don't communicate elevation hierarchy
- Replace borders with spacing (whitespace separates as well as lines)
- Remove gradients on backgrounds unless they serve a compositional purpose
- Simplify border-radius (pick one value for the system, not a mix)
- Remove background patterns, textures, and decorative illustrations that don't aid comprehension

### Axis 4: Motion

Auto-playing animations, aggressive hover effects, and fast transitions create cognitive load without adding clarity.

**Assessment:** Watch the page for 10 seconds without interacting. If things are moving, they're probably too much.

**Reduction:**

- Remove auto-play animations; let content be still by default
- Slow transitions to 200-300ms; fast enough to feel responsive, slow enough to feel calm
- Reduce hover effect intensity; subtle opacity or color shift, not scale transforms
- Respect `prefers-reduced-motion`: everything removed above should also be removed for this preference
- Loading states can animate; decorative elements should not

---

## Process

1. **Assess overstimulation.** Score each axis (1-5, where 5 is "maximum visual noise"). Focus on the highest-scoring axes first.
2. **Identify the primary offender.** Usually one axis is the main culprit. Fix that one and the whole interface breathes.
3. **Reduce deliberately.** Not "remove everything." Each reduction should preserve the original intent. A colorful CTA can stay colorful; the background behind it gets quieter.
4. **Preserve hierarchy.** Quieter means calmer, not flatter. The most important elements should still be the most prominent; they just shouldn't be screaming.
5. **Check that intent survived.** After reduction, the user should still be able to identify the primary action, the content hierarchy, and the brand presence. If those are gone, you cut too deep.
6. **Present the delta.** Show what was reduced and why.

---

## Pairing

- `/design bolder` then `/design quieter` to find the sweet spot
- `/design quieter` then `/design audit` to verify hierarchy survived
- `/design quieter` after heavy feature additions when the page got cluttered

---

## Rules

1. **Refinement, not neutralization.** The goal is a calmer version of the same design, not a blank page. Personality should survive; noise should not.
2. **Reduce axes independently.** A page can have quiet color but energetic composition. Don't flatten everything to the same level.
3. **WCAG contrast is a floor, not a target.** Quieter reduces harsh contrast extremes but never below AA minimums. Text legibility improves when you soften backgrounds, not when you lighten text.
4. **Whitespace is a tool.** Often the best way to quiet a layout is to add space, not remove elements. Breathing room reduces perceived complexity.
5. **One accent color survives.** Even the quietest interface needs a focal point. Keep one color at full strength for primary actions.
6. **Motion earns its place or leaves.** Every animation should communicate a state change. Decorative motion goes. Functional transitions stay (but slow down).
7. **Don't punish brand register.** Quieter on a marketing page still allows bold moments. The hero can be dramatic; the surrounding sections get calm.

---

## DO

- Soften pure black/white to warm or cool near-blacks/near-whites
- Replace borders with whitespace where possible
- Slow transitions to 200-300ms
- Keep one accent color at full strength
- Remove shadows that don't communicate hierarchy

## DON'T

- Remove all color; quiet is not gray
- Lower text contrast below WCAG AA
- Remove functional motion (loading, state transitions)
- Flatten hierarchy; quiet interfaces still need visual priority
- Apply uniformly; some sections can stay bold while others calm down
