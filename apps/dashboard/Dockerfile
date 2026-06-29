# ═══════════════════════════════════════════════════════════════════════
# Ninbus Admin Dashboard — Next.js standalone Docker image
#
# Strategy: Next.js `output: 'standalone'` produces a self-contained server
# bundle. Multi-stage build → final image ~120MB (no node_modules at runtime).
#
# The dashboard container talks to the API via the compose service name
# (http://api:8081) through the Route Handler proxy. It never exposes a port
# to the host — only nginx (reverse-proxy) reaches it on :3001 internally.
# ═══════════════════════════════════════════════════════════════════════

# ── Stage 1: deps ───────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install

# ── Stage 2: build ──────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ── Stage 3: runner ─────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3001
ENV HOSTNAME=0.0.0.0

# Non-root user for security.
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy the standalone server bundle + static assets.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3001
CMD ["node", "server.js"]
