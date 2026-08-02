"""Безопасное первоначальное создание суперадминистратора платформы."""

from __future__ import annotations

import argparse
import asyncio
import getpass
import sys
import warnings
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import TextIO

from pydantic import EmailStr, TypeAdapter, ValidationError
from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import PasswordPolicyError, PasswordService
from app.models import PlatformRole, PlatformUser, PlatformUserStatus

_EMAIL_ADAPTER = TypeAdapter(EmailStr)
_BOOTSTRAP_LOCK = "trimmycrm.bootstrap_superadmin"


class BootstrapInputError(ValueError):
    """Входные данные CLI непригодны для bootstrap."""


class BootstrapConflictError(RuntimeError):
    """Bootstrap потребовал бы небезопасного изменения существующей учётной записи."""


class BootstrapAction(StrEnum):
    created = "created"
    already_exists = "already_exists"


@dataclass(frozen=True, slots=True)
class BootstrapResult:
    action: BootstrapAction
    email: str
    status: PlatformUserStatus
    email_verified: bool


def normalize_email(raw_email: str) -> str:
    """Проверить и привести email к тому же виду, что использует регистрация."""

    try:
        validated = _EMAIL_ADAPTER.validate_python(raw_email.strip())
    except ValidationError as exc:
        raise BootstrapInputError("Укажите корректный email") from exc
    return str(validated).lower()


def decide_bootstrap(
    *,
    target_role: PlatformRole | None,
    another_superadmin_exists: bool,
) -> BootstrapAction:
    """Определить действие без чтения пароля и обращения к базе данных."""

    if target_role is PlatformRole.superadmin:
        return BootstrapAction.already_exists
    if target_role is not None:
        raise BootstrapConflictError(
            f"Учётная запись уже существует с ролью {target_role.value}; "
            "bootstrap не повышает owner или staff"
        )
    if another_superadmin_exists:
        raise BootstrapConflictError(
            "Первый superadmin уже создан под другим email; bootstrap новых "
            "суперадминистраторов запрещён"
        )
    return BootstrapAction.created


def read_password(
    *,
    password_stdin: bool,
    stdin: TextIO | None = None,
    getpass_fn: Callable[[str], str] | None = None,
) -> str:
    """Прочитать пароль без аргумента командной строки и переменной окружения."""

    input_stream = stdin or sys.stdin
    if password_stdin:
        if input_stream.isatty():
            raise BootstrapInputError(
                "--password-stdin нельзя использовать с терминалом: "
                "введите пароль в защищённом интерактивном режиме"
            )
        line = input_stream.readline()
        if line == "":
            raise BootstrapInputError("В stdin не передан пароль")
        return line.removesuffix("\n").removesuffix("\r")

    password_reader = getpass_fn or getpass.getpass
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", getpass.GetPassWarning)
            password = password_reader("Пароль superadmin: ")
            confirmation = password_reader("Повторите пароль: ")
    except getpass.GetPassWarning as exc:
        raise BootstrapInputError(
            "Нет защищённого терминала; передайте секрет через --password-stdin"
        ) from exc
    if password != confirmation:
        raise BootstrapInputError("Пароли не совпадают")
    return password


async def create_first_superadmin(
    session: AsyncSession,
    *,
    email: str,
    password_hash: str,
) -> BootstrapResult:
    """Атомарно создать только первого superadmin или вернуть существующего."""

    await session.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:lock_name))"),
        {"lock_name": _BOOTSTRAP_LOCK},
    )
    target = await session.scalar(select(PlatformUser).where(PlatformUser.email == email))
    another_superadmin_exists = bool(
        await session.scalar(
            select(PlatformUser.id).where(PlatformUser.role == PlatformRole.superadmin).limit(1)
        )
    )
    action = decide_bootstrap(
        target_role=None if target is None else target.role,
        another_superadmin_exists=another_superadmin_exists,
    )
    if action is BootstrapAction.already_exists:
        assert target is not None
        return BootstrapResult(
            action=action,
            email=str(target.email),
            status=target.status,
            email_verified=target.email_verified,
        )

    statement = (
        insert(PlatformUser)
        .values(
            email=email,
            password_hash=password_hash,
            role=PlatformRole.superadmin,
            status=PlatformUserStatus.active,
            email_verified=True,
        )
        .on_conflict_do_nothing(index_elements=[PlatformUser.email])
        .returning(PlatformUser.id)
    )
    created_id = await session.scalar(statement)
    if created_id is not None:
        return BootstrapResult(
            action=BootstrapAction.created,
            email=email,
            status=PlatformUserStatus.active,
            email_verified=True,
        )

    # Обычная регистрация могла занять тот же email между проверкой и INSERT.
    target = await session.scalar(select(PlatformUser).where(PlatformUser.email == email))
    if target is None:
        raise BootstrapConflictError("Не удалось создать superadmin из-за конкурентной записи")
    action = decide_bootstrap(
        target_role=target.role,
        another_superadmin_exists=target.role is not PlatformRole.superadmin,
    )
    return BootstrapResult(
        action=action,
        email=str(target.email),
        status=target.status,
        email_verified=target.email_verified,
    )


async def run_bootstrap(*, email: str, password_hash: str) -> BootstrapResult:
    """Запустить bootstrap через административную сессию с platform RLS scope."""

    from app.db.session import AdminSession, set_rls_context

    async with AdminSession() as session:
        async with session.begin():
            await set_rls_context(session, None, platform_scope=True)
            return await create_first_superadmin(
                session,
                email=email,
                password_hash=password_hash,
            )


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Первоначальное безопасное создание superadmin TrimmyCRM",
    )
    parser.add_argument("email", metavar="EMAIL", help="email первого superadmin")
    parser.add_argument(
        "--password-stdin",
        action="store_true",
        help="прочитать пароль одной строкой из stdin вместо защищённого запроса",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        email = normalize_email(args.email)
        settings = get_settings()
        password = read_password(password_stdin=args.password_stdin)
        password_hash = PasswordService.from_settings(settings).hash(password, email=email)
        result = asyncio.run(run_bootstrap(email=email, password_hash=password_hash))
    except PasswordPolicyError as exc:
        print("Пароль не соответствует политике:", file=sys.stderr)
        for violation in exc.violations:
            print(f"- {violation}", file=sys.stderr)
        return 2
    except BootstrapInputError as exc:
        print(f"Ошибка ввода: {exc}", file=sys.stderr)
        return 2
    except BootstrapConflictError as exc:
        print(f"Bootstrap отклонён: {exc}", file=sys.stderr)
        return 1

    if result.action is BootstrapAction.created:
        print(f"Superadmin {result.email} создан и активирован.")
    else:
        details = f"status={result.status.value}, email_verified={result.email_verified}"
        print(f"Superadmin {result.email} уже существует ({details}); изменений нет.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
