"use client";

import type { CSSProperties } from "react";

import type { AppointmentView, StaffView } from "@/lib/api/types";
import { appointmentServiceLabel, calendarEventLanes, calendarPosition } from "@/lib/app/calendar";
import {
  appointmentStatuses,
  formatMoney,
  formatSalonTime,
  salonDayKey,
} from "@/lib/app/dashboard";

const startHour = 8;
const endHour = 21;
const hours = Array.from({ length: endHour - startHour + 1 }, (_, index) => startHour + index);

function dayDate(dateKey: string) {
  return new Date(dateKey + "T12:00:00Z");
}

function dayLabel(dateKey: string, format: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("ru-RU", { ...format, timeZone: "UTC" }).format(dayDate(dateKey));
}

export function CalendarGrid({
  appointments,
  days,
  timezone,
  staff,
  onSelect,
}: {
  appointments: AppointmentView[];
  days: string[];
  timezone: string;
  staff: StaffView[];
  onSelect: (appointment: AppointmentView) => void;
}) {
  const today = salonDayKey(new Date(), timezone);
  const staffColors = new Map(staff.map((item, index) => [item.id, index % 5]));

  return (
    <section className="schedule-calendar">
      <div className="calendar-desktop">
        <header className="calendar-header">
          <span>Время</span>
          {days.map((day) => (
            <div className={day === today ? "is-today" : ""} key={day}>
              <small>{dayLabel(day, { weekday: "short" })}</small>
              <strong>{dayLabel(day, { day: "2-digit" })}</strong>
            </div>
          ))}
        </header>
        <div className="calendar-body">
          <div className="calendar-hours" aria-hidden="true">
            {hours.map((hour) => <span key={hour}>{String(hour).padStart(2, "0")}:00</span>)}
          </div>
          <div className="calendar-days">
            {days.map((day) => {
              const values = appointments.filter(
                (appointment) => salonDayKey(appointment.startAt, timezone) === day,
              );
              return (
                <div className={"calendar-day" + (day === today ? " is-today" : "")} key={day}>
                  {calendarEventLanes(values, timezone).map(({ appointment, lane, lanes }, index) => {
                    const position = calendarPosition(appointment, timezone, startHour, endHour);
                    const serviceLabel = appointmentServiceLabel(appointment);
                    const tone = appointment.status === "cancelled"
                      ? "cancelled"
                      : "staff-" + (staffColors.get(appointment.staffId || "") ?? index % 5);
                    const laneWidth = 92 / lanes;
                    const style = {
                      top: position.topPercent + "%",
                      height: position.heightPercent + "%",
                      left: 4 + lane * laneWidth + "%",
                      width: Math.max(0, laneWidth - 1.5) + "%",
                    } satisfies CSSProperties;
                    return (
                      <button
                        className={"calendar-event calendar-event--" + tone}
                        type="button"
                        style={style}
                        onClick={() => onSelect(appointment)}
                        aria-label={
                          formatSalonTime(appointment.startAt, timezone) + ", " +
                          (appointment.clientName || "клиент") + ", " +
                          serviceLabel
                        }
                        key={appointment.id}
                        data-calendar-lane={lane}
                        data-calendar-lanes={lanes}
                      >
                        <time>{formatSalonTime(appointment.startAt, timezone)}</time>
                        <strong>{appointment.clientName || "Клиент"}</strong>
                        <span>{serviceLabel}</span>
                        <small>{appointment.staffName || "Без мастера"}</small>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="calendar-agenda">
        {days.map((day) => {
          const values = appointments
            .filter((appointment) => salonDayKey(appointment.startAt, timezone) === day)
            .sort((left, right) => left.startAt.localeCompare(right.startAt));
          return (
            <section className={"agenda-day" + (day === today ? " is-today" : "")} key={day}>
              <header>
                <span>{dayLabel(day, { weekday: "long" })}</span>
                <strong>{dayLabel(day, { day: "numeric", month: "long" })}</strong>
                {day === today && <i>сегодня</i>}
              </header>
              {values.length ? (
                <div>
                  {values.map((appointment) => {
                    const status = appointmentStatuses[appointment.status];
                    const serviceLabel = appointmentServiceLabel(appointment);
                    return (
                      <button type="button" className="agenda-event" onClick={() => onSelect(appointment)} key={appointment.id}>
                        <time>
                          {formatSalonTime(appointment.startAt, timezone)}
                          <small>{formatSalonTime(appointment.endAt, timezone)}</small>
                        </time>
                        <span aria-hidden="true">{(appointment.clientName || "К")[0]?.toUpperCase()}</span>
                        <p>
                          <strong>{appointment.clientName || "Клиент"}</strong>
                          <small>{serviceLabel}</small>
                        </p>
                        <em>{formatMoney(appointment.price)}</em>
                        <i className={"crm-status crm-status--" + status.tone}>{status.label}</i>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="agenda-day__empty">Свободный день</p>
              )}
            </section>
          );
        })}
      </div>
    </section>
  );
}
