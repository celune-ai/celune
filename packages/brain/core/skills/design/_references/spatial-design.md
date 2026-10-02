# Spatial Design Reference

> Layout, spacing, grids, whitespace, and visual grouping principles for production interfaces.
> This file powers the /design skill's spatial reasoning. Every spacing value, grid decision, and layout pattern should trace back to these principles.

---

## Core Principle: Space Is Structure

Space is not the absence of design; it is the primary tool for communicating relationships. Two elements placed 8px apart are perceived as a group. Two elements placed 48px apart are perceived as separate concerns. This is Gestalt proximity, and it governs every layout decision.

**The designer's job is not to fill space. It is to structure it.**

---

## The 8px Spacing Scale

All spacing derives from an 8px base unit. This creates visual rhythm, simplifies developer handoff, and ensures pixel-perfect alignment on all screen densities.

### The Scale

| Token     | Value | Usage                                                     |
| --------- | ----- | --------------------------------------------------------- |
| `space-1` | 4px   | Optical adjustment only (icon-to-label, badge offset)     |
| `space-2` | 8px   | Tightest intentional spacing (inline elements, icon gaps) |
| `space-3` | 12px  | Compact UI (table cells, dense lists)                     |
| `space-4` | 16px  | Default internal padding (cards, inputs, list items)      |
| `space-5` | 24px  | Group separation within a section                         |
| `space-6` | 32px  | Section padding, modal insets                             |
| `space-7` | 48px  | Major section breaks, page-level vertical rhythm          |
| `space-8` | 64px  | Hero spacing, large section separators                    |
| `space-9` | 96px  | Brand surfaces, landing page section gaps                 |

### Application Rules

- **Internal padding** (inside a component): `space-4` (16px) is the default. Cards, inputs, dropdowns, modals.
- **Gap between related items** (within a group): `space-2` to `space-4` (8-16px). List items, form fields in a group, button rows.
- **Gap between groups** (within a section): `space-5` to `space-6` (24-32px). Separating a form group from the next, sidebar section breaks.
- **Gap between sections** (page-level): `space-7` to `space-8` (48-64px). Major content shifts, topic changes.
- **Brand/marketing surfaces**: `space-8` to `space-9` (64-96px). Hero sections, feature blocks, testimonial areas.

### Why Not 4px Base?

4px is too granular for most decisions. It creates false precision: nobody can perceive the difference between 12px and 16px at a glance, but they can perceive 8px vs 16px. The 8px base keeps the scale coarse enough to be meaningful. Use 4px only for optical corrections (nudging an icon 2px to align with text baseline).

---

## The Proximity Principle

This is the single most important spatial rule. It overrides everything else when there's a conflict.

**Related items must be closer to each other than to unrelated items.**

This sounds obvious, but it's violated constantly. Common violations:

- A form label is equidistant from the field above it and the field below it (which field does it belong to?)
- Card content has the same padding on all sides, making the title feel disconnected from its body
- A "section header" floats in dead space, equidistant from the section above and below

### The Proximity Test

For every label, heading, or group boundary, ask: "Is this element closer to the thing it describes than to the thing it doesn't?" If the answer is no, the spacing is wrong.

### Concrete Pattern: Form Labels

```css
/* WRONG: equal spacing makes label ownership ambiguous */
.form-field + .form-label {
  margin-top: 16px; /* same as margin-bottom of label */
}
.form-label {
  margin-bottom: 16px;
}

/* RIGHT: label hugs its field, separates from the previous field */
.form-field + .form-label {
  margin-top: 24px; /* larger gap above label */
}
.form-label {
  margin-bottom: 4px; /* tight gap below label */
}
```

---

## Grid Systems

### 12-Column Grid (Marketing/Landing Pages)

Use a 12-column grid for pages with varied layout needs: hero sections, feature grids, testimonials, pricing tables. The 12-column grid divides cleanly into halves, thirds, quarters, and sixths.

```css
.grid-marketing {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  gap: 24px; /* gutter */
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 24px; /* page margin */
}
```

**Breakpoint behavior:**

- 1200px+: full 12-column grid
- 768-1199px: collapse to 8 columns or stack
- <768px: single column, full bleed with 16px page margin

### Content-Width Grid (Reading/Product)

For text-heavy product surfaces (documentation, settings, dashboards with prose), constrain the content width to **68ch** (roughly 680px). This keeps line length in the 45-75 character optimal range.

