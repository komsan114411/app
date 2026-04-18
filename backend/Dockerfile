# ── Build stage ─────────────────────────────────────────────
FROM node:20.18-alpine AS build
WORKDIR /app

# Install only production deps for smaller final image
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund

# Copy source
COPY . .

# ── Runtime stage ───────────────────────────────────────────
FROM node:20.18-alpine AS runtime

# Security: install latest CA certs + dumb-init
RUN apk add --no-cache dumb-init && \
    addgroup -g 10001 -S app && \
    adduser  -u 10001 -S app -G app

WORKDIR /app
COPY --from=build --chown=app:app /app /app

# Drop privileges
USER app

# Readonly root fs + tmpfs for /tmp is applied by orchestrator
ENV NODE_ENV=production \
    UV_THREADPOOL_SIZE=8 \
    NODE_OPTIONS="--max-http-header-size=16384 --disallow-code-generation-from-strings"

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/healthz || exit 1

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "server.js"]
