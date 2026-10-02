import { createServiceClient } from '@repo/db/service';

/**
 * Resolve the user's org_id and verify they are an owner/admin.
 * Returns org_id if authorized, null otherwise.
 */
export async function requireOrgStaff(userId: string): Promise<string | null> {
  const supabase = createServiceClient();
  const { data: membership } = await supabase
    .from('org_memberships')
    .select('org_id, is_owner')
    .eq('user_id', userId)
    .limit(1)
    .single();

  if (!membership?.org_id) return null;

  // Owner via org_memberships shortcut
  if (membership.is_owner) return membership.org_id;

  // Check org_members for admin role
  const { data: orgMember } = await supabase
    .from('org_members')
    .select('id, role_id, roles!inner(slug)')
    .eq('user_id', userId)
    .eq('org_id', membership.org_id)
    .eq('is_active', true)
    .limit(1)
    .single();

  const role = (orgMember as { roles?: { slug?: string } } | null)?.roles?.slug;
  if (role !== 'owner' && role !== 'admin') return null;

  return membership.org_id;
}
