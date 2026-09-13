FROM rust:1.95.0-bookworm@sha256:6258907abe69656e41cd992e0b705cdcfabcbbe3db374f92ed2d47121282d4a1 AS document-builder
WORKDIR /extract
COPY native/document-extract/Cargo.toml native/document-extract/Cargo.lock ./
COPY native/document-extract/src ./src
RUN cargo build --release --locked && cp target/release/wiki-document-extract /extract/wiki-document-extract && rm -rf target /usr/local/cargo/registry /usr/local/cargo/git

FROM node:22.23.1-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# Complete the converter first to bound peak disk usage during builds.
COPY --from=document-builder /extract/wiki-document-extract /tmp/wiki-document-extract
COPY . .
# Keep installation and pruning in one layer. The pinned Node image supplies npm 10.9.8.
RUN npm ci && npm run build && npm prune --omit=dev && npm cache clean --force && rm -rf .next/cache

FROM node:22.23.1-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 DOCUMENT_EXTRACTOR_BIN=/usr/local/bin/wiki-document-extract
COPY --from=document-builder /extract/wiki-document-extract /usr/local/bin/wiki-document-extract
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/.next ./.next
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/src ./src
COPY --from=builder --chown=node:node /app/scripts ./scripts
COPY --from=builder --chown=node:node /app/drizzle ./drizzle
COPY --from=builder --chown=node:node /app/package.json /app/tsconfig.json /app/next.config.ts ./
RUN mkdir -p /var/lib/wiki/originals && chown -R node:node /var/lib/wiki
USER node
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start", "--port", "3000", "--hostname", "0.0.0.0"]
