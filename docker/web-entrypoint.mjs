/**
 * Web container entrypoint for the self-host stack.
 *
 * Next.js inlines NEXT_PUBLIC_SUPABASE_URL at build time and uses the same
 * value in the browser and on the server. The browser reaches Supabase at
 * http://localhost:<port>; inside this container localhost is the container
 * itself. When the URL points at localhost, this script forwards that port to
 * the gateway (SUPABASE_UPSTREAM, default kong:8000) so one URL works in both
 * places, then starts the Next.js standalone server.
 */
import net from 'node:net';

const publicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const upstream = process.env.SUPABASE_UPSTREAM ?? 'kong:8000';

let parsed = null;
try {
  parsed = new URL(publicUrl);
} catch {
  parsed = null;
}

if (parsed && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')) {
  const listenPort = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
  const [upHost, upPort] = upstream.split(':');
  net
    .createServer((client) => {
      const target = net.connect(Number(upPort || 8000), upHost);
      client.pipe(target).pipe(client);
      client.on('error', () => target.destroy());
      target.on('error', () => client.destroy());
    })
    .listen(listenPort, '127.0.0.1', () => {
      console.log(`[celune-web] forwarding localhost:${listenPort} to ${upstream}`);
    });
}

await import('/app/apps/platform/server.js');
