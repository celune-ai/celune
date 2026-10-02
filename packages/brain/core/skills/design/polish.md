---
name: design-polish
description: "Final pass before shipping. Pixel-level consistency sweep across 6 dimensions. TRIGGER when: user says '/design polish', 'final pass', 'pixel perfect', 'clean up before shipping'."
user_invocable: true
---

# /design polish -- Final Pass Before Shipping

The last thing that happens before code ships. Polish hunts the details that separate "done" from "finished": misaligned elements, inconsistent spacing, orphaned hardcoded values, missing states, rough transitions, sloppy copy.

Polish is LAST, not first. If the layout is wrong, run `/design layout`. If the typography is flat, run `/design typeset`. Polish assumes the structure is solid and the system is in place. It sweeps for cracks.

---

## When to Use

- Feature is functionally complete and ready for review
- After `/design craft` or `/design audit` findings are resolved
- Before opening a PR that touches UI
- When something "feels off" but you can't name it

**Not for:** Structural problems (use `/design layout`), missing features (use `/design craft`), accessibility violations (use `/design harden`).

---

## Workflow

### Step 1: Discover the Design System

Before touching anything, load the rules:

1. **DESIGN.md** (project root): Tokens, colors, typography scale, elevation, component patterns, do's and don'ts
2. **PRODUCT.md** (project root): Register, brand personality, anti-references
3. **All 7 reference files** from `_references/`:
   - `spatial-design.md` (spacing, grids, alignment)
   - `typography.md` (type scale, hierarchy, measure)
   - `color-and-contrast.md` (palette, contrast, semantic colors)
   - `motion-design.md` (transitions, timing, easing)
   - `interaction-design.md` (states, feedback, patterns)
   - `responsive-design.md` (breakpoints, touch targets, fluid)
   - `ux-writing.md` (copy tone, labels, error messages)

If DESIGN.md exists, it is the source of truth. Every value in the code should trace to a token. Polish's primary job is closing the gap between the system and the implementation.

If DESIGN.md doesn't exist, polish against WCAG AA, the anti-pattern list, and internal consistency (does the file use the same values everywhere?).

### Step 2: Sweep the 6 Dimensions

Work through each dimension in order. Fix as you go; don't catalog and batch.

### Step 3: Verify Token Compliance

After the sweep, check that no new hardcoded values were introduced. Every color, spacing value, font size, and shadow should reference a token or CSS variable. Replace stragglers.

### Step 4: Cross-check Anti-Patterns

Run the 10 AI anti-patterns from the main `/design` skill. Polish is where anti-patterns are most likely to survive because they're small and easy to miss.

---

## The 6 Dimensions

### 1. Visual Alignment and Spacing

Hunt for:

- Elements that are _almost_ aligned but off by 1-3px
- Inconsistent padding between siblings (one card has 16px padding, the next has 20px)
- Margin that doesn't match the spacing scale (arbitrary 13px, 22px, 37px values)
- Text baselines that don't align across columns
- Icons that aren't optically centered in their containers
- Uneven gaps in flex/grid layouts

**Fix pattern:** Replace arbitrary values with the nearest spacing scale step. If DESIGN.md defines a scale (e.g., 4/8/12/16/24/32/48/64), snap to it. If not, establish one and use it consistently.

### 2. Typography Consistency

Hunt for:

- Font sizes that don't match the type scale (a rogue 15px among 14/16/18/24)
- Inconsistent font weights for the same semantic role (some labels are 500, others 600)
- Line heights that vary for same-size text
- Letter-spacing applied inconsistently
- Headings that skip scale steps or use the wrong semantic level
- Text color that drifts between near-identical values (#333 in one place, #374151 in another)

**Fix pattern:** Map every text element to a type scale step. If it doesn't fit, it's either wrong or the scale needs a new step (flag the latter).

### 3. Color and Contrast

Hunt for:

- Hardcoded hex/rgb values that should be tokens
- Near-duplicate colors that should be the same token (#3B82F6 vs #3B83F7)
- Contrast ratios below WCAG AA (4.5:1 body, 3:1 large text, 3:1 UI components)
- Semantic color misuse (success green used for non-success contexts)
- Background colors that don't match the elevation system
- Borders or dividers using inconsistent colors

**Fix pattern:** Consolidate to tokens. Bump low-contrast pairs. Align semantic usage.

### 4. Interaction States

Hunt for:

- Buttons missing hover, focus, active, or disabled states
- Links that only change color (add underline or other secondary indicator)
- Focus rings that are invisible or clipped by `overflow: hidden`
- Disabled elements that lack visual differentiation (just reduced opacity isn't enough without `cursor: not-allowed` and `aria-disabled`)
- Loading states that are missing or use a bare spinner with no context
- Error states without associated messaging

**Fix pattern:** Every interactive element needs 6 states: default, hover, focus, active, disabled, loading. Error is a 7th for inputs. Check all of them.

### 5. Transitions and Motion

Hunt for:

- State changes with no transition (jarring instant swaps)
- Inconsistent duration (some hovers are 150ms, others 300ms)
- Linear easing on UI transitions (should be ease-out or ease-in-out)
- Transitions on properties that trigger layout (`width`, `height`, `top`, `left`); should use `transform` and `opacity`
- Missing `prefers-reduced-motion` media query
- Decorative animations that add no information

**Fix pattern:** Standardize durations (150ms for micro, 200-300ms for state changes, 300-500ms for entrances). Use `ease-out` for entrances, `ease-in-out` for state changes. Only animate `transform` and `opacity`.

### 6. Copy Tone

Hunt for:

- Placeholder text that shipped ("Lorem ipsum", "Click here", "Submit")
- Generic copy ("Welcome to our platform", "An error occurred")
- Inconsistent voice (formal in one place, casual in another)
- Button labels that don't describe the action ("OK", "Yes", "Continue" without context)
- Error messages that blame the user or don't explain what to do next
- Truncated text that cuts mid-word instead of using ellipsis properly

**Fix pattern:** Every label should describe its action. Every error should explain what happened and what to do. Copy voice should match PRODUCT.md personality.

---

## Rules

1. **Polish is LAST.** Do not run polish on a feature that still has structural or layout problems. Fix those first with the appropriate command.
2. **Fix as you find.** Don't write a report and hand it off. Polish is a cleanup pass, not an audit. (Use `/design audit` for reports.)
3. **Token compliance is non-negotiable.** If DESIGN.md exists, hardcoded values are bugs. Replace them.
4. **Don't invent tokens.** If you need a value the system doesn't have, flag it as a potential addition to DESIGN.md. Don't silently introduce it.
5. **Measure contrast, don't eyeball it.** Use actual ratio calculations. "Looks fine" is not a measurement.
6. **Check every interactive element.** Not just buttons. Links, inputs, selects, checkboxes, radio buttons, tabs, accordions, tooltips. All of them. All states.
7. **Respect the register.** Brand register allows more expressive polish (custom transitions, personality in copy). Product register keeps polish functional and invisible.

---

## Chains

- **After:** `/design craft`, `/design audit` (fix phase), `/design layout`, `/design typeset`, `/design colorize`, `/design animate`
- **Before:** PR review, shipping
- **Siblings:** `/design harden` (polish handles visual consistency; harden handles edge cases and error resilience)
