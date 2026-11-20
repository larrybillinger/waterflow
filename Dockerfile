# Waterflow
#
# Two stages: build the static site, then serve it from a slim runtime with the optional
# tile cache. The builder's node_modules never reach the final image.

FROM node:22-alpine AS build

WORKDIR /app

# Copy the manifests first so the dependency layer is cached independently of the source.
COPY package.json package-lock.json* ./
RUN npm ci || npm install

COPY . .

# VITE_TILE_PROXY is baked in at build time, so it has to be set here rather than at run
# time. Empty means the browser fetches tiles directly from their origin.
ARG VITE_TILE_PROXY=/api/tiles
ENV VITE_TILE_PROXY=$VITE_TILE_PROXY

RUN npm run build


FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

# Only the server's own dependencies, not the build toolchain.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY server ./server

RUN mkdir -p /app/server/cache && chown -R node:node /app
USER node

EXPOSE 8098

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.APP_PORT || 8098) + '/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server/index.js"]
