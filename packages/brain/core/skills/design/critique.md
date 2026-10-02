---
name: design-critique
description: "Design review with heuristic scoring, persona tests, and automated anti-pattern detection. TRIGGER when: user says '/design critique', 'critique this', 'design review', 'is this any good'."
user_invocable: true
---

# /design critique -- Design Review

Two independent assessments that merge into one report: an LLM-driven design review (heuristics, cognitive load, personas, brand fit) and an automated anti-pattern detection pass. The two assessments run in parallel so neither biases the other.

---

## Workflow

### Step 1: Determine Scope

Same as `/design audit`: file path, directory, component name, or whole app.

### Step 2: Load Context

1. Read `PRODUCT.md` from project root (register, users, brand personality, anti-references, design principles)
2. Read `DESIGN.md` from project root (visual system, tokens, do's and don'ts)
3. Load reference files as needed from `_references/`

If neither context file exists, note it in the report and evaluate against general design best practices with Brand register as default.

### Step 3: Run Both Assessments in Parallel

**Critical rule:** Assessment A (LLM Review) and Assessment B (Automated Detection) must be independent. Form your heuristic opinions, persona scores, and cognitive load evaluation BEFORE looking at the detector output. This prevents anchoring bias; the human-style review and the mechanical check should arrive at findings independently, then combine.

**Execution order:**

1. Read all source code in scope
2. Complete Assessment A in full (all scores, all notes)
3. Run Assessment B (`detect.py`)
4. Merge into the combined report

Do NOT read detector output before completing Assessment A.

---

## Assessment A: LLM Design Review

### A1. Nielsen's 10 Heuristics (score each 0-4)

Evaluate the UI against each heuristic. For every score below 3, provide a specific finding with file:line reference.

| #   | Heuristic                               | What to Evaluate                                                                                                                                         |
| --- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Visibility of system status**         | Does the UI show what's happening? Loading indicators, progress bars, save confirmations, active states, selected items, current location in navigation. |
| 2   | **Match between system and real world** | Does it speak the user's language? Familiar terms, logical ordering, real-world metaphors, no jargon or developer terminology exposed to users.          |
| 3   | **User control and freedom**            | Can users undo, go back, cancel, dismiss? Emergency exits from flows. No dead ends. Confirmation before destructive actions.                             |
| 4   | **Consistency and standards**           | Same action, same result everywhere. Platform conventions followed. Internal patterns reused. No contradictory behaviors.                                |
| 5   | **Error prevention**                    | Are errors prevented before they happen? Constraints on inputs, smart defaults, confirmation dialogs, disabled states when actions aren't available.     |
| 6   | **Recognition rather than recall**      | Is information visible when needed? No memorization required. Options visible, not hidden. Context preserved across views.                               |
| 7   | **Flexibility and efficiency**          | Power user shortcuts? Customization? Batch actions? Keyboard shortcuts? Frequently-used actions easily accessible?                                       |
| 8   | **Aesthetic and minimalist design**     | Every element earns its place? No visual noise, no competing focal points, no decorative clutter, clear visual hierarchy.                                |
| 9   | **Help users recover from errors**      | Error messages in plain language? Specific about what went wrong? Suggest a fix? No error codes or stack traces shown to users.                          |
| 10  | **Help and documentation**              | Is help available in context? Tooltips, inline guidance, onboarding flows. Searchable docs if the product is complex.                                    |

**Scoring:**

- 4: Exemplary. Could be used as a teaching example.
- 3: Solid. Minor gaps that don't impact usability.
- 2: Needs work. Noticeable UX friction in this area.
- 1: Poor. Users will struggle or get confused.
- 0: Missing. This heuristic is not addressed at all.

### A2. Cognitive Load Checklist (8 items, pass/flag each)

For each item, mark PASS or FLAG. Flagged items get a brief explanation.

| #   | Check                        | Pass Criteria                                                                                                       |
| --- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1   | **Choices per screen**       | No more than 5-7 primary actions visible. Secondary actions are de-emphasized or progressive.                       |
| 2   | **Visual hierarchy clarity** | Clear primary, secondary, tertiary levels. Eyes know where to look first. One dominant focal point per view.        |
| 3   | **Information grouping**     | Related items are visually grouped (proximity, borders, background). Unrelated items are visually separated.        |
| 4   | **Progressive disclosure**   | Complex features reveal detail on demand. Not everything shown at once. Sensible defaults reduce initial decisions. |
| 5   | **Consistent patterns**      | Same type of interaction looks and behaves the same way everywhere. No "is this a link or a button?" ambiguity.     |
| 6   | **Meaningful defaults**      | Forms pre-filled where possible. Toggles set to the common case. Filters start with useful presets.                 |
| 7   | **Clear next actions**       | At every screen, the user knows what to do next. Primary CTA is obvious. No dead-end states.                        |
| 8   | **Reduced working memory**   | Users don't need to remember info from a previous screen. Context carries forward. Multi-step flows show progress.  |

