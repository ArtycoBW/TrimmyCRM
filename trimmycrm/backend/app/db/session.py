"""Асинхронные движки БД, фабрики сессий и локальный для транзакции контекст RLS."""

from __future__ import annotations

import os
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)


def _asyncpg_url(value: str) -> str:
    """Принимать обычные URL PostgreSQL, всегда используя драйвер asyncpg."""

    if value.startswith("postgres://"):
        return "postgresql+asyncpg://" + value.removeprefix("postgres://")
    if value.startswith("postgresql://"):
        return "postgresql+asyncpg://" + value.removeprefix("postgresql://")
    return value


def _required_url(name: str, fallback: str | None = None) -> str:
    value = os.getenv(name) or fallback
    if not value:
        raise RuntimeError(f"{name} must be configured")
    return _asyncpg_url(value)


DATABASE_URL = _required_url("DATABASE_URL")
ADMIN_DATABASE_URL = _required_url("ADMIN_DATABASE_URL", DATABASE_URL)


def _make_engine(url: str) -> AsyncEngine:
    return create_async_engine(
        url,
        pool_pre_ping=True,
        pool_recycle=int(os.getenv("DB_POOL_RECYCLE_SECONDS", "1800")),
        pool_size=int(os.getenv("DB_POOL_SIZE", "10")),
        max_overflow=int(os.getenv("DB_MAX_OVERFLOW", "20")),
    )


runtime_engine = _make_engine(DATABASE_URL)
admin_engine = _make_engine(ADMIN_DATABASE_URL)

RuntimeSession = async_sessionmaker(
    runtime_engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)
AdminSession = async_sessionmaker(
    admin_engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


async def get_runtime_session() -> AsyncIterator[AsyncSession]:
    """Зависимость FastAPI для запросов, у которых ещё нет контекста тенанта."""

    async with RuntimeSession() as session:
        yield session


async def get_admin_session() -> AsyncIterator[AsyncSession]:
    """Зависимость FastAPI для служебной работы с БД и миграций."""

    async with AdminSession() as session:
        yield session


async def set_rls_context(
    session: AsyncSession,
    tenant_id: uuid.UUID | str | None,
    *,
    platform_scope: bool = False,
) -> None:
    """Установить параметры RLS GUC только для текущей транзакции.

    Функцию нужно вызывать внутри ``session.begin()``. Вызов ``set_config(..., true)``
    действует только в транзакции, поэтому соединения из пула не сохраняют тенанта.
    ``platform_scope`` открывает только строки с ``tenant_id``, равным NULL, и никогда
    не обходит RLS-политики тенанта.
    """

    await session.execute(
        text("SELECT set_config('app.current_tenant', :tenant_id, true)"),
        {"tenant_id": "" if tenant_id is None else str(tenant_id)},
    )
    await session.execute(
        text("SELECT set_config('app.is_platform', :is_platform, true)"),
        {"is_platform": "true" if platform_scope else "false"},
    )


@asynccontextmanager
async def tenant_transaction(
    tenant_id: uuid.UUID | str | None,
    *,
    platform_scope: bool = False,
    session_factory: async_sessionmaker[AsyncSession] = RuntimeSession,
) -> AsyncIterator[AsyncSession]:
    """Открыть транзакцию с локальным RLS-контекстом, запрещающим доступ при сбое."""

    if tenant_id is None and not platform_scope:
        raise ValueError("tenant_id is required unless platform_scope=True")

    async with session_factory() as session:
        async with session.begin():
            await set_rls_context(
                session,
                tenant_id,
                platform_scope=platform_scope,
            )
            yield session


@asynccontextmanager
async def admin_transaction() -> AsyncIterator[AsyncSession]:
    """Открыть административную транзакцию без установки GUC тенанта."""

    async with AdminSession() as session:
        async with session.begin():
            yield session
