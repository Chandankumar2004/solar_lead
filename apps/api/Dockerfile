# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim AS base
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable

FROM base AS deps
ENV PRISMA_SKIP_POSTINSTALL_GENERATE=true
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/api/prisma apps/api/prisma
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @solar/api build

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable
COPY --from=deps /app/node_modules /app/node_modules
COPY --from=build /app/apps/api/dist /app/apps/api/dist
COPY --from=build /app/apps/api/prisma /app/apps/api/prisma
COPY --from=build /app/packages/shared/dist /app/packages/shared/dist
COPY --from=build /app/apps/api/package.json /app/apps/api/package.json
COPY --from=build /app/packages/shared/package.json /app/packages/shared/package.json
# Prisma client is generated during build stage into /app/node_modules/.prisma.
# Copy generated client artifacts so runtime does not fail with "did not initialize yet".
COPY --from=build /app/node_modules/.prisma /app/node_modules/.prisma
COPY --from=build /app/node_modules/@prisma /app/node_modules/@prisma
RUN mkdir -p /app/node_modules/@solar /app/apps/api /app/packages/shared && \
    ln -sf /app/packages/shared /app/node_modules/@solar/shared && \
    ln -sf /app/node_modules /app/apps/api/node_modules && \
    ln -sf /app/node_modules /app/packages/shared/node_modules
WORKDIR /app/apps/api
EXPOSE 10000
CMD ["node", "dist/index.js"]