### A3. Persona Tests (3 personas, score each 0-4)

Test the design through three lens personas. These are not user personas from PRODUCT.md; they're evaluation lenses that stress-test different aspects of the design.

**The Evaluator**

> Comparing alternatives on a Tuesday evening. Has 3 tabs open. Will bounce if confused or unimpressed in 10 seconds.

Evaluate: First impression clarity. Can they understand what this does and why they should care within 10 seconds? Is the value proposition obvious? Does it look credible? Is it differentiated from competitors?

**The Returning User**

> Knows the product. On mobile. In a hurry. Wants to do one specific thing and leave.

Evaluate: Task efficiency. Can they accomplish their goal quickly? Is navigation predictable? Do they have to wade through features they don't need? Does the mobile experience respect their urgency?

**The Skeptic**

> Has seen every SaaS landing page and is bored. Immune to buzzwords. Allergic to generic design.

Evaluate: Authenticity. Does this feel like it was designed with intention, or assembled from templates? Is the copy specific or could it describe any product? Are the visuals distinctive or interchangeable? Would this person respect the craft?

**Scoring per persona:**

- 4: This persona would be impressed and engaged
- 3: Functional for this persona, no significant friction
- 2: This persona would notice issues and feel mild frustration
- 1: This persona would struggle or bounce
- 0: Hostile to this persona's needs

### A4. Brand Fit

If PRODUCT.md exists, evaluate whether the design matches the declared brand:

- Does the visual tone match the stated personality? (e.g., "bold and energetic" should not look muted and corporate)
- Does the register match? (Brand register should look distinctive; Product register should look familiar)
- Are anti-references successfully avoided?
- Do the design principles manifest in the actual UI?

If PRODUCT.md doesn't exist, skip this section and note: "No PRODUCT.md found. Brand fit cannot be evaluated. Run `/design teach` to establish brand context."

---

## Assessment B: Automated Detection

Run the anti-pattern detector against the scope:

```
python3 {SKILLS_PATH}/design/_scripts/detect.py [scope_path]
```

Parse the JSON output. Group findings by severity: critical, high, medium, low. Count totals.

Do NOT interpret or editorialize the detector output here. Present it factually. The merge step combines it with Assessment A.

---

## Combined Report

After both assessments are complete, merge into this format:

```
## /design critique [scope]

### AI Slop Verdict: PASS / FAIL

[If FAIL, list the specific tells that fired. Reference both LLM observations and detector findings.]
[PASS means: this does not look like it was generated by a prompt-and-ship workflow. It shows intentional design decisions.]
[FAIL means: this has visible AI design anti-patterns that erode trust and distinctiveness.]

---

### Heuristics

| # | Heuristic | Score |
|---|-----------|-------|
| 1 | Visibility of system status | X/4 |
| 2 | Match between system and real world | X/4 |
| 3 | User control and freedom | X/4 |
| 4 | Consistency and standards | X/4 |
| 5 | Error prevention | X/4 |
| 6 | Recognition rather than recall | X/4 |
| 7 | Flexibility and efficiency | X/4 |
| 8 | Aesthetic and minimalist design | X/4 |
| 9 | Help users recover from errors | X/4 |
| 10 | Help and documentation | X/4 |

**Average: X.X / 4**

[For any heuristic scored below 3, include a 1-2 sentence finding with file:line reference.]

---

### Cognitive Load

| Check | Status | Notes |
|-------|--------|-------|
| Choices per screen | PASS/FLAG | [if flagged, brief explanation] |
| Visual hierarchy | PASS/FLAG | |
| Information grouping | PASS/FLAG | |
| Progressive disclosure | PASS/FLAG | |
| Consistent patterns | PASS/FLAG | |
| Meaningful defaults | PASS/FLAG | |
| Clear next actions | PASS/FLAG | |
| Working memory | PASS/FLAG | |

**[N]/8 passing**

---

### Personas

| Persona | Score | Key Issue |
|---------|-------|-----------|
| The Evaluator | X/4 | [primary concern or strength] |
| The Returning User | X/4 | [primary concern or strength] |
| The Skeptic | X/4 | [primary concern or strength] |

---

### Brand Fit

[2-3 sentences on alignment with PRODUCT.md, or note that PRODUCT.md is missing.]

---

### Anti-Patterns

**[N] findings** ([critical count] critical, [high count] high, [medium count] medium, [low count] low)

[If critical or high findings exist, list them with file:line references.]

---

### What's Working

- [Genuinely good things. Be specific. "Nice color palette" is vague. "The muted blue-gray neutral scale creates a calm, professional feel that matches the healthcare context" is useful.]
- [Minimum 2, maximum 5 items.]

---

### What to Fix (Prioritized)

1. **[Most impactful fix]** → Route: `/design [command]`
   [1-2 sentences on what to do and why it matters most.]
2. **[Second fix]** → Route: `/design [command]`
3. **[Third fix]** → Route: `/design [command]`
[Maximum 7 items. Prioritize by user impact, not ease of fix.]

---

### Provocative Questions

- [Questions worth answering before shipping. These should challenge assumptions, not nitpick details.]
- [2-4 questions. Examples:]
  - "Who is this hero section actually for? It speaks to investors, not users."
  - "What happens when this table has 500 rows? The design assumes 10."
  - "If a competitor copied your feature set, would your design still be a reason to choose you?"
```

