FROM node:22-slim AS base
WORKDIR /app
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends \
  ca-certificates \
  && rm -rf /var/lib/apt/lists/*

FROM node:22-slim AS deps
WORKDIR /app
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends \
  python3 \
  make \
  gcc \
  g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY scripts/ ./scripts/
RUN npm ci --only=production && npm cache clean --force

FROM base AS runner
RUN mkdir -p /home/appuser && \
  addgroup --system --gid 1001 nodejs && \
  adduser --system --uid 1001 --home /home/appuser appuser && \
  mkdir -p /data && \
  chown appuser:nodejs /data /home/appuser
ENV HOME=/home/appuser
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN chown -R appuser:nodejs /app /home/appuser
USER appuser
ENV NODE_ENV=production
ENV PORT=4321
ENV WEB_HOST=0.0.0.0
VOLUME /data
EXPOSE 4321
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:' + (process.env.PORT || 4321) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "bin/web.js"]
