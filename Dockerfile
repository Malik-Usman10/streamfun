# Multi-stage Dockerfile for streamfun
FROM oven/bun:1.3-alpine AS base

# Install system dependencies: ffmpeg (thumbnails), curl (healthcheck), rclone, pg_dump
RUN apk add --no-cache ffmpeg curl bash postgresql16-client && \
    curl https://rclone.org/install.sh | bash

WORKDIR /app

# ─── Dependency stage ───────────────────────────────────────────────────────
FROM base AS deps
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# ─── Build stage ────────────────────────────────────────────────────────────
FROM deps AS builder
COPY . .
RUN bun build src/index.ts --outdir dist --target bun --external "*"

# ─── Runtime stage ──────────────────────────────────────────────────────────
FROM base AS runner

WORKDIR /app

# Copy installed packages and built output
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/migrations ./migrations
COPY --from=builder /app/src/database/migrate.ts ./src/database/migrate.ts
COPY --from=builder /app/src ./src
COPY package.json ./

# Create upload directory (will be overridden by bind-mount in compose)
RUN mkdir -p /uploads

# Run DB migrations then start the server
CMD ["sh", "-c", "bun run migrate:up && bun run src/index.ts"]

EXPOSE 3000