---

## AI Slop Verdict Logic

The verdict synthesizes both assessments. FAIL if any of these are true:

1. **Detector fired critical or high findings** for: purple-gradient palette, gradient text, generic hero copy, nested cards, uniform padding
2. **Heuristic #8 (Aesthetic/Minimalist) scored 1 or below** AND the design uses default AI styling patterns
3. **The Skeptic persona scored 1 or below** with findings related to generic/template appearance
4. **3+ of the top-10 anti-patterns** from the main `/design` skill are present

PASS if the design shows intentional decisions, even if it has other issues. A design can PASS the slop check while still scoring poorly on heuristics or personas. Slop is specifically about: does this look like a human made deliberate choices?

---

## Routing Guide

Critique findings route to the refinement command best suited for the work:

| Finding Type                                               | Route To          |
| ---------------------------------------------------------- | ----------------- |
| Visual noise, competing focal points, unnecessary elements | `/design distill` |
| Bland, safe, generic, could-be-anyone                      | `/design bolder`  |
| Overstimulating, too many competing elements, too loud     | `/design quieter` |
| Type hierarchy unclear, readability issues, font problems  | `/design typeset` |
| Layout composition, spacing, grid, visual flow             | `/design layout`  |
| Theming inconsistency, color issues, token drift           | `/design polish`  |
| Interaction patterns, states, feedback                     | `/design harden`  |
| Responsive issues, mobile problems                         | `/design adapt`   |
| Copy, labels, messaging                                    | `/design clarify` |

---

## Rules

1. **Independence is mandatory.** Complete Assessment A before reading Assessment B output. The whole point of parallel assessment is that they cross-validate. If you anchor on detector results, the heuristic review becomes confirmation bias.
2. **Be specific, not vague.** "The typography needs work" is useless. "The h2 and h3 are visually indistinguishable at `src/app/page.tsx:45` because both use 600 weight with only a 2px size difference" is actionable.
3. **"What's Working" must be genuine.** Don't pad it with faint praise. If the design is doing something well, name it and say why. If very little is working, be honest; two genuine positives are better than five forced ones.
4. **Provocative questions should provoke.** Not "Have you considered accessibility?" but "Your onboarding flow assumes users know what a 'workspace' is. What percentage of your signups have used a tool with workspaces before?"
5. **Don't critique, then fix.** This command is review only. Route to fix commands. The user decides what to act on and when.
6. **Score honestly.** A 4/4 on a heuristic means you'd show it as a positive example to a junior designer. A 2/4 means real users will feel friction. Don't grade on a curve.
7. **Respect the register.** A Product-register app scoring low on "aesthetic and minimalist" might be fine if it's a data-heavy dashboard. A Brand-register landing page scoring low there is a real problem. Context matters.
8. **The Skeptic is your hardest grader.** If the Skeptic scores 3+, the design has genuine craft. If the Skeptic scores 1 or below, something is fundamentally wrong with the distinctiveness.
