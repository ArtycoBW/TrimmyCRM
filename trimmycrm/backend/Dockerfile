# syntax=docker/dockerfile:1.7

FROM python:3.12-slim-bookworm AS builder

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update \
    && apt-get install --no-install-recommends -y build-essential libpq-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY . /build

# Все нативные зависимости собираются вне финального образа.
RUN python -m pip wheel --wheel-dir /wheels .


FROM python:3.12-slim-bookworm AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update \
    && apt-get install --no-install-recommends -y ca-certificates libpq5 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 app \
    && useradd --uid 10001 --gid app --create-home --shell /usr/sbin/nologin app

COPY --from=builder /wheels /wheels
RUN python -m pip install --no-index --find-links=/wheels trimmycrm-backend \
    && rm -rf /wheels

WORKDIR /app
COPY --chown=app:app . /app
RUN chmod 0755 /app/docker/entrypoint.sh

USER app

ENTRYPOINT ["/app/docker/entrypoint.sh"]
CMD ["api"]
