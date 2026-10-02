# Interaction Design Reference

> Forms, interactive states, feedback patterns, keyboard navigation, and touch targets for production interfaces.
> This file powers the /design skill's interaction decisions. Every button, input, and interactive element should trace back to these principles.

---

## Core Principle: Every Interaction Has a Response

The user acts; the interface responds. Always. A click with no visual feedback feels broken, even if something is happening. A hover with no state change makes clickable things feel dead. The speed and nature of the response communicates the system's status to the user.

---

## The Five States

Every interactive element must support five visual states. Skipping any of these creates dead spots in the interaction.

### 1. Default

The resting state. Must clearly communicate that the element is interactive (through color, underline, cursor, or affordance).

### 2. Hover

Visual acknowledgment that the user's cursor is over the element. Subtle change: background color shift, slight elevation, or underline appearance.

```css
.button:hover {
  background-color: var(--primary-600); /* one step darker */
}

.link:hover {
  text-decoration-color: var(--primary-500); /* underline appears */
}

.card-interactive:hover {
  box-shadow: var(--shadow-md); /* subtle lift */
}
```

### 3. Focus (Keyboard)

The element has keyboard focus. This MUST be visually distinct. Use `:focus-visible` (not `:focus`) to show focus rings only for keyboard users, not mouse users.

```css
/* Focus ring for keyboard users only */
.button:focus-visible {
  outline: 2px solid var(--primary-500);
  outline-offset: 2px;
}

/* Never do this: */
.button:focus {
  outline: none; /* NEVER remove focus without replacing it */
}
```

**Focus ring rules:**

