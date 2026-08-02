from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import sentry_sdk
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from prometheus_fastapi_instrumentator import Instrumentator
from redis.asyncio import Redis

from app.api.router import api_router, include_optional_media_router
from app.api.routes.health import router as health_router
from app.core.audit import MUTATING_METHODS, record_authenticated_mutation
from app.core.config import get_settings
from app.core.errors import register_error_handlers
from app.core.logging import (
    RequestContextMiddleware,
    configure_logging,
    reset_logging_tenant,
    set_logging_tenant,
)
from app.core.tenant import (
    InvalidHostError,
    TenantResolver,
    effective_host_from_request,
    reset_current_tenant,
    set_current_tenant,
)
from app.integrations.payments import build_payment_gateway
from app.integrations.storage import build_object_storage
from app.services.tenant_lookup import SQLTenantLookup
from app.web_pages import router as web_pages_router

settings = get_settings()
configure_logging(debug=settings.debug)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    redis = Redis.from_url(settings.redis_url.get_secret_value(), decode_responses=False)
    resolver = TenantResolver(
        SQLTenantLookup(str(settings.tenant_base_domains[0])),
        redis,
        base_domains=settings.tenant_base_domains,
        platform_hosts=settings.platform_hosts,
        reserved_slugs=settings.reserved_tenant_slugs,
        cache_ttl_seconds=settings.tenant_host_cache_ttl_seconds,
        negative_ttl_seconds=settings.tenant_host_negative_cache_ttl_seconds,
        allow_ip_hosts=settings.is_development,
    )
    app.state.settings = settings
    app.state.redis = redis
    app.state.tenant_resolver = resolver
    app.state.payment_gateway = build_payment_gateway(settings)
    app.state.storage = build_object_storage(settings)
    try:
        yield
    finally:
        close_gateway = getattr(app.state.payment_gateway, "aclose", None)
        if close_gateway is not None:
            await close_gateway()
        await redis.aclose()


def create_app() -> FastAPI:
    if settings.sentry_dsn:
        sentry_sdk.init(
            dsn=settings.sentry_dsn.get_secret_value(),
            environment=settings.environment,
            traces_sample_rate=0.05,
            send_default_pii=False,
        )
    application = FastAPI(
        title=settings.app_name,
        version="1.0.0",
        description="Multi-tenant API for TrimmyCRM",
        docs_url="/api/docs",
        redoc_url="/api/redoc",
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )
    application.add_middleware(RequestContextMiddleware)
    application.add_middleware(GZipMiddleware, minimum_size=1024)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.allowed_origins),
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=[
            "Authorization",
            "Content-Type",
            "Idempotency-Key",
            "X-CSRF-Token",
            "X-Request-ID",
            "X-Captcha-Token",
        ],
        expose_headers=["X-Request-ID", "ETag", "Content-Disposition"],
    )

    @application.middleware("http")
    async def resolve_tenant(request: Request, call_next):  # type: ignore[no-untyped-def]
        if request.url.path.startswith(("/health/", "/metrics", "/api/v1/internal/")):
            return await call_next(request)
        try:
            host = effective_host_from_request(
                request,
                trusted_proxy_networks=settings.trusted_proxy_networks,
                internal_edge_token=settings.internal_edge_token.get_secret_value(),
                allow_ip=settings.is_development,
            )
            tenant = await request.app.state.tenant_resolver.resolve(host)
        except InvalidHostError:
            return JSONResponse(
                status_code=400,
                content={
                    "statusCode": 400,
                    "error": "BadRequest",
                    "message": "Некорректный Host",
                    "code": "invalid_host",
                },
            )
        preview_path = f"{settings.api_v1_prefix}/public/site"
        is_draft_preview = (
            tenant is not None
            and tenant.status == "draft"
            and request.url.path == preview_path
            and bool(request.query_params.get("previewToken"))
        )
        if tenant is not None and tenant.status != "published" and not is_draft_preview:
            return JSONResponse(
                status_code=404,
                content={
                    "statusCode": 404,
                    "error": "NotFound",
                    "message": "Сайт не опубликован",
                    "code": "site_not_published",
                },
            )
        request.state.tenant_id = tenant.id if tenant else None
        request.state.tenant_host = host
        request.state.tenant_slug = tenant.slug if tenant else None
        tenant_token = set_current_tenant(tenant)
        logging_token = set_logging_tenant(str(tenant.id) if tenant else None)
        try:
            response = await call_next(request)
            if request.method in MUTATING_METHODS and response.status_code < 400:
                try:
                    await record_authenticated_mutation(request, response.status_code)
                except Exception:
                    # Ошибка сохранения аудита не должна превращать уже успешное
                    # бизнес-изменение в повторную попытку, способную его продублировать.
                    # Сама ошибка отправляется в централизованный журнал.
                    import logging

                    logging.getLogger(__name__).exception("audit_write_failed")
            return response
        finally:
            reset_logging_tenant(logging_token)
            reset_current_tenant(tenant_token)

    register_error_handlers(application)
    application.include_router(health_router)
    application.include_router(web_pages_router)
    application.include_router(api_router, prefix=settings.api_v1_prefix)
    if settings.prometheus_enabled:
        Instrumentator(excluded_handlers=["/metrics", "/health/.*"]).instrument(application).expose(
            application, endpoint="/metrics", include_in_schema=False
        )
    return application


include_optional_media_router()
app = create_app()
