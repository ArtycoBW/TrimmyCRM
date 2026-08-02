"""Адаптеры уведомлений SMS и Telegram и диспетчер каналов."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Protocol

import httpx

from app.core.config import Settings
from app.integrations.email import Email, EmailDelivery, EmailSender

_PHONE_RE = re.compile(r"^\+?[1-9][0-9]{7,14}$")
_CHAT_ID_RE = re.compile(r"^-?[0-9]{1,32}$")


class NotificationDeliveryError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class SMS:
    phone: str
    text: str

    def __post_init__(self) -> None:
        normalized = self.phone.replace(" ", "").replace("-", "").replace("(", "").replace(")", "")
        if not _PHONE_RE.fullmatch(normalized):
            raise ValueError("invalid phone number")
        if not self.text or len(self.text) > 1000:
            raise ValueError("SMS text must contain 1..1000 characters")
        object.__setattr__(self, "phone", normalized)


@dataclass(frozen=True, slots=True)
class SMSDelivery:
    provider_id: str
    segments: int | None = None


class SMSSender(Protocol):
    async def send(self, message: SMS) -> SMSDelivery: ...


class SMSCClient:
    """Адаптер JSON API сервиса SMSC.ru."""

    def __init__(
        self,
        *,
        login: str,
        password: str,
        sender: str | None = None,
        api_url: str = "https://smsc.ru/sys/send.php",
        timeout_seconds: float = 10.0,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        if not login or not password:
            raise ValueError("SMSC credentials are required")
        self.login = login
        self.password = password
        self.sender = sender
        self.api_url = api_url
        self._owns_client = client is None
        self._client = client or httpx.AsyncClient(
            timeout=httpx.Timeout(timeout_seconds), follow_redirects=False
        )

    async def send(self, message: SMS) -> SMSDelivery:
        data = {
            "login": self.login,
            "psw": self.password,
            "phones": message.phone,
            "mes": message.text,
            "fmt": "3",
            "charset": "utf-8",
        }
        if self.sender:
            data["sender"] = self.sender
        try:
            response = await self._client.post(self.api_url, data=data)
            response.raise_for_status()
            payload = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise NotificationDeliveryError("SMS provider request failed") from exc
        if not isinstance(payload, dict) or payload.get("error"):
            raise NotificationDeliveryError("SMS provider rejected the message")
        provider_id = payload.get("id")
        if provider_id is None:
            raise NotificationDeliveryError("SMS provider returned an invalid response")
        count = payload.get("cnt")
        return SMSDelivery(
            provider_id=str(provider_id),
            segments=int(count) if isinstance(count, (int, str)) and str(count).isdigit() else None,
        )

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()


@dataclass(frozen=True, slots=True)
class TelegramMessage:
    chat_id: str
    text: str
    parse_mode: str | None = None

    def __post_init__(self) -> None:
        if not _CHAT_ID_RE.fullmatch(self.chat_id):
            raise ValueError("invalid Telegram chat ID")
        if not self.text or len(self.text) > 4096:
            raise ValueError("Telegram text must contain 1..4096 characters")
        if self.parse_mode not in {None, "HTML", "MarkdownV2"}:
            raise ValueError("unsupported Telegram parse mode")


@dataclass(frozen=True, slots=True)
class TelegramDelivery:
    message_id: int
    chat_id: str


class TelegramSender(Protocol):
    async def send(self, message: TelegramMessage) -> TelegramDelivery: ...


class TelegramBotClient:
    def __init__(
        self,
        *,
        bot_token: str,
        api_url: str = "https://api.telegram.org",
        timeout_seconds: float = 10.0,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        if not bot_token or any(char.isspace() for char in bot_token):
            raise ValueError("Telegram bot token is required")
        # Токен входит в путь API Telegram. Нельзя журналировать этот URL или
        # необработанный текст исключения httpx.
        self._send_url = f"{api_url.rstrip('/')}/bot{bot_token}/sendMessage"
        self._owns_client = client is None
        self._client = client or httpx.AsyncClient(
            timeout=httpx.Timeout(timeout_seconds), follow_redirects=False
        )

    async def send(self, message: TelegramMessage) -> TelegramDelivery:
        body: dict[str, object] = {
            "chat_id": message.chat_id,
            "text": message.text,
            "disable_web_page_preview": True,
        }
        if message.parse_mode:
            body["parse_mode"] = message.parse_mode
        try:
            response = await self._client.post(self._send_url, json=body)
            response.raise_for_status()
            payload = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            # Строка исключения httpx содержит URL запроса, а Telegram включает
            # в него токен бота. Нельзя сохранять такое исключение как причину.
            del exc
            raise NotificationDeliveryError("Telegram delivery failed") from None
        if not isinstance(payload, dict) or payload.get("ok") is not True:
            raise NotificationDeliveryError("Telegram rejected the message")
        result = payload.get("result")
        if not isinstance(result, dict) or not isinstance(result.get("message_id"), int):
            raise NotificationDeliveryError("Telegram returned an invalid response")
        chat = result.get("chat")
        returned_chat_id = str(chat.get("id")) if isinstance(chat, dict) else message.chat_id
        return TelegramDelivery(
            message_id=int(result["message_id"]),
            chat_id=returned_chat_id,
        )

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()


class NotificationDispatcher:
    """Тонкий фасад каналов для задач Celery и сервисов приложения."""

    def __init__(
        self,
        *,
        email: EmailSender | None = None,
        sms: SMSSender | None = None,
        telegram: TelegramSender | None = None,
    ) -> None:
        self.email = email
        self.sms = sms
        self.telegram = telegram

    async def send_email(self, message: Email) -> EmailDelivery:
        if self.email is None:
            raise NotificationDeliveryError("email channel is not configured")
        return await self.email.send(message)

    async def send_sms(self, message: SMS) -> SMSDelivery:
        if self.sms is None:
            raise NotificationDeliveryError("SMS channel is not configured")
        return await self.sms.send(message)

    async def send_telegram(self, message: TelegramMessage) -> TelegramDelivery:
        if self.telegram is None:
            raise NotificationDeliveryError("Telegram channel is not configured")
        return await self.telegram.send(message)


def build_sms_sender(settings: Settings) -> SMSSender | None:
    if not settings.smsc_login or not settings.smsc_password:
        return None
    return SMSCClient(
        login=settings.smsc_login,
        password=settings.smsc_password.get_secret_value(),
        sender=settings.smsc_sender,
        api_url=str(settings.smsc_api_url),
        timeout_seconds=settings.notification_timeout_seconds,
    )


def build_telegram_sender(settings: Settings) -> TelegramSender | None:
    if not settings.telegram_bot_token:
        return None
    return TelegramBotClient(
        bot_token=settings.telegram_bot_token.get_secret_value(),
        api_url=str(settings.telegram_api_url),
        timeout_seconds=settings.notification_timeout_seconds,
    )
