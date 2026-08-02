#!/bin/sh
set -eu

case "${1:-api}" in
  api)
    exec uvicorn "${UVICORN_APP:-app.main:app}" \
      --host "${API_HOST:-0.0.0.0}" \
      --port "${API_PORT:-8000}" \
      --workers "${API_WORKERS:-2}" \
      --proxy-headers \
      --forwarded-allow-ips "${FORWARDED_ALLOW_IPS:-10.0.0.0/8,172.16.0.0/12,192.168.0.0/16}" \
      --no-access-log
    ;;
  migrate)
    exec alembic -c "${ALEMBIC_CONFIG:-alembic.ini}" upgrade head
    ;;
  worker)
    exec celery -A "${CELERY_APP:-app.tasks.celery_app:celery_app}" worker \
      --loglevel "${CELERY_LOG_LEVEL:-INFO}" \
      --concurrency "${CELERY_CONCURRENCY:-2}" \
      --hostname "worker@%h"
    ;;
  beat)
    exec celery -A "${CELERY_APP:-app.tasks.celery_app:celery_app}" beat \
      --loglevel "${CELERY_LOG_LEVEL:-INFO}" \
      --schedule "${CELERY_BEAT_SCHEDULE:-/tmp/celerybeat-schedule}"
    ;;
  *)
    exec "$@"
    ;;
esac
