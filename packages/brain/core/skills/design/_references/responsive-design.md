# Responsive Design Reference

> Breakpoints, fluid layout, container queries, content priority, and cross-device patterns for production interfaces.
> This file powers the /design skill's responsive decisions. Every layout choice should work from mobile to ultrawide without content loss or layout breakage.

---

## Core Principle: Adapt, Don't Amputate

Every feature available on desktop must be accessible on mobile. The presentation can change (collapsed menu, stacked layout, bottom sheet instead of sidebar), but the functionality cannot disappear. If a feature is critical enough to exist on desktop, it's critical enough to exist on mobile.

---

## Breakpoint Philosophy

### Content-First Breakpoints

Don't design for device widths. Design for content breakpoints: the viewport width at which your content breaks, becomes unreadable, or wastes space.

Start with the content in a single column. Resize the viewport wider. When the content starts to look stretched, sparse, or wasteful, that's where you add a layout change.

### Reference Breakpoints

These are starting points, not mandates. Adjust based on your content.

| Token | Width  | Rough target        | Layout change                      |
| ----- | ------ | ------------------- | ---------------------------------- |
| `sm`  | 640px  | Large phones        | Stack to 2-column for small cards  |
| `md`  | 768px  | Tablets (portrait)  | Sidebar appears, grid goes 2-col   |
| `lg`  | 1024px | Tablets (landscape) | Full navigation, 3-col grids       |
| `xl`  | 1280px | Desktop             | Max content width, wider sidebar   |
| `2xl` | 1536px | Large desktop       | Content centered, whitespace grows |

### Mobile-First Implementation

Always start with the mobile layout (no media query), then add complexity:

```css
/* Base: mobile (single column, full width) */
.grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
  padding: 16px;
}

/* sm: 2 columns for card grids */
@media (min-width: 640px) {
  .grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 24px;
    padding: 24px;
  }
}

/* lg: 3 columns, full layout */
@media (min-width: 1024px) {
  .grid {
    grid-template-columns: repeat(3, 1fr);
    gap: 24px;
    padding: 32px;
  }
}
```

---

## Fluid Layout Techniques

### clamp() for Typography

See typography.md for full details. Key pattern:

```css
/* Fluid heading: 24px to 48px between 320px and 1200px viewport */
h1 {
  font-size: clamp(1.5rem, 1rem + 2.7vw, 3rem);
}
```

### minmax() for Grids

Let grid columns flex between a minimum and maximum size:

```css
/* Auto-wrapping grid: columns are at least 280px, fill available space */
.auto-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 24px;
}
```

This grid is fully responsive with zero media queries. Cards will wrap naturally based on available space.

### Container Queries

Container queries let components respond to their container's size, not the viewport. This is essential for components that appear in different layout contexts (sidebar vs main content vs modal).

```css
/* Define a container */
.card-container {
  container-type: inline-size;
  container-name: card;
}

/* Component responds to container width */
@container card (min-width: 400px) {
  .card {
    grid-template-columns: 120px 1fr;
  }
}

@container card (max-width: 399px) {
  .card {
    grid-template-columns: 1fr;
  }
}
```

**When to use container queries vs media queries:**

- **Media queries:** page-level layout changes (sidebar appears, navigation style changes)
- **Container queries:** component-level layout changes (card layout, widget density)

---

## Navigation Patterns

### Mobile (< 768px)

**Bottom navigation bar** for primary navigation (3-5 items max):

- Fixed to bottom of viewport
- 56px height
- Icon + label for each item
- Highlights current section
- Safe area padding for notched devices

```css
.bottom-nav {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 56px;
  padding-bottom: env(safe-area-inset-bottom);
  display: flex;
  justify-content: space-around;
  align-items: center;
  background: var(--surface-raised);
  border-top: 1px solid var(--border);
  z-index: 50;
}
```

**Hamburger menu** for secondary/full navigation:

- Trigger: top-left or top-right icon button
- Opens as full-height drawer from the side
- Focus trapping while open
- Backdrop overlay dismisses

### Tablet (768px-1024px)

**Collapsed sidebar** (icon-only rail, 56-72px wide):

- Icons for primary navigation
- Expands on hover or click to show labels
- Tooltip labels as hover fallback

### Desktop (1024px+)

**Full sidebar** (240-280px wide):

