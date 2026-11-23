ARG INPUT_IMAGE=robots-registration/app:local
FROM ${INPUT_IMAGE} AS assemble
USER root
RUN mkdir -p /runtime/apps/api /runtime/apps/web /runtime/packages/db /runtime/infra/sandboxes/computer && \
    cp -a /app/node_modules /runtime/ && \
    cp -a /app/apps/api/node_modules /runtime/apps/api/ && \
    cp -a /app/packages/db/node_modules /app/packages/db/prisma /runtime/packages/db/ && \
    cp -a /app/apps/web/dist /runtime/apps/web/ && \
    cp /app/infra/sandboxes/computer/robots-page-browser /app/infra/sandboxes/computer/page_secrets.py /app/infra/sandboxes/computer/install-agent-browser.sh /runtime/infra/sandboxes/computer/ && \
    cp /app/LICENSE /app/NOTICE /runtime/ && \
    find /runtime -name '*.map' -delete && \
    printf '{"type":"module"}\n' >/runtime/package.json
COPY --chmod=755 runtime/ /runtime/
FROM node:24.22.2-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=assemble /runtime/ /app/
RUN install -d -m 750 -o node -g node /data /app/apps/web/asset-archive
ENV NODE_ENV=production ROBOTS_DB_PACKAGE_DIR=/app/packages/db
USER node
CMD ["node","apps/api/dist/index.js"]
