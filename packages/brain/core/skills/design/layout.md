---
name: design-layout
description: "Fix pages where nothing breathes. Rebuild spacing, hierarchy, rhythm, and density. TRIGGER when: user says '/design layout', 'fix the layout', 'nothing breathes', 'spacing feels off', 'rework the grid'."
user_invocable: true
---

# /design layout -- Make It Breathe

Fixes pages where nothing is technically broken but nothing has room to land. Equal padding everywhere, no clear primary action, random pixel values, no rhythm between sections. Layout rebuilds the spatial system so the eye knows where to go and the content has room to speak.

---

## When to Use

- Everything has the same padding and nothing stands out
- The eye doesn't know where to land first
- Spacing uses arbitrary values (13px, 22px, 37px) with no system
- The page feels either cramped or floaty with no in-between
- Cards, sections, and groups all blur together
- A redesign of spacing and visual weight without changing content

**Not for:** Typography problems (use `/design typeset`), color problems (use `/design colorize`), responsive breakpoints (use `/design adapt`).

---

## What It Loads

**Always:**

- `_references/spatial-design.md` (spacing scales, grid systems, layout composition, alignment)

**When the scope includes multiple breakpoints:**

- `_references/responsive-design.md` (breakpoint strategy, fluid layouts, content reflow)

**Also reads if they exist:**

- `PRODUCT.md` (register, users, content type)
- `DESIGN.md` (spacing tokens, grid system, elevation)

---

## The 5 Dimensions

### 1. Spacing System

**The problem:** Random pixel values. Every margin and padding is a one-off decision. The result is visual noise that the brain processes as disorder, even if the user can't articulate it.

**The fix:** Establish a spacing scale and map every value to it.

**Recommended scale (base 8):**

| Token      | Value | Use                                           |
| ---------- | ----- | --------------------------------------------- |
| `space-1`  | 4px   | Inline elements, icon gaps                    |
| `space-2`  | 8px   | Tight grouping (label to input, icon to text) |
| `space-3`  | 12px  | Related elements within a group               |
| `space-4`  | 16px  | Default internal padding (cards, containers)  |
| `space-6`  | 24px  | Between groups within a section               |
| `space-8`  | 32px  | Between sections on a page                    |
| `space-12` | 48px  | Major section breaks                          |
| `space-16` | 64px  | Page-level vertical rhythm                    |
| `space-24` | 96px  | Hero spacing, dramatic breaks                 |

**Rules:**

