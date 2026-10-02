import { createServiceClient } from '@repo/db/service';
/** Billing feature identifiers for usage tracking */
type BillingFeature = string;

/**
 * Increment usage counter for a user/feature pair in the current calendar month.
 * Uses service client so it bypasses RLS — safe to call from server-side routes only.
 * Silently no-ops on error so billing failures never break core features.
 */
export async function trackUsage(
  userId: string,
  feature: BillingFeature,
  count = 1,
): Promise<void> {
  try {
    const supabase = createServiceClient();
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const periodEnd = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
      999,
    ).toISOString();

    await supabase.from('usage_records').insert({
      user_id: userId,
      feature,
      count,
      period_start: periodStart,
      period_end: periodEnd,
    });
  } catch {
    // Intentionally swallow — usage tracking must not break caller
    console.warn('[usage] trackUsage failed silently', { userId, feature });
  }
}
