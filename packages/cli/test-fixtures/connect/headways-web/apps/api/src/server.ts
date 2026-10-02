import { Hono } from 'hono';
import { jwtVerify } from 'jose';

export const app = new Hono();

app.get('/health', async (c) => {
  await jwtVerify(c.req.header('authorization') ?? '', new Uint8Array());
  return c.json({ ok: true });
});
