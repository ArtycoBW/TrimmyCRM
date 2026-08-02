"use client";

import {
  weekdays,
  type ScheduleRange,
  type WeeklySchedule,
} from "@/lib/app/catalog";

function replaceRange(
  schedule: WeeklySchedule,
  day: string,
  index: number,
  patch: Partial<ScheduleRange>,
) {
  return {
    ...schedule,
    [day]: (schedule[day] || []).map((range, current) =>
      current === index ? { ...range, ...patch } : range
    ),
  };
}

function nextRange(ranges: ScheduleRange[]): ScheduleRange {
  const lastEnd = ranges.at(-1)?.end;
  if (!lastEnd) return { start: "09:00", end: "18:00" };
  const [hour, minute] = lastEnd.split(":").map(Number);
  const startMinutes = hour * 60 + minute;
  if (startMinutes >= 23 * 60 + 59) return { start: "22:00", end: "23:00" };
  const endMinutes = Math.min(startMinutes + 60, 23 * 60 + 59);
  const clock = (value: number) =>
    String(Math.floor(value / 60)).padStart(2, "0") + ":" + String(value % 60).padStart(2, "0");
  return { start: lastEnd, end: clock(endMinutes) };
}

export function WeeklyScheduleEditor({
  schedule,
  onChange,
}: {
  schedule: WeeklySchedule;
  onChange: (schedule: WeeklySchedule) => void;
}) {
  function copyWeekdays() {
    const monday = (schedule.monday || []).map((range) => ({ ...range }));
    onChange({
      ...schedule,
      tuesday: monday.map((range) => ({ ...range })),
      wednesday: monday.map((range) => ({ ...range })),
      thursday: monday.map((range) => ({ ...range })),
      friday: monday.map((range) => ({ ...range })),
    });
  }

  return (
    <section className="weekly-editor">
      <header>
        <div>
          <p className="crm-kicker">Персональные смены</p>
          <p>До 8 непересекающихся интервалов на день.</p>
        </div>
        <button type="button" onClick={copyWeekdays} disabled={!schedule.monday?.length}>
          Пн → будни
        </button>
      </header>

      <div className="weekly-editor__days">
        {weekdays.map((day) => {
          const ranges = schedule[day.key] || [];
          return (
            <section className="weekly-day" key={day.key}>
              <header>
                <span>{day.short}</span>
                <strong>{day.label}</strong>
                <button
                  type="button"
                  disabled={ranges.length >= 8}
                  onClick={() => onChange({
                    ...schedule,
                    [day.key]: [...ranges, nextRange(ranges)],
                  })}
                  aria-label={"Добавить интервал: " + day.label}
                >
                  +
                </button>
              </header>

              {ranges.length ? (
                <div>
                  {ranges.map((range, index) => (
                    <div className="weekly-range" key={index}>
                      <label>
                        <span className="sr-only">{day.label}, начало интервала {index + 1}</span>
                        <input
                          type="time"
                          value={range.start}
                          onChange={(event) => onChange(replaceRange(schedule, day.key, index, { start: event.target.value }))}
                        />
                      </label>
                      <i>—</i>
                      <label>
                        <span className="sr-only">{day.label}, конец интервала {index + 1}</span>
                        <input
                          type="time"
                          value={range.end}
                          onChange={(event) => onChange(replaceRange(schedule, day.key, index, { end: event.target.value }))}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => onChange({
                          ...schedule,
                          [day.key]: ranges.filter((_, current) => current !== index),
                        })}
                        aria-label={"Удалить интервал " + (index + 1) + ": " + day.label}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p>Как у салона</p>
              )}
            </section>
          );
        })}
      </div>
    </section>
  );
}
