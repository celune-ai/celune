import { betterAuth } from 'better-auth';

export const auth = betterAuth({});

export async function requireActiveOrg(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new Response('Unauthorized', { status: 401 });
  return { id: session.session.activeOrganizationId };
}
