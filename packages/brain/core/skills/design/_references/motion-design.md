# Motion Design Reference

> Animation principles, easing curves, duration, purpose-driven motion, and accessibility for production interfaces.
> This file powers the /design skill's motion decisions. Every animation should have a purpose, a duration from the scale, and an easing that matches its intent.

---

## Core Principle: Motion Communicates State

Animation is not decoration. Every animation must answer the question: "What state change is this communicating?" If the answer is "none, it just looks cool," remove it.

Motion serves four purposes:

1. **Feedback** - confirming a user action was received (button press, form submit)
2. **Orientation** - showing where something came from or went to (navigation, modals)
3. **Continuity** - maintaining spatial relationships during layout changes (expand/collapse, reorder)
4. **Attention** - drawing focus to something that requires action (notification, error)

If an animation doesn't serve one of these four purposes, it doesn't belong.

---

## Duration Scale

Like spacing and type, animation durations follow a scale. Picking durations from this scale creates consistent, predictable motion.

| Token                | Duration | Purpose                                                      |
| -------------------- | -------- | ------------------------------------------------------------ |
| `duration-instant`   | 0ms      | State changes with no perceptible transition (color swap)    |
| `duration-micro`     | 100ms    | Hover states, toggle switches, checkbox ticks                |
| `duration-fast`      | 150ms    | Button feedback, icon transitions, tooltips appear           |
| `duration-standard`  | 250ms    | Default for most transitions (modals, dropdowns, tab switch) |
| `duration-emphasis`  | 400ms    | Deliberate emphasis (card expand, page transition)           |
| `duration-dramatic`  | 600ms    | Brand moments (hero entrance, scroll-driven reveal)          |
| `duration-cinematic` | 800ms+   | Marketing hero, loading sequences, brand storytelling        |

### Rules

- **Micro-interactions: 100-150ms.** The user should perceive the response as instantaneous.
- **Standard transitions: 200-300ms.** Slow enough to track, fast enough to not feel sluggish.
- **Emphasis/brand: 400-600ms.** Deliberate, cinematic, used sparingly.
- **Never exceed 1000ms** for any single animation in product UI. Beyond 1 second, users feel like the interface is slow.
- **Exits are faster than entrances.** A modal entering at 250ms should exit at 200ms. Users want to dismiss things quickly.

---

## Easing Curves

Easing determines how an animation accelerates and decelerates. The right easing makes motion feel physical and natural. The wrong easing makes it feel robotic or chaotic.

### The Easing Hierarchy

| Easing               | CSS Value                           | When to Use                                |
| -------------------- | ----------------------------------- | ------------------------------------------ |
| **Ease-out (decel)** | `cubic-bezier(0.16, 1, 0.3, 1)`     | **Default.** Elements entering the screen. |
| **Ease-in-out**      | `cubic-bezier(0.65, 0, 0.35, 1)`    | Elements moving within the screen.         |
| **Ease-in (accel)**  | `cubic-bezier(0.7, 0, 0.84, 0)`     | Elements leaving the screen.               |
| **Linear**           | `linear`                            | Progress bars, opacity fades only.         |
| **Spring**           | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Playful UI, toggle snap, rare.             |

### Exponential Easing (Preferred)

Standard CSS `ease-out` (`cubic-bezier(0.0, 0.0, 0.58, 1.0)`) decelerates too gradually. Modern interfaces use exponential deceleration for a more natural, physical feel.

```css
/* Standard exponential ease-out (our default) */
--ease-out: cubic-bezier(0.16, 1, 0.3, 1);

/* Aggressive exponential (for larger movements) */
--ease-out-expo: cubic-bezier(0.19, 1, 0.22, 1);

/* Smooth ease-in-out for repositioning */
--ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);

/* Exit acceleration */
--ease-in: cubic-bezier(0.7, 0, 0.84, 0);
```

### Never Use

- **`linear`** for motion (only for progress bars and opacity). Linear motion looks mechanical and unnatural.
- **`bounce`/`elastic`** in product UI. They feel unprofessional and extend animation duration unnecessarily. Reserve for game UI or playful brand moments with explicit approval.
- **Default CSS `ease`** (`cubic-bezier(0.25, 0.1, 0.25, 1)`). It's a weak, generic curve. Always specify an intentional easing.

---

## What to Animate

### Safe Properties (GPU-Composited)

Only animate these properties. They're handled by the GPU compositor and won't trigger layout recalculations:

- `transform` (translate, scale, rotate)
- `opacity`

Everything else triggers layout or paint and will jank.

### Transform Patterns

```css
/* Entrance: fade up */
.enter {
  animation: fade-up 250ms var(--ease-out) forwards;
}
@keyframes fade-up {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Exit: fade out (faster) */
.exit {
  animation: fade-out 200ms var(--ease-in) forwards;
}
@keyframes fade-out {
  from {
    opacity: 1;
    transform: translateY(0);
  }
  to {
    opacity: 0;
    transform: translateY(4px);
  }
}

/* Scale entrance (modal, dropdown) */
.scale-enter {
  animation: scale-in 250ms var(--ease-out) forwards;
}
@keyframes scale-in {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

/* Slide from side (drawer, sidebar) */
.slide-enter {
  animation: slide-in 300ms var(--ease-out) forwards;
}
@keyframes slide-in {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(0);
  }
}
```

### Never Animate

- `width`, `height` (triggers layout). Use `transform: scale()` instead, or animate `max-height` with `overflow: hidden` if content size changes.
- `top`, `right`, `bottom`, `left` (triggers layout). Use `transform: translate()`.
- `margin`, `padding` (triggers layout).
- `border-width` (triggers layout). Animate `box-shadow` or `outline` instead.
- `color` directly (triggers paint on every frame). If you must, use opacity on a colored overlay.

