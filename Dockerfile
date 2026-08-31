# syntax=docker/dockerfile:1
FROM node:24-slim AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./

FROM base AS build
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm fetch
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm install --frozen-lockfile --offline && pnpm run build

FROM base AS prod-deps
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm fetch --prod && pnpm install --prod --frozen-lockfile --offline

FROM node:24-slim
ENV NODE_ENV=production
RUN mkdir /data && chown node:node /data
COPY --from=prod-deps /app/node_modules /app/node_modules
COPY --from=build /app/dist /app/dist
COPY --from=build /app/package.json /app/package.json
USER node
# The DB path is ./telegram_log.db (cwd-relative); WORKDIR=/data puts it on the
# mount, and .env is read from the same directory — identical to local dev.
WORKDIR /data
CMD ["node", "--env-file-if-exists=.env", "/app/dist/main.js"]
