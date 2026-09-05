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
COPY apps/web ./apps/web

# Build frontend static distribution
RUN pnpm --filter @miwifi-webui/web build

# Production runtime stage: Nginx
FROM nginx:alpine AS runner

COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
