---
name: design-harden
description: "Make UI survive reality. Long names, errors, RTL, offline, slow connections. TRIGGER when: user says '/design harden', 'edge cases', 'error states', 'what if it breaks', 'production ready'."
user_invocable: true
---

# /design harden -- For the Day It Meets Real Users

Your interface works with "Jane Doe" and a fast connection. Now make it work with "Dr. Maria-Fernanda Gutierrez-Worthington III" on a spotty mobile connection who just hit a rate limit while her screen reader announces an error in German. Harden is the reality check: text extremes, error scenarios, internationalization, and hostile device conditions.

---

## When to Use

- Feature is functionally complete and works on the happy path
- Before a launch or significant release
- After `/design audit` routes accessibility or responsive findings here
- When real user bug reports start coming in (names truncated, errors swallowed, layouts breaking)
- Before `/design polish` (harden the scenarios first, then polish the pixels)

**Not for:** First-run empty states or onboarding flows (use `/design onboard`). Not for visual polish (use `/design polish`). Not for responsive breakpoints (use `/design adapt`, though harden checks device extremes).

---

## What It Loads

**Always:**

- `_references/interaction-design.md` (form validation, error patterns, input states)
- `_references/responsive-design.md` (touch targets, viewport extremes, device conditions)
- `_references/ux-writing.md` (error messages, empty states, loading copy, truncation)

**Also reads if they exist:**

- `PRODUCT.md` (users, constraints, i18n requirements)
- `DESIGN.md` (component patterns, existing error states)

---

## The 4 Dimensions

### 1. Text and Data Extremes

Test every text-rendering element with hostile input.

**Test strings:**

| Scenario              | Test Value                                                | What Breaks                                      |
| --------------------- | --------------------------------------------------------- | ------------------------------------------------ |
| Long name             | `Dr. Maria-Fernanda Gutierrez-Worthington III` (47 chars) | Truncation, overflow, layout shift               |
| Very long single word | `Pneumonoultramicroscopicsilicovolcanoconiosis`           | No word-break point; overflows containers        |
| Empty string          | `""`                                                      | Collapsed elements, missing fallbacks            |
| Single character      | `"X"`                                                     | Undersized elements, lost padding                |
| Emoji in text         | `"John 🎉 Smith"`                                         | Font fallback, line-height disruption, rendering |
| RTL characters        | `"محمد"`                                                  | Direction handling, alignment                    |
| HTML/script injection | `"<script>alert(1)</script>"`                             | XSS if rendered as HTML                          |
| Extremely long number | `999,999,999,999.99`                                      | Column width, alignment, overflow                |
| Negative number       | `-$1,234.56`                                              | Minus sign handling, red text conventions        |
| Zero / null           | `0`, `null`, `undefined`                                  | Display as "0" vs blank vs "N/A"                 |
| Date extremes         | `2000-01-01`, `2099-12-31`                                | Date formatting, timezone edge cases             |

**What to verify for each:**

- Text truncates with ellipsis (not mid-character clip)
- Layout doesn't break (no horizontal scroll, no overlap)
- Fallback displays for empty/null values
- `overflow-wrap: break-word` or `word-break: break-word` on user-generated content
- `text-overflow: ellipsis` with `overflow: hidden` and `white-space: nowrap` on single-line displays
- Multi-line content has a `line-clamp` or explicit max-height

### 2. Error Scenarios

Every network call fails. Every validation rule triggers. Every permission gets denied.

**Error categories to cover:**

| Category           | Scenarios                                                                                                                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Network**        | Timeout, DNS failure, connection dropped mid-request, slow response (5s+)                                                                                                                    |
| **HTTP errors**    | 400 (bad request), 401 (unauthorized/session expired), 403 (forbidden), 404 (not found), 409 (conflict), 422 (validation), 429 (rate limited), 500 (server error), 503 (service unavailable) |
| **Validation**     | Required field empty, format invalid (email, phone, URL), min/max length, type mismatch, duplicate value                                                                                     |
| **Business logic** | Insufficient permissions, quota exceeded, feature not available in plan, conflicting edits, stale data                                                                                       |
| **Auth**           | Session expired mid-flow, token refresh failure, account locked, MFA required                                                                                                                |

**For each error, verify:**

1. **Is there a visible error state?** Not just a console.log. The user sees something.
2. **Does the message explain what happened?** Not "An error occurred." Say what went wrong.
3. **Does it say what to do next?** "Try again", "Check your connection", "Contact support", "Sign in again."
4. **Is the error recoverable?** Can the user retry without losing their work? Form data preserved? Draft saved?
5. **Is the error associated with the right element?** Inline validation errors next to the field, not just a banner at the top.
6. **Does the error use the semantic error color?** Error states use the error palette from the color system, with proper contrast.

**Error message format:**

