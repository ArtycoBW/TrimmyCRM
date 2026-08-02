"""Журналирование аутентифицированных изменений на уровне запроса по возможности."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import Request

from app.core.logging import get_request_id
from app.db.session import AdminSession
from app.models import AuditActorType, AuditLog

MUTATING_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


async def record_authenticated_mutation(request: Request, status_code: int) -> None:
    actor_id = getattr(request.state, "audit_actor_id", None)
    actor_type = getattr(request.state, "audit_actor_type", None)
    if actor_id is None or actor_type not in {"platform_user", "tenant_user"}:
        return
    tenant_id = getattr(request.state, "audit_tenant_id", None) or getattr(
        request.state, "tenant_id", None
    )
    route = request.scope.get("route")
    route_path = getattr(route, "path", request.url.path)
    after: dict[str, Any] = {
        "method": request.method,
        "path": route_path,
        "statusCode": status_code,
    }
    role = getattr(request.state, "audit_actor_role", None)
    if role:
        after["role"] = role
    async with AdminSession() as session:
        async with session.begin():
            session.add(
                AuditLog(
                    tenant_id=(uuid.UUID(str(tenant_id)) if tenant_id else None),
                    actor_type=AuditActorType(actor_type),
                    actor_id=uuid.UUID(str(actor_id)),
                    action=f"api.{request.method.lower()}",
                    entity_type="api_route",
                    entity_id=None,
                    before=None,
                    after=after,
                    request_id=get_request_id(),
                    ip_address=request.client.host if request.client else None,
                    user_agent=(request.headers.get("user-agent") or "")[:1000] or None,
                )
            )
