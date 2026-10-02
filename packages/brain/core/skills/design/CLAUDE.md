---
name: design
description: "Design fluency for AI harnesses. Deep reference knowledge across 7 dimensions with 22 commands to steer the result. TRIGGER when: user says '/design', 'design this', 'make this look better', 'improve the UI', or any design-related request."
user_invocable: true
---

# /design -- Design Intelligence

Freeform design work with the full guidebook loaded. Use `/design` when you're not sure which sub-command fits, when work spans multiple disciplines, or when you want full design intelligence applied to a problem.

## How It Works

1. Loads `PRODUCT.md` from project root (strategic context: register, users, brand personality, anti-references)
2. Loads `DESIGN.md` from project root (visual system: colors, typography, elevation, components, do's and don'ts)
3. Loads relevant reference files from `_references/` based on the task
4. Applies anti-pattern awareness (see below)
5. Executes the design work with full context

If neither `PRODUCT.md` nor `DESIGN.md` exists, the skill operates in **Brand register** by default and recommends running `/design teach` first.

---

## Sub-Commands (22)

### Create

| Command                   | Purpose                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------ |
| `/design craft <feature>` | Full build flow with iteration. The primary creation command.                                    |
| `/design shape <feature>` | Think before building. Produces a design brief: goals, constraints, inspiration, open questions. |

### Evaluate

| Command            | Purpose                                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------------------------- |
| `/design audit`    | Systematic design audit against heuristics, accessibility, and consistency. Produces a scored report.     |
| `/design critique` | Design review. Identifies what works, what doesn't, and what to try next. Conversational, not mechanical. |

### Refine

| Command             | Purpose                                                                               |
| ------------------- | ------------------------------------------------------------------------------------- |
| `/design animate`   | Add motion and transitions. Micro-interactions, page transitions, loading states.     |
| `/design bolder`    | Push the design further. More contrast, more personality, more risk.                  |
| `/design colorize`  | Rework the color system. Palette generation, contrast checks, semantic color mapping. |
| `/design delight`   | Add moments of delight. Easter eggs, satisfying interactions, personality touches.    |
| `/design layout`    | Rework spatial composition. Grid, spacing, visual hierarchy, content flow.            |
| `/design overdrive` | Maximum intensity. Push every dial to its creative limit. Use sparingly.              |
| `/design quieter`   | Reduce visual noise. Simplify, remove, calm. The opposite of bolder.                  |
| `/design typeset`   | Typography refinement. Scale, hierarchy, measure, leading, font pairing.              |

### Simplify

| Command           | Purpose                                                                        |
| ----------------- | ------------------------------------------------------------------------------ |
| `/design adapt`   | Make the design responsive. Breakpoint strategy, fluid layouts, touch targets. |
| `/design clarify` | Improve information architecture. Labels, grouping, progressive disclosure.    |
| `/design distill` | Reduce to essentials. Remove everything that isn't earning its place.          |

### Harden

| Command            | Purpose                                                                                 |
| ------------------ | --------------------------------------------------------------------------------------- |
| `/design harden`   | Production hardening. Edge cases, error states, empty states, loading states.           |
| `/design onboard`  | First-run experience. Empty states, tooltips, progressive disclosure, activation flow.  |
| `/design optimize` | Performance-aware design. Image optimization, layout shifts, render-blocking decisions. |
| `/design polish`   | Final pass before shipping. Pixel alignment, consistency sweep, detail work.            |

### System

| Command            | Purpose                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------- |
| `/design teach`    | Interactive setup. Creates `PRODUCT.md` and `DESIGN.md` for the project through guided Q&A. |
| `/design document` | Generate or update `DESIGN.md` from an existing codebase or design file.                    |
| `/design extract`  | Pull design tokens, patterns, or components from existing code into structured reference.   |

---

## Context Files

### PRODUCT.md (Strategic Context)

Defines _who_ you're designing for and _how_ the brand should feel. Six sections:

