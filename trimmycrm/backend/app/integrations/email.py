"""Интерфейс доставки электронной почты и SMTP-адаптер."""

from __future__ import annotations

import asyncio
import smtplib
import ssl
from collections.abc import Mapping
from dataclasses import dataclass, field
from email.message import EmailMessage as MIMEMessage
from email.utils import formataddr, make_msgid
from typing import Protocol

from app.core.config import Settings


class EmailDeliveryError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class Email:
    to: tuple[str, ...]
    subject: str
    text: str
    html: str | None = None
    reply_to: str | None = None
    from_name: str | None = None
    headers: Mapping[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.to:
            raise ValueError("at least one recipient is required")
        header_values = (
            *self.to,
            self.subject,
            self.reply_to or "",
            self.from_name or "",
            *self.headers.keys(),
            *self.headers.values(),
        )
        for value in header_values:
            if not isinstance(value, str):
                raise TypeError("email header values must be strings")
            if "\r" in value or "\n" in value:
                raise ValueError("email headers must not contain line breaks")


@dataclass(frozen=True, slots=True)
class EmailDelivery:
    message_id: str
    accepted_recipients: tuple[str, ...]


class EmailSender(Protocol):
    async def send(self, message: Email) -> EmailDelivery: ...


class SMTPEmailSender:
    def __init__(
        self,
        *,
        host: str,
        port: int,
        from_email: str,
        from_name: str = "TrimmyCRM",
        username: str | None = None,
        password: str | None = None,
        starttls: bool = True,
        use_ssl: bool = False,
        timeout_seconds: float = 10.0,
    ) -> None:
        if not host:
            raise ValueError("SMTP host is required")
        if starttls and use_ssl:
            raise ValueError("choose implicit SSL or STARTTLS, not both")
        if username and password is None:
            raise ValueError("SMTP password is required with username")
        self.host = host
        self.port = port
        self.from_email = from_email
        self.from_name = from_name
        self.username = username
        self.password = password
        self.starttls = starttls
        self.use_ssl = use_ssl
        self.timeout = timeout_seconds

    @classmethod
    def from_settings(cls, settings: Settings) -> SMTPEmailSender:
        if not settings.smtp_host:
            raise ValueError("SMTP is not configured")
        return cls(
            host=settings.smtp_host,
            port=settings.smtp_port,
            from_email=settings.smtp_from_email,
            from_name=settings.smtp_from_name,
            username=settings.smtp_username,
            password=(
                settings.smtp_password.get_secret_value() if settings.smtp_password else None
            ),
            starttls=settings.smtp_starttls,
            use_ssl=settings.smtp_use_ssl,
            timeout_seconds=settings.smtp_timeout_seconds,
        )

    async def send(self, message: Email) -> EmailDelivery:
        mime = self._build_message(message)
        try:
            await asyncio.to_thread(self._send_sync, mime)
        except (OSError, smtplib.SMTPException) as exc:
            raise EmailDeliveryError("SMTP delivery failed") from exc
        return EmailDelivery(
            message_id=str(mime["Message-ID"]),
            accepted_recipients=message.to,
        )

    def _build_message(self, message: Email) -> MIMEMessage:
        mime = MIMEMessage()
        mime["From"] = formataddr((message.from_name or self.from_name, self.from_email))
        mime["To"] = ", ".join(message.to)
        mime["Subject"] = message.subject
        mime["Message-ID"] = make_msgid(domain=self.from_email.partition("@")[2] or None)
        if message.reply_to:
            mime["Reply-To"] = message.reply_to
        for key, value in message.headers.items():
            if key.casefold() in {"from", "to", "subject", "message-id", "bcc", "cc"}:
                raise ValueError(f"reserved email header: {key}")
            mime[key] = value
        mime.set_content(message.text)
        if message.html is not None:
            mime.add_alternative(message.html, subtype="html")
        return mime

    def _send_sync(self, message: MIMEMessage) -> None:
        context = ssl.create_default_context()
        if self.use_ssl:
            with smtplib.SMTP_SSL(
                host=self.host,
                port=self.port,
                timeout=self.timeout,
                context=context,
            ) as connection:
                self._deliver(connection, message, context)
        else:
            with smtplib.SMTP(
                host=self.host,
                port=self.port,
                timeout=self.timeout,
            ) as connection:
                self._deliver(connection, message, context)

    def _deliver(
        self,
        connection: smtplib.SMTP,
        message: MIMEMessage,
        context: ssl.SSLContext,
    ) -> None:
        connection.ehlo()
        if self.starttls:
            connection.starttls(context=context)
            connection.ehlo()
        if self.username:
            connection.login(self.username, self.password or "")
        connection.send_message(message)


class InMemoryEmailSender:
    """Тестовый адаптер, который нужно явно выбрать при сборке приложения."""

    def __init__(self) -> None:
        self.messages: list[Email] = []

    async def send(self, message: Email) -> EmailDelivery:
        self.messages.append(message)
        return EmailDelivery(message_id=make_msgid(), accepted_recipients=message.to)