---

## Animation Patterns

### Staggered List Entrance

When multiple items enter simultaneously, stagger them by 50-80ms each. Cap the total stagger at 400ms (roughly 5-8 items visible).

```css
.list-item {
  animation: fade-up 250ms var(--ease-out) both;
}

.list-item:nth-child(1) {
  animation-delay: 0ms;
}
.list-item:nth-child(2) {
  animation-delay: 50ms;
}
.list-item:nth-child(3) {
  animation-delay: 100ms;
}
.list-item:nth-child(4) {
  animation-delay: 150ms;
}
.list-item:nth-child(5) {
  animation-delay: 200ms;
}
/* Cap here. Items 6+ should enter with item 5. */
```

### Loading States

- **Skeleton screens** over spinners. Skeletons communicate content structure and feel faster.
- **Pulse animation** for skeleton placeholders: subtle opacity oscillation.
- **Determinate progress** when possible (75% uploaded). Indeterminate only when truly unknown.

```css
.skeleton {
  background: var(--color-surface-secondary);
  animation: skeleton-pulse 1.5s ease-in-out infinite;
  border-radius: 4px;
}

@keyframes skeleton-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}
```

### State Transitions

Interactive elements should transition between states smoothly:

```css
.button {
  transition:
    background-color 150ms var(--ease-out),
    transform 100ms var(--ease-out),
    box-shadow 150ms var(--ease-out);
}

.button:hover {
  background-color: var(--color-primary-hover);
}

.button:active {
  transform: scale(0.98);
}
```

### Page Transitions

Cross-fade between pages or views. The outgoing view fades out while the incoming view fades in, with a slight upward movement.

```css
/* View transition API (modern browsers) */
::view-transition-old(root) {
  animation: 200ms var(--ease-in) both fade-out;
}

::view-transition-new(root) {
  animation: 300ms var(--ease-out) both fade-up;
}
```

---

## Accessibility: prefers-reduced-motion

This is not optional. It is a legal and ethical requirement.

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

**Rules:**

- All decorative animation must respect `prefers-reduced-motion`.
- Functional animations (like a drawer opening) can use a simple fade instead of sliding, but should still indicate state change.
- Never use `animation-play-state: paused` as the reduced-motion fallback (it freezes mid-animation).
- Test with reduced motion enabled. Your interface should be fully functional and understandable without any animation.

---

## Scroll-Driven Animation

Modern CSS supports scroll-driven animations without JavaScript:

```css
/* Fade in elements as they scroll into view */
.scroll-reveal {
  animation: fade-up linear both;
  animation-timeline: view();
  animation-range: entry 0% entry 100%;
}
```

**Rules for scroll-driven animation:**

- Use `animation-timeline: view()` for element-based triggers.
- Keep effects subtle: opacity and small translate only.
- Never hijack scroll (parallax that fights the user's scroll speed).
- Always falls back gracefully when unsupported (the element should be visible by default).

---

## DO

- Give every animation a purpose (feedback, orientation, continuity, attention)
- Use the duration scale, not arbitrary values
- Default to ease-out (exponential) for entrances
- Make exits faster than entrances
- Only animate `transform` and `opacity`
- Implement `prefers-reduced-motion` from the start
- Stagger list animations by 50-80ms, capped at 400ms total
- Use skeleton screens instead of spinners
- Test animations at 0.25x speed (browser DevTools) to catch timing issues
- Use CSS custom properties for easing values (consistency across codebase)

## DON'T

- Add animation "because it looks cool" without a state-change purpose
- Use bounce or elastic easing in product UI
- Exceed 1000ms for any single product animation
- Animate layout properties (width, height, margin, top, left)
- Use linear easing for motion (only for progress and opacity)
- Auto-play animations that loop indefinitely (except loading indicators)
- Animate on page load without user trigger (except initial content entrance)
- Create parallax effects that fight scroll direction
- Use `animation-delay` greater than 400ms (users think the interface is broken)
- Forget to test with reduced motion enabled

---

## Anti-Patterns

### The "Everything Bounces" Problem

Elastic/bounce easing applied to modals, dropdowns, tooltips. It feels playful for about 30 seconds, then becomes exhausting. Reserve spring physics for deliberate brand moments.

### The "Slow Reveal" Problem

Content slides in over 800ms+ with heavy easing. The user is waiting for the UI to finish performing before they can use it. Product animations should be invisible; fast enough to orient but not slow enough to notice.

### The "Scroll Hijack" Problem

Parallax layers that move at different speeds, sections that snap-scroll, scroll-triggered animations that prevent natural scrolling. The user's scroll input should result in predictable scroll output, always.

### The "Infinite Loop" Problem

Animated gradients, pulsing elements, rotating icons that never stop. These are distracting, drain battery, and cause motion sickness for vestibular-sensitive users. If it loops, it needs a purpose and a stop condition.

---

## Register Variants

### Product Register

- Duration: 100-300ms (fast and functional)
- Purpose: feedback and orientation only
- No decorative animation
- Skeleton loading, instant transitions
- `prefers-reduced-motion` disables nearly everything

### Brand Register

- Duration: 300-800ms (deliberate and cinematic)
- Purpose: storytelling and emotional impact
- Scroll-driven reveals, staggered entrances
- Hero sequences with choreographed timing
- `prefers-reduced-motion` reduces to simple fades
- Entry animations on view, parallax-lite effects