- Tighter within related groups, looser between unrelated sections
- Inner padding < outer margin (a card's internal padding should be less than the gap between cards)
- If DESIGN.md defines a scale, use it. If it conflicts with these recommendations, flag the conflict.

### 2. Visual Hierarchy

**The problem:** The user's eye lands on the page and doesn't know where to go. Everything has equal visual weight. No primary action, no clear entry point.

**The 2-second test:** Can a new user identify the primary action within 2 seconds of seeing the page? If not, the hierarchy is broken.

**Hierarchy levers (from strongest to weakest):**

| Lever        | How It Works                                                                                                                              |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Size**     | Larger elements draw the eye first. Page title > section heading > body. Primary button > secondary.                                      |
| **Contrast** | High contrast (dark on light, or bright on neutral) pulls attention. Low contrast recedes.                                                |
| **Space**    | Elements with more surrounding whitespace feel more important. A CTA with 48px of breathing room dominates one squeezed between siblings. |
| **Position** | Top-left in LTR layouts has natural primacy. Center placement signals importance. Bottom-right is terminal (submit, next).                |
| **Color**    | A single saturated element on a neutral page is unmissable. Use sparingly; too much color = no hierarchy.                                 |
| **Weight**   | Bolder text draws the eye before lighter text at the same size.                                                                           |

**Method:**

1. Identify the single most important action or information on the page
2. Give it the strongest combination of levers (size + contrast + space)
3. Identify 2-3 secondary elements and give them moderate strength
4. Everything else gets default or reduced treatment

### 3. Grid and Structure

**The problem:** Elements are positioned without an underlying spatial logic. Things line up by accident (or don't). Adding content breaks the layout because there's no grid to absorb it.

**Evaluating structure:**

- Is there a visible or implicit column grid?
- Do elements align to consistent vertical lines?
- Does the layout use a content width constraint (max-width)?
- Is there a consistent pattern for how sections are composed?

**Common structures:**

| Pattern                     | When                                                |
| --------------------------- | --------------------------------------------------- |
| **Single column, centered** | Content pages, articles, forms, settings            |
| **Sidebar + main**          | Dashboards, admin panels, documentation             |
| **Multi-column grid**       | Card layouts, galleries, product listings           |
| **Asymmetric two-column**   | Landing pages (hero + supporting), feature sections |
| **Full-bleed sections**     | Marketing pages with alternating backgrounds        |

**Implementation:**

- Use CSS Grid or Flexbox, not absolute positioning or float
- Set `max-width` on content areas (1200px for wide layouts, 768px for reading, 480px for narrow forms)
- Use `gap` instead of margins between grid items (one value to maintain, not N margins)
- Allow the grid to define alignment; don't manually nudge elements

### 4. Rhythm

**The problem:** Every section has the same spacing. The page reads like a spreadsheet: row after row of equal-weight content with no visual breathing.

**The fix:** Alternate tight and generous spacing to create rhythm.

**Rhythm pattern:**

```
[Hero area]           -- generous (space-24: 96px top/bottom)
[Section heading]     -- moderate (space-8: 32px above)
  [Content group]     -- tight (space-4: 16px between items)
  [Content group]     -- tight
[Section break]       -- generous (space-12: 48px)
[Section heading]     -- moderate
  [Content group]     -- tight
[CTA area]            -- generous (space-16: 64px isolation)
[Footer]              -- moderate
```

The alternation between tight clusters and generous breaks creates a visual cadence that guides the eye down the page.

**Rules:**

- Never use the same spacing token for both intra-group and inter-section gaps
- Horizontal rhythm matters too: don't let content run edge-to-edge without padding
- Section breaks should be noticeably larger than group breaks (at least 2x)

### 5. Density

**The problem:** The density doesn't match the content type. A data dashboard crammed into a spacious marketing layout wastes space. A blog post crammed into a dense dashboard layout is unreadable.

**Density guide:**

| Content Type      | Density     | Spacing Scale                         | Line Length                           |
| ----------------- | ----------- | ------------------------------------- | ------------------------------------- |
| Marketing / brand | Low (airy)  | Generous: 24/48/96px between sections | 55-65ch                               |
| Editorial / blog  | Low-medium  | Moderate-generous: 16/32/64px         | 55-65ch                               |
| Product UI / app  | Medium      | Moderate: 8/16/24/32px                | 65-75ch for content, dense for tables |
| Dashboard / data  | High        | Tight: 4/8/12/16/24px                 | Dense; optimize for scanability       |
| Admin / settings  | Medium-high | Moderate-tight: 8/12/16/24px          | Full-width forms, dense lists         |

**Register alignment:**

- Brand register: bias toward lower density, more whitespace, more dramatic spacing
- Product register: bias toward higher density, efficient use of space, information-forward

---

## Algorithm

1. **Read context** (PRODUCT.md for register and users, DESIGN.md for existing spacing tokens)
2. **Identify the content type** and match to appropriate density
3. **Establish or verify the spacing scale** (8-base recommended; align with DESIGN.md if it exists)
4. **Run the 2-second test** on each page/view: where does the eye land? Is it the right place?
5. **Rebuild hierarchy** with the 6 levers, starting from the primary action
6. **Impose grid structure** if one is missing; verify alignment if one exists
7. **Create rhythm** by differentiating intra-group spacing from inter-section spacing
8. **Replace all arbitrary values** with spacing scale tokens

---

## Rules

1. **Fix spacing before anything else.** Layout is the foundation. Typography and color build on top of it. If spacing is wrong, everything on top will feel wrong.
2. **One primary action per view.** If two things compete for dominance, neither wins. Pick one.
3. **Inner padding < outer margin.** Always. A card's 16px padding should live inside a 24px gap between cards.
4. **Don't center everything.** Center alignment is for hero headings and CTAs. Body text, form labels, and navigation should be left-aligned (in LTR layouts). Over-centering is an AI anti-pattern.
5. **Use the spacing scale, not "whatever looks right."** "Looks right" is how you get 13px margins. The scale keeps decisions consistent across the team.
6. **Whitespace is not wasted space.** Density should match content type, but even dense dashboards need breathing room between logical groups.
7. **Test with real content.** A layout that works with "Lorem ipsum" and 3-word labels will break with real data. Use realistic text lengths.

---

## Chains

- **Before:** `/design typeset` (set spacing before type), `/design colorize` (set structure before color), `/design polish` (layout is structural; polish is final)
- **After:** `/design shape` (brief informs density and hierarchy decisions)
- **Works with:** `/design adapt` (layout defines the desktop structure; adapt handles breakpoint behavior)
