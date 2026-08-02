from fastapi import APIRouter

from app.api.routes import (
    analytics,
    auth,
    billing,
    booking,
    crm,
    engagement,
    feedback,
    internal,
    public_leads,
    sites,
    superadmin,
    tenant_auth,
)

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(feedback.router)
api_router.include_router(public_leads.router)
api_router.include_router(tenant_auth.router)
api_router.include_router(sites.router)
api_router.include_router(crm.router)
api_router.include_router(booking.router)
api_router.include_router(engagement.router)
api_router.include_router(analytics.router)
api_router.include_router(billing.router)
api_router.include_router(superadmin.router)
api_router.include_router(internal.router)


def include_optional_media_router() -> None:
    """Импортировать медиа лениво, чтобы тесты хранилища могли загрузить ядро API."""

    from app.api.routes import media

    api_router.include_router(media.router)
