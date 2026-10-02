// Platform app entry (the configured app domain)
// Server component: resolves workspace and redirects without client JS
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { createClient } from '@repo/db/server';

const SLUG_COOKIE = 'activeWorkspaceSlug';
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,49}$/;

export default async function RootRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  // If an access code arrives at root (e.g. from a broken email link),
  // redirect to /signup with the code preserved
  const code = typeof params.code === 'string' ? params.code : undefined;
  const isUuid =
    code && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(code);
  if (code && !isUuid) {
    redirect(`/signup?code=${encodeURIComponent(code)}`);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Prefer the user's last-used workspace from cookie (matches client localStorage key)
  const cookieStore = await cookies();
  const preferred = cookieStore.get(SLUG_COOKIE)?.value;
  if (preferred && SLUG_RE.test(preferred)) {
    redirect(`/${preferred}/analytics`);
  }

  // Fallback: fetch default workspace from DB
  try {
    const { data: workspaces } = await supabase
      .from('workspaces')
      .select('slug')
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(1);

    const slug = workspaces?.[0]?.slug ?? 'main';
    redirect(`/${slug}/analytics`);
  } catch {
    // DB unreachable — fall back to default
    redirect('/main/analytics');
  }
}
