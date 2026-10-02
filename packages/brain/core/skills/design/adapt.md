---
name: design-adapt
description: "Make a design work in another context. Mobile, tablet, email, embedded. TRIGGER when: user says '/design adapt', 'make this responsive', 'mobile version', 'adapt for tablet'."
user_invocable: true
---

# /design adapt -- Design for Another Context

Take a design that works in one context and make it work in another. Desktop to mobile. Web to email. Full page to embedded widget. The challenge is adaptation, not amputation. Critical features can't disappear when the viewport shrinks.

---

## When to Use

- A desktop design needs a mobile version
- A web interface needs to work on tablet
- Content needs to render in email clients
- A full-page experience needs to live inside an iframe or widget
- An existing responsive implementation has layout issues at certain breakpoints

---

## How It Works

Load `PRODUCT.md` and `DESIGN.md` if they exist. Load `_references/responsive-design.md` for breakpoint strategy. Assess the current design across four dimensions.

### Dimension 1: Layout and Breakpoints

How the spatial structure transforms at each viewport size.

**Assessment:** Identify the current layout strategy. Is it fluid, fixed, or hybrid? Where does it break?

**Adaptation:**

- **Fluid first.** Use `clamp()`, percentages, and `fr` units so layout flexes before breakpoints kick in.
- **Breakpoints are rescue points**, not layout switches. The design should flex gracefully; breakpoints fix what can't flex.
- **Common breakpoints:** 640px (mobile), 768px (tablet portrait), 1024px (tablet landscape / small desktop), 1280px (desktop). Use the design system's breakpoints if DESIGN.md defines them.
- **Sidebar patterns:** sidebar on desktop collapses to bottom nav on mobile, or to a hamburger menu. Bottom nav is almost always better than hamburger for primary navigation.
- **Grid collapse:** multi-column grids stack to single column. But consider 2-column on tablet instead of jumping straight to single.

### Dimension 2: Touch Targets

Fingers are not cursors. Touch requires larger, spaced-apart interactive areas.

**Assessment:** Measure interactive element sizes. Anything under 44x44px (Apple HIG) or 48x48dp (Material) is a problem.

**Adaptation:**

- **Minimum touch target: 44x44px.** This is the interactive area, not necessarily the visual size. A 24px icon can have a 44px tap target with padding.
- **Spacing between targets:** at least 8px between adjacent interactive elements to prevent mis-taps.
- **Hover-dependent interactions don't exist on touch.** Tooltips triggered by hover need a tap alternative. Dropdown menus on hover need a tap trigger.
- **Swipe zones:** if the design uses horizontal scrolling, add visible overflow indicators (partial next item, scroll dots).

### Dimension 3: Navigation Patterns

How users move through the interface changes with the device.

**Assessment:** Map the current navigation structure. Sidebar? Top nav? Breadcrumbs? Tabs? How deep does it go?

**Adaptation:**

- **Desktop sidebar becomes mobile bottom nav** for primary navigation (3-5 items max).
- **Secondary navigation** goes behind a menu icon or into a sheet/drawer.
- **Breadcrumbs** collapse on mobile. Show only the parent and current page, with "..." for intermediate levels.
- **Tabs** work on mobile if there are 2-4 items. More than 4: scrollable tabs with visible overflow.
- **Back navigation** must be explicit on mobile. Don't rely on browser back; provide an in-app back button or gesture.

### Dimension 4: Content Priority

Not everything that fits on desktop fits on mobile. But the answer is rarely "remove it."

**Assessment:** Rank every content element by importance. What must be visible immediately? What can be collapsed? What can be reached via interaction?

**Adaptation rules:**

- **Visible:** primary content, primary action, status/state. These must be above the fold on every viewport.
- **Collapsed:** secondary content, metadata, supporting information. Accordion, expandable section, or "show more."
- **Reachable:** tertiary content, advanced options, configuration. Behind a link, in a sheet, or on a sub-page.
- **Never removed:** critical features cannot disappear on mobile. If a user can do it on desktop, they must be able to do it on mobile (even if the interaction is different).

---

## Context-Specific Adaptations

### Desktop to Mobile

Focus on touch targets, bottom nav, single-column layout, and content priority. Load `_references/responsive-design.md`.

### Web to Email

HTML email is a different rendering engine. Tables for layout. Inline styles. No JavaScript. No flexbox/grid (mostly). No web fonts (fallback stacks). Max-width 600px. Test in Outlook, Gmail, and Apple Mail minimum. Load `_references/responsive-design.md` for email breakpoint strategy.

### Full Page to Embedded

When the design lives inside another page (iframe, widget, embed): respect the host's visual language. Reduce chrome to minimum. Remove navigation (the host handles it). Ensure the component works at multiple widths. Use container queries if the host width varies.

---

## Process

1. **Identify source and target context.** What exists, what's needed.
2. **Load references.** `responsive-design.md` always. Others based on the adaptation type.
3. **Assess all four dimensions.** Layout, touch, navigation, content priority.
4. **Adapt systematically.** Start with layout (the biggest structural changes), then navigation, then touch targets, then content priority.
5. **Test at real sizes.** Not just "mobile." Test at 320px (small phone), 375px (standard phone), 414px (large phone), 768px (tablet), and 1024px (small desktop).
6. **Verify critical features survive.** Walk through every key user flow on the target context. If something is missing, it's a bug.

---

## Rules

1. **Adapt, don't amputate.** Critical features can't disappear on mobile. If users need it, it must be reachable.
2. **Touch targets are 44px minimum.** Interactive area, not visual size. No exceptions on touch devices.
3. **Fluid before breakpoints.** Layout should flex. Breakpoints are rescue points for what can't flex.
4. **Bottom nav over hamburger** for primary navigation with 3-5 items. Hamburger menus hide things users need.
5. **Test at 320px.** The smallest viewport catches problems that 375px hides. If it works at 320, it works everywhere.
6. **Content priority is a spectrum, not a binary.** Visible, collapsed, reachable. Three levels, not two (show/hide).
7. **Hover doesn't exist on touch.** Every hover interaction needs a tap equivalent.

---

## DO

- Start with layout; it's the biggest structural adaptation
- Use `clamp()` and fluid units before adding breakpoints
- Provide visible overflow indicators for horizontal scroll areas
- Test every key user flow on the target context
- Use container queries for embedded/widget contexts

## DON'T

- Remove features on mobile; collapse or restructure instead
- Use hamburger menus for primary navigation
- Assume "responsive" means "stacks on mobile"; it means "works on every viewport"
- Skip 320px testing; small phones still exist
- Rely on hover interactions for critical functionality