- Icons + labels
- Collapsible sections for nested nav
- Fixed position (doesn't scroll with content)

### Responsive Navigation Pattern

```css
/* Mobile: bottom nav */
.sidebar {
  display: none;
}
.bottom-nav {
  display: flex;
}

/* Tablet: collapsed sidebar */
@media (min-width: 768px) {
  .bottom-nav {
    display: none;
  }
  .sidebar {
    display: flex;
    width: 56px; /* icon-only */
  }
  .sidebar-label {
    display: none;
  }
}

/* Desktop: full sidebar */
@media (min-width: 1024px) {
  .sidebar {
    width: 240px;
  }
  .sidebar-label {
    display: block;
  }
}
```

---

## Content Priority

### The Stacking Rule

On mobile, elements stack vertically in order of importance. The most important content comes first in the HTML source order.

```css
/* Desktop: sidebar + content side by side */
.layout {
  display: grid;
  grid-template-columns: 1fr;
}

@media (min-width: 1024px) {
  .layout {
    grid-template-columns: 240px 1fr;
  }
}
```

With this pattern, the sidebar content naturally falls below the main content on mobile (or above, depending on HTML order). Use CSS `order` to reorder if needed, but prefer logical source order.

### Tables on Mobile

Wide tables break on small screens. Strategies:

1. **Horizontal scroll** (simplest): wrap table in `overflow-x: auto` container
2. **Card transformation**: each row becomes a card with label-value pairs
3. **Column priority**: hide low-priority columns on mobile, show them on desktop

```css
/* Strategy 1: horizontal scroll */
.table-wrapper {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

/* Strategy 2: card transformation */
@media (max-width: 639px) {
  table,
  thead,
  tbody,
  tr,
  th,
  td {
    display: block;
  }
  thead {
    display: none;
  }
  td::before {
    content: attr(data-label);
    font-weight: 600;
    display: block;
  }
}

/* Strategy 3: column priority */
@media (max-width: 639px) {
  .col-priority-low {
    display: none;
  }
}
```

### Images

- Use `srcset` and `sizes` for resolution-appropriate images
- Use `<picture>` with `<source>` for art-direction (different crops per viewport)
- Always include `width` and `height` attributes to prevent layout shift
- Use `loading="lazy"` for below-the-fold images
- Use `aspect-ratio` for responsive image containers

```html
<picture>
  <!-- Wide crop for desktop -->
  <source media="(min-width: 768px)" srcset="hero-wide.webp" />
  <!-- Square crop for mobile -->
  <source srcset="hero-square.webp" />
  <img src="hero-fallback.jpg" alt="Description" width="1200" height="600" loading="eager" />
</picture>
```

---

## Spacing Adjustments

Page margins, padding, and gaps should tighten on mobile:

```css
:root {
  --page-margin: 16px;
  --section-gap: 32px;
  --card-padding: 16px;
}

@media (min-width: 768px) {
  :root {
    --page-margin: 24px;
    --section-gap: 48px;
    --card-padding: 20px;
  }
}

@media (min-width: 1024px) {
  :root {
    --page-margin: 32px;
    --section-gap: 64px;
    --card-padding: 24px;
  }
}
```

---

## Testing Requirements

### Device Testing Checklist

- 320px viewport (smallest phone: iPhone SE)
- 375px viewport (standard phone: iPhone 14)
- 428px viewport (large phone: iPhone 14 Pro Max)
- 768px viewport (tablet portrait: iPad)
- 1024px viewport (tablet landscape)
- 1280px viewport (laptop)
- 1440px viewport (desktop)
- 1920px viewport (large desktop)
- 2560px viewport (ultrawide, to check max-width behavior)

### What to Check

- Text readability (no truncation, no overflow)
- Touch targets (44px minimum on touch devices)
- Navigation accessibility (can reach all features)
- Image behavior (no cropping that loses meaning)
- Form usability (labels visible, inputs reachable)
- Horizontal scroll (should only exist intentionally, like tables)
- Fixed elements (headers, bottom nav) don't overlap content
- Safe area insets on notched devices

---

## DO

- Start mobile-first and add complexity with `min-width` media queries
- Use `auto-fill` with `minmax()` for naturally responsive grids
- Use container queries for components that exist in multiple layout contexts
- Set `max-width` on content areas to prevent ultrawide stretching
- Use `clamp()` for fluid typography on brand surfaces
- Test on real devices, not just browser resize
- Provide bottom navigation on mobile for primary nav
- Use `env(safe-area-inset-*)` for notched device padding
- Include `width` and `height` on images to prevent layout shift
- Use `loading="lazy"` for below-the-fold images

## DON'T

- Hide features on mobile (adapt the presentation, not the functionality)
- Create horizontal scroll on the main page content
- Use fixed pixel widths for layout containers (use %, fr, minmax)
- Design only for breakpoint boundaries (test the in-between sizes)
- Use `max-width` media queries as the primary responsive strategy (mobile-first is min-width)
- Set `height: 100vh` for full-page sections (mobile browsers have dynamic viewport height; use `dvh`)
- Assume hover exists on touch devices
- Place important actions in hard-to-reach zones (top corners on large phones)
- Use desktop-sized spacing on mobile (tighten margins and padding)
- Create separate mobile and desktop codebases (one responsive codebase)

---

## Anti-Patterns

### The "Desktop Shrink" Problem

Designing for desktop first, then squeezing everything smaller until it fits on mobile. The result is tiny text, cramped layouts, and hidden content. Always start mobile-first.

### The "Breakpoint-Only Design" Problem

Designing exactly at 768px and 1024px, but never checking 900px or 1100px. The layout breaks in the spaces between breakpoints. Test continuously across the full range.

### The "m-dot Site" Problem

Building a completely separate mobile site at m.example.com. Double the maintenance, divergent features, SEO problems. Use responsive design in a single codebase.

### The "Hamburger Everything" Problem

Hiding all navigation behind a hamburger menu, even on desktop. Navigation discoverability drops dramatically when hidden behind a menu. Show primary navigation visibly on desktop; collapse for mobile only.

### The "100vh Lie" Problem

Using `100vh` for full-screen sections on mobile. Mobile browsers have dynamic toolbars that change the visible viewport. `100vh` includes the space behind the toolbar, causing content to be partially hidden. Use `100dvh` (dynamic viewport height) instead.

---

## Register Variants

### Product Register

- Compact layouts with early column breaks (sm: 640px)
- Dense data tables with horizontal scroll on mobile
- Sidebar navigation on desktop, bottom nav on mobile
- Container queries for dashboard widgets
- Minimal fluid sizing (fixed scale values)

### Brand Register

- Late column breaks (keep single-column longer for dramatic reading)
- Full-bleed images and sections
- Fluid typography that scales dramatically
- Viewport-height hero sections (using `dvh`)
- Scroll-driven reveals and parallax-lite
- Asymmetric layouts at desktop, clean single-column at mobile
