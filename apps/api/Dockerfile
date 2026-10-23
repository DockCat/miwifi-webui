# Build stage
FROM --platform=$BUILDPLATFORM node:26.12.1-alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797 AS builder

WORKDIR /app

RUN npm install -g pnpm@11.25.0

# Copy root workspace manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/router-core/package.json ./packages/router-core/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

# Install workspace dependencies (cached layer keyed on manifests)
RUN pnpm install --frozen-lockfile

# Copy source code
COPY tsconfig.base.json ./
COPY packages/contracts ./packages/contracts
COPY packages/router-core ./packages/router-core
COPY apps/api ./apps/api

# Build API and bundle with inlined workspace code
RUN pnpm --filter @miwifi-webui/api build

# Production runtime stage
FROM node:26.12.1-alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797 AS runner

LABEL org.opencontainers.image.title="miwifi-webui-api" \
      org.opencontainers.image.description="Self-hosted Xiaomi/Redmi router observability and AI investigation - Backend API" \
      org.opencontainers.image.source="https://github.com/DockCat/miwifi-webui" \
      org.opencontainers.image.documentation="https://github.com/DockCat/miwifi-webui#readme"

WORKDIR /app
ENV NODE_ENV=production

RUN npm install -g pnpm@11.25.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/router-core/package.json ./packages/router-core/
COPY apps/api/package.json ./apps/api/

# Install production dependencies only
RUN pnpm install --prod --frozen-lockfile

# Copy bundled application & migrations from builder
COPY --from=builder /app/apps/api/dist ./apps/api/dist

# Non-root runtime. The dist tree is copied as root; chown to the unprivileged
# user so the app never needs root to read its own files.
RUN chown -R node:node /app
USER node

WORKDIR /app/apps/api

EXPOSE 3001

# docker HEALTHCHECK against the unauthenticated liveness endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/main.js"]
