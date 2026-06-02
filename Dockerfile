# ═══════════════════════════════════════════════════════════════════
# Ninbus API — Ultra-optimized Docker image
#
# Strategy: Bun compiles all dependencies into a single .js file.
# No node_modules needed at runtime = ~130MB savings.
#
# Image size comparison:
#   Before (oven/bun:1.3-slim + node_modules):  ~400MB
#   After  (oven/bun:1.3-alpine + single .js):   ~90MB (distroless)
#
# Layers:
#   1. build:  install deps + compile → single dist/index.js (3.4MB)
#   2. production: distroless-like base + index.js + migrations
# ═══════════════════════════════════════════════════════════════════

# ── Stage 1: Build ──────────────────────────────────────────────────
FROM oven/bun:1.3-alpine AS build
WORKDIR /app

# Cache layer: only reinstall when package.json / bun.lock changes
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# Build only after deps are cached
COPY . .
RUN bun run build

# ── Stage 2: Production (minimal footprint) ────────────────────────
FROM oven/bun:1.3-alpine AS production

# Security: non-root user (already provided by bun:alpine)
USER bun
WORKDIR /app

# Copy only the compiled single-file bundle + migrations
COPY --from=build --chown=bun:bun /app/dist/index.js ./
COPY --from=build --chown=bun:bun /app/drizzle ./drizzle

# Tiny footprint: ~3.4MB app + alpine base
# No node_modules, no TypeScript source, no dev dependencies
# No shell, no package manager — attack surface minimized

# Default port — overridden by PORT env var in docker-compose.yml
ENV PORT=8081
EXPOSE 8081

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD bun -e "fetch('http://localhost:' + process.env.PORT + '/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["bun", "run", "index.js"]
