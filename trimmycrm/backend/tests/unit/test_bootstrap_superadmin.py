from __future__ import annotations

from io import StringIO

import pytest

from app.bootstrap_superadmin import (
    BootstrapAction,
    BootstrapConflictError,
    BootstrapInputError,
    decide_bootstrap,
    normalize_email,
    read_password,
)
from app.core.security import PasswordPolicyError, PasswordService
from app.models import PlatformRole


def test_normalize_email_uses_registration_normalization() -> None:
    assert normalize_email("  Admin@EXAMPLE.COM  ") == "admin@example.com"


def test_normalize_email_rejects_invalid_value() -> None:
    with pytest.raises(BootstrapInputError, match="корректный email"):
        normalize_email("not-an-email")


def test_decide_bootstrap_creates_only_when_platform_has_no_superadmin() -> None:
    assert (
        decide_bootstrap(target_role=None, another_superadmin_exists=False)
        is BootstrapAction.created
    )


def test_decide_bootstrap_is_idempotent_for_existing_superadmin() -> None:
    assert (
        decide_bootstrap(
            target_role=PlatformRole.superadmin,
            another_superadmin_exists=True,
        )
        is BootstrapAction.already_exists
    )


@pytest.mark.parametrize("role", [PlatformRole.owner, PlatformRole.staff])
def test_decide_bootstrap_never_promotes_existing_platform_user(role: PlatformRole) -> None:
    with pytest.raises(BootstrapConflictError, match=role.value):
        decide_bootstrap(target_role=role, another_superadmin_exists=False)


def test_decide_bootstrap_rejects_second_superadmin_email() -> None:
    with pytest.raises(BootstrapConflictError, match="под другим email"):
        decide_bootstrap(target_role=None, another_superadmin_exists=True)


def test_read_password_from_stdin_removes_only_line_ending() -> None:
    assert (
        read_password(password_stdin=True, stdin=StringIO(" StrongPass!42 \r\n"))
        == " StrongPass!42 "
    )


def test_read_password_from_stdin_rejects_terminal_to_avoid_echo() -> None:
    class TerminalInput(StringIO):
        def isatty(self) -> bool:
            return True

    with pytest.raises(BootstrapInputError, match="защищённом интерактивном режиме"):
        read_password(password_stdin=True, stdin=TerminalInput("StrongPass!42\n"))


def test_read_password_interactively_requires_confirmation() -> None:
    answers = iter(("StrongPass!42", "different"))

    with pytest.raises(BootstrapInputError, match="не совпадают"):
        read_password(
            password_stdin=False,
            getpass_fn=lambda _prompt: next(answers),
        )


def test_bootstrap_uses_application_password_policy() -> None:
    passwords = PasswordService()

    with pytest.raises(PasswordPolicyError):
        passwords.hash("weak-password", email="admin@example.com")

    password_hash = passwords.hash("StrongPass!42", email="admin@example.com")
    assert passwords.verify(password_hash, "StrongPass!42")
