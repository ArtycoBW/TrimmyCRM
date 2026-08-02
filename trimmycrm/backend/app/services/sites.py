from __future__ import annotations

import hashlib
import json
import re
import secrets
import uuid
from datetime import UTC, datetime
from typing import Any

from redis.asyncio import Redis
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import SalonType, Site, SiteBlock, SiteVersion, SiteVersionStatus

TRIMMY_THEME: dict[str, str] = {
    "vermillion": "#d15022",
    "acidMint": "#75dfb5",
    "pureBlack": "#000000",
    "paperWhite": "#ffffff",
}

SALON_TYPE_PRESETS: dict[SalonType, dict[str, Any]] = {
    SalonType.women_hair_salon: {
        "templateKey": "women-hair",
        "serviceFocuses": ["haircut", "color", "styling", "care"],
    },
    SalonType.barbershop: {
        "templateKey": "barbershop",
        "serviceFocuses": ["haircut", "beard", "shaving", "gray_blending"],
    },
    SalonType.unisex_hair_salon: {
        "templateKey": "unisex-hair",
        "serviceFocuses": ["haircut", "color", "styling", "care", "beard"],
    },
}


def salon_profile_defaults(salon_type: SalonType) -> dict[str, Any]:
    """Return a fresh, deterministic profile preset for a new salon."""

    preset = SALON_TYPE_PRESETS[salon_type]
    return {
        "template_key": str(preset["templateKey"]),
        "service_focuses": list(preset["serviceFocuses"]),
        "theme": dict(TRIMMY_THEME),
    }


_CYRILLIC = str.maketrans(
    {
        "а": "a",
        "б": "b",
        "в": "v",
        "г": "g",
        "д": "d",
        "е": "e",
        "ё": "e",
        "ж": "zh",
        "з": "z",
        "и": "i",
        "й": "y",
        "к": "k",
        "л": "l",
        "м": "m",
        "н": "n",
        "о": "o",
        "п": "p",
        "р": "r",
        "с": "s",
        "т": "t",
        "у": "u",
        "ф": "f",
        "х": "h",
        "ц": "c",
        "ч": "ch",
        "ш": "sh",
        "щ": "sch",
        "ъ": "",
        "ы": "y",
        "ь": "",
        "э": "e",
        "ю": "yu",
        "я": "ya",
    }
)


def slugify(value: str) -> str:
    value = value.strip().lower().translate(_CYRILLIC)
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    value = re.sub(r"-+", "-", value)[:63].strip("-")
    return value if len(value) >= 3 else f"salon-{secrets.token_hex(3)}"


async def unique_slug(
    session: AsyncSession,
    value: str,
    *,
    reserved: set[str],
    exclude_site_id: uuid.UUID | None = None,
) -> str:
    base = slugify(value)
    if base in reserved:
        base = f"{base}-salon"
    for index in range(100):
        suffix = "" if index == 0 else f"-{index + 1}"
        candidate = f"{base[: 63 - len(suffix)]}{suffix}"
        query = select(Site.id).where(Site.slug == candidate)
        if exclude_site_id:
            query = query.where(Site.id != exclude_site_id)
        if await session.scalar(query) is None:
            return candidate
    return f"salon-{uuid.uuid4().hex[:12]}"


async def current_version_no(session: AsyncSession, tenant_id: uuid.UUID) -> int:
    return int(
        await session.scalar(
            select(func.coalesce(func.max(SiteVersion.version_no), 0)).where(
                SiteVersion.tenant_id == tenant_id
            )
        )
        or 0
    )


async def build_site_snapshot(session: AsyncSession, site: Site) -> dict[str, Any]:
    blocks = (
        await session.scalars(
            select(SiteBlock).where(SiteBlock.tenant_id == site.id).order_by(SiteBlock.position)
        )
    ).all()
    return {
        "id": str(site.id),
        "name": site.name,
        "slug": site.slug,
        "salonType": site.salon_type.value,
        "serviceFocuses": site.service_focuses,
        "locale": site.locale,
        "currency": site.currency,
        "customDomain": site.custom_domain,
        "description": site.description,
        "city": site.city,
        "street": site.street,
        "phone": site.phone,
        "workHours": site.work_hours,
        "socials": site.socials,
        "logoUrl": site.logo_url,
        "theme": site.theme,
        "timezone": getattr(site, "timezone", "Europe/Moscow"),
        "templateKey": site.template_key,
        "blocks": [
            {
                "id": str(block.id),
                "type": block.type,
                "position": block.position,
                "config": block.config,
                "enabled": block.enabled,
            }
            for block in blocks
        ],
    }


async def save_version(
    session: AsyncSession,
    *,
    site: Site,
    actor_id: uuid.UUID,
    status: SiteVersionStatus,
) -> SiteVersion:
    version = SiteVersion(
        tenant_id=site.id,
        version_no=await current_version_no(session, site.id) + 1,
        status=status,
        snapshot=await build_site_snapshot(session, site),
        created_by_id=actor_id,
        published_at=datetime.now(UTC) if status is SiteVersionStatus.published else None,
    )
    session.add(version)
    await session.flush()
    return version


async def publish_version(session: AsyncSession, *, site: Site, actor_id: uuid.UUID) -> SiteVersion:
    await session.execute(
        update(SiteVersion)
        .where(
            SiteVersion.tenant_id == site.id,
            SiteVersion.status == SiteVersionStatus.published,
        )
        .values(status=SiteVersionStatus.archived)
    )
    return await save_version(
        session, site=site, actor_id=actor_id, status=SiteVersionStatus.published
    )


async def create_preview(redis: Redis, snapshot: dict[str, Any], ttl: int) -> tuple[str, datetime]:
    raw = secrets.token_urlsafe(32)
    key = "trimmycrm:preview:" + hashlib.sha256(raw.encode()).hexdigest()
    await redis.set(key, json.dumps(snapshot, ensure_ascii=False, default=str), ex=ttl)
    from datetime import timedelta

    return raw, datetime.now(UTC) + timedelta(seconds=ttl)


async def read_preview(redis: Redis, raw: str) -> dict[str, Any] | None:
    if len(raw) < 32 or len(raw) > 256:
        return None
    key = "trimmycrm:preview:" + hashlib.sha256(raw.encode()).hexdigest()
    value = await redis.get(key)
    if value is None:
        return None
    result = json.loads(value)
    return result if isinstance(result, dict) else None
