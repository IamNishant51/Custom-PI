FROM node:20-slim AS base
WORKDIR /app
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends \
  ca-certificates \
  && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --only=production && npm cache clean --force

FROM base AS runner
RUN addgroup --system --gid 1001 nodejs && \
  adduser --system --uid 1001 appuser
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN chown -R appuser:nodejs /app
USER appuser
ENV NODE_ENV=production
ENV PORT=4321
EXPOSE 4321
CMD ["node", "bin/web.js"]
