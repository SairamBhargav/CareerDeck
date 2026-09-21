# Node 22 runs TypeScript directly, so there is no build step and no compiled output to
# keep in sync with the source. If a later phase adds a dependency that needs compiling,
# this becomes a two-stage build; until then it does not need to be one.
FROM node:22-alpine

WORKDIR /app

# Copied first so `npm ci` is only re-run when the dependency set actually changes.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY src ./src

ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787

# Runs as a non-root user: a process holding the service-role key should own as little
# of its container as possible.
USER node

CMD ["node", "src/index.ts"]
