---
name: design-animate
description: "Add purposeful motion that communicates state, not decoration. TRIGGER when: user says '/design animate', 'add animation', 'add transitions', 'make it feel alive', 'loading states'."
user_invocable: true
---

# /design animate -- Motion That Communicates

Adds motion that tells users what happened, what's happening, and what will happen next. Every animation answers a question: "Did my action work?" "Where did that come from?" "What's loading?" If the animation doesn't answer a question, it doesn't belong.

---

## When to Use

- State changes feel jarring (instant appear/disappear, abrupt swaps)
- Hover and focus states have no transition
- Content appears without context (popping in from nowhere)
- Loading states are missing or use a bare spinner with no skeleton
- The interface feels static and unresponsive to user actions
- Reduced motion support is missing

**Not for:** Decorative animation (bouncing logos, floating particles, parallax backgrounds). Not for animation-heavy marketing pages (that's a `/design craft` scope decision). Not for fixing layout or typography.

---

## What It Loads

**Always:**

- `_references/motion-design.md` (timing, easing, principles, patterns, reduced motion)

**Also reads if they exist:**

- `PRODUCT.md` (register, brand personality)
- `DESIGN.md` (existing motion tokens, transition standards)

---

## The 5 Areas

### 1. Entrances and Exits

Content that appears or disappears should transition, not teleport.

**Entrance pattern (fade + subtle movement):**

```css
/* Base entrance */
@keyframes enter {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.entering {
  animation: enter 250ms ease-out forwards;
}
```

**Timing by element type:**

| Element                | Duration                     | Movement                     | Easing         |
| ---------------------- | ---------------------------- | ---------------------------- | -------------- |
| Tooltip / popover      | 150-200ms                    | fade only (no Y shift)       | ease-out       |
| Dropdown / menu        | 200ms                        | fade + scaleY from origin    | ease-out       |
| Modal / dialog         | 250ms                        | fade + translateY(16px)      | ease-out-quart |
| Toast / notification   | 250ms                        | fade + translateX(from edge) | ease-out       |
| Page content (stagger) | 200ms per item, 50ms stagger | fade + translateY(8px)       | ease-out       |
| Exit (any)             | 150-200ms                    | reverse of entrance          | ease-in        |

**Rules:**

- Entrances are longer than exits (enter: 200-300ms, exit: 150-200ms). Users care about arrivals; departures should be quick.
- Movement direction should match origin: dropdown from top, slide-over from side, modal from bottom (mobile) or center (desktop).
- Staggered lists: max 5-6 items staggered, then batch the rest. Staggering 50 items is a slideshow, not animation.

### 2. State Feedback

Every user action should produce visible feedback.

**Hover:**

```css
.interactive {
  transition:
    background-color 150ms ease-out,
    box-shadow 150ms ease-out,
    transform 150ms ease-out;
}

.interactive:hover {
  /* Choose 1-2 of: background lightening, subtle lift, border change */
}
```

**Focus:**

```css
.interactive:focus-visible {
  outline: 2px solid var(--primary-500);
  outline-offset: 2px;
  transition: outline-offset 100ms ease-out;
}
```

**Active / pressed:**

```css
.interactive:active {
  transform: scale(0.98);
  transition: transform 80ms ease-in;
}
```

**Loading (button):**

```css
.button--loading {
  position: relative;
  color: transparent; /* hide text */
  pointer-events: none;
}
.button--loading::after {
  /* spinner centered in button */
  animation: spin 600ms linear infinite;
}
```

**Disabled:**
No transition to disabled state. Disabled should feel inert, not animated.

### 3. View Transitions

Moving between views, tabs, or pages.

**Tab / segmented control:**

- Active indicator slides to the new position (translateX, 200ms, ease-out)
- Content crossfades (old fades out 100ms, new fades in 150ms)

**Page transitions (SPA):**

- Exiting page fades out (150ms, ease-in)
- Entering page fades in with subtle Y shift (250ms, ease-out)
- Or: shared-element transitions where a card expands into its detail view

**Accordion / expandable:**

```css
.accordion-content {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 250ms ease-out;
}
.accordion-content.open {
  grid-template-rows: 1fr;
}
```

Use `grid-template-rows` for height animation (performs well, no layout thrashing).

### 4. Progress and Loading

**Skeleton screens (preferred over spinners):**

```css
.skeleton {
  background: linear-gradient(
    90deg,
    var(--neutral-100) 25%,
    var(--neutral-200) 50%,
    var(--neutral-100) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s ease-in-out infinite;
}
```

**When to use what:**

| Pattern                   | When                                                                           |
| ------------------------- | ------------------------------------------------------------------------------ |
| Skeleton screen           | Layout is predictable (lists, cards, profiles). Show the shape of the content. |
| Spinner (small, inline)   | Single element loading (button, input validation).                             |
| Progress bar              | Determinate progress (file upload, multi-step process).                        |
| Spinner (large, centered) | Entire page loading with unpredictable layout. Use sparingly.                  |

**Rules:**

- Skeleton shapes should match the actual content dimensions. Don't use generic rectangles.
- Show skeletons immediately (no 200ms delay before showing them). Users should see the skeleton before they notice the wait.
- Progress bars animate with `linear` easing (the only valid use of linear easing).
- Spinners rotate at 600-800ms per revolution.

### 5. Reduced Motion

**This is mandatory, not optional.**

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

**Or, more granularly:** Replace motion-based animations with opacity-only alternatives:

```css
@media (prefers-reduced-motion: reduce) {
  .entering {
    animation: fade-in 200ms ease-out forwards;
    /* no translateY, just fade */
  }
}
```

**Rules:**

- Every animation must have a reduced-motion fallback
- Opacity transitions are safe (no vestibular trigger)
- `scroll-behavior: smooth` must be disabled
- Auto-playing animations (loading spinners, skeleton shimmer) may continue but should use opacity only

---

## Easing Reference

| Easing             | CSS Value                              | When                                                |
| ------------------ | -------------------------------------- | --------------------------------------------------- |
| **ease-out**       | `cubic-bezier(0.16, 1, 0.3, 1)`        | Entrances. Fast start, gentle landing.              |
| **ease-out-quart** | `cubic-bezier(0.25, 1, 0.5, 1)`        | Modal/dialog entrances. More dramatic deceleration. |
| **ease-in**        | `cubic-bezier(0.55, 0.06, 0.68, 0.19)` | Exits. Gentle start, fast departure.                |
| **ease-in-out**    | `cubic-bezier(0.45, 0.05, 0.55, 0.95)` | State changes (expand/collapse, position shifts).   |
| **linear**         | `linear`                               | Progress bars ONLY. Nothing else.                   |

**Banned easing:**

- `bounce` (unprofessional, distracting)
- `elastic` (unprofessional, distracting)
- `linear` for UI transitions (feels robotic)
- Browser default `ease` (too generic, weak deceleration)

---

## Rules

1. **Only animate `transform` and `opacity`.** These are GPU-composited. Animating `width`, `height`, `top`, `left`, `margin`, or `padding` triggers layout recalculation and causes jank.
2. **`prefers-reduced-motion` is non-negotiable.** Ship without it and you fail accessibility. Period.
3. **No bounce, no elastic.** These easing curves feel toylike and untrustworthy in product UI. Even in brand register, use them only for playful illustration, never for functional interactions.
4. **Entrances are longer than exits.** Users want to see what arrives; they want departures to be quick and out of the way.
5. **Stagger max 5-6 items.** After that, batch. Nobody wants to watch 50 cards animate one by one.
6. **Skeletons over spinners.** Skeleton screens preserve layout context and feel faster. Spinners say "wait" with no information about what's coming.
7. **Every animation answers a question.** "Did my click register?" "Where did this come from?" "What's loading?" If it doesn't answer one, remove it.
8. **Respect the register.** Brand register allows more expressive motion (longer durations, more movement). Product register keeps motion minimal and functional (shorter durations, subtle transitions only).

---

## Chains

- **Before:** `/design polish` (motion should be in place before the final consistency sweep)
- **After:** `/design craft` (structure should exist before adding motion), `/design layout` (spacing should be solid before things start moving)
- **Works with:** `/design harden` (loading states and error transitions overlap; animate handles the motion, harden handles the scenarios)
