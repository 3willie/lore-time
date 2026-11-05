# syntax=docker/dockerfile:1
# Story Time: no dependencies and no build step, just Node serving the reader and your story files.
FROM node:22-alpine AS test
WORKDIR /app
COPY . .
RUN node --test

FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=8090 \
    STORIES_DIR=/stories \
    PUID=1000 PGID=1000
WORKDIR /app
COPY --from=test /app/server.mjs /app/package.json ./
COPY --from=test /app/public ./public
# The sample stories, used whenever the mounted /stories folder has no topics in it yet.
COPY --from=test /app/stories ./stories
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" || exit 1
# Starts as root only to check the app user can read /stories, then drops to PUID:PGID (see server.mjs).
CMD ["node", "server.mjs"]
