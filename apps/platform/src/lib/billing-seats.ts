/**
 * Cloud seats: one seat per active human org member, minimum 1.
 *
 * The subscription belongs to the org owner (subscriptions.user_id) and covers
 * every org that user owns, so seats are the distinct active members across
 * those orgs. Agents are not org members and are never seats.
 */

import { createServiceClient } from '@repo/db/service';
import { getStripe } from '@/lib/stripe';

/** Count billable seats for a subscription owner. Always at least 1. */
export async function countSeats(ownerId: string): Promise<number> {
  // Service client: seats span every org the owner holds. Accesses: organizations, org_members.
  const supabase = createServiceClient();
  const { data: orgs } = await supabase.from('organizations').select('id').eq('owner_id', ownerId);
  const orgIds = (orgs ?? []).map((o: { id: string }) => o.id);
  if (orgIds.length === 0) return 1;

  const { data: members } = await supabase
    .from('org_members')
    .select('user_id')
    .in('org_id', orgIds)
    .eq('is_active', true);
  const distinct = new Set((members ?? []).map((m: { user_id: string }) => m.user_id));
  return Math.max(distinct.size, 1);
}

/** Org ids a user belongs to. Read these before deleting the memberships, then pass them to syncSeats. */
export async function orgIdsForUser(userId: string): Promise<string[]> {
  if (!getStripe()) return [];
  try {
    // Service client: membership lookup for seat sync. Accesses: org_members.
    const supabase = createServiceClient();
    const { data } = await supabase.from('org_members').select('org_id').eq('user_id', userId);
    return (data ?? []).map((row: { org_id: string }) => row.org_id);
  } catch (error) {
    console.error('[billing-seats] Org lookup failed; seats will not sync:', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Update the Stripe subscription quantity for the owners of these orgs after a
 * member was added, removed, activated, or deactivated. Prorated.
 *
 * Fail-soft: errors are logged and never thrown, so a member change is never
 * blocked by billing. A no-op without Stripe or without a subscription.
 */
export async function syncSeats(orgIds: string | Array<string | null | undefined>): Promise<void> {
  const stripe = getStripe();
  if (!stripe) return;

  const ids = [
    ...new Set((Array.isArray(orgIds) ? orgIds : [orgIds]).filter((id): id is string => !!id)),
  ];
  if (ids.length === 0) return;

  try {
    // Service client: resolves the billing owner and their subscription. Accesses: organizations, subscriptions.
    const supabase = createServiceClient();
    const { data: orgs } = await supabase.from('organizations').select('owner_id').in('id', ids);
    const owners = [
      ...new Set((orgs ?? []).map((o: { owner_id: string | null }) => o.owner_id).filter(Boolean)),
    ] as string[];

    for (const ownerId of owners) {
      const { data: sub } = await supabase
        .from('subscriptions')
        .select('stripe_subscription_id')
        .eq('user_id', ownerId)
        .maybeSingle();
      const subscriptionId = sub?.stripe_subscription_id;
      if (!subscriptionId) continue;

      const seats = await countSeats(ownerId);
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const item = subscription.items.data[0];
      if (!item) continue;

      if (item.quantity !== seats) {
        await stripe.subscriptionItems.update(item.id, {
          quantity: seats,
          proration_behavior: 'create_prorations',
        });
      }
      await supabase.from('subscriptions').update({ seats }).eq('user_id', ownerId);
    }
  } catch (error) {
    console.error('[billing-seats] Seat sync failed; the member change stands:', {
      orgIds: ids,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
