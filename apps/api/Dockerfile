# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.25.0 --activate

# Copy root workspace manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/router-core/package.json ./packages/router-core/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

# Install workspace dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY tsconfig.base.json ./
COPY packages/contracts ./packages/contracts
COPY packages/router-core ./packages/router-core
COPY apps/api ./apps/api

# Build API and bundle with inlined workspace code
RUN pnpm --filter @miwifi-webui/api build

# Production runtime stage
FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

RUN corepack enable && corepack prepare pnpm@11.25.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/router-core/package.json ./packages/router-core/
COPY apps/api/package.json ./apps/api/

# Install production dependencies only
RUN pnpm install --prod --frozen-lockfile

# Copy bundled application & migrations from builder
COPY --from=builder /app/apps/api/dist ./apps/api/dist

WORKDIR /app/apps/api

EXPOSE 3001

CMD ["node", "dist/main.js"]
