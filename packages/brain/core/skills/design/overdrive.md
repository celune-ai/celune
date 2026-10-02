---
name: design-overdrive
description: "One extraordinary technical moment. WebGL, spring physics, View Transitions, GPU filters. TRIGGER when: user says '/design overdrive', 'make this extraordinary', 'wow moment', 'push the limits'."
user_invocable: true
---

# /design overdrive -- One Extraordinary Moment

Pick ONE moment in the interface and make it extraordinary. Not "make everything fancy." One moment. WebGL shaders, spring physics, Scroll Timeline, View Transitions, canvas animation, GPU-composited filters. The kind of thing that makes a developer inspect the source.

This is a scalpel, not a paintbrush. The surrounding interface stays clean so the overdrive moment has room to land. Used sparingly, it's a signature. Used everywhere, it's a performance disaster.

---

## When to Use

- A hero section needs a stopping-power moment
- A product launch or brand page needs a technical signature
- A specific interaction should feel magical (page transitions, data visualization, reveal animation)
- The user explicitly asks for something extraordinary
- Brand register only; never for dashboards or admin panels

---

## How It Works

### Step 1: Select the Moment

One moment. Not two. Not "a few." One.

Candidates for overdrive:

- **Hero entrance**: the first thing users see
- **Page transition**: moving between major sections or views
- **Data reveal**: a visualization that earns its complexity
- **Scroll interaction**: content that responds to scroll position
- **Hover/interaction**: a single element with a remarkable response

Ask the user which moment matters most. If they can't decide, pick the hero; it gets the most eyeballs.

### Step 2: Choose the Technique

Match the technique to the moment. Don't use WebGL because it's impressive; use it because the moment demands it.

| Technique                                 | Best for                                               | Complexity | Performance cost         |
| ----------------------------------------- | ------------------------------------------------------ | ---------- | ------------------------ |
| **CSS Scroll Timeline**                   | Scroll-driven animations, parallax, progress           | Low        | Minimal (GPU composited) |
| **View Transitions API**                  | Page/route transitions, layout morphing                | Low-Medium | Minimal (browser-native) |
| **Spring physics** (motion libraries)     | Interactive elements, drag, gesture response           | Medium     | Low if scoped            |
| **GPU filters** (backdrop-filter, filter) | Blur, glass morphism, color effects                    | Low        | Medium (watch on mobile) |
| **Canvas 2D**                             | Particle systems, generative art, custom visualization | Medium     | Medium                   |
| **WebGL / Three.js**                      | 3D, complex shaders, immersive scenes                  | High       | High (needs budget)      |
| **GSAP ScrollTrigger**                    | Complex scroll choreography                            | Medium     | Low-Medium               |

### Step 3: Budget and Profile

Every overdrive moment gets a performance budget:

- **Frame rate**: 60fps minimum, no exceptions. If it drops, simplify.
- **First paint**: overdrive must not block initial render. Lazy-load heavy techniques.
- **Memory**: canvas/WebGL contexts consume GPU memory. One context, cleaned up on unmount.
- **Bundle size**: if the technique requires a library (Three.js, GSAP), account for the added KB. Tree-shake aggressively.
- **Mobile**: test on a mid-range device. If it can't hold 60fps, provide a simpler fallback.

### Step 4: Build with Fallbacks

Every overdrive moment needs three tiers:

1. **Full experience**: the intended effect on capable devices
2. **Reduced-motion**: `prefers-reduced-motion: reduce` gets a static or minimal version. This is mandatory, not optional.
3. **Fallback**: devices/browsers that don't support the technique get a graceful alternative. A static image, a simpler CSS animation, or just the content without the effect.

```
@media (prefers-reduced-motion: reduce) {
  .overdrive-element {
    animation: none;
    /* Static alternative */
  }
}
```

### Step 5: Mark It

Add a comment in the code:

```
/* OVERDRIVE: [technique] — [what it does] — [performance budget] */
```

This signals to future developers that this section is intentionally complex and should be maintained, not simplified during refactoring.

---

## Process

1. **Select one moment.** Get the user's input. If they want overdrive on three things, push back; explain the scalpel principle.
2. **Choose the lightest technique that achieves the effect.** CSS Scroll Timeline over GSAP. View Transitions over custom JS. Native before library.
3. **Build the full experience.** Get it working at 60fps.
4. **Build the reduced-motion fallback.** Not an afterthought; a first-class alternative.
5. **Profile on a mid-range device.** If performance is unacceptable, simplify the effect or scope it to desktop only.
6. **Mark with the OVERDRIVE comment.** Future-proof the intent.

---

## Rules

1. **One moment per page/view.** Multiple overdrive moments compete and cancel each other out. Pick the most impactful one.
2. **60fps or it doesn't ship.** There is no "mostly smooth." Profile on a real device.
3. **Reduced-motion fallback is mandatory.** Not negotiable. Not "we'll add it later." Build it alongside the full experience.
4. **Brand register only.** Overdrive has no place in dashboards, admin panels, or data-heavy tools. If the register is Product, this is the wrong skill.
5. **The surrounding interface stays clean.** Overdrive works because it contrasts with calm surroundings. If everything is busy, nothing is extraordinary.
6. **Native over library.** CSS Scroll Timeline over GSAP. View Transitions API over custom route transitions. Smaller bundle, better performance.
7. **Lazy-load the technique.** WebGL contexts, large animation libraries, and canvas setups should not block first paint. Dynamic import them.
8. **Clean up resources.** Canvas contexts, WebGL programs, animation frames, and event listeners get cleaned up on unmount. Memory leaks are not extraordinary.

---

## DO

- Pick one moment and make it unforgettable
- Profile on mid-range devices before shipping
- Use CSS/browser-native techniques first
- Build reduced-motion fallbacks alongside the full effect
- Mark overdrive sections with clear comments

## DON'T

- Apply overdrive to more than one moment per page
- Use WebGL when CSS can achieve the effect
- Ship without 60fps verification
- Skip reduced-motion fallbacks
- Use overdrive in Product register interfaces
- Let the effect block initial page render
