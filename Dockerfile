# syntax=docker/dockerfile:1.7

FROM node:22.18.0-bookworm-slim AS node-build

ARG PNPM_VERSION=10.10.0
WORKDIR /build

RUN npm install --global "pnpm@${PNPM_VERSION}"
COPY package.json pnpm-lock.yaml tsconfig.json tsconfig.web.json vite.config.ts vitest.config.ts ./
RUN pnpm install --frozen-lockfile

COPY parser-identity.json ./
COPY public ./public
COPY src ./src
COPY tests ./tests
RUN pnpm build

FROM node-build AS test
RUN pnpm test && pnpm test:web


FROM mcr.microsoft.com/playwright:v1.62.1-noble AS e2e

WORKDIR /work
COPY --from=node-build /build/package.json ./package.json
COPY --from=node-build /build/node_modules ./node_modules
COPY playwright.config.ts ./playwright.config.ts
COPY e2e ./e2e

CMD ["./node_modules/.bin/playwright", "test"]

FROM node-build AS node-production
RUN pnpm prune --prod


FROM gradle:8.14.3-jdk17 AS parser-build

WORKDIR /build
COPY parser-identity.json ./
COPY parser ./parser
COPY vendor/clarity ./vendor/clarity
WORKDIR /build/parser
RUN gradle --no-daemon clean test shadowJar


FROM eclipse-temurin:21.0.8_9-jre AS java-runtime


FROM node:22.18.0-bookworm-slim AS app

ENV NODE_ENV=production \
    REPLAY_ROOT=/data/replays \
    STAGING_ROOT=/work/staging \
    STAGING_INBOX_ROOT=/work/staging/inbox \
    STAGING_CLAIMED_ROOT=/work/staging/claimed \
    JOBS_ROOT=/work/staging/jobs \
    MIGRATION_ROOT=/app/migrations \
    WAREHOUSE_PATH=/data/warehouse/dota.duckdb \
    WAREHOUSE_LOCK_PATH=/data/warehouse/dota.duckdb.lock

WORKDIR /app
RUN groupadd --gid 10001 dota \
    && useradd --uid 10001 --gid dota --no-create-home --shell /usr/sbin/nologin dota \
    && mkdir -p /data/replays /data/warehouse /work/staging/inbox /work/staging/claimed /work/staging/jobs \
    && chown -R dota:dota /data/replays /data/warehouse /work/staging

COPY --from=node-production --chown=dota:dota /build/package.json ./package.json
COPY --from=node-production --chown=dota:dota /build/node_modules ./node_modules
COPY --from=node-production --chown=dota:dota /build/dist ./dist
COPY --from=node-production --chown=dota:dota /build/src/db/migrations ./migrations

USER 10001:10001
ENTRYPOINT ["node", "/app/dist/src/cli/index.js"]


FROM app AS parser-worker

ENV JAVA_HOME=/opt/java/openjdk \
    PATH="/opt/java/openjdk/bin:${PATH}" \
    JOBS_ROOT=/work/staging/jobs \
    PARSER_JAR=/app/parser.jar \
    PARSER_WORKER_TIMEOUT_MS=240000 \
    PARSER_MAX_INPUT_BYTES=2147483648 \
    PARSER_MAX_OUTPUT_BYTES=1073741824 \
    PARSER_TIMEOUT_SECONDS=180 \
    PARSER_MAX_RECORDS=2000000 \
    CHECKPOINT_INTERVAL_SECONDS=30

COPY --from=java-runtime /opt/java/openjdk /opt/java/openjdk
COPY --from=parser-build --chown=dota:dota /build/parser/build/libs/dota-replay-exporter.jar /app/parser.jar

CMD ["parser-worker"]


FROM node:22.18.0-bookworm-slim AS web

ENV NODE_ENV=production \
    REPLAY_ROOT=/data/replays \
    STAGING_ROOT=/work/staging \
    JOBS_ROOT=/work/staging/jobs \
    MIGRATION_ROOT=/app/migrations \
    WAREHOUSE_PATH=/data/warehouse/dota.duckdb \
    QUERY_FILES_ROOT=/data/queries \
    HOST=0.0.0.0 \
    PORT=3000

WORKDIR /app
RUN groupadd --gid 10001 dota \
    && useradd --uid 10001 --gid dota --no-create-home --shell /usr/sbin/nologin dota \
    && mkdir -p /data/replays /data/warehouse /data/queries /work/staging/inbox /work/staging/claimed /work/staging/jobs \
    && chown -R dota:dota /data/replays /data/warehouse /data/queries /work/staging

COPY --from=node-production --chown=dota:dota /build/package.json ./package.json
COPY --from=node-production --chown=dota:dota /build/node_modules ./node_modules
COPY --from=node-production --chown=dota:dota /build/dist ./dist
COPY --from=node-production --chown=dota:dota /build/src/db/migrations ./migrations

USER 10001:10001
EXPOSE 3000
CMD ["./node_modules/.bin/srvx", "--prod", "--host=0.0.0.0", "--port=3000", "--static=../client", "--entry=dist/server/server.js"]


FROM java-runtime AS parser

ENV REPLAY_ROOT=/data/replays \
    STAGING_ROOT=/work/staging/inbox \
    PARSER_MAX_INPUT_BYTES=2147483648 \
    PARSER_MAX_OUTPUT_BYTES=1073741824 \
    PARSER_TIMEOUT_SECONDS=180 \
    PARSER_MAX_RECORDS=2000000 \
    CHECKPOINT_INTERVAL_SECONDS=30

WORKDIR /app
RUN groupadd --gid 10001 dota \
    && useradd --uid 10001 --gid dota --no-create-home --shell /usr/sbin/nologin dota \
    && mkdir -p /data/replays /work/staging/inbox \
    && chown -R dota:dota /data/replays /work/staging

COPY --from=parser-build --chown=dota:dota /build/parser/build/libs/dota-replay-exporter.jar /app/parser.jar

USER 10001:10001
ENTRYPOINT ["java", "-jar", "/app/parser.jar"]
