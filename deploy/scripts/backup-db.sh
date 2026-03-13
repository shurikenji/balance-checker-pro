#!/usr/bin/env bash
set -euo pipefail

DB_PATH="${1:-/var/lib/balance-checker-pro/app.db}"
BACKUP_DIR="${2:-/var/backups/balance-checker-pro}"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_FILE="$BACKUP_DIR/app-$STAMP.db"

mkdir -p "$BACKUP_DIR"

if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DB_PATH" ".backup '$BACKUP_FILE'"
else
  cp "$DB_PATH" "$BACKUP_FILE"
fi

find "$BACKUP_DIR" -type f -name 'app-*.db' -mtime +7 -delete

echo "Backup created: $BACKUP_FILE"
