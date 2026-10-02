###############################################################################
# Standalone Celune API (apps/api) for the self-host stack.
# Node 24 runs the TypeScript sources directly (type stripping is on by
# default), so there is no build step.
###############################################################################

FROM node:24-slim AS base
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app

FROM base AS pruner
COPY . .
RUN npx turbo prune api --docker

FROM base AS runner
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=pruner /app/out/pnpm-workspace.yaml ./pnpm-workspace.yaml
RUN pnpm install --frozen-lockfile --prod --ignore-scripts
COPY --from=pruner /app/out/full/ .
ENV NODE_ENV=production
ENV PORT=3010
USER node
EXPOSE 3010
CMD ["node", "apps/api/src/server.ts"]
