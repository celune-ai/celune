# Discord Gateway — standalone WebSocket process
# Connects to Discord Gateway, forwards events to platform API
#
# Required env vars:
#   DISCORD_BOT_TOKEN         — Bot token from Discord Developer Portal
#   DISCORD_GATEWAY_SECRET    — Shared secret for authenticating with platform API
#   PLATFORM_API_URL          — Base URL of platform API (e.g. https://app.example.com)
#   PORT                      — Health check port (default: 3100)

FROM node:20-alpine AS base

WORKDIR /app

# Install dependencies
COPY package.json tsconfig.json ./
RUN npm install

# Copy source
COPY src/ ./src/

# Build
RUN npx tsc

# ── Production ─────────────────────────────────────────────────────────────

FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY --from=base /app/dist ./dist
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/package.json ./

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT:-3100}/health || exit 1

EXPOSE ${PORT:-3100}

CMD ["node", "dist/index.js"]
