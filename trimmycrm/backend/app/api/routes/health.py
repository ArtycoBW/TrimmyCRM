from __future__ import annotations

from fastapi import APIRouter, Response, status
from redis.asyncio import Redis
from sqlalchemy import text

from app.core.config import get_settings
from app.db.session import runtime_engine
from app.schemas import HealthResponse

router = APIRouter(tags=["health"])


@router.get("/health/live", response_model=HealthResponse, include_in_schema=False)
async def liveness() -> HealthResponse:
    return HealthResponse(status="ok", checks={"process": "ok"})


@router.get("/health/ready", response_model=HealthResponse, include_in_schema=False)
async def readiness(response: Response) -> HealthResponse:
    checks: dict[str, str] = {}
    try:
        async with runtime_engine.connect() as connection:
            await connection.execute(text("SELECT 1"))
        checks["postgres"] = "ok"
    except Exception:
        checks["postgres"] = "unavailable"

    settings = get_settings()
    redis = Redis.from_url(settings.redis_url.get_secret_value(), socket_timeout=1.0)
    try:
        await redis.ping()
        checks["redis"] = "ok"
    except Exception:
        checks["redis"] = "unavailable"
    finally:
        await redis.aclose()
    ready = all(value == "ok" for value in checks.values())
    if not ready:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return HealthResponse(
        status="ok" if ready else "degraded",
        checks=checks,
    )
