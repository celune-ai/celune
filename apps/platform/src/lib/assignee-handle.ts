import { TASK_ASSIGNEES } from '@repo/types';

/** Agent names and 'unassigned'; a person must never claim under one of these. */
const RESERVED = new Set<string>(TASK_ASSIGNEES.filter((a) => a !== 'eric'));

/**
 * The assignee value a signed-in person claims tasks as: the email's local
 * part as a lowercase slug. A slug that matches an agent name gets the first
 * eight characters of the user id appended. Undefined until the profile loads,
 * which hides the Claim button instead of claiming under a wrong name.
 */
export function assigneeHandle(user: {
  id: string | null;
  email: string | null;
}): string | undefined {
  if (!user.id || !user.email) return undefined;
  const slug = (user.email.split('@')[0] ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) return undefined;
  return RESERVED.has(slug) ? `${slug}-${user.id.slice(0, 8)}` : slug;
}
