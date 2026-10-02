/**
 * Discord Gateway (v10) WebSocket client.
 *
 * Self-contained class that manages the bot's real-time connection to Discord.
 * Designed to run in a standalone process (Railway/Fly.io) that forwards
 * events to the platform API via HTTP.
 *
 * Handles:
 * - WebSocket connection to wss://gateway.discord.gg/?v=10&encoding=json
 * - Heartbeat management (OP 10 Hello → OP 1 Heartbeat on interval)
 * - IDENTIFY (OP 2) with bot token and intents
 * - RESUME (OP 6) for reconnection after disconnects
 * - Graceful shutdown (OP 7 Reconnect, OP 9 Invalid Session)
 */

// ── Discord Gateway Opcodes ────────────────────────────────────────────────

const OP = {
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  PRESENCE_UPDATE: 3,
  VOICE_STATE_UPDATE: 4,
  RESUME: 6,
  RECONNECT: 7,
  REQUEST_GUILD_MEMBERS: 8,
  INVALID_SESSION: 9,
  HELLO: 10,
  HEARTBEAT_ACK: 11,
} as const;

// ── Gateway Intents ────────────────────────────────────────────────────────

export const GatewayIntents = {
  GUILDS: 1 << 0,
  GUILD_MESSAGES: 1 << 9,
  MESSAGE_CONTENT: 1 << 15,
} as const;

const DEFAULT_INTENTS =
  GatewayIntents.GUILDS | GatewayIntents.GUILD_MESSAGES | GatewayIntents.MESSAGE_CONTENT;

// ── Types ──────────────────────────────────────────────────────────────────

export interface GatewayMessage {
  id: string;
  channel_id: string;
  guild_id?: string;
  author: {
    id: string;
    username: string;
    bot?: boolean;
    discriminator: string;
  };
  content: string;
  timestamp: string;
  mentions: Array<{ id: string; username: string }>;
  referenced_message?: GatewayMessage | null;
}

interface GatewayPayload {
  op: number;
  d: unknown;
  s?: number | null;
  t?: string | null;
}

interface GatewayConfig {
  token: string;
  intents?: number;
  /** Callback fired for every MESSAGE_CREATE event */
  onMessage?: (message: GatewayMessage) => void | Promise<void>;
  /** Callback fired on any dispatched event */
  onEvent?: (eventName: string, data: unknown) => void | Promise<void>;
  /** Callback fired on connection state changes */
  onStateChange?: (state: ConnectionState) => void;
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'resuming';

// ── Gateway Client ─────────────────────────────────────────────────────────

export class DiscordGateway {
  private ws: WebSocket | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private heartbeatAcked = true;
  private sequence: number | null = null;
  private sessionId: string | null = null;
  private resumeGatewayUrl: string | null = null;
  private state: ConnectionState = 'disconnected';
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private destroyed = false;

  private readonly token: string;
  private readonly intents: number;
  private messageHandler: ((message: GatewayMessage) => void | Promise<void>) | null;
  private eventHandler: ((eventName: string, data: unknown) => void | Promise<void>) | null;
  private stateHandler: ((state: ConnectionState) => void) | null;

  constructor(config: GatewayConfig) {
    this.token = config.token;
    this.intents = config.intents ?? DEFAULT_INTENTS;
    this.messageHandler = config.onMessage ?? null;
    this.eventHandler = config.onEvent ?? null;
    this.stateHandler = config.onStateChange ?? null;
  }

  // ── Public API ─────────────────────────────────────────────────────────

  /** Open the Gateway connection. Resolves once READY or RESUMED is received. */
  async connect(): Promise<void> {
    if (this.destroyed) throw new Error('Gateway instance has been destroyed');
    this.setState('connecting');

    const url = this.resumeGatewayUrl ?? 'wss://gateway.discord.gg/?v=10&encoding=json';

    return new Promise<void>((resolve, reject) => {
      try {
        this.ws = new WebSocket(url);
      } catch (err) {
        this.setState('disconnected');
        reject(err);
        return;
      }

      const readyTimeout = setTimeout(() => {
        reject(new Error('Gateway connection timed out after 30s'));
        this.ws?.close();
      }, 30_000);

      this.ws.onopen = () => {
        console.log('[discord-gateway] WebSocket opened');
      };

      this.ws.onmessage = (event: MessageEvent) => {
        const payload = JSON.parse(String(event.data)) as GatewayPayload;
        this.handlePayload(payload, () => {
          clearTimeout(readyTimeout);
          resolve();
        });
      };

      this.ws.onclose = (event: CloseEvent) => {
        console.log(`[discord-gateway] WebSocket closed: ${event.code} ${event.reason}`);
        clearTimeout(readyTimeout);
        this.cleanup();

        if (!this.destroyed) {
          this.handleReconnect(event.code);
        }
      };

      this.ws.onerror = (event: Event) => {
        console.error('[discord-gateway] WebSocket error:', event);
      };
    });
  }

  /** Gracefully close the Gateway connection. */
  disconnect(): void {
    this.destroyed = true;
    this.cleanup();
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
    this.setState('disconnected');
    console.log('[discord-gateway] Disconnected gracefully');
  }

  /** Register a handler for MESSAGE_CREATE events. */
  onMessage(handler: (message: GatewayMessage) => void | Promise<void>): void {
    this.messageHandler = handler;
  }

  /** Register a handler for all dispatched events. */
  onEvent(handler: (eventName: string, data: unknown) => void | Promise<void>): void {
    this.eventHandler = handler;
  }

  /** Current connection state. */
  get connectionState(): ConnectionState {
    return this.state;
  }

