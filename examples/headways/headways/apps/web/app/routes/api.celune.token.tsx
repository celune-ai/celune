/**
 * POST /api/celune/token?org=<slug> — mints a fresh Celune embed token for the
 * signed-in user. CeluneProvider calls it when the current token expires.
 */
import type { Route } from './+types/api.celune.token';
import { loadCeluneEmbed } from '#server/celune.server.js';

export const action = async ({ request }: Route.ActionArgs) => {
  const orgSlug = new URL(request.url).searchParams.get('org') ?? undefined;
  const embed = await loadCeluneEmbed(request, orgSlug);
  if (!embed) return Response.json({ token: null }, { status: 404 });
  return Response.json({ token: embed.token });
};

export const loader = () => new Response(null, { status: 405 });
