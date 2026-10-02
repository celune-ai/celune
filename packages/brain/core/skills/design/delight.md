---
name: design-delight
description: "Add small moments of personality and joy. Empty states, loading, success feedback, microcopy, easter eggs. TRIGGER when: user says '/design delight', 'add personality', 'make it delightful', 'add polish touches'."
user_invocable: true
---

# /design delight -- Small Moments of Personality

Delight is the difference between software that works and software people like using. This skill hunts for opportunities to add personality, warmth, and surprise without compromising function.

This is a finishing skill. Run it after the interface works correctly, looks good, and passes audit. Delight layered on a broken interface is lipstick on a bug.

---

## When to Use

- The interface is functional and well-designed but feels sterile
- Empty states are blank or generic
- Loading states are bare spinners
- Success moments pass without acknowledgment
- Copy is correct but has zero personality
- The product has a defined brand personality that isn't showing through

---

## How It Works

Load `PRODUCT.md` to understand brand personality and tone. If no PRODUCT.md exists, default to warm-professional. Scan five areas for delight opportunities.

### Area 1: Empty States

Empty states are the most underused canvas in software. Users see them first, see them often, and form impressions from them.

**Hunt for:**

- Blank pages with no content yet (first-use, no results, empty lists)
- Generic "No items found" messages
- Placeholder text that could carry personality

**Add:**

- Illustration or icon that matches brand personality (not generic stock)
- Copy that orients ("This is where your projects live"), explains ("Create your first project to get started"), and provides a next step (CTA button)
- Personality-appropriate humor or warmth if the brand supports it
- Don't overdo it; one empty state with strong personality beats ten with forced jokes

### Area 2: Loading and Waiting

Waiting is dead time. Delight reclaims it.

**Hunt for:**

- Bare spinner icons with no context
- Long operations with no progress indication
- Skeleton screens that are just gray rectangles

**Add:**

- Content-aware loading: show what's coming ("Loading your dashboard...") instead of a generic spinner
- Progress indication for operations over 2 seconds
- Skeleton screens that match actual content shapes
- For long waits (5s+): tips, fun facts, or progress details
- Never auto-play heavy animation for loading; a subtle pulse or fade is enough

### Area 3: Success Feedback

Users complete tasks and... nothing happens. The interface just moves on. Success moments deserve celebration, proportional to effort.

**Hunt for:**

- Form submissions that silently redirect
- Completed onboarding with no acknowledgment
- Achieved milestones (first project, 100th entry, streak)
- Purchases, upgrades, or significant actions

**Add:**

- Confirmation with personality: "You're all set" beats "Success"
- Visual feedback proportional to effort: a subtle checkmark for small actions, a moment of celebration for big ones
- Avoid confetti for everything. Reserve the big celebrations for genuinely significant moments.
- Toast notifications with specific, helpful messages

### Area 4: Microcopy

Every label, button, tooltip, and error message is an opportunity for voice.

**Hunt for:**

- Generic button labels ("Submit", "OK", "Cancel")
- Tooltips that restate the label
- Error messages that are technical or cold
- Placeholder text that could guide

**Add:**

- Verb-first buttons that describe the outcome: "Save changes" not "Submit"
- Tooltips that add information the label couldn't fit
- Error messages with warmth: acknowledge the problem, explain it, offer a fix
- Placeholder text that gives examples: "e.g., Weekly team standup" not "Enter name"
- Tone should match PRODUCT.md personality. A healthcare app is warm but not cute. A creative tool can be playful.

### Area 5: Easter Eggs

Small hidden touches for users who explore. These are optional and should never interfere with core function.

**Hunt for:**

- Keyboard shortcuts that could have personality (Konami code, custom sequences)
- About pages or settings that could reward curiosity
- Seasonal or contextual moments (holidays, user anniversaries)
- Console messages for developers who inspect

**Add sparingly:**

- One or two at most per product
- Must be discoverable but not required
- Must not confuse users who find them accidentally
- Must not break accessibility or function

---

## The Delight Test

Every delight must pass this test:

> **If you delete the delight, does the interface still work perfectly?**

If removing the delight breaks function, flow, or comprehension, it's not delight; it's a feature. Delight is additive. It makes good things better; it doesn't paper over bad things.

---

## Process

1. **Read PRODUCT.md.** Brand personality determines what kind of delight is appropriate. A medical app and a social app have very different delight spectrums.
2. **Scan the five areas.** Identify which have the most opportunity. Usually empty states and microcopy have the highest yield.
3. **Propose 3-5 specific changes.** Not a general "add delight everywhere." Specific moments, specific copy, specific interactions.
4. **Implement proportionally.** Big moments get big delight. Small moments get subtle touches. Everything in between gets nothing; delight is specific, not distributed.
5. **Test the delight test.** Delete each addition mentally. Does everything still work? Good.

---

## Rules

1. **Finishing skill only.** Do not add delight to a broken or poorly designed interface. Function first, then form, then feeling.
2. **Brand personality governs tone.** Read PRODUCT.md. Healthcare warm is different from gaming playful is different from fintech trustworthy. Match the personality.
3. **The delight test is mandatory.** Every addition must be removable without breaking anything.
4. **Proportional to effort.** A login gets a subtle welcome. Completing a month-long project gets a real moment. Don't celebrate everything equally.
5. **Microcopy is the highest-yield area.** Changing button labels and error messages is cheap and high-impact. Start there.
6. **One easter egg maximum in most products.** Easter eggs are seasoning. Too many and the product feels unserious.
7. **Accessibility survives delight.** Animations have reduced-motion fallbacks. Copy changes maintain clarity. No delight should make the interface harder to use.

---

## DO

- Start with microcopy; it's the cheapest, highest-impact delight
- Match empty state personality to brand tone
- Celebrate success proportionally to user effort
- Use content-aware loading messages
- Test every delight with the deletion test

## DON'T

- Add delight to broken interfaces; fix first
- Use confetti for trivial actions
- Force humor where the brand tone is serious
- Add animation that doesn't respect `prefers-reduced-motion`
- Let delight obscure function or information
