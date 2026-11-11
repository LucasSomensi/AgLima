FROM node:24-bookworm-slim

# PostgreSQL 18 client supports the hosted database and synchronized snapshots.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl tar \
    && mkdir -p /usr/share/postgresql-common/pgdg \
    && curl --fail --silent --show-error https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
    && echo 'deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main' > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client-18 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY app.js ./
COPY routes ./routes
COPY views ./views
COPY public ./public
COPY scripts ./scripts
COPY migrations ./migrations
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod 755 /app/docker-entrypoint.sh
ENV NODE_ENV=production
ENV PG_DUMP_PATH=/usr/lib/postgresql/18/bin/pg_dump
ENV FOTOS_DIR=/app/fotos
# Sem "USER node": o entrypoint ajusta o dono do volume de fotos e troca para
# o usuário node (setpriv) antes de iniciar a aplicação.
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "app.js"]
