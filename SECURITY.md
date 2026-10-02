# Security policy

## Reporting a vulnerability

Do not open a public issue for a security problem.

Report it privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. If you cannot use GitHub, email hello@celune.ai with SECURITY in the subject.

Include:

- what the problem is and what an attacker could do with it
- steps to reproduce, or a proof of concept
- the affected version, commit, or deployment type (self-hosted or Celune Cloud)

## What happens next

- We acknowledge the report within 3 business days.
- We confirm the problem and tell you the planned fix timeline within 10 business days.
- We tell you when the fix ships and credit you in the advisory unless you ask us not to.

Please give us a reasonable time to fix the problem before you disclose it publicly. We will not take legal action against research done in good faith under this policy.

## Scope

In scope: code in this repository, the published `@celuneai/*` npm packages, and Celune Cloud.

Out of scope: denial-of-service testing, social engineering, physical attacks, and findings in third-party services we use (report those to the vendor).

## Supported versions

Security fixes go into the latest release of each `@celuneai/*` package and into `main`. Self-hosted installs should update to the latest release.
