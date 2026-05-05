# ═══════════════════════════════════════════════════════════════════
# Ninbus API — Ultra-optimized Docker image
#
# Strategy: Bun compiles all dependencies into a single .js file.
# No node_modules needed at runtime = ~130MB savings.
#
# Image size comparison:
#   Before (oven/bun:1.3-slim + node_modules):  ~400MB
#   After  (oven/bun:1.3-alpine + single .js):   ~170MB
#
# Layers:
#   1. build:  install deps + compile → single dist/index.js (3.4MB)
#   2. production: alpine base + index.js + migrations + .env.test
# ═══════════════════════════════════════════════════════════════════

# ── Stage 1: Build ──────────────────────────────────────────────────
FROM oven/bun:1.3-alpine AS build
WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

# ── Stage 2: Production ────────────────────────────────────────────
FROM oven/bun:1.3-alpine AS production

# Security: non-root user (already provided by bun:alpine)
USER bun
WORKDIR /app

# Copy only the compiled single-file bundle + migrations
COPY --from=build /app/dist/index.js ./
COPY --from=build /app/drizzle ./drizzle

# Tiny footprint: ~3.4MB app + ~156MB alpine base ≈ 170MB total
# No node_modules, no TypeScript source, no dev dependencies

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD bun -e "fetch('http://localhost:3000/health').then(r => r.ok ? process.exit(0) : process.exit(1))" || exit 1

CMD ["bun", "run", "index.js"]