  // ── Payload Handling ───────────────────────────────────────────────────

  private handlePayload(payload: GatewayPayload, onReady?: () => void): void {
    // Track sequence number for heartbeats and resume
    if (payload.s !== null && payload.s !== undefined) {
      this.sequence = payload.s;
    }

    switch (payload.op) {
      case OP.HELLO: {
        const { heartbeat_interval } = payload.d as { heartbeat_interval: number };
        this.startHeartbeat(heartbeat_interval);

        // Send IDENTIFY or RESUME depending on session state
        if (this.sessionId && this.state === 'resuming') {
          this.sendResume();
        } else {
          this.sendIdentify();
        }
        break;
      }

      case OP.HEARTBEAT_ACK:
        this.heartbeatAcked = true;
        break;

      case OP.HEARTBEAT:
        // Discord may request an immediate heartbeat
        this.sendHeartbeat();
        break;

      case OP.RECONNECT:
        console.log('[discord-gateway] Received RECONNECT, reconnecting...');
        this.ws?.close(4000, 'Reconnect requested');
        break;

      case OP.INVALID_SESSION: {
        const resumable = payload.d as boolean;
        console.log(`[discord-gateway] Invalid session, resumable: ${resumable}`);

        if (!resumable) {
          // Cannot resume — clear session and re-identify
          this.sessionId = null;
          this.sequence = null;
          this.resumeGatewayUrl = null;
        }

        // Wait 1–5s then reconnect per Discord docs
        const delay = 1000 + Math.random() * 4000;
        setTimeout(() => {
          if (!this.destroyed) {
            this.connect().catch((err) =>
              console.error('[discord-gateway] Reconnect after invalid session failed:', err),
            );
          }
        }, delay);
        break;
      }

      case OP.DISPATCH:
        this.handleDispatch(payload.t!, payload.d, onReady);
        break;
    }
  }

  private handleDispatch(eventName: string, data: unknown, onReady?: () => void): void {
    switch (eventName) {
      case 'READY': {
        const ready = data as {
          session_id: string;
          resume_gateway_url: string;
        };
        this.sessionId = ready.session_id;
        this.resumeGatewayUrl = ready.resume_gateway_url;
        this.reconnectAttempts = 0;
        this.setState('connected');
        console.log('[discord-gateway] READY — session established');
        onReady?.();
        break;
      }

      case 'RESUMED':
        this.reconnectAttempts = 0;
        this.setState('connected');
        console.log('[discord-gateway] RESUMED — session restored');
        onReady?.();
        break;

      case 'MESSAGE_CREATE': {
        const message = data as GatewayMessage;
        try {
          this.messageHandler?.(message);
        } catch (err) {
          console.error('[discord-gateway] Message handler error:', err);
        }
        break;
      }
    }

    // Fire generic event handler
    try {
      this.eventHandler?.(eventName, data);
    } catch (err) {
      console.error(`[discord-gateway] Event handler error for ${eventName}:`, err);
    }
  }

  // ── Heartbeat ──────────────────────────────────────────────────────────

  private startHeartbeat(intervalMs: number): void {
    this.stopHeartbeat();

    // First heartbeat after jitter (0..interval) per Discord docs
    const jitter = Math.random() * intervalMs;
    setTimeout(() => {
      this.sendHeartbeat();

      this.heartbeatInterval = setInterval(() => {
        if (!this.heartbeatAcked) {
          console.warn('[discord-gateway] Heartbeat not ACKed — zombie connection, reconnecting');
          this.ws?.close(4009, 'Heartbeat timeout');
          return;
        }
        this.sendHeartbeat();
      }, intervalMs);
    }, jitter);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private sendHeartbeat(): void {
    this.heartbeatAcked = false;
    this.send({ op: OP.HEARTBEAT, d: this.sequence });
  }

  // ── Identity & Resume ──────────────────────────────────────────────────

  private sendIdentify(): void {
    this.send({
      op: OP.IDENTIFY,
      d: {
        token: this.token,
        intents: this.intents,
        properties: {
          os: 'linux',
          browser: 'celune',
          device: 'celune',
        },
      },
    });
  }

  private sendResume(): void {
    this.send({
      op: OP.RESUME,
      d: {
        token: this.token,
        session_id: this.sessionId,
        seq: this.sequence,
      },
    });
  }

  // ── Reconnection ───────────────────────────────────────────────────────

  private handleReconnect(closeCode: number): void {
    // Non-resumable close codes — must re-identify
    const nonResumable = [4004, 4010, 4011, 4012, 4013, 4014];
    if (nonResumable.includes(closeCode)) {
      console.error(`[discord-gateway] Fatal close code ${closeCode} — cannot reconnect`);
      this.setState('disconnected');
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[discord-gateway] Max reconnect attempts reached');
      this.setState('disconnected');
      return;
    }

    this.reconnectAttempts++;
    const backoff = Math.min(1000 * 2 ** this.reconnectAttempts, 60_000);
    console.log(
      `[discord-gateway] Reconnecting in ${backoff}ms (attempt ${this.reconnectAttempts})`,
    );

    this.setState('resuming');

    setTimeout(() => {
      if (!this.destroyed) {
        this.connect().catch((err) => console.error('[discord-gateway] Reconnect failed:', err));
      }
    }, backoff);
  }

  // ── Utilities ──────────────────────────────────────────────────────────

  private send(payload: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private setState(state: ConnectionState): void {
    this.state = state;
    this.stateHandler?.(state);
  }

  private cleanup(): void {
    this.stopHeartbeat();
  }
}
