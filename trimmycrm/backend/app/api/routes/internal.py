from __future__ import annotations

import hmac

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import platform_db, settings_dep
from app.core.config import Settings
from app.core.errors import AuthenticationError, BadRequestError, NotFoundError
from app.core.tenant import InvalidHostError, normalize_host
from app.models import Site, SiteStatus
from app.services.tenant_lookup import SQLTenantLookup

router = APIRouter(prefix="/internal", tags=["internal"], include_in_schema=False)


@router.get("/domains/allow")
async def allow_on_demand_tls(
    domain: str = Query(min_length=4, max_length=253),
    token: str = Query(min_length=16, max_length=256),
    session: AsyncSession = Depends(platform_db, scope="function"),
    settings: Settings = Depends(settings_dep),
) -> Response:
    if not hmac.compare_digest(token, settings.internal_edge_token.get_secret_value()):
        raise AuthenticationError("Недействительный внутренний токен")
    try:
        host = normalize_host(domain, allow_ip=False)
    except InvalidHostError as exc:
        raise BadRequestError("Некорректный домен", code="invalid_domain") from exc

    allowed = host in {str(value).strip().lower().rstrip(".") for value in settings.platform_hosts}
    if not allowed:
        for base in settings.tenant_base_domains:
            suffix = f".{str(base).lower().rstrip('.')}"
            if host.endswith(suffix) and host.count(".") == suffix.count("."):
                slug = host[: -len(suffix)]
                allowed = bool(
                    await session.scalar(
                        select(Site.id).where(
                            Site.slug == slug,
                            Site.status == SiteStatus.published,
                        )
                    )
                )
                break
    if not allowed:
        custom_tenant = await SQLTenantLookup(
            str(settings.tenant_base_domains[0])
        ).find_by_custom_domain(host)
        allowed = bool(
            custom_tenant is not None and custom_tenant.status == SiteStatus.published.value
        )
    # Контракт `ask` для TLS по требованию в Caddy использует статус HTTP, а не
    # логическое значение JSON: любой ответ 2xx разрешает выпуск сертификата.
    if not allowed:
        raise NotFoundError("Домен не разрешён", code="domain_not_allowed")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