```css
.content-width {
  max-width: 68ch;
  margin: 0 auto;
  padding: 0 24px;
}
```

### Sidebar + Content

A common product layout. Sidebar is fixed width, content area fills remaining space.

```css
.app-layout {
  display: grid;
  grid-template-columns: 240px 1fr;
  min-height: 100vh;
}

/* Content area still constrains prose */
.app-content {
  max-width: 68ch;
  padding: 32px;
}
```

### Dashboard Grid

Dashboards use CSS Grid with explicit areas. Cards snap to a grid, and content within cards follows the spacing scale.

```css
.dashboard {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 24px;
  padding: 32px;
}
```

---

## Whitespace as a Design Element

Whitespace is not wasted space. It is the single most effective way to communicate hierarchy, importance, and breathing room.

### Hierarchy Through Space

The most important content gets the most space around it. A hero headline with 96px of vertical padding commands attention. A dense data table with 8px cell padding communicates utility.

### The Breathing Room Rule

If a section feels cramped, the answer is almost never "make it smaller." It's "give it more space." Increase the gap between sections before reducing font size, truncating text, or removing content.

### Density Modes

Some products need multiple density levels (think Gmail's compact/comfortable/default). Implement this as a spacing scale multiplier, not individual overrides:

```css
[data-density='compact'] {
  --space-unit: 6px;
}
[data-density='default'] {
  --space-unit: 8px;
}
[data-density='comfortable'] {
  --space-unit: 10px;
}
```

---

## Visual Grouping Without Borders

Before adding a border or background to group elements, try spacing first. Grouping should follow this escalation:

1. **Proximity** (space alone creates groups)
2. **Shared alignment** (items on the same grid line feel grouped)
3. **Subtle background** (a slight tint, 2-3% opacity shift)
4. **Divider line** (1px, very low contrast)
5. **Border** (last resort, adds visual noise)

If you need a border to make a group feel like a group, the spacing is probably wrong.

---

## DO

- Use the 8px spacing scale for every margin, padding, and gap
- Apply the proximity test to every label and heading
- Use generous vertical spacing between sections (48-64px minimum)
- Constrain reading content to 45-75 characters per line
- Start with space-based grouping before adding borders
- Use CSS `gap` over margins for grid and flex layouts (avoids margin collapse headaches)
- Use consistent page margins (24px mobile, 32px tablet, 48px+ desktop)
- Test layouts at multiple viewport widths, not just breakpoint boundaries
- Use `minmax()` and `auto-fill`/`auto-fit` for responsive grids that don't need breakpoints

## DON'T

- Use equal padding on all sides of everything (this destroys proximity relationships)
- Pick random pixel values (17px, 23px, 37px) that aren't on the scale
- Cram content to avoid scrolling (scrolling is fine; cramped layouts are not)
- Use pixel-perfect positioning for every element (let the grid do the work)
- Add borders to every card and section (borders add visual noise)
- Use `margin: 0 auto` on everything (explicit grid placement is clearer)
- Set `max-width: 100%` on text without a character-width constraint
- Assume equal column widths are always right (content should drive column ratios)
- Nest grids more than two levels deep (composition over nesting)

---

## Anti-Patterns

### The "Pixel-Perfect Mockup" Trap

Designers hand off a static mockup with arbitrary spacing. Developer measures 13px here, 17px there, 22px elsewhere. The result is a fragile layout with no system. Solution: round to the nearest scale value and have the conversation.

### The "Divide Remaining Space" Trap

Three cards in a row, so each gets exactly 33.33%. But the content in each card varies wildly. Solution: use `auto-fill` with `minmax()` so cards wrap naturally.

### The "Holy Padding" Trap

Every element gets 16px padding because that's "the standard." Buttons, cards, modals, list items, headers, all 16px. Result: everything looks the same, nothing has hierarchy. Solution: vary padding by component purpose (buttons: 8px 16px, cards: 16px 24px, modals: 24px 32px, page sections: 48px 32px).

---

## Register Variants

### Product Register

- Tighter spacing: favor `space-3` to `space-5` for dense interfaces
- 8-column or content-width grids
- Density modes may be appropriate
- Minimize decorative whitespace; every pixel serves utility

### Brand Register

- Generous spacing: `space-7` to `space-9` between sections
- 12-column grid with dramatic full-bleed sections
- Whitespace is a luxury signal; use it liberally
- Asymmetric layouts create visual interest (60/40 splits, offset grids)
- Viewport-height sections for scroll-driven experiences