- 2px minimum width
- Must contrast 3:1 against both the element and its background
- `outline-offset: 2px` prevents the ring from touching the element
- Use `outline`, not `box-shadow`, for focus rings (outlines don't affect layout)

### 4. Active (Pressed)

The moment of click/tap. Brief, immediate feedback.

```css
.button:active {
  transform: scale(0.98);
  background-color: var(--primary-700); /* two steps darker */
}
```

### 5. Disabled

The element cannot be interacted with. Must still be visible and explain WHY it's disabled.

```css
.button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  pointer-events: none; /* prevents click events */
}
```

**Critical rule:** A disabled button without an explanation is a UX failure. Always include a tooltip, helper text, or contextual explanation of what condition must be met to enable it.

```html
<!-- BAD: disabled with no explanation -->
<button disabled>Submit</button>

<!-- GOOD: disabled with reason -->
<div class="button-wrapper" title="Complete all required fields to submit">
  <button disabled>Submit</button>
</div>
```

---

## Touch Targets

### Minimum Sizes

| Platform         | Minimum Target | Recommended |
| ---------------- | -------------- | ----------- |
| Mobile (iOS)     | 44x44px        | 48x48px     |
| Mobile (Android) | 48x48px        | 48x48px     |
| Desktop          | 32x32px        | 36-40px     |

### Spacing Between Targets

Minimum 8px gap between adjacent touch targets. This prevents accidental taps on the wrong element.

### The Invisible Hit Area Pattern

When an icon or text link is visually smaller than 44px, extend the hit area with padding:

```css
.icon-button {
  /* Visual size: 24x24 icon */
  width: 24px;
  height: 24px;

  /* Touch target: 44x44 */
  padding: 10px;
  margin: -10px; /* compensate to preserve visual layout */
}
```

Or use `::after` for a transparent hit area extension:

```css
.small-link {
  position: relative;
}

.small-link::after {
  content: '';
  position: absolute;
  inset: -8px; /* extends hit area 8px in all directions */
}
```

---

## Form Design

### Labels

- **Always above the input**, never beside it (except single checkboxes/radios).
- Labels are `<label>` elements with `for` attribute, not placeholder text.
- Required fields: mark optional fields as "(optional)" rather than marking required fields with asterisks. Most fields are required; mark the exception.

```html
<!-- Pattern: label above input -->
<div class="field">
  <label for="email">Email address</label>
  <input type="email" id="email" placeholder="you@example.com" />
</div>

<!-- Optional field -->
<div class="field">
  <label for="phone">Phone number <span class="optional">(optional)</span></label>
  <input type="tel" id="phone" />
</div>
```

### Input Sizing

- Width should suggest the expected content length (zip code: narrow, email: wide)
- Height: 40-44px for desktop, 48px for touch
- Padding: 12px horizontal, center-aligned text vertically
- Border: 1px solid, clearly visible against the background

### Inline Validation

Validate after the user leaves the field (on blur), not while they're typing (on change). Real-time validation while typing is annoying ("Your email is invalid" while still typing the domain).

```
Timing:
- On blur: validate format and required
- On submit: validate all fields, scroll to first error
- On correction: validate immediately after an error has been shown
```

### Error Messages

- Appear directly below the problematic field
- Use red/error color for the border and message
- Start with what's wrong, then what to do: "Email address is required. Enter your email to continue."
- Never: "Invalid input", "Error", "Please try again"
- Use `aria-describedby` to associate the error with the input

```html
<div class="field field--error">
  <label for="email">Email address</label>
  <input type="email" id="email" aria-invalid="true" aria-describedby="email-error" />
  <p id="email-error" class="field-error" role="alert">
    Enter a valid email address (e.g., name@company.com)
  </p>
</div>
```

### Form Layout

- One column. Multi-column forms have slower completion rates.
- Group related fields with visual sections (fieldset + legend, or heading + spacing).
- Primary action (Submit) at the bottom-left (LTR), aligned with the form fields.
- Destructive secondary actions (Cancel, Delete) visually de-emphasized (text button or ghost button).

---

## Loading States

### Skeleton Screens (Preferred)

Replace content areas with placeholder shapes that match the expected content layout. This communicates structure and feels faster than a spinner.

```css
.skeleton-text {
  height: 1em;
  width: 80%;
  background: var(--neutral-200);
  border-radius: 4px;
  animation: skeleton-pulse 1.5s ease-in-out infinite;
}

.skeleton-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--neutral-200);
  animation: skeleton-pulse 1.5s ease-in-out infinite;
}
```

### Progress Indicators

- **Determinate (preferred):** Show actual progress (42% uploaded, 3 of 7 files).
- **Indeterminate:** Only when progress is truly unknowable. Use a subtle animation, not a spinning wheel.
- **Inline spinners:** Acceptable inside buttons during async actions (e.g., "Saving..." with a small spinner replacing the icon).

### Optimistic Updates

For low-risk actions (starring an item, toggling a setting), update the UI immediately and reconcile with the server in the background. If the server request fails, revert and show an error.

---

## Keyboard Navigation

### Tab Order

- Tab order follows the visual order (left-to-right, top-to-bottom for LTR).
- Never use `tabindex` values greater than 0 (this breaks natural tab order).
- Use `tabindex="0"` to make non-interactive elements focusable (custom components).
- Use `tabindex="-1"` for elements that should be programmatically focusable but not in the tab order.

### Keyboard Patterns by Component

| Component       | Key          | Action                    |
| --------------- | ------------ | ------------------------- |
| Button          | Enter, Space | Activate                  |
| Link            | Enter        | Navigate                  |
| Checkbox        | Space        | Toggle                    |
| Radio group     | Arrow keys   | Move selection            |
| Tab list        | Arrow keys   | Switch tabs               |
| Dropdown/Select | Arrow keys   | Navigate options          |
| Modal           | Escape       | Close                     |
| Menu            | Arrow keys   | Navigate, Enter to select |

### Focus Trapping

Modals and dialogs must trap focus: Tab cycles within the modal, not behind it. Escape closes the modal and returns focus to the trigger element.

```javascript
// Focus trap essentials:
// 1. On open: move focus to first focusable element in modal
// 2. Tab from last focusable element wraps to first
// 3. Shift+Tab from first wraps to last
// 4. Escape: close modal, return focus to trigger
```

### Skip Links

Every page should have a "Skip to main content" link as the first focusable element:

```html
<a href="#main" class="skip-link">Skip to main content</a>

<style>
  .skip-link {
    position: absolute;
    top: -40px;
    left: 0;
    padding: 8px 16px;
    z-index: 100;
  }

  .skip-link:focus {
    top: 0;
  }
</style>
```

---

## Feedback Patterns

### Success Feedback

- Inline: green checkmark, brief success message
- Toast/snackbar: for actions that happen away from the trigger (file saved, email sent)
- Page: for major completions (form submitted, account created)

### Error Feedback

- Inline: red border + message below the field (forms)
- Toast: for async errors (network failure, save failed)
- Page: for blocking errors (404, permission denied)
- Never: silent failure

### Confirmation for Destructive Actions

Required for any action that is:

- Irreversible (delete, send, publish)
- High-consequence (changing permissions, removing team members)
- Affecting other users (shared resources)

---

## DO

- Implement all five states for every interactive element (default, hover, focus, active, disabled)
- Use `:focus-visible` for keyboard-only focus rings
- Ensure 44px minimum touch targets on mobile
- Place labels above inputs, never inside as placeholder-only
- Validate on blur, re-validate immediately after error correction
- Use skeleton screens over spinners for content loading
- Trap focus inside modals and dialogs
- Include a skip link as the first focusable element
- Provide a reason when disabling an interactive element
- Test the entire flow with keyboard only (no mouse)

## DON'T

- Remove focus outlines without replacement (`:focus { outline: none }`)
- Use hover-only interactions (touch devices have no hover)
- Rely on placeholder text as the only label
- Validate while the user is still typing
- Show spinners for operations under 300ms (flash of loading state)
- Use mystery icons without labels or tooltips
- Put disabled buttons without explaining why they're disabled
- Use `tabindex` values greater than 0
- Auto-submit forms without user confirmation
- Create custom scrollbars that break native scrolling behavior

---

## Anti-Patterns

### The "Mystery Meat Navigation" Problem

Icon buttons with no labels, no tooltips, and no text. Users have to click to discover what each button does. Always pair icons with visible labels, or at minimum, a tooltip.

### The "Hover-Only Reveal" Problem

Important actions only appear on hover (edit buttons, delete links, overflow menus). On touch devices, these are invisible. On desktop, users have to mouse over every element to discover what's interactive. Show critical actions by default; relegate secondary actions to a visible overflow menu.

### The "Double-Tap Disabled" Problem

A disabled button that provides no explanation. The user can't tell if it's a bug, a permission issue, or missing data. They click multiple times in frustration. Always explain the condition required to enable the action.

### The "Alert Fatigue" Problem

Every action triggers a confirmation dialog. Save? "Are you sure?" Navigate? "Unsaved changes!" Close? "Really close?" Reserve confirmations for genuinely destructive or irreversible actions. Auto-save where possible.

---

## Register Variants

### Product Register

- Dense interaction targets (32-36px desktop)
- Inline validation, inline errors
- Keyboard shortcuts for power users
- Optimistic updates for common actions
- Minimal confirmations (auto-save model)

### Brand Register

- Generous interaction targets (48px+)
- Single-column forms with ample spacing
- Animated state transitions (250ms)
- Clear confirmation for every action
- Progressive disclosure (show basics, reveal details on demand)
