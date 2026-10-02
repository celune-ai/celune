---
name: design-clarify
description: "Fix confusing interface text. Rewrites labels, buttons, errors, empty states, tooltips, confirmations. TRIGGER when: user says '/design clarify', 'fix the copy', 'improve the labels', 'rewrite the text'."
user_invocable: true
---

# /design clarify -- Fix Confusing Text

Every interface is a conversation between the product and the user. When labels are vague, buttons are generic, errors are cryptic, and confirmations are ambiguous, that conversation breaks down. This skill rewrites interface text across six surfaces to make the product say what it means.

---

## When to Use

- Users are confused about what buttons do
- Error messages are technical or unhelpful
- Empty states are blank or generic
- Labels require explanation or context to understand
- Tooltips restate the label instead of adding information
- Confirmation dialogs don't explain consequences

---

## How It Works

Load `PRODUCT.md` for brand personality and audience. Load `_references/ux-writing.md` for writing conventions. Scan six surfaces and rewrite what's broken.

### Surface 1: Labels

Labels are the most-read text in any interface. They should be direct and specific.

**Common problems:**

- Vague: "Type" (type of what?)
- Ambiguous: "Status" (what status? whose?)
- Jargon: "SKU", "Payload", "Instance" (when users don't use these terms)
- Redundant: "Customer Name" on a page titled "Customer Details"

**Rewrite rules:**

- Specific over generic: "Project status" not "Status"
- User vocabulary over system vocabulary: "Price" not "Unit cost" (unless the audience is accounting)
- Contextually aware: if the page context makes the meaning clear, shorter labels win. "Name" is fine on a contact form.
- Front-load the distinguishing word: "Email address" not "Address (email)"

### Surface 2: Buttons

Buttons are commitments. The user is about to do something. The label should describe what happens when they click.

**Common problems:**

- Generic: "Submit", "OK", "Yes", "Confirm"
- Noun-based: "Submission" instead of "Submit report"
- Ambiguous pairs: "OK / Cancel" on a destructive action

**Rewrite rules:**

- **Verb first.** Describe the outcome: "Save changes", "Send invitation", "Delete project"
- **Match the action to the consequence.** "Delete" for destruction. "Remove" for disassociation. "Cancel" for aborting a process.
- **Pair buttons clearly.** "Delete project / Keep project" not "OK / Cancel"
- **Primary button states the positive action.** The thing the user probably wants to do.

### Surface 3: Errors

Error messages are the interface at its most vulnerable. Users are already frustrated. Bad error messages make it worse.

**Common problems:**

- Technical: "Error 422: Unprocessable Entity"
- Vague: "Something went wrong"
- Blaming: "Invalid input" (whose fault is it?)
- No next step: the error explains the problem but not the solution

**Rewrite rules:**

- **Three parts:** What went wrong + whose fault it is (system or user) + what to do next
- **System fault:** "We couldn't save your changes. Our servers are having trouble. Try again in a minute."
- **User fault (gentle):** "That email address doesn't look right. Check for typos and try again."
- **Never blame:** "Invalid" is accusatory. "Doesn't look right" or "We couldn't find a match" is not.
- **Specific over generic:** "Your password needs at least 8 characters" not "Password doesn't meet requirements"

### Surface 4: Empty States

Empty states are the user's first impression of a feature. Blank pages with "No items" waste that opportunity.

**Common problems:**

- Blank: just... nothing
- Minimal: "No results found"
- Unhelpful: "Nothing here yet" with no guidance

**Rewrite rules:**

- **Three parts:** Orient (what this area is for) + explain (why it's empty) + next step (CTA to fill it)
- Example: "Your projects live here. Create your first project to get started." + [Create project] button
- Match personality to brand. A playful product can say "It's quiet in here." A serious product says "No projects yet."
- Empty search results should suggest corrections: "No results for 'acounting'. Did you mean 'accounting'?"

### Surface 5: Tooltips

Tooltips exist to add information the label couldn't fit. If the tooltip restates the label, it's wasting the user's time.

**Common problems:**

- Restating: Label says "Email", tooltip says "Enter your email address"
- Too long: paragraphs in a tooltip
- Missing: complex features with no guidance

**Rewrite rules:**

- **Add, don't restate.** If the label says "API key", the tooltip should say "Found in Settings > Integrations. Keep this secret."
- **One sentence maximum.** If you need more, it's not a tooltip; it's inline help or documentation.
- **Only add tooltips where they help.** Not every element needs one. A "Save" button does not need a tooltip saying "Saves your work."

### Surface 6: Confirmations

Confirmation dialogs ask the user to commit to something. The dialog must make the consequences clear.

**Common problems:**

- Vague: "Are you sure?" (sure about what?)
- No consequences: "Delete?" without explaining what gets deleted
- Ambiguous buttons: "OK / Cancel" instead of naming the actions

**Rewrite rules:**

- **Name the action and the consequence.** "Delete 'Q4 Report'? This removes the file and all comments. This can't be undone."
- **Button labels match the action.** "Delete report / Keep report" not "OK / Cancel"
- **Distinguish reversible from irreversible.** Reversible: "You can restore this from the trash for 30 days." Irreversible: "This can't be undone."
- **Don't over-confirm.** Low-stakes actions (archiving, hiding) don't need confirmations. Reserve them for destruction and significant state changes.

---

## Process

1. **Read PRODUCT.md.** Audience determines vocabulary and tone. A developer tool uses different language than a consumer app.
2. **Scan all six surfaces.** Don't cherry-pick; do a complete pass.
3. **List every rewrite.** Present as a table: current text, proposed text, rationale.
4. **Prioritize by user impact.** Error messages and buttons affect user decisions. Fix those first.
5. **Apply rewrites.** Update the actual code/content.
6. **Read it out loud.** If any rewrite sounds awkward spoken aloud, revise it.

---

## Rules

1. **Audience vocabulary.** Use the words your users use, not the words your database uses. PRODUCT.md defines the audience.
2. **Buttons are verb-first.** "Save draft", "Send message", "Create project". Never nouns. Never "OK."
3. **Errors have three parts.** What's wrong, whose fault, what to do. All three, every time.
4. **Empty states have three parts.** Orient, explain, next step. All three, every time.
5. **Tooltips add, never restate.** If the tooltip says the same thing as the label, delete the tooltip.
6. **Confirmations name consequences.** "Are you sure?" is never sufficient. Name what happens and whether it's reversible.
7. **Read it out loud.** The best interface text sounds like a helpful colleague talking. If it sounds like a robot or a legal document, rewrite it.

---

## DO

- Use specific verbs that describe outcomes
- Front-load the important word in labels
- Include next-step guidance in every error and empty state
- Name consequences in confirmation dialogs
- Match vocabulary to the audience, not the codebase

## DON'T

- Use "Submit", "OK", "Yes/No", or "Confirm" as button labels
- Write error messages without a recovery path
- Leave empty states blank or with just "No items"
- Add tooltips that restate the label
- Use system jargon in user-facing text
