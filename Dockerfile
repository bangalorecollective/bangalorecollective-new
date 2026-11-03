# Production image for the VPS (see deploy/README.md). Coolify builds it from GitHub without
# database access, so no page may read the database during the build.

FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:24-bookworm-slim AS build
WORKDIR /app
ARG NOINDEX
ENV NOINDEX=$NOINDEX NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN groupadd -g 1001 nodejs && useradd -u 1001 -g nodejs -m nextjs \
  && mkdir -p /data/uploads /data/image-cache && chown -R 1001:1001 /data
COPY --from=build /app/public ./public
COPY --from=build --chown=1001:1001 /app/.next/standalone ./
COPY --from=build --chown=1001:1001 /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
