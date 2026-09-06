# Build stage
FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.25.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/router-core/package.json ./packages/router-core/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages/contracts ./packages/contracts
COPY packages/router-core ./packages/router-core
COPY apps/web ./apps/web

# Build frontend static distribution
RUN pnpm --filter @miwifi-webui/web build

# Production runtime stage: unprivileged nginx (listens on 8080, runs as uid 101)
FROM nginxinc/nginx-unprivileged:1.28-alpine@sha256:7377697a821c131a924a7105fafbe7414db4e9fcc77a6f08f776f33f141ec3f8 AS runner

USER 101

COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
# default.conf listens on 8080 (unprivileged) and proxies /api to the backend.
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
