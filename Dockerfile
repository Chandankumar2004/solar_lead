FROM node:20-bookworm-slim

WORKDIR /app

# Prisma needs OpenSSL at runtime in slim images.
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Enable pnpm via corepack (ships with Node 20).
RUN corepack enable

# Copy workspace manifests first for better layer caching.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/

RUN pnpm install --frozen-lockfile

# Copy source after dependencies.
COPY packages/shared packages/shared
COPY apps/api apps/api

# Build API (includes shared build + prisma generate).
RUN pnpm --filter @solar/api build

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "apps/api/dist/index.js"]
