---
name: design-craft
description: "Full shape-then-build flow with visual iteration. TRIGGER when: user says '/design craft', 'craft this feature', 'build this with design thinking'."
user_invocable: true
---

# /design craft -- Shape, Load, Build, Iterate

The end-to-end design command. Chains four non-skippable phases: shape the feature, load the right references, build in deliberate order, then iterate until it matches the brief.

This is the primary creation command. If you're not sure which `/design` sub-command to use, use this one.

---

## Phase 1: Shape the Design

Run `/design shape` internally. This produces a design brief through discovery conversation.

**This phase is NON-SKIPPABLE.** The brief is what makes the difference between building with intention and generating slop. No brief, no build.

**Exception:** If the user already has a design brief (from a prior `/design shape` run, or written by hand), they can pass it directly. Validate that it has the required sections (Purpose, User, Content, Feeling, Constraints, Hierarchy, Recommended References) and proceed to Phase 2.

After the brief is produced, present it and wait for confirmation:

> "Here's the design brief. Review it. Push back on anything that's wrong. Once you confirm, I'll load references and start building."

Do not proceed until the user confirms or the brief is adjusted. The brief is the contract.

---

## Phase 2: Load References

Based on the brief's "Recommended References" section, load the relevant files from `{SKILLS_PATH}/design/_references/`.

**Always load:**

- `spatial-design.md` (spacing, grids, layout composition, alignment)
- `typography.md` (type scale, font pairing, hierarchy, measure, leading)

**Load based on brief:**

| Reference               | Load when the brief mentions...                                                     |
| ----------------------- | ----------------------------------------------------------------------------------- |
| `motion-design.md`      | Animations, transitions, loading states, entrances, micro-interactions              |
| `color-and-contrast.md` | Palette work, theming, dark mode, contrast, semantic colors, color-dependent states |
| `interaction-design.md` | Forms, inputs, buttons, navigation, interactive patterns, drag-drop, selection      |
| `responsive-design.md`  | Breakpoints, fluid layouts, mobile adaptation, touch targets, content reflow        |
| `ux-writing.md`         | Copy, labels, error messages, empty states, onboarding text, microcopy              |

**Also load if they exist:**

- `PRODUCT.md` (project root): register, users, personality, anti-references
- `DESIGN.md` (project root): tokens, colors, typography, elevation, component patterns

If `DESIGN.md` has a YAML frontmatter with tokens, those are the canonical values. Use them. Do not invent new colors or spacing values when the system already has them.

---

## Phase 3: Build

Implement the feature in a deliberate, ordered sequence. Each step gets dedicated attention. Do not skip ahead.

### Build Order

**1. Structure and HTML semantics**

Lay out the DOM structure first. Correct semantic elements (nav, main, section, article, aside, header, footer, dialog). Landmark roles. Heading hierarchy. No divs where a semantic element fits.

Trace to the brief: the Content and Hierarchy sections dictate what goes where.

**2. Spacing and hierarchy**

Apply the spatial scale. Group related elements with tighter spacing; separate sections with looser spacing. Establish visual hierarchy through whitespace before adding any other styling.

Reference: `spatial-design.md`. Use the spacing scale from DESIGN.md if it exists.

**3. Typography**

Apply the type scale. Page title, section headers, body text, captions, metadata. Each level should be visually distinct through size, weight, and color (not just size alone).

Reference: `typography.md`. Use the font stack and scale from DESIGN.md if it exists.

**4. Color**

Apply the color palette. Background hierarchy (surface, elevated, sunken). Text colors with proper contrast. Semantic colors for states (success, warning, error). Brand color for primary actions.

Reference: `color-and-contrast.md`. Use palette from DESIGN.md if it exists. Verify contrast ratios meet WCAG AA (4.5:1 body, 3:1 large text).

**5. Interaction states**

Every interactive element needs all of its states defined: default, hover, focus, active, disabled, loading, error. Focus states must be visible (outline or ring, not just color change).

