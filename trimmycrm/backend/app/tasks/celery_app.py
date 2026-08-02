"""Приложение Celery, общее для обработчиков и планировщика.

Обработчик намеренно использует только сообщения JSON. События задач и расширенные
результаты отключены, потому что задачи с письмами аутентификации неизбежно передают
короткоживущий токен в данных брокера; эти значения нельзя копировать в журналы,
события мониторинга или хранилище результатов.
"""

from __future__ import annotations

from celery import Celery  # type: ignore[import-untyped]
from celery.schedules import crontab  # type: ignore[import-untyped]

from app.core.config import get_settings

settings = get_settings()

celery_app = Celery(
    "trimmycrm",
    broker=settings.celery_broker_url.get_secret_value(),
    backend=settings.celery_result_backend.get_secret_value(),
    include=("app.tasks.jobs",),
)

celery_app.conf.update(
    accept_content=("json",),
    task_serializer="json",
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_protocol=2,
    broker_connection_retry_on_startup=True,
    broker_transport_options={"visibility_timeout": 60 * 60},
    result_expires=60 * 60,
    result_extended=False,
    task_send_sent_event=False,
    worker_send_task_events=False,
    task_track_started=False,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    task_default_queue="trimmycrm",
    beat_schedule={
        "dispatch-due-notifications": {
            "task": "app.tasks.dispatch_queued_notifications",
            "schedule": 15.0,
            "options": {"expires": 14},
        },
        "schedule-appointment-reminders": {
            "task": "app.tasks.schedule_appointment_reminders",
            "schedule": crontab(minute="*/5"),
            "options": {"expires": 4 * 60},
        },
        "subscription-renewal-and-dunning": {
            "task": "app.tasks.process_subscription_lifecycle",
            "schedule": crontab(hour=2, minute=15),
            "options": {"expires": 6 * 60 * 60},
        },
        "cleanup-expired-security-records": {
            "task": "app.tasks.cleanup_expired_records",
            "schedule": crontab(hour=3, minute=30),
            "options": {"expires": 6 * 60 * 60},
        },
        "worker-health-ping": {
            "task": "app.tasks.health_ping",
            "schedule": crontab(minute="*/5"),
            "options": {"expires": 4 * 60},
        },
    },
)


__all__ = ["celery_app"]
