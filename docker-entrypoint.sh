#!/bin/sh
# O Railway monta volumes com dono root. O container inicia como root só para
# preparar o volume de fotos e, em seguida, executa a aplicação como "node".
set -eu

FOTOS_DIR="${FOTOS_DIR:-/app/fotos}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$FOTOS_DIR"
  # Corrige só o que não pertence a "node", para não percorrer tudo a cada deploy.
  find "$FOTOS_DIR" ! -user node -exec chown node:node {} +
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi

exec "$@"
