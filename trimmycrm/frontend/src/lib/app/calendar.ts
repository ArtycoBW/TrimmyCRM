import type { AppointmentView } from "@/lib/api/types";
import { salonDayKey } from "@/lib/app/dashboard";

export type AppointmentStatus = AppointmentView["status"];

export const statusTransitions: Record<AppointmentStatus, AppointmentStatus[]> = {
  new: ["confirmed", "cancelled"],
  confirmed: ["completed", "cancelled", "no_show"],
  completed: [],
  cancelled: [],
  no_show: [],
};

export function addDays(dateKey: string, amount: number) {
  const date = new Date(dateKey + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function startOfWeekKey(dateKey: string) {
  const day = new Date(dateKey + "T00:00:00Z").getUTCDay();
  return addDays(dateKey, -(day === 0 ? 6 : day - 1));
}

export function currentWeekKey(timezone: string, now = new Date()) {
  return startOfWeekKey(salonDayKey(now, timezone));
}

export function weekDateKeys(start: string) {
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

function zonedParts(value: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZone: timezone,
  }).formatToParts(value);
  return Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
}

export function zonedDateTimeToIso(dateKey: string, time: string, timezone: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = target;

  for (let iteration = 0; iteration < 3; iteration += 1) {
    const parts = zonedParts(new Date(guess), timezone);
    const represented = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const correction = target - represented;
    guess += correction;
    if (correction === 0) break;
  }

  return new Date(guess).toISOString();
}

export function weekQueryRange(start: string, timezone: string) {
  return {
    from: zonedDateTimeToIso(start, "00:00", timezone),
    to: zonedDateTimeToIso(addDays(start, 7), "00:00", timezone),
  };
}

export function appointmentLocalMinutes(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: timezone,
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
  return values.hour * 60 + values.minute;
}

export function calendarPosition(
  appointment: Pick<AppointmentView, "startAt" | "endAt">,
  timezone: string,
  startHour = 8,
  endHour = 21,
) {
  const range = (endHour - startHour) * 60;
  const starts = appointmentLocalMinutes(appointment.startAt, timezone) - startHour * 60;
  const ends = appointmentLocalMinutes(appointment.endAt, timezone) - startHour * 60;
  const top = Math.max(0, Math.min(range - 24, starts));
  const bottom = Math.max(top + 24, Math.min(range, ends));
  return {
    topPercent: (top / range) * 100,
    heightPercent: Math.max(3.2, ((bottom - top) / range) * 100),
  };
}

type CalendarEvent = Pick<AppointmentView, "startAt" | "endAt">;

export type CalendarEventLane<T extends CalendarEvent> = {
  appointment: T;
  lane: number;
  lanes: number;
};

/**
 * Assigns a stable lane to each intersecting calendar event.
 *
 * A small offset per card is not enough when visits have the same time: the
 * cards still cover each other.  This is the usual interval-partitioning
 * algorithm used by week calendars.  Events that merely touch at their
 * boundaries (10:00–11:00 and 11:00–12:00) reuse the same lane.
 */
export function calendarEventLanes<T extends CalendarEvent>(
  appointments: T[],
  timezone: string,
): CalendarEventLane<T>[] {
  const values = appointments
    .map((appointment, order) => ({
      appointment,
      order,
      start: appointmentLocalMinutes(appointment.startAt, timezone),
      end: Math.max(
        appointmentLocalMinutes(appointment.endAt, timezone),
        appointmentLocalMinutes(appointment.startAt, timezone) + 1,
      ),
    }))
    .sort((left, right) => left.start - right.start || left.end - right.end || left.order - right.order);

  const laidOut: Array<CalendarEventLane<T> & { order: number }> = [];
  let cluster: typeof values = [];
  let clusterEnd = Number.NEGATIVE_INFINITY;

  const finishCluster = () => {
    if (!cluster.length) return;
    const laneEnds: number[] = [];
    const entries = cluster.map((entry) => {
      let lane = laneEnds.findIndex((end) => end <= entry.start);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = entry.end;
      return { ...entry, lane };
    });
    const lanes = laneEnds.length;
    laidOut.push(...entries.map((entry) => ({
      appointment: entry.appointment,
      lane: entry.lane,
      lanes,
      order: entry.order,
    })));
    cluster = [];
    clusterEnd = Number.NEGATIVE_INFINITY;
  };

  for (const entry of values) {
    if (cluster.length && entry.start >= clusterEnd) finishCluster();
    cluster.push(entry);
    clusterEnd = Math.max(clusterEnd, entry.end);
  }
  finishCluster();

  return laidOut.sort((left, right) => left.order - right.order);
}
