# syntax=docker/dockerfile:1.7

FROM node:22.18.0-bookworm-slim AS node-build

ARG PNPM_VERSION=10.10.0
WORKDIR /build

RUN npm install --global "pnpm@${PNPM_VERSION}"
COPY package.json pnpm-lock.yaml tsconfig.json ./
RUN pnpm install --frozen-lockfile

COPY src ./src
COPY tests ./tests
RUN pnpm build

FROM node-build AS test
RUN pnpm test

FROM node-build AS node-production
RUN pnpm prune --prod


FROM gradle:8.14.3-jdk21 AS parser-build

WORKDIR /build/parser
COPY parser/ ./
RUN gradle --no-daemon clean test shadowJar


FROM node:22.18.0-bookworm-slim AS app

ENV NODE_ENV=production \
    REPLAY_ROOT=/data/replays \
    STAGING_ROOT=/work/staging \
    MIGRATION_ROOT=/app/migrations \
    QUERY_ROOT=/app/queries \
    WAREHOUSE_PATH=/data/warehouse/dota.duckdb \
    WAREHOUSE_LOCK_PATH=/data/warehouse/dota.duckdb.lock

WORKDIR /app
RUN groupadd --gid 10001 dota \
    && useradd --uid 10001 --gid dota --no-create-home --shell /usr/sbin/nologin dota \
    && mkdir -p /data/replays /data/warehouse /work/staging \
    && chown -R dota:dota /data/replays /data/warehouse /work/staging

COPY --from=node-production --chown=dota:dota /build/package.json ./package.json
COPY --from=node-production --chown=dota:dota /build/node_modules ./node_modules
COPY --from=node-production --chown=dota:dota /build/dist ./dist
COPY --from=node-production --chown=dota:dota /build/src/db/migrations ./migrations
COPY --from=node-production --chown=dota:dota /build/src/db/queries ./queries

USER 10001:10001
ENTRYPOINT ["node", "/app/dist/src/cli/index.js"]


FROM eclipse-temurin:21.0.8_9-jre AS parser

ENV REPLAY_ROOT=/data/replays \
    STAGING_ROOT=/work/staging \
    PARSER_MAX_INPUT_BYTES=2147483648 \
    PARSER_MAX_OUTPUT_BYTES=8589934592 \
    PARSER_TIMEOUT_SECONDS=1800 \
    PARSER_MAX_RECORDS=50000000 \
    CHECKPOINT_INTERVAL_SECONDS=30

WORKDIR /app
RUN groupadd --gid 10001 dota \
    && useradd --uid 10001 --gid dota --no-create-home --shell /usr/sbin/nologin dota \
    && mkdir -p /data/replays /work/staging \
    && chown -R dota:dota /data/replays /work/staging

COPY --from=parser-build --chown=dota:dota /build/parser/build/libs/dota-replay-exporter.jar /app/parser.jar

USER 10001:10001
ENTRYPOINT ["java", "-jar", "/app/parser.jar"]
