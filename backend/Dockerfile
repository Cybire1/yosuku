# Stage 1: Build Leo from source (use bookworm to match node:22-slim runtime GLIBC)
FROM rust:bookworm AS leo-builder

RUN apt-get update && apt-get install -y git pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*

# Install Leo v3.4.0
RUN cargo install --locked --git https://github.com/ProvableHQ/leo --tag v3.4.0 leo-lang

# Stage 2: Build TypeScript
FROM node:22-slim AS ts-builder

WORKDIR /build
COPY backend/package.json backend/package-lock.json* ./
RUN npm ci
COPY backend/tsconfig.json ./
COPY backend/src/ src/
RUN npm run build

# Stage 3: Runtime — Node 22 for proper ESM + top-level await support
FROM node:22-slim

# Install runtime deps for Leo binary (GLIBC from node:22-slim is Debian Bookworm-based)
RUN apt-get update && apt-get install -y \
    ca-certificates libcurl4 \
    && rm -rf /var/lib/apt/lists/*

# Copy Leo binary
COPY --from=leo-builder /usr/local/cargo/bin/leo /usr/local/bin/leo

# Copy Leo project (btc_pred_v8 uses test_usdcx_stablecoin.aleo from network)
COPY btc_pred_v8 /app/btc_pred_v8

WORKDIR /app/backend

# Copy Node.js app
COPY backend/package.json backend/package-lock.json* ./
RUN npm ci --production
COPY --from=ts-builder /build/dist ./dist

ENV PORT=3001
EXPOSE 3001

CMD ["node", "dist/index.js"]