1. **Product Overview** -- what it is, who it's for, core value prop
2. **Register** -- Brand or Product (see Register System below)
3. **Users** -- primary personas, their goals, their frustrations
4. **Brand Personality** -- adjectives, tone, energy level
5. **Anti-References** -- what this should NOT look or feel like
6. **Constraints** -- tech stack, accessibility requirements, existing systems

Run `/design teach` to create this interactively.

### DESIGN.md (Visual System)

Defines the _visual language_. Six sections:

1. **Overview** -- design philosophy, key principles, mood
2. **Colors** -- palette with semantic roles, contrast ratios, dark mode strategy
3. **Typography** -- type scale, font stack, hierarchy rules, line lengths
4. **Elevation** -- shadow system, layering, depth cues
5. **Components** -- component inventory with usage notes
6. **Do's and Don'ts** -- explicit examples of correct vs. incorrect usage

Run `/design document` to generate from an existing codebase, or `/design teach` to create from scratch.

---

## Register System

The register determines how aggressively the design pushes creative boundaries.

### Brand Register

> Design IS the product.

For: marketing sites, landing pages, portfolios, brand experiences, creative tools.

Behavior: pushes distinctiveness, allows more expressive typography, bolder color choices, unconventional layouts, personality-forward interactions. The design itself is a differentiator.

### Product Register

> Design SERVES the product.

For: app UI, dashboards, admin panels, tools, data-heavy interfaces.

Behavior: pushes familiarity, prioritizes learnability, uses established patterns, keeps decoration subordinate to function. The design should disappear; the user's task should be front and center.

### Default Behavior

When no `PRODUCT.md` exists, the skill defaults to **Brand register**. This biases toward more distinctive, expressive output. If you're building an app UI without a PRODUCT.md, explicitly state "product register" in your prompt.

---

## Core Design Principles

Core design principles. These govern every design decision.

### 1. People Before Pixels

We build digital products that solve real problems for real people. Every decision starts with empathy, understanding who we're building for and why it matters to them. If it doesn't serve a person, we don't build it.

**Applies to design:** No decorative elements without purpose. No interactions that slow users down. No visual complexity that doesn't aid comprehension.

### 2. Celebrate the Journey

The process matters as much as the outcome. We acknowledge wins, learn from misses, and build with energy, not just efficiency.

**Applies to design:** Iterate visibly. Show options. Explain tradeoffs. Make the design process collaborative, not a black box.

### 3. Thoughtfully Deliver

Quality and craftsmanship over quantity. We hold an incredibly high bar for polish. Nothing leaves half-baked. Speed matters, but never at the expense of craft.

**Applies to design:** Every pixel matters. Alignment, spacing, color, type; all must be intentional. "Good enough" is not good enough.

---

## Getting Started

```
1. /design teach           -- Set up project context (PRODUCT.md + DESIGN.md)
2. /design shape <feature>  -- Think before building (design brief)
3. /design craft <feature>  -- Full build flow with iteration
4. /design critique         -- Design review when done
5. /design polish           -- Final pass before shipping
```

For quick one-off work, just use `/design` with a description of what you need. The skill will load all available context and apply full design intelligence.

---

## Anti-Pattern Awareness

The top 10 AI design anti-patterns. The skill actively watches for and avoids these.