```
[What happened] + [Why] + [What to do]

"Your session has expired. For security, sessions last 24 hours. Sign in again to continue."
"That email is already registered. Try signing in, or use a different email."
"Upload failed: files must be under 10 MB. Compress the image and try again."
```

**Never:**

- "An error occurred" (meaningless)
- "Error: 500" (technical gibberish to users)
- "Invalid input" (which input? what's invalid about it?)
- Error messages that blame the user ("You entered an invalid email")

### 3. Internationalization (i18n)

Even if the product is English-only today, harden against the inevitable.

**Text expansion:**

| Language                | Expansion vs. English                |
| ----------------------- | ------------------------------------ |
| German                  | +30%                                 |
| French                  | +20%                                 |
| Finnish                 | +30-40%                              |
| Japanese/Chinese/Korean | -30% (but taller line height needed) |
| Arabic/Hebrew           | RTL layout reversal                  |

**What to verify:**

- Fixed-width containers can handle 30% longer text without breaking
- Buttons with text labels don't overflow at 130% width
- Tables and forms use flexible column widths
- No text is embedded in images (untranslatable)
- Date formats use locale-aware formatting (not hardcoded "MM/DD/YYYY")
- Number formats handle commas vs. periods as thousands/decimal separators
- Currency symbols on both sides ($ prefix vs. suffix in other locales)
- Pluralization isn't hardcoded ("1 item" vs "2 items" doesn't work in all languages)

**RTL checks (if applicable):**

- Layout mirrors correctly (sidebar on right, text right-aligned)
- Icons that imply direction (arrows, back buttons) are flipped
- `dir="rtl"` is set on the root element
- CSS uses logical properties (`margin-inline-start` not `margin-left`)

### 4. Device and Context

The lab environment lies. Test against reality.

**Touch targets:**

- Every interactive element is at least 44x44px on touch devices
- Adjacent touch targets have at least 8px spacing
- Swipe gestures have fallback tap targets
- No hover-only interactions on touch devices (tooltips, dropdown on hover)

**Offline and degraded network:**

- What happens when the connection drops mid-action?
- Is there a visible offline indicator?
- Can the user still navigate cached content?
- Do forms preserve input when the submit fails?
- Does the app recover gracefully when connection returns?

**Slow connections (3G simulation):**

- Images have loading="lazy" below the fold
- Above-fold content renders without waiting for all assets
- Large operations show progress indication, not just a spinner
- Timeouts are set (don't hang forever on a failed request)

**Viewport extremes:**

- 320px width (smallest common phone)
- 2560px width (ultrawide monitor)
- 667px height (landscape phone; fixed headers/footers eat most of this)
- Dynamic viewport height (`dvh`) for mobile browsers with disappearing address bars

**Screen reader verification:**

- Announce dynamic content changes with `aria-live`
- Error messages are announced when they appear
- Loading states have `aria-busy="true"` on the updating region
- Modal focus trapping works (tab doesn't escape to behind the modal)
- Form labels are associated with inputs (`for`/`id` or wrapping `<label>`)

---

## Algorithm

1. **Read context** (PRODUCT.md for user profiles and constraints, DESIGN.md for existing patterns)
2. **Identify all text-rendering elements** and test with extreme strings
3. **Map every network call** and define error states for each failure mode
4. **Check text expansion tolerance** (simulate 30% longer strings)
5. **Verify touch targets and viewport extremes**
6. **Test or spec offline behavior** for any stateful flows
7. **Fix found issues** inline, noting which dimension each fix addresses
8. **Present a hardening summary** listing what was tested and what was fixed

---

## Rules

1. **Test with real data, not "John Smith."** Real users have long names, special characters, empty fields, and emoji. Your test data should too.
2. **Every error needs three parts:** what happened, why, and what to do next. Anything less is unhelpful.
3. **Don't swallow errors.** A `catch (e) {}` with no user-visible feedback is a bug, not error handling.
4. **Inline validation beats top-of-form banners.** Show the error next to the field, not in a dismissible alert at the top of the page.
5. **Touch targets are 44x44px minimum.** Not 32px. Not "it's fine, the hitbox is bigger than it looks." 44px.
6. **Preserve user work.** If a form submit fails, the form data must still be there when they try again. Clearing a form on error is hostile.
7. **Assume the worst connection, not the best.** Your users are not all on fiber. Test at 3G speeds.
8. **Reduced motion applies to error animations too.** Shaking inputs, bouncing alerts, sliding toasts all need `prefers-reduced-motion` fallbacks.

---

## Chains

- **Before:** `/design polish` (harden the scenarios, then polish the visuals)
- **After:** `/design craft` (build the feature first, then stress-test it), `/design audit` (routes hardening findings here)
- **Complements:** `/design animate` (animate handles the motion patterns; harden defines the scenarios that need them), `/design onboard` (onboard handles first-run; harden handles the ongoing reality)
