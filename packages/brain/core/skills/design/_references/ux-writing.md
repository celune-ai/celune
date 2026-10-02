# UX Writing Reference

> Microcopy, error messages, labels, buttons, empty states, tone, and content patterns for production interfaces.
> This file powers the /design skill's copy decisions. Every label, message, and piece of UI text should trace back to these principles.

---

## Core Principle: Words Are Interface

Every string in a UI is a design decision. The label on a button, the message in an error, the text in an empty state: these are not content that gets filled in later. They are load-bearing parts of the interface that determine whether users succeed or fail.

---

## Labels

### Input Labels

Labels answer one question: "What goes here?"

**Rules:**

- Be specific. "Name" is ambiguous (first? last? company?). Use "First name" or "Company name."
- Use sentence case, not Title Case. Sentence case is easier to scan and feels less formal.
- Keep it under 3 words when possible. If you need more, the input might be too complex.
- Never use the placeholder as the only label. Placeholders disappear when the user starts typing.

```
GOOD                         BAD
Email address                Email
First name                   Name
Company name                 Your company's name
Card number                  Enter your credit card number here
```

### Placeholder Text

Placeholders show format or example data, not instructions:

```
GOOD                         BAD
you@company.com              Enter your email
(555) 123-4567               Phone number goes here
Search tasks...              Type here to search
```

### Checkbox and Radio Labels

State what the option does in active voice:

```
GOOD                         BAD
Send me weekly updates       Weekly updates?
Allow public access          Public access toggle
Remember this device         Remember
```

---

## Buttons

### The Verb-First Rule

Every button label starts with a verb and describes the outcome, not the process:

```
GOOD                         BAD
Save changes                 OK
Create account               Submit
Delete project               Yes
Export as PDF                 Continue
Send invitation              Confirm
```

### Specificity Over Generics

The button label should tell the user what will happen, not ask them to acknowledge a vague action:

```
GOOD                         BAD
Publish post                 OK
Remove team member           Yes, proceed
Upgrade to Pro               Submit
Discard unsaved changes      Continue
```

### Button Hierarchy

In any group of buttons, one is primary (the recommended action) and others are secondary:

- **Primary:** filled background, brand color. One per group maximum.
- **Secondary:** outlined or ghost style. For alternative actions.
- **Destructive:** red/error color (filled or outlined). For irreversible actions.
- **Text/Link:** no border or background. For navigation or dismissal.

```
Primary:     [Save changes]        (filled, brand color)
Secondary:   [Save as draft]       (outlined)
Destructive: [Delete account]      (red, outlined or filled)
Text:         Cancel               (text only, no border)
```

### Button Text Patterns

| Action Type  | Pattern               | Example              |
| ------------ | --------------------- | -------------------- |
| Create       | "Create [thing]"      | Create project       |
| Save         | "Save [scope]"        | Save changes         |
| Delete       | "Delete [thing]"      | Delete 3 files       |
| Send         | "Send [thing]"        | Send invitation      |
| Navigate     | "Go to [place]"       | Go to dashboard      |
| Export       | "Export as [format]"  | Export as CSV        |
| Toggle on    | "Enable [thing]"      | Enable notifications |
| Toggle off   | "Disable [thing]"     | Disable auto-save    |
| Authenticate | "Sign in" / "Sign up" | Sign in with Google  |

---

## Error Messages

### The Three-Part Error

Every error message must contain three pieces of information:

1. **What went wrong** (the problem)
2. **Whose fault it is** (system or user, implied through tone)
3. **What to do next** (the fix)

```
GOOD:
"That email address is already registered. Sign in instead, or use a different email."
 ^ what went wrong              ^ what to do next (two options)

BAD:
"Error: invalid input"
 ^ what went wrong (vague)  ^ no fix offered

BAD:
"Something went wrong. Please try again."
 ^ uninformative            ^ unhelpful
```

### Error Message Patterns

