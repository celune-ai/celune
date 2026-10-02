---
name: design-onboard
description: "First-run and empty state design. Get users to their aha moment fast. TRIGGER when: user says '/design onboard', 'first-run experience', 'onboarding flow', 'new user experience'."
user_invocable: true
---

# /design onboard -- First-Run and Empty State Design

The gap between sign-up and value is where products lose users. This skill designs the bridge: first-run experiences, empty states, setup flows, progressive disclosure, and activation events. The core question: what is the aha moment, and how fast can you get users there?

---

## When to Use

- A product has no first-run experience
- New users land on an empty dashboard with no guidance
- Setup is too long or asks for too much upfront
- User activation rates are low
- Empty states are blank or generic
- Users don't discover key features

---

## How It Works

Load `PRODUCT.md` for user context and product value prop. Load `_references/ux-writing.md` for tone guidance. Design across five surfaces.

### Surface 1: First-Run Experience

The first screen a new user sees after sign-up. Three strategies, each suited to different products.

**Strategy A: Tour / Walkthrough**
Best for: complex products with multiple features.

- Maximum 3-5 steps. Each step reveals one capability.
- Skippable. Always. Some users want to explore on their own.
- Contextual (in-page highlighting) beats modal (blocking overlay).
- End with an action, not a "Done" button. The last step should lead into the user's first task.

**Strategy B: Blank Canvas**
Best for: creative tools, note-taking, project management.

- Show the empty state with clear guidance: "This is where X lives. Create your first one."
- The empty state IS the onboarding. No separate tour needed.
- Primary CTA is front and center: "Create project", "Write your first note", "Add a task."

**Strategy C: Filled Example**
Best for: products where an empty state doesn't communicate value.

- Pre-populate with sample data so users can see what the product looks like in use.
- Label it clearly: "Sample project" with a dismiss/archive option.
- Users learn by editing the example, not by reading instructions.

**Choosing a strategy:** If the product's value is obvious from its primary object (notes, tasks, documents), use B. If the product needs data to make sense (dashboards, analytics), use C. If the product is complex with many features, use A. When in doubt, B is safest.

### Surface 2: Empty States

Every list, dashboard, inbox, and collection starts empty. Each empty state is an onboarding moment.

**Three-part structure:**

1. **Orient:** "This is your project dashboard."
2. **Explain:** "Projects you create or join will appear here."
3. **Next step:** [Create a project] button or link.

**Rules:**

- Never show just "No items" or a blank area.
- Match personality to PRODUCT.md tone.
- If the empty state is caused by a filter/search, suggest adjustments: "No results for 'acounting'. Try 'accounting'?"
- If the user can't create items themselves (e.g., notifications), explain what will fill it: "You'll see notifications here when someone comments on your work."

### Surface 3: Setup and Configuration

The less you ask upfront, the more users complete setup.

**Rules:**

- **Minimize required fields.** Ask only what's needed to show value. Everything else is optional or can come later.
- **Smart defaults.** Pre-select the most common option. Let users change later.
- **Progressive profiling.** Ask for more information over time, not all at once. First session: name and email. Second session: preferences. Third session: integrations.
- **Show progress.** If setup has multiple steps, show how many and where the user is.
- **Allow skip.** Every optional step should be skippable with a clear "I'll do this later" option.
- **Defer complexity.** Integrations, advanced settings, and team invites can wait until after the user has experienced core value.

### Surface 4: Progressive Disclosure

Reveal features as users are ready for them, not all at once.

**Timing strategies:**

- **Usage-based:** show a feature tip after the user has used the product 3-5 times.
- **Context-based:** surface a feature when the user is doing something related. ("Did you know you can filter by date? Try it here.")
- **Achievement-based:** introduce advanced features after the user has completed basic tasks.

**Rules:**

- Maximum one tip per session. More than that is harassment.
- Every tip is dismissible and doesn't come back once dismissed.
- Tips should be contextual (inline, near the relevant feature) not modal (blocking the interface).
- Track what's been shown. Never repeat dismissed tips.

### Surface 5: Activation Events

The moment a user first experiences real value. This is the aha moment. Celebrate it.

**Identifying the aha moment:**

- For a project tool: creating their first project and adding a task
- For a writing tool: publishing their first piece
- For an analytics tool: seeing their first real data (not sample data)
- For a collaboration tool: getting their first response from a teammate

**Celebration rules:**

- Proportional to effort. A login doesn't deserve celebration. A first published post does.
- Name what they accomplished: "Your first project is live!" not just "Congratulations!"
- Suggest what's next: the second action after the aha moment keeps momentum.
- Don't block the user. Celebration should be a moment, not a gate.

---

## Anti-Patterns

Two failure modes to avoid:

**Over-tutorialization:** 10-step tours, mandatory walkthroughs, tooltips on every element, "Did you know?" modals on every login. This treats users like they're incapable and drives them away.

**Zero-onboarding:** empty dashboard, no guidance, no empty states, no progressive disclosure. "The product speaks for itself" is an excuse for not designing the first experience.

The sweet spot: enough guidance that new users aren't lost, little enough that experienced users aren't annoyed.

---

## Process

1. **Define the aha moment.** What specific action or outcome makes a user say "this is useful"? Be concrete.
2. **Map the path from sign-up to aha.** Count the steps. Every step is a potential drop-off.
3. **Minimize the path.** Remove or defer every step that isn't strictly necessary to reach the aha moment.
4. **Design the five surfaces.** First-run, empty states, setup, progressive disclosure, activation celebration.
5. **Test the path.** Walk through the entire experience as a new user. Time it. If it takes more than 2 minutes to reach the aha moment, the path is too long.

---

## Rules

1. **Name the aha moment before designing anything.** If you can't articulate it in one sentence, the product's value prop isn't clear enough.
2. **Every empty state has three parts.** Orient, explain, next step. No exceptions.
3. **Setup asks for the minimum.** If it's not needed to reach the aha moment, it's not needed at sign-up.
4. **Tours are skippable.** Always. Non-negotiable.
5. **One tip per session.** Progressive disclosure is patient. Rushing it creates tooltip fatigue.
6. **Celebrate proportionally.** Small wins get small acknowledgment. Big wins get real celebration. Don't confetti a login.
7. **Test as a new user.** The curse of knowledge is real. Walk through the entire flow assuming no prior context.

---

## DO

- Define the aha moment before designing the flow
- Use empty states as onboarding surfaces
- Minimize required setup fields; defer everything else
- Make tours skippable and contextual
- Celebrate the first real value moment

## DON'T

- Build 10-step mandatory walkthroughs
- Leave empty states blank
- Ask for information you don't need yet
- Show more than one progressive disclosure tip per session
- Celebrate trivial actions with disproportionate fanfare
