# /email-template — Generate Branded Email Templates

Create Resend-compatible HTML email templates matching the Celune brand system.

## Arguments

`/email-template <description of the email and its purpose>`

---

## Step 1: Gather Requirements

Use `AskUserQuestion` to clarify before building (up to 4 questions per call):

1. **Purpose** — What triggers this email? (signup, referral, notification, etc.)
2. **Dynamic variables** — What data gets injected? (e.g., `{{code}}`, `{{name}}`, `{{referrer_email}}`)
3. **Key content** — What's the headline, body copy, and CTA text?
4. **Special sections** — Any cards, lists, steps, or feature highlights needed?

Skip questions that are already clear from the user's initial description.

## Step 2: Build the Template

### Base Structure

Every template MUST follow this structure (read `apps/platform/email-templates/access-code-invite.html` as the canonical reference):

```
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{email title}</title>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
      * { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important; }
      code, .code { font-family: 'SF Mono', 'Fira Code', Menlo, Consolas, monospace !important; }
    </style>
  </head>
  <body style="margin:0;padding:0;background-color:#08080a;font-family:'Inter',...">
    <!-- Full-width wrapper table -->
    <table role="presentation" width="100%" style="background-color:#08080a">
      <tr>
        <td align="center" style="padding: 40px 16px">
          <!-- 560px content container -->
          <table role="presentation" width="560" style="max-width:560px;width:100%">
            {LOGO}
            {HERO HEADING}
            {BODY TEXT}
            {CONTENT CARD(S) — optional}
            {CTA BUTTON}
            {ALT LINK — optional}
            {DIVIDER}
            {SOCIAL FOLLOW}
            {FOOTER}
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
```

### Design Tokens

| Token               | Value                                                          |
| ------------------- | -------------------------------------------------------------- |
| Background          | `#08080a`                                                      |
| Card background     | `#0f1419`                                                      |
| Card border         | `#1f2937`                                                      |
| Card radius         | `16px`                                                         |
| Heading color       | `#ffffff`                                                      |
| Body text           | `#a3a3a3`                                                      |
| Muted text          | `#525252`                                                      |
| Footer links        | `#404040`                                                      |
| Brand green         | `#22c55e`                                                      |
| Green accent bg     | `#22c55e15`                                                    |
| Green accent border | `#22c55e30`                                                    |
| Divider gradient    | `linear-gradient(to right, transparent, #1f2937, transparent)` |
| CTA button bg       | `#22c55e`                                                      |
| CTA button text     | `#000000`                                                      |
| CTA radius          | `10px`                                                         |
| CTA padding         | `14px 40px` to `16px 48px`                                     |
| Logo                | `https://celune.ai/celune_light.png` width 110                 |
| Container width     | 560px                                                          |
| Font heading        | 28px, weight 600                                               |
| Font body           | 16px, line-height 1.65                                         |
| Font small          | 13-14px                                                        |

### Reusable Blocks

**Numbered steps card** (see waitlist-confirmation.html):

- Green-bordered circle with number
- Step text in `#a3a3a3`

**Feature list** (see access-code-invite.html):

- Green `✦` bullet
- Bold `#e5e5e5` feature name + `#a3a3a3` description

**Gradient card** (see waitlist "skip the line"):

- `linear-gradient(135deg, #0a1628 0%, #0f1419 100%)`
- Centered text + outline green button

### Footer (MANDATORY — same on every template)

```html
<!-- Social -->
<tr>
  <td style="padding: 0 0 32px">
    <p style="margin: 0; font-size: 14px; color: #a3a3a3; line-height: 1.5">
      Follow along on
      <a href="https://x.com/celuneapp" style="color: #22c55e; text-decoration: none"
        >X / Twitter</a
      >
      for build-in-public updates and sneak peeks.
    </p>
  </td>
</tr>
<!-- Signature -->
<tr>
  <td style="padding: 0 0 8px">
    <p style="margin: 0; font-size: 13px; color: #525252">— The {{brand}} Team</p>
  </td>
</tr>
<!-- Links -->
<tr>
  <td>
    <table role="presentation" cellpadding="0" cellspacing="0">
      <tr>
        <td style="padding: 16px 0">
          <a
            href="https://celune.ai"
            style="font-size:12px;color:#404040;text-decoration:none;margin-right:16px"
            >celune.ai</a
          >
          <a
            href="https://x.com/celuneapp"
            style="font-size:12px;color:#404040;text-decoration:none;margin-right:16px"
            >X / Twitter</a
          >
          <a href="https://docs.celune.ai" style="font-size:12px;color:#404040;text-decoration:none"
            >Docs</a
          >
        </td>
      </tr>
    </table>
  </td>
</tr>
<!-- Legal -->
<tr>
  <td>
    <p style="margin: 0; font-size: 11px; color: #333333; line-height: 1.5">
      {context-specific unsubscribe/explanation text}
    </p>
  </td>
</tr>
```

**Twitter link is always `https://x.com/celuneapp`** — never `celune_ai`.

## Step 3: Write the File

Save to: `apps/platform/email-templates/{slug}.html`

Naming convention: kebab-case matching the email purpose (e.g., `referral-invite.html`, `access-code-invite.html`, `welcome-onboarding.html`).

## Step 4: Update email.ts (if applicable)

If this template will be sent from celune-web:

1. Add a new function to `apps/site/src/lib/email.ts`
2. Use the inline HTML approach (not Resend template ID) unless explicitly asked to use dashboard templates
3. Match the HTML from the template file

If sent from celune-platform admin:

1. Add to the relevant API route in `apps/platform/src/app/api/`
2. Support both Resend template ID and inline HTML fallback

## Step 5: Confirm

Show the user:

- File path created
- Dynamic variables used (`{{var}}` format)
- Which sending function to use or update
- Preview suggestion: "Paste the HTML into Resend dashboard to preview"

## Conventions

- All templates use table-based layout (email client compatibility)
- All styles are inline (no external CSS except the `<style>` block in `<head>`)
- Never use `div` for layout — use `<table role="presentation">`
- Test with dark backgrounds — `#08080a` is the base
- Dynamic variables use `{{double_braces}}` format
- Every template gets the Inter font `<style>` block in `<head>`
- Twitter/X links always point to `@celuneapp` (`https://x.com/celuneapp`)
