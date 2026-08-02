from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

WEEKDAY_NAMES = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")


@dataclass(frozen=True, slots=True)
class TimeRange:
    starts_at: datetime
    ends_at: datetime

    def overlaps(self, other: TimeRange) -> bool:
        return self.starts_at < other.ends_at and other.starts_at < self.ends_at


@dataclass(frozen=True, slots=True)
class ScheduleExceptionValue:
    starts_at: datetime
    ends_at: datetime
    kind: str


class ScheduleError(ValueError):
    pass


def parse_timezone(value: str) -> ZoneInfo:
    try:
        return ZoneInfo(value)
    except ZoneInfoNotFoundError as exc:
        raise ScheduleError("Неизвестный часовой пояс") from exc


def _parse_clock(value: str) -> time:
    try:
        parsed = time.fromisoformat(value)
    except ValueError as exc:
        raise ScheduleError(f"Некорректное время графика: {value}") from exc
    if parsed.tzinfo is not None:
        raise ScheduleError("В графике нужно указывать локальное время без timezone")
    return parsed.replace(second=0, microsecond=0)


def working_ranges_for_date(schedule: dict[str, Any], day: date, tz: ZoneInfo) -> list[TimeRange]:
    raw_ranges = schedule.get(WEEKDAY_NAMES[day.weekday()], [])
    if isinstance(raw_ranges, dict):
        raw_ranges = [raw_ranges]
    result: list[TimeRange] = []
    for value in raw_ranges:
        if not isinstance(value, dict) or "start" not in value or "end" not in value:
            raise ScheduleError("График должен содержать массив {start, end}")
        starts_at = datetime.combine(day, _parse_clock(str(value["start"])), tzinfo=tz)
        ends_at = datetime.combine(day, _parse_clock(str(value["end"])), tzinfo=tz)
        if ends_at <= starts_at:
            raise ScheduleError("Окончание смены должно быть позже начала")
        result.append(TimeRange(starts_at, ends_at))
    return result


def validate_schedule(schedule: dict[str, Any]) -> dict[str, Any]:
    """Проверить сохранённый недельный график до генерации слотов."""

    unknown = set(schedule) - set(WEEKDAY_NAMES)
    if unknown:
        raise ScheduleError(
            "Неизвестные дни графика: " + ", ".join(sorted(str(value) for value in unknown))
        )
    # 20 июля 2026 года — понедельник; фиксированная неделя охватывает все дни.
    monday = date(2026, 7, 20)
    tz = ZoneInfo("UTC")
    for offset, name in enumerate(WEEKDAY_NAMES):
        raw = schedule.get(name, [])
        values = [raw] if isinstance(raw, dict) else raw
        if not isinstance(values, list) or len(values) > 8:
            raise ScheduleError("На один день допускается не более 8 интервалов")
        ranges = sorted(
            working_ranges_for_date(schedule, monday + timedelta(days=offset), tz),
            key=lambda item: item.starts_at,
        )
        for previous, current in zip(ranges, ranges[1:], strict=False):
            if previous.ends_at > current.starts_at:
                raise ScheduleError("Интервалы графика не должны пересекаться")
    return schedule


def generate_slots(
    *,
    day: date,
    timezone: str,
    salon_schedule: dict[str, Any],
    staff_schedule: dict[str, Any],
    duration_min: int,
    buffer_before_min: int = 0,
    buffer_after_min: int = 0,
    step_min: int = 15,
    appointments: Iterable[TimeRange] = (),
    exceptions: Iterable[ScheduleExceptionValue] = (),
    now: datetime | None = None,
    include_unavailable: bool = True,
) -> list[tuple[TimeRange, bool]]:
    if duration_min <= 0 or step_min <= 0:
        raise ScheduleError("Продолжительность и шаг слота должны быть положительными")
    tz = parse_timezone(timezone)
    current = (now or datetime.now(tz)).astimezone(tz)
    salon_ranges = working_ranges_for_date(salon_schedule, day, tz)
    staff_ranges = working_ranges_for_date(staff_schedule, day, tz)
    if not staff_ranges:
        staff_ranges = salon_ranges

    intersections: list[TimeRange] = []
    for salon in salon_ranges:
        for staff in staff_ranges:
            starts_at = max(salon.starts_at, staff.starts_at)
            ends_at = min(salon.ends_at, staff.ends_at)
            if starts_at < ends_at:
                intersections.append(TimeRange(starts_at, ends_at))

    blocking = list(appointments)
    working_overrides: list[TimeRange] = []
    for exception in exceptions:
        value = TimeRange(exception.starts_at.astimezone(tz), exception.ends_at.astimezone(tz))
        if exception.kind == "working":
            working_overrides.append(value)
        else:
            blocking.append(value)
    intersections.extend(working_overrides)

    occupied_duration = timedelta(minutes=buffer_before_min + duration_min + buffer_after_min)
    public_duration = timedelta(minutes=duration_min)
    step = timedelta(minutes=step_min)
    result: list[tuple[TimeRange, bool]] = []
    for working in sorted(intersections, key=lambda item: item.starts_at):
        cursor = working.starts_at
        while cursor + occupied_duration <= working.ends_at:
            occupied = TimeRange(cursor, cursor + occupied_duration)
            public = TimeRange(
                cursor + timedelta(minutes=buffer_before_min),
                cursor + timedelta(minutes=buffer_before_min) + public_duration,
            )
            available = public.starts_at > current and not any(
                occupied.overlaps(item) for item in blocking
            )
            if include_unavailable or available:
                result.append((public, available))
            cursor += step
    deduplicated: dict[datetime, tuple[TimeRange, bool]] = {}
    for slot in result:
        prior = deduplicated.get(slot[0].starts_at)
        deduplicated[slot[0].starts_at] = slot if prior is None else (slot[0], prior[1] and slot[1])
    return [deduplicated[key] for key in sorted(deduplicated)]


def assert_slot_matches(
    requested_start: datetime, available_slots: Iterable[tuple[TimeRange, bool]]
) -> TimeRange:
    if requested_start.tzinfo is None:
        raise ScheduleError("startAt должен содержать timezone")
    for slot, available in available_slots:
        if slot.starts_at == requested_start and available:
            return slot
    raise ScheduleError("Выбранный слот недоступен")
