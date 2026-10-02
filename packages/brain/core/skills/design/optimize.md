---
name: design-optimize
description: "Performance improvement across Web Vitals, rendering, animation, assets, and bundle size. TRIGGER when: user says '/design optimize', 'improve performance', 'too slow', 'fix the loading'."
user_invocable: true
---

# /design optimize -- Performance as Design

Performance is a design decision. A 3-second LCP is not a technical debt item; it's a design failure. Users don't distinguish between "slow to load" and "bad." This skill measures, diagnoses, and fixes performance across five dimensions.

Do not optimize prematurely. If LCP is under 1.1s and INP is under 80ms, the user's time is better spent elsewhere. Run measurements first. Fix what the numbers say is broken.

---

## When to Use

- Page load feels slow (LCP > 2.5s is poor, 1.8-2.5s needs work)
- Interactions feel sluggish (INP > 200ms is poor, 80-200ms needs work)
- Layout shifts during load (CLS > 0.1 is poor)
- Animations stutter or drop frames
- Bundle size is growing and load times are creeping up
- Images are large and unoptimized

---

## How It Works

Five dimensions, each measured before and after. No guessing. No "it feels faster." Numbers.

### Dimension 1: Web Vitals

The three Core Web Vitals are the starting point.

**LCP (Largest Contentful Paint):** How long until the main content is visible.

- Target: under 1.8s (good), under 2.5s (acceptable)
- Common causes: large unoptimized images, render-blocking scripts, slow server response, late-loading web fonts
- Fixes: preload hero images, inline critical CSS, defer non-critical JS, use `font-display: swap`, optimize server response time (TTFB)

**INP (Interaction to Next Paint):** How long until the interface responds to user input.

- Target: under 80ms (good), under 200ms (acceptable)
- Common causes: long tasks on the main thread, heavy event handlers, synchronous layout/style recalculation
- Fixes: break up long tasks with `requestIdleCallback` or `setTimeout`, debounce rapid-fire handlers, move computation to web workers

**CLS (Cumulative Layout Shift):** How much the page layout shifts during load.

- Target: under 0.1
- Common causes: images without dimensions, dynamically injected content, late-loading fonts with different metrics, ads/embeds without reserved space
- Fixes: always set `width` and `height` on images, reserve space for async content, use `font-display: optional` or size-adjusted fallback fonts

### Dimension 2: Rendering

React, Vue, and other frameworks can re-render excessively. Rendering performance is about doing less work per frame.

**Diagnosis:**

- React DevTools Profiler: identify components that re-render when they shouldn't
- Performance tab: identify long tasks and forced layout recalculations
- `why-did-you-render` library: pinpoint unnecessary re-renders

**Fixes:**

- Memoize expensive components: `React.memo`, `useMemo`, `useCallback` (but only where profiling shows a real problem)
- Avoid layout thrashing: batch DOM reads and writes. Don't read `offsetHeight` then write `style.height` in a loop.
- Virtualize long lists: `react-window` or `@tanstack/virtual` for lists over 100 items
- Keys must be stable and unique. Array index keys cause unnecessary re-mounts on reorder.

### Dimension 3: Animations

Animations that trigger layout recalculation stutter. Composited animations don't.

**Layout properties (expensive, avoid animating):**

- `width`, `height`, `top`, `left`, `margin`, `padding`
- Any change triggers layout recalculation for the element and its siblings

**Composited properties (cheap, prefer these):**

- `transform` (translate, scale, rotate)
- `opacity`
- `filter` (with GPU compositing)
- These run on the GPU compositor and don't trigger layout

**Rules:**

- Move elements with `transform: translate()`, not `top/left`
- Size changes with `transform: scale()`, not `width/height`
- Use `will-change` sparingly (it reserves GPU memory; apply to 2-3 elements max)
- `requestAnimationFrame` for JS-driven animations, never `setInterval`
- Test with DevTools "Rendering" tab: enable "Paint flashing" and "Layout Shift Regions"

### Dimension 4: Images and Assets

Images are typically the largest payload on any page.

**Format selection:**

- **Photos:** WebP (25-35% smaller than JPEG), AVIF (50% smaller, check browser support), with JPEG fallback
- **Icons/illustrations:** SVG (scalable, tiny). Inline for small icons, sprite for large sets.
- **Screenshots/UI:** PNG only when transparency is needed. Otherwise WebP.

**Optimization:**

- Always set `width` and `height` attributes (prevents CLS)
- Use `loading="lazy"` for below-fold images
- Use `srcset` and `sizes` for responsive images (serve 400px image to mobile, 1200px to desktop)
- Use `<picture>` element for format fallbacks: `<source type="image/avif">`, `<source type="image/webp">`, `<img>` fallback
- Compress aggressively: quality 75-85 for WebP is visually identical to quality 95

**Fonts:**

- Subset to used characters when possible
- `font-display: swap` (shows fallback immediately, swaps when loaded)
- Preload the primary font: `<link rel="preload" as="font" crossorigin>`
- Self-host over CDN for first-party control

### Dimension 5: Bundle Size

Every kilobyte of JavaScript is parsed, compiled, and executed. Large bundles slow down first load and interaction readiness.

**Diagnosis:**

- Bundle analyzer: `webpack-bundle-analyzer`, `@next/bundle-analyzer`, or `vite-bundle-visualizer`
- Check for unused imports: tree-shaking only works if imports are specific. `import { format } from 'date-fns'` not `import * as dateFns from 'date-fns'`

**Fixes:**

- Code split by route: each page loads only what it needs
- Dynamic import heavy libraries: `const Chartjs = await import('chart.js')` only when the chart is visible
- Replace heavy libraries with lighter alternatives: `date-fns` over `moment`, `zustand` over `redux` (if appropriate)
- Audit `node_modules`: `npx depcheck` to find unused dependencies
- Set a bundle budget: warn/fail the build if a chunk exceeds the limit

---

## Process

1. **Measure baseline.** Lighthouse, WebPageTest, or Chrome DevTools Performance tab. Record LCP, INP, CLS, bundle size, largest assets.
2. **Identify the biggest bottleneck.** Fix the worst dimension first. A 4s LCP matters more than an animation stutter.
3. **Fix and re-measure.** One change at a time. Measure after each fix. Verify the number improved.
4. **Document before/after.** Present as a table: metric, before, after, target.
5. **Set budgets.** After optimization, set performance budgets to prevent regression.

---

## Rules

1. **Measure before optimizing.** No guessing. No "it feels faster." Numbers or nothing.
2. **Don't optimize what isn't broken.** If LCP < 1.1s and INP < 80ms, the performance is good. Spend time elsewhere.
3. **Fix the biggest bottleneck first.** A 2-second LCP improvement matters more than saving 10ms on a re-render.
4. **One change, one measurement.** Change multiple things at once and you won't know what helped.
5. **Composited properties only for animation.** Never animate `width`, `height`, `top`, or `left`. Use `transform` and `opacity`.
6. **Always set image dimensions.** `width` and `height` on every `<img>`. This is the cheapest CLS fix.
7. **Bundle budgets prevent regression.** Set them after optimizing. Future you will thank present you.

---

## DO

- Run Lighthouse or DevTools Performance before making any changes
- Present before/after numbers for every optimization
- Use `transform` and `opacity` for animations
- Lazy-load below-fold images and heavy libraries
- Set `width` and `height` on every image element

## DON'T

- Optimize when LCP < 1.1s and INP < 80ms; it's already good
- Animate layout properties (width, height, top, left, margin)
- Use `will-change` on more than 2-3 elements
- Import entire libraries when you need one function
- Guess at performance problems; measure first
