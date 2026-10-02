---
name: design-teach
description: "One-time project setup. Scans codebase, runs discovery interview, writes PRODUCT.md. TRIGGER when: user says '/design teach', 'set up design context', 'teach about this project'."
user_invocable: true
---

# /design teach -- Project Setup

One-time command that establishes design context for a project. Scans the codebase, runs a discovery interview, and writes `PRODUCT.md` at the project root.

Run this once at the start of any project. Every other `/design` command reads `PRODUCT.md` before generating output.

---

## Workflow

### Step 1: Explore the Codebase

Before asking a single question, scan the project to build a hypothesis. Look for:

**Project identity**

- `README.md`, docs folders, any description of purpose or audience
- `package.json` / `pyproject.toml` / `Cargo.toml` / config files: name, description, dependencies
- Existing `PRODUCT.md` or `DESIGN.md` (if found, ask before overwriting)

**Tech stack and design libraries**

- UI frameworks: React, Vue, Svelte, Angular, etc.
- Component libraries: shadcn, Radix, MUI, Chakra, Ant Design, Tailwind, etc.
- CSS approach: Tailwind, CSS modules, styled-components, vanilla CSS

**Existing design decisions**

- Color values: CSS variables, theme files, Tailwind config, design tokens
- Typography: font imports, font-family declarations, type scale
- Spacing: spacing scale in use, padding/margin patterns
- Component patterns: what components exist, how they're structured

**Brand assets**

- Logos, favicons, OG images
- Brand guidelines or style documentation

**Form a register hypothesis** based on what you find:

| Signal                                                                                                     | Likely Register                                                  |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `/`, `/about`, `/pricing`, `/blog/*`, hero sections, big typography, scroll-driven layouts, marketing copy | **Brand**                                                        |
| `/app/*`, `/dashboard`, `/settings`, forms, data tables, side nav, top nav, app-shell patterns             | **Product**                                                      |
| Both present (marketing site + app)                                                                        | **Split** -- clarify with user which surface this context covers |

Collect all findings. You'll use them to skip questions you already have answers for and to make the interview feel informed, not generic.

---

### Step 2: Run Discovery Interview

Ask these questions **conversationally**, not as a numbered list. Adapt based on what Step 1 revealed. Skip questions the codebase already answered clearly.

**1. Register confirmation**

> "Based on scanning your project, this looks like a [brand/product] surface. [Cite specific evidence: routes, components, layout patterns.] Is that right, or is it more [the other]?"

If the project has both marketing and app surfaces, ask which one this `PRODUCT.md` should cover. They may need two.

**2. Users**

> "Who uses this? What state of mind are they in when they arrive?"

Follow up on emotional context: Are they rushed? Exploring? Anxious? Confident? This shapes density, pacing, and tone.

**3. Product purpose**

> "In one sentence, what does this product actually do?"

Push for specificity. "A platform for X" is not specific enough. "Helps [who] do [what] when [context]" is.

**4. Brand personality**

> "If this product were a person at a party, how would they act?"

Offer spectrums: Calm and precise vs. bold and energetic? Warm and approachable vs. sleek and premium? Playful vs. serious?

**5. Anti-references**

> "What should this absolutely NOT look like? Name specific products, styles, or patterns to avoid."

This is often more useful than inspiration. People know what they hate faster than what they want.

**6. Design principles**

> "Name 3 things that matter most in how this looks and feels."

If they struggle, offer trade-offs: Speed vs. beauty? Simplicity vs. power? Familiarity vs. distinctiveness?

**7. Accessibility**

> "Any specific accessibility requirements? WCAG level, specific user needs?"

Default assumption: WCAG AA minimum. Note if they need AAA or have specific needs (color blindness, motor impairment, screen reader support).

**Interview style notes:**

- This should feel like a conversation with a design lead, not a form.
- Follow up on interesting answers. If someone says "bold and energetic," ask what that means to them.
- Reference what you found in the codebase: "I noticed you're using Inter and a pretty neutral palette. Is that intentional, or something you'd want to push further?"
- If PRODUCT.md already exists, offer to update specific sections rather than starting from scratch.

---

### Step 3: Write PRODUCT.md

After the interview, write `PRODUCT.md` at the project root with this exact structure:

```markdown
# PRODUCT.md

> Design context for this project. Generated by /design teach.
> Every /design command reads this before writing code.

## Register

[brand|product]

## Users

[Who they are, their mental state, context of use]

## Purpose

[What the product does, in one sentence]

## Brand Personality

[Voice, tone, energy level]

## Anti-References

[What to actively avoid -- specific products, styles, patterns]

## Design Principles

1. [Principle 1]
2. [Principle 2]
3. [Principle 3]

## Accessibility

[WCAG level, specific requirements]
```

**Writing guidelines:**

- Keep each section to 2-4 sentences max. This is a reference doc, not a manifesto.
- Use the user's own words where possible. Don't over-polish their language.
- Register must be exactly `brand` or `product` (lowercase). No hedging.
- Anti-references should name specific products or styles, not vague descriptions.
- Design principles should be actionable, not aspirational. "Fast over beautiful" is useful. "Excellence" is not.
- If the user didn't specify accessibility requirements, default to: "WCAG AA. Minimum 4.5:1 contrast for body text, 3:1 for large text. Visible focus indicators on all interactive elements."

---

### Step 4: Offer DESIGN.md Generation

After writing PRODUCT.md, confirm and offer the next step:

> "PRODUCT.md is set. Want me to run /design document to generate DESIGN.md (your visual system)?"

If yes, invoke `/design document`. If no, the project is ready for any `/design` command; they'll operate in the declared register with the strategic context from PRODUCT.md.

---

## Rules

1. **PRODUCT.md is strategy only.** Who, what, why. No colors, no fonts, no pixel values. Visual decisions belong in DESIGN.md.
2. **Register is the most important field.** It shapes every downstream default across all /design commands. Get it right.
3. **Default register is Brand when uncertain.** Brand register is the safer default; it produces more distinctive output. Product register risks being generic.
4. **If PRODUCT.md already exists, ask before overwriting.** Offer to update specific sections instead of starting over.
5. **Don't skip the codebase scan.** The interview is dramatically better when you can reference what you found. Generic questions get generic answers.
6. **The interview is a conversation, not a questionnaire.** Follow up. React to answers. Reference the codebase. Make it feel like working with a design lead who's done their homework.
