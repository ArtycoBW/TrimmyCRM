#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"
OUTPUT_DIR="$SCRIPT_DIR/backups"
KEY_FILE=""
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

usage() {
  echo "Usage: $0 [--env-file PATH] --key-file PATH [--output-dir PATH] [--retention-days N]" >&2
}

while (($#)); do
  case "$1" in
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --key-file) KEY_FILE="$2"; shift 2 ;;
    --output-dir) OUTPUT_DIR="$2"; shift 2 ;;
    --retention-days) RETENTION_DAYS="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) usage; exit 2 ;;
  esac
done

if [[ -z "$KEY_FILE" || ! -r "$KEY_FILE" ]]; then
  echo "A readable encryption key file is required." >&2
  usage
  exit 2
fi

if [[ ! -r "$ENV_FILE" ]]; then
  echo "Environment file not found: $ENV_FILE" >&2
  exit 2
fi

if [[ ! "$RETENTION_DAYS" =~ ^[0-9]+$ ]]; then
  echo "Retention days must be a non-negative integer." >&2
  exit 2
fi

command -v docker >/dev/null || { echo "docker is required" >&2; exit 1; }
command -v openssl >/dev/null || { echo "openssl is required" >&2; exit 1; }

mkdir -p "$OUTPUT_DIR"
chmod 0700 "$OUTPUT_DIR"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="$OUTPUT_DIR/trimmycrm-$timestamp.dump.enc"
temporary="$target.tmp"
trap 'rm -f -- "$temporary"' EXIT

docker compose --project-directory "$SCRIPT_DIR" --env-file "$ENV_FILE" \
  exec -T postgres sh -ec \
  'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --format=custom --no-owner --no-acl' \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 250000 -salt \
      -pass "file:$KEY_FILE" -out "$temporary"

mv -- "$temporary" "$target"
chmod 0600 "$target"
trap - EXIT

find "$OUTPUT_DIR" -type f -name 'trimmycrm-*.dump.enc' -mtime "+$RETENTION_DAYS" -delete

echo "$target"
