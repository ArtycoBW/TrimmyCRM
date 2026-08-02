# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS dependencies

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-alpine AS builder

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

ARG NEXT_PUBLIC_API_BASE_URL=/api/v1
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_PLATFORM_HOSTS
ARG NEXT_PUBLIC_TENANT_BASE_DOMAIN
ARG NEXT_PUBLIC_YANDEX_SMARTCAPTCHA_SITE_KEY

ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}
ENV NEXT_PUBLIC_PLATFORM_HOSTS=${NEXT_PUBLIC_PLATFORM_HOSTS}
ENV NEXT_PUBLIC_TENANT_BASE_DOMAIN=${NEXT_PUBLIC_TENANT_BASE_DOMAIN}
ENV NEXT_PUBLIC_YANDEX_SMARTCAPTCHA_SITE_KEY=${NEXT_PUBLIC_YANDEX_SMARTCAPTCHA_SITE_KEY}

COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 --ingroup nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
