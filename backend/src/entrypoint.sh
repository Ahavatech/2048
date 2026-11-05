#!/bin/sh
set -eu

if [ "${DATABASE_PATH:-}" = "/data/2048.db" ]; then
  chown node:node /data
  for file in /data/2048.db /data/2048.db-shm /data/2048.db-wal; do
    if [ -e "$file" ]; then
      chown node:node "$file"
    fi
  done
fi

exec su -s /bin/sh node -c 'exec node src/server.js'
