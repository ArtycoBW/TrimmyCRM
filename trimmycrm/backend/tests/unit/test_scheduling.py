from datetime import date, datetime
from zoneinfo import ZoneInfo

from app.services.scheduling import TimeRange, generate_slots


def test_slots_respect_duration_and_existing_appointment() -> None:
    timezone = "Europe/Moscow"
    tz = ZoneInfo(timezone)
    schedule = {"monday": [{"start": "09:00", "end": "12:00"}]}
    occupied = TimeRange(
        datetime(2026, 7, 20, 10, 0, tzinfo=tz), datetime(2026, 7, 20, 11, 0, tzinfo=tz)
    )
    slots = generate_slots(
        day=date(2026, 7, 20),
        timezone=timezone,
        salon_schedule=schedule,
        staff_schedule=schedule,
        duration_min=60,
        step_min=60,
        appointments=[occupied],
        now=datetime(2026, 7, 19, tzinfo=tz),
    )
    assert [(item.starts_at.hour, available) for item, available in slots] == [
        (9, True),
        (10, False),
        (11, True),
    ]
