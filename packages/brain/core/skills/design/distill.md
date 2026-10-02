---
name: design-distill
description: "Remove what shouldn't be there. Reduce complexity to essentials. TRIGGER when: user says '/design distill', 'simplify this', 'too complex', 'strip it down', 'reduce clutter'."
user_invocable: true
---

# /design distill -- Remove What Shouldn't Be There

Every interface accumulates. Features ship, elements stack, options multiply, and nobody removes anything. Distill starts with one question: what is the single job this interface does? Then it removes everything that isn't helping.

Simplicity is fewer obstacles between the user and their goal. Not fewer features. Not fewer options. Fewer things standing in the way.

---

## When to Use

- A page has grown cluttered over multiple iterations
- Users can't find the primary action
- The interface tries to do too many things at once
- Settings pages have become overwhelming
- A redesign is needed but the scope is unclear
- Feature accretion has buried the original purpose

---

## How It Works

Two passes: assess the complexity sources, then edit ruthlessly.

### Pass 1: Assess Complexity Sources

Identify where complexity lives. It clusters into four categories.

**Too many elements.** The page has more distinct items than the user can scan in 3 seconds.

- Count visible elements at each viewport size
- Identify elements that serve the same purpose (redundant actions, duplicate information)
- Note elements that exist "just in case" but are rarely used

**Excessive variation.** Too many visual styles, layout patterns, or interaction models on one page.

- Count distinct card styles, button variants, heading treatments
- Note inconsistent spacing patterns
- Flag where similar elements look different for no reason

**Information overload.** More data shown than the user needs for their current task.

- Identify data that's shown by default but only needed occasionally
- Note long lists without filtering, sorting, or pagination
- Flag dense tables where users only need 2-3 columns most of the time

**Visual noise.** Decorative elements, unnecessary borders, shadows, badges, and indicators that add visual weight without adding meaning.

- Count borders, dividers, and separators
- Note shadows that don't communicate hierarchy
- Flag badges, pills, and status indicators that aren't actionable

### Pass 2: Edit Ruthlessly

Four operations, in order of preference:

**1. Remove.** The best simplification is deletion. If an element doesn't serve the page's single job, remove it entirely.

- Ask: "If I remove this, what does the user lose?" If the answer is "nothing meaningful for their primary task," remove it.
- Removed elements don't need to go forever. They might move to a detail page, a settings panel, or a hover/click disclosure.

**2. Combine.** Merge elements that serve related purposes.

- Two buttons that do similar things become one with smart behavior
- Multiple status indicators become a single, richer status display
- Separate sections with related content become one section with clear hierarchy

**3. Hide.** Move secondary content behind progressive disclosure.

- Advanced options behind an "Advanced" toggle
- Metadata behind a "Details" expansion
- Secondary actions behind a "More" menu
- The rule: hide requires one click to reveal. If it requires navigation, that's "move," not "hide."

**4. Consolidate.** Reduce visual variation to fewer, consistent patterns.

- Three card styles become one flexible card component
- Five button sizes become three (small, default, large)
- Random spacing values become a consistent scale
- Ad-hoc color usage becomes semantic tokens

---

## The Single-Job Test

Before editing, answer this question:

> What is the single most important thing a user does on this page?

Write it down. Every element on the page either supports that job or is a candidate for removal/hiding. Be ruthless about this. A settings page's job is "find and change a setting." A dashboard's job is "understand current state and decide what to do." A list page's job is "find the right item and act on it."

Elements that support a secondary job aren't automatically removed, but they should be visually subordinate to the primary job. If secondary elements compete with primary elements for attention, the hierarchy is broken.

---

## Process

1. **State the single job.** Write one sentence describing what the page is for.
2. **Assess complexity.** Identify which of the four sources (too many elements, excessive variation, information overload, visual noise) are present and how severe each is.
3. **Propose edits.** For each complexity source, list specific changes: what to remove, combine, hide, or consolidate. Present as a prioritized list.
4. **Get confirmation.** Distillation is opinionated. The user should approve before elements disappear.
5. **Execute.** Make the changes.
6. **Verify the single job.** After editing, the primary task should be faster and clearer. If it's not, the wrong things were removed.

---

## Rules

1. **Single-job test first.** Don't edit until you've stated the page's primary purpose. Every decision flows from that statement.
2. **Remove before hiding.** Hiding adds complexity too (the user knows there's more). Only hide what's genuinely needed sometimes.
3. **Don't remove features, remove obstacles.** Distill doesn't delete capabilities. It restructures how they're accessed so the primary job is unobstructed.
4. **Consistency is simplicity.** Three card styles that look different create more cognitive load than one card style used three times. Consolidate variation.
5. **Confirm before deleting.** Distillation is subjective. Present the proposed removals and let the user decide. What looks unnecessary to you might be critical to their workflow.
6. **Measure after.** The user should be able to complete their primary task faster after distillation. If they can't, something went wrong.
7. **Progressive disclosure is not a dumping ground.** Don't hide everything behind "More." Be intentional about what's visible vs. collapsed vs. reachable.

---

## DO

- Start by naming the page's single job in one sentence
- Count visible elements before and after
- Remove elements before hiding them
- Consolidate visual variation into fewer patterns
- Present proposed changes for approval before executing

## DON'T

- Remove capabilities; restructure access to them
- Hide everything behind progressive disclosure
- Distill without stating the single-job purpose first
- Assume you know what's unimportant; ask when uncertain
- Optimize for aesthetics at the expense of function