| Scenario             | Message pattern                                                   |
| -------------------- | ----------------------------------------------------------------- |
| Required field empty | "[Field name] is required"                                        |
| Format invalid       | "Enter a valid [thing] (e.g., [example])"                         |
| Too long/short       | "[Field] must be between [min] and [max] characters"              |
| Already exists       | "That [thing] already exists. Try a different [thing]."           |
| Permission denied    | "You don't have access to [thing]. Ask [role] for permission."    |
| Network failure      | "Couldn't reach the server. Check your connection and try again." |
| Server error         | "Something went wrong on our end. Try again in a few minutes."    |
| Rate limited         | "Too many attempts. Wait [time] before trying again."             |
| Not found            | "We couldn't find [thing]. It may have been moved or deleted."    |

### Error Tone Rules

- **Never blame the user.** "You entered an invalid email" becomes "That doesn't look like an email address."
- **Never use technical jargon.** "400 Bad Request" becomes "We couldn't process that request."
- **Never use exclamation marks in errors.** "Error!" adds stress. Use periods.
- **Be honest about system errors.** "Something went wrong on our end" is better than pretending it's a user problem.

---

## Empty States

Empty states are first-impression moments. They answer three questions:

1. **What is this place?** (orient the user)
2. **Why is it empty?** (set expectations)
3. **What do I do next?** (offer a clear action)

### Patterns

```
GOOD:
Title:   "No projects yet"
Body:    "Projects help you organize your work into focused efforts.
          Create your first project to get started."
Action:  [Create project]

BAD:
Title:   "No data"
Body:    (none)
Action:  (none)
```

### Empty State Types

| Type              | Tone               | Action                                           |
| ----------------- | ------------------ | ------------------------------------------------ |
| First use         | Welcoming, guiding | Primary CTA to create first item                 |
| Search no results | Helpful            | Suggest clearing filters or broadening search    |
| Error/failure     | Reassuring         | Retry button, contact support link               |
| Intentional       | Neutral            | None needed (e.g., "No unread messages")         |
| Filtered empty    | Instructive        | "No results match your filters. [Clear filters]" |

---

## Tooltips

### When to Use

- To explain what an icon-only button does
- To provide supplementary context that can't fit in the label
- To show keyboard shortcuts
- To explain why something is disabled

### When NOT to Use

- To restate the label (tooltip "Save" on a button labeled "Save" is redundant)
- To convey critical information (users might never hover)
- To show long paragraphs (if it needs more than one sentence, use a popover or help page)

### Tooltip Text

Keep it under 15 words. No periods at the end unless it's a full sentence.

```
GOOD                              BAD
"Add to favorites"                "Click here to add this item to your favorites list"
"Ctrl+S"                          "Keyboard shortcut"
"Visible to team members only"    "This is only visible to team members"
```

---

## Confirmation Dialogs

### Name the Consequences

The dialog title and confirm button should describe what will happen, not ask a generic question:

```
GOOD:
Title:   "Delete 23 files permanently"
Body:    "This cannot be undone. These files will be permanently
          removed from your account."
Actions: [Cancel]  [Delete 23 files]

BAD:
Title:   "Are you sure?"
Body:    "Do you want to continue?"
Actions: [No]  [Yes]
```

### Confirmation Dialog Rules

- Title: action + specific object + consequence
- Body: clarify irreversibility or impact
- Confirm button: repeats the action verb (Delete, Remove, Publish)
- Cancel button: always labeled "Cancel" (not "No" or "Go back")
- Destructive confirm button gets destructive styling (red)
- Non-destructive confirmations should not require a dialog (auto-save instead)

---

## Numbers and Data

### Use Specific Numbers

Specificity builds trust. Vague language feels evasive.

```
GOOD                              BAD
"3 items selected"                "Items selected"
"Updated 2 minutes ago"           "Recently updated"
"47 results"                      "Multiple results found"
"Saving... (2 of 5 files)"       "Saving..."
"Free for teams up to 5"          "Free for small teams"
```

### Time and Dates

- Relative time for recent events: "2 minutes ago", "Yesterday at 3:15 PM"
- Absolute time for anything older than a week: "April 15, 2026"
- Include timezone for anything time-sensitive: "3:00 PM EST"
- Use the user's locale for date formatting when possible

---

## Tone Adaptation

### Context-Aware Tone

The same product can speak differently depending on the emotional context:

