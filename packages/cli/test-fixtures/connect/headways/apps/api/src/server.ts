import { Hono } from 'hono';
import { requireActiveOrg } from './auth';

export const app = new Hono();

app.get('/v1/workspace/workstreams', async (c) => {
  const org = await requireActiveOrg(c);
  return c.json({ org });
});
