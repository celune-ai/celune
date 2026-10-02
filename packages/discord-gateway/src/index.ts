/**
 * Discord Gateway — standalone entry point for Railway/Fly.io.
 *
 * Connects to Discord Gateway via WebSocket, receives MESSAGE_CREATE events,
 * and forwards them to the platform API for memory ingestion + proactive responses.
 *
 * Includes a simple HTTP health check endpoint.
 *
 * Env vars:
 *   DISCORD_BOT_TOKEN       — Bot token from Discord Developer Portal
 *   DISCORD_GATEWAY_SECRET  — Shared secret for platform API auth
 *   PLATFORM_API_URL        — Platform base URL (e.g. https://app.example.com)
 *   PORT                    — Health check port (default: 3100)
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import WebSocket from 'ws';

// ── Config ────────────────────────────────────────────────────────────────

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GATEWAY_SECRET = process.env.DISCORD_GATEWAY_SECRET;
const PLATFORM_API_URL = process.env.PLATFORM_API_URL;
const PORT = parseInt(process.env.PORT ?? '3100', 10);

if (!BOT_TOKEN) {
  console.error('[gateway] DISCORD_BOT_TOKEN is required');
  process.exit(1);
}
if (!GATEWAY_SECRET) {
  console.error('[gateway] DISCORD_GATEWAY_SECRET is required');
  process.exit(1);
}
if (!PLATFORM_API_URL) {
  console.error('[gateway] PLATFORM_API_URL is required');
  process.exit(1);
}

// ── Discord Gateway Opcodes ───────────────────────────────────────────────

const OP = {
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  RESUME: 6,
  RECONNECT: 7,
  INVALID_SESSION: 9,
  HELLO: 10,
  HEARTBEAT_ACK: 11,
} as const;

const INTENTS = (1 << 0) | (1 << 9) | (1 << 15); // GUILDS | GUILD_MESSAGES | MESSAGE_CONTENT

// ── State ─────────────────────────────────────────────────────────────────

let ws: WebSocket | null = null;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let heartbeatAcked = true;
let sequence: number | null = null;
let sessionId: string | null = null;
let resumeGatewayUrl: string | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 15;
let connectionState: 'disconnected' | 'connecting' | 'connected' | 'resuming' = 'disconnected';
let eventsForwarded = 0;
let lastEventAt: string | null = null;

// ── Forward events to platform API ────────────────────────────────────────

async function forwardEvent(event: string, data: unknown): Promise<void> {
  try {
    const res = await fetch(`${PLATFORM_API_URL}/api/discord/gateway-events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-gateway-secret': GATEWAY_SECRET!,
      },
      body: JSON.stringify({ event, data }),
    });

    if (!res.ok) {
      console.error(`[gateway] Forward failed: ${res.status} ${res.statusText}`);
    } else {
      eventsForwarded++;
      lastEventAt = new Date().toISOString();
    }
  } catch (err) {
    console.error('[gateway] Forward error:', err);
  }
}

// ── Gateway Connection ────────────────────────────────────────────────────

function send(payload: Record<string, unknown>): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function sendHeartbeat(): void {
  heartbeatAcked = false;
  send({ op: OP.HEARTBEAT, d: sequence });
}

function startHeartbeat(intervalMs: number): void {
  stopHeartbeat();
  const jitter = Math.random() * intervalMs;
  setTimeout(() => {
    sendHeartbeat();
    heartbeatInterval = setInterval(() => {
      if (!heartbeatAcked) {
        console.warn('[gateway] Heartbeat not ACKed — zombie connection, reconnecting');
        ws?.close(4009, 'Heartbeat timeout');
        return;
      }
      sendHeartbeat();
    }, intervalMs);
  }, jitter);
}

function stopHeartbeat(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

function handlePayload(
  payload: { op: number; d: unknown; s?: number | null; t?: string | null },
  onReady: () => void,
): void {
  if (payload.s !== null && payload.s !== undefined) {
    sequence = payload.s;
  }

  switch (payload.op) {
    case OP.HELLO: {
      const { heartbeat_interval } = payload.d as { heartbeat_interval: number };
      startHeartbeat(heartbeat_interval);
      if (sessionId && connectionState === 'resuming') {
        send({ op: OP.RESUME, d: { token: BOT_TOKEN, session_id: sessionId, seq: sequence } });
      } else {
        send({
          op: OP.IDENTIFY,
          d: {
            token: BOT_TOKEN,
            intents: INTENTS,
            properties: { os: 'linux', browser: 'celune-gateway', device: 'celune-gateway' },
          },
        });
      }
      break;
    }
    case OP.HEARTBEAT_ACK:
      heartbeatAcked = true;
      break;
    case OP.HEARTBEAT:
      sendHeartbeat();
      break;
    case OP.RECONNECT:
      console.log('[gateway] Received RECONNECT');
      ws?.close(4000, 'Reconnect requested');
      break;
    case OP.INVALID_SESSION: {
      const resumable = payload.d as boolean;
      console.log(`[gateway] Invalid session, resumable: ${resumable}`);
      if (!resumable) {
        sessionId = null;
        sequence = null;
        resumeGatewayUrl = null;
      }
      const delay = 1000 + Math.random() * 4000;
      setTimeout(() => connect(), delay);
      break;
    }
    case OP.DISPATCH:
      handleDispatch(payload.t!, payload.d, onReady);
      break;
  }
}

function handleDispatch(eventName: string, data: unknown, onReady: () => void): void {
  switch (eventName) {
    case 'READY': {
      const ready = data as { session_id: string; resume_gateway_url: string };
      sessionId = ready.session_id;
      resumeGatewayUrl = ready.resume_gateway_url;
      reconnectAttempts = 0;
      connectionState = 'connected';
      console.log('[gateway] READY — session established');
      onReady();
      break;
    }
    case 'RESUMED':
      reconnectAttempts = 0;
      connectionState = 'connected';
      console.log('[gateway] RESUMED');
      onReady();
      break;
    case 'MESSAGE_CREATE':
      // Forward to platform API in background
      forwardEvent('MESSAGE_CREATE', data).catch((err) =>
        console.error('[gateway] Forward error:', err),
      );
      break;
  }
}

function handleReconnect(closeCode: number): void {
  const nonResumable = [4004, 4010, 4011, 4012, 4013, 4014];
  if (nonResumable.includes(closeCode)) {
    console.error(`[gateway] Fatal close code ${closeCode} — cannot reconnect`);
    connectionState = 'disconnected';
    return;
  }

  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.error('[gateway] Max reconnect attempts reached, exiting');
    process.exit(1); // Railway auto-restart will handle this
  }

  reconnectAttempts++;
  const backoff = Math.min(1000 * 2 ** reconnectAttempts, 60_000);
  console.log(`[gateway] Reconnecting in ${backoff}ms (attempt ${reconnectAttempts})`);
  connectionState = 'resuming';
  setTimeout(() => connect(), backoff);
}

function connect(): void {
  connectionState = 'connecting';
  const url = resumeGatewayUrl ?? 'wss://gateway.discord.gg/?v=10&encoding=json';

  ws = new WebSocket(url);

  const readyTimeout = setTimeout(() => {
    console.error('[gateway] Connection timed out after 30s');
    ws?.close();
  }, 30_000);

  ws.on('open', () => {
    console.log('[gateway] WebSocket opened');
  });

  ws.on('message', (raw: WebSocket.RawData) => {
    const payload = JSON.parse(raw.toString());
    handlePayload(payload, () => clearTimeout(readyTimeout));
  });

  ws.on('close', (code: number, reason: Buffer) => {
    console.log(`[gateway] WebSocket closed: ${code} ${reason.toString()}`);
    stopHeartbeat();
    handleReconnect(code);
  });

  ws.on('error', (err: Error) => {
    console.error('[gateway] WebSocket error:', err.message);
  });
}

// ── Health Check Server ───────────────────────────────────────────────────

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  if (req.url === '/health') {
    const healthy = connectionState === 'connected';
    res.writeHead(healthy ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: healthy ? 'ok' : 'degraded',
        connectionState,
        eventsForwarded,
        lastEventAt,
        uptime: process.uptime(),
        reconnectAttempts,
      }),
    );
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log(`[gateway] Health check listening on :${PORT}`);
});

// ── Start ─────────────────────────────────────────────────────────────────

console.log('[gateway] Starting Discord Gateway...');
console.log(`[gateway] Platform API: ${PLATFORM_API_URL}`);
connect();

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[gateway] SIGTERM received, shutting down...');
  ws?.close(1000, 'Shutting down');
  stopHeartbeat();
  server.close();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[gateway] SIGINT received, shutting down...');
  ws?.close(1000, 'Shutting down');
  stopHeartbeat();
  server.close();
  process.exit(0);
});