| Context            | Tone                  | Example                                                     |
| ------------------ | --------------------- | ----------------------------------------------------------- |
| Onboarding         | Welcoming, guiding    | "Let's set up your workspace. This takes about 2 minutes."  |
| Success            | Brief, celebratory    | "Project created. You're ready to go."                      |
| Error              | Calm, helpful         | "That didn't work. Here's what to try."                     |
| Destructive action | Serious, clear        | "Delete this project and all its data permanently?"         |
| Loading/waiting    | Reassuring            | "Setting things up... This usually takes about 10 seconds." |
| Payment            | Professional, precise | "You'll be charged $29/month starting May 1."               |

### Audience-Aware Tone

| Audience        | Register             | Example                                             |
| --------------- | -------------------- | --------------------------------------------------- |
| Technical users | Precise, terse       | "API key rotated. Old key invalidated."             |
| Consumer users  | Plain, friendly      | "Your password has been updated."                   |
| Enterprise      | Professional, formal | "Your organization's SSO configuration is active."  |
| Anxious context | Reassuring, gentle   | "Your payment information is encrypted and secure." |

---

## Writing for Scanning

Users don't read; they scan. Every piece of UI text should be optimized for scanning:

### Front-Loading

Put the most important information first. The first two words of any message should carry the meaning:

```
GOOD                              BAD
"3 tasks due today"               "You currently have 3 tasks that are due today"
"Password updated"                "Your password has been successfully updated"
"File too large (max 10MB)"       "The file you're trying to upload exceeds the maximum allowed size of 10MB"
```

### Conciseness

Remove every word that doesn't add information:

```
GOOD                              BAD
"Save changes?"                   "Would you like to save your changes before continuing?"
"Email sent"                      "Your email has been sent successfully"
"No results"                      "Unfortunately, we were unable to find any results matching your search"
```

---

## DO

- Start button labels with a verb
- Name specific objects and quantities in messages
- Provide a clear next action in every error message
- Write empty states that orient, explain, and guide
- Front-load the key information in every message
- Use sentence case everywhere (not Title Case, not ALL CAPS for paragraphs)
- Keep tooltips under 15 words
- Name consequences in confirmation dialogs
- Adapt tone to emotional context (errors are calm, success is brief)
- Test copy with real users, not just designers and developers

## DON'T

- Write "Click here" or "Press this button" (the UI shows what's clickable)
- Use passive voice in calls to action ("Changes will be saved" vs "Save changes")
- End errors with exclamation marks ("Error!" adds anxiety)
- Use "please" in errors or required field messages (it's filler)
- Ship with lorem ipsum or placeholder text in production
- Write "An error has occurred" without explaining what or what to do
- Use title-case for body text or descriptions
- Write tooltips that restate the label
- Use "Are you sure?" as a confirmation dialog title
- Write vague quantities ("some", "multiple", "several") when you have exact numbers

---

## Anti-Patterns

### The "OK/Cancel" Problem

Generic button labels that force the user to re-read the dialog body to understand what each button does. "Delete project" / "Cancel" is instantly clear. "OK" / "Cancel" is not.

### The "Helpful Wall of Text" Problem

Error messages or tooltips that are technically comprehensive but so long that nobody reads them. If the error is "Email is invalid," don't write three sentences about email formatting requirements. One sentence with an example suffices.

### The "Robot Speaks" Problem

System-oriented language that exposes internal implementation: "Record not found in database," "Null reference exception," "403 Forbidden." Translate every system message into human language.

### The "Passive Everything" Problem

"Your changes have been saved." "An error has been encountered." "The file is being uploaded." Passive voice is longer, weaker, and harder to scan. Use active voice: "Changes saved." "Upload failed." "Uploading file..."

---

## Register Variants

### Product Register

- Terse, functional copy
- Abbreviations acceptable for power users (e.g., "Ctrl+S")
- Technical terms allowed if the audience is technical
- Minimal personality in error states
- Data-heavy: prefer numbers and specifics over prose

### Brand Register

- Warmer, more expressive copy
- Full words, no abbreviations
- Plain language for all audiences
- Brand personality shows in success states and empty states
- Storytelling in onboarding and feature discovery
- Exclamation marks allowed sparingly in positive contexts only
