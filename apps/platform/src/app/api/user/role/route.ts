import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { getAuthUserId } from '@/lib/auth';
import type { UserRole } from '@/lib/roles';

export async function GET(request: NextRequest) {
  const userId = getAuthUserId(request);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Service client: fetches the caller's own role; RLS policies on user_roles may not allow self-reads. Accesses: user_roles.
  const supabase = createServiceClient();
  const { data } = await supabase.from('user_roles').select('role').eq('user_id', userId).single();

  if (data?.role) {
    return NextResponse.json({ role: data.role as UserRole });
  }

  // Fallback: check org_members.is_owner for users without a user_roles entry (e.g. OAuth signups)
  const { data: orgOwner } = await supabase
    .from('org_members')
    .select('is_owner')
    .eq('user_id', userId)
    .eq('is_owner', true)
    .maybeSingle();

  if (orgOwner) {
    return NextResponse.json({ role: 'owner' as UserRole });
  }

  // Default to member if they exist but have no explicit role
  return NextResponse.json({ role: 'member' as UserRole });
}