Reference: `interaction-design.md`. Missing focus states is anti-pattern #8. Missing hover states make interfaces feel broken.

**6. Motion**

Add transitions and animations. Entrance animations for content that appears. Transition for state changes. Feedback animations for user actions. Loading states.

Reference: `motion-design.md`. Motion should be functional (communicates state change) not decorative. If the brief doesn't call for motion, keep it minimal: subtle transitions on hover/focus only.

**7. Responsive**

Apply breakpoint strategy. Content priority shifts (what gets promoted or demoted at each breakpoint). Touch target sizing (minimum 44x44px). Fluid typography if the system uses it.

Reference: `responsive-design.md`. Test the mental model at mobile, tablet, and desktop widths.

### Build Rules

- **Every decision traces to the brief.** If you can't point to a brief section that justifies a choice, question the choice.
- **Use existing tokens.** If DESIGN.md defines colors, spacing, or typography, use those values. Do not introduce new ones without flagging it.
- **Anti-pattern check at each step.** Cross-reference the anti-pattern list from the main `/design` skill. Catch problems early, not at the end.
- **One step at a time.** Don't jump to color while you're still figuring out structure. The order exists because later steps depend on earlier ones being solid.

---

## Phase 4: Visual Iteration

The first working version is never the shipped version. Check the result against three lenses:

### Lens 1: The Design Brief

Walk through each section of the brief:

- Does the Purpose come through? Is the feature's reason for existing immediately clear?
- Does it serve the User in their described mental state and context?
- Is all the Content represented, including edge cases (empty, error, overflow)?
- Does it produce the intended Feeling?
- Are all Constraints respected?
- Does the Hierarchy match, with the most important elements most prominent?

If any answer is no, fix it and check again.

### Lens 2: Anti-Pattern Catalog

Check against the 10 AI anti-patterns from the main `/design` skill:

1. Purple gradients / AI color palette
2. Gradient text
3. Nested cards (cards on cards)
4. Inter/Roboto as only font (when personality is needed)
5. Generic copy ("Welcome to Our Platform")
6. Equal padding everywhere
7. Low-contrast labels
8. Missing focus states
9. Tiny body text (< 16px)
10. Line length > 75 characters

If any anti-pattern is present, fix it and note the correction.

### Lens 3: DESIGN.md Tokens

If DESIGN.md exists, verify consistency:

- Colors match the palette (no rogue hex values)
- Spacing uses the defined scale (no arbitrary pixel values)
- Typography uses the defined stack and scale
- Elevation uses the defined shadow system
- Components follow established patterns

Flag any deviations. Some may be intentional (the feature needs something the system doesn't have yet); flag those as potential token additions.

### Iteration Loop

Repeat the three-lens check until the result passes all three. Maximum 3 iterations. If it's not converging, surface the tension to the user:

> "The brief says [X] but the system tokens push toward [Y]. Which should win?"

---

## Rules

1. **Phase 1 is non-skippable.** No brief, no build. The only exception is a pre-existing brief passed by the user.
2. **Build order matters.** Structure before spacing. Spacing before typography. Typography before color. Each layer depends on the one before it.
3. **Every decision traces to the brief.** The brief is the contract. If something isn't in the brief, it probably shouldn't be in the build.
4. **Use existing tokens over invented ones.** DESIGN.md is the visual system. Respect it.
5. **The first version is never final.** Phase 4 exists because the first pass always has problems. Budget time for iteration.
6. **Anti-patterns are dealbreakers.** Any anti-pattern detected in the output must be fixed before presenting to the user.
7. **Load PRODUCT.md and DESIGN.md when they exist.** They provide strategic and visual context that prevents the build from drifting into generic territory.
8. **Flag new tokens.** If the feature needs a color, spacing value, or component pattern that doesn't exist in DESIGN.md, flag it as a potential system addition rather than silently introducing it.