| #   | Anti-Pattern                                 | Why It's Bad                                                                  | What to Do Instead                                                                                                              |
| --- | -------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Purple gradients / AI color palette**      | Screams "AI made this." Purple-to-blue gradients are the new clip art.        | Use the project's actual brand colors. If none exist, derive a palette from the product's personality, not from AI defaults.    |
| 2   | **Gradient text**                            | Hard to read, accessibility nightmare, rarely on-brand.                       | Solid color text. Reserve gradients for large decorative headings only, and only when the brand supports it.                    |
| 3   | **Nested cards (cards on cards)**            | Creates visual confusion and wasted space. Users can't tell what's clickable. | Flatten the hierarchy. One level of cards max. Use spacing and typography to create grouping.                                   |
| 4   | **Inter/Roboto as only font**                | Makes everything look like a Google product. Zero personality.                | Choose typefaces that match the brand register. Even system fonts (SF Pro, Segoe) have more character.                          |
| 5   | **Generic copy ("Welcome to Our Platform")** | Signals that nobody thought about the words. Erodes trust instantly.          | Write specific, useful copy. "Your dashboard" not "Welcome to Our Platform."                                                    |
| 6   | **Equal padding everywhere**                 | Creates a flat, lifeless layout with no rhythm.                               | Vary spacing intentionally. Tighter within groups, looser between sections. Use a spacing scale (4, 8, 12, 16, 24, 32, 48, 64). |
| 7   | **Low-contrast labels**                      | Fails accessibility. Users with any vision impairment can't read them.        | Minimum 4.5:1 contrast for body text, 3:1 for large text (WCAG AA). Test with a contrast checker.                               |
| 8   | **Missing focus states**                     | Keyboard users are locked out. Accessibility violation.                       | Every interactive element needs a visible focus indicator. Use outline or ring, not just color change.                          |
| 9   | **Tiny body text (< 16px)**                  | Strains eyes on every device. Mobile is worse.                                | 16px minimum for body text. 14px only for secondary/metadata text.                                                              |
| 10  | **Line length > 75ch**                       | Long lines are exhausting to read. Eyes lose their place on the return sweep. | Set max-width on text containers. 45-75 characters per line is the readable range.                                              |

When generating any design output, cross-check against this list before presenting the result. If any anti-pattern is detected, fix it and note the correction.

---

## Reference File Loading

Reference files live in `{SKILLS_PATH}/design/_references/` and are loaded based on the task.

### Always Loaded

- `spatial-design.md` -- spacing scales, grid systems, layout composition, alignment rules
- `typography.md` -- type scales, font pairing, hierarchy, measure, leading, readability

### Loaded by Task Context

| Reference File     | Loaded When                                                                |
| ------------------ | -------------------------------------------------------------------------- |
| `motion.md`        | Task involves animation, transitions, micro-interactions, loading states   |
| `color.md`         | Task involves palette work, theming, dark mode, contrast, semantic colors  |
| `interaction.md`   | Task involves forms, inputs, buttons, navigation, interactive patterns     |
| `responsive.md`    | Task involves breakpoints, fluid layouts, mobile adaptation, touch targets |
| `ux-writing.md`    | Task involves copy, labels, error messages, empty states, onboarding text  |
| `accessibility.md` | Task involves WCAG compliance, screen readers, keyboard navigation, ARIA   |
| `iconography.md`   | Task involves icon systems, icon sizing, visual metaphors                  |

If a reference file doesn't exist yet, the skill operates from its built-in knowledge and notes the gap. Run `/design extract` to generate reference files from an existing codebase.

---

## Design Execution Protocol

When `/design` is invoked (or any design-related request is detected):

1. **Load context**: Read `PRODUCT.md` and `DESIGN.md` from project root. Note which exists.
2. **Determine register**: Brand (default) or Product (from PRODUCT.md or explicit instruction).
3. **Load references**: Always load spatial-design.md + typography.md. Load others based on task.
4. **Understand the ask**: What is being designed? What constraints exist? What's the scope?
5. **Generate options**: Present 2-3 distinct approaches when the task is ambiguous. For clear tasks, go direct.
6. **Execute**: Build the design with full context applied.
7. **Anti-pattern check**: Cross-reference output against the anti-pattern list. Fix any violations.
8. **Present**: Show the result with brief rationale for key decisions. No over-explaining.

---

## Quality Checklist

Before presenting any design output, verify:

- [ ] Contrast ratios meet WCAG AA (4.5:1 body, 3:1 large text)
- [ ] Body text >= 16px
- [ ] Line length <= 75 characters
- [ ] Focus states present on all interactive elements
- [ ] Spacing uses a consistent scale (not arbitrary values)
- [ ] No nested cards without clear purpose
- [ ] Typography has clear hierarchy (not just size; weight, color, spacing too)
- [ ] Colors are from the project palette (not AI defaults)
- [ ] Copy is specific and useful (not generic placeholder text)
- [ ] Layout has visual rhythm (varied spacing, not uniform padding)
- [ ] No anti-patterns from the awareness list above
