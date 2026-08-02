"use client";

import Link from "next/link";
import type { Route } from "next";
import { Maximize2, Minimize2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { AppointmentDrawer } from "@/components/app/appointment-drawer";
import { AppointmentForm } from "@/components/app/appointment-form";
import { CalendarGrid } from "@/components/app/calendar-grid";
import { useApp } from "@/components/app/app-provider";
import { AppIcon } from "@/components/app/app-icon";
import { AppSelect } from "@/components/ui/select";
import { apiRequest } from "@/lib/api/client";
import type {
  AppointmentView,
  ClientView,
  Paginated,
  ServiceView,
  StaffView,
} from "@/lib/api/types";
import {
  addDays,
  currentWeekKey,
  statusTransitions,
  weekDateKeys,
  weekQueryRange,
} from "@/lib/app/calendar";
import { appointmentStatuses, formatMoney, formatSalonTime, formatSalonTimezone, salonDayKey } from "@/lib/app/dashboard";

export type ScheduleData = {
  appointments: AppointmentView[];
  clients: ClientView[];
  services: ServiceView[];
  staff: StaffView[];
};

type ScheduleState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: ScheduleData };

function dateLabel(dateKey: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("ru-RU", { ...options, timeZone: "UTC" })
    .format(new Date(dateKey + "T12:00:00Z"));
}

function ScheduleLoading() {
  return (
    <div className="schedule-page schedule-page--loading" aria-busy="true">
      <div className="crm-skeleton crm-skeleton--title" />
      <div className="schedule-loading__toolbar crm-skeleton" />
      <div className="schedule-loading__grid crm-skeleton" />
    </div>
  );
}

export function ScheduleWorkspace({ mode }: { mode: "calendar" | "list" }) {
  const { site } = useApp();
  const timezone = site?.timezone || "Europe/Moscow";
  const [weekStart, setWeekStart] = useState(() => currentWeekKey(timezone));
  const [requestKey, setRequestKey] = useState(0);
  const [state, setState] = useState<ScheduleState>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [staffFilter, setStaffFilter] = useState("");
  const [serviceFilter, setServiceFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [selected, setSelected] = useState<AppointmentView | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [calendarFullscreen, setCalendarFullscreen] = useState(false);

  useEffect(() => {
    document.body.classList.toggle("schedule-calendar-fullscreen", calendarFullscreen);
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setCalendarFullscreen(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.classList.remove("schedule-calendar-fullscreen");
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [calendarFullscreen]);

  useEffect(() => {
    let active = true;
    const range = weekQueryRange(weekStart, timezone);
    const params = new URLSearchParams({ from: range.from, to: range.to });
    Promise.all([
      apiRequest<AppointmentView[]>("/admin/appointments?" + params.toString(), { realm: "platform" }),
      apiRequest<Paginated<ClientView>>("/clients?page=1&limit=100", { realm: "platform" }),
      apiRequest<ServiceView[]>("/services", { realm: "platform" }),
      apiRequest<StaffView[]>("/staff", { realm: "platform" }),
    ])
      .then(([appointments, clients, services, staff]) => {
        if (active) {
          setState({
            status: "ready",
            data: { appointments, clients: clients.items, services, staff },
          });
          setRefreshing(false);
        }
      })
      .catch((reason) => {
        if (active) {
          setState({
            status: "error",
            message: reason instanceof Error ? reason.message : "Не удалось загрузить расписание",
          });
          setRefreshing(false);
        }
      });

    return () => {
      active = false;
    };
  }, [requestKey, timezone, weekStart]);

  const filtered = useMemo(() => {
    if (state.status !== "ready") return [];
    return state.data.appointments.filter((appointment) =>
      (!staffFilter || appointment.staffId === staffFilter) &&
      (!serviceFilter || appointment.serviceId === serviceFilter) &&
      (!statusFilter || appointment.status === statusFilter)
    );
  }, [serviceFilter, staffFilter, state, statusFilter]);

  const days = weekDateKeys(weekStart);
  const weekEnd = days[6];
  const titleRange =
    dateLabel(weekStart, { day: "numeric", month: weekStart.slice(0, 7) === weekEnd.slice(0, 7) ? undefined : "short" }) +
    " — " +
    dateLabel(weekEnd, { day: "numeric", month: "long", year: "numeric" });

  function changeWeek(offset: number) {
    if (state.status === "ready") setRefreshing(true);
    setWeekStart((value) => addDays(value, offset * 7));
    setSelected(null);
  }

  function showCurrentWeek() {
    if (state.status === "ready") setRefreshing(true);
    setWeekStart(currentWeekKey(timezone));
    setSelected(null);
  }

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), 3200);
  }

  function replaceAppointment(appointment: AppointmentView) {
    setState((current) => {
      if (current.status !== "ready") return current;
      const exists = current.data.appointments.some((item) => item.id === appointment.id);
      return {
        ...current,
        data: {
          ...current.data,
          appointments: exists
            ? current.data.appointments.map((item) => item.id === appointment.id ? appointment : item)
            : [...current.data.appointments, appointment],
        },
      };
    });
    setSelected(appointment);
  }

  async function transitionAppointment(status: AppointmentView["status"]) {
    if (!selected || !statusTransitions[selected.status].includes(status)) return;
    setMutating(true);
    try {
      const updated = await apiRequest<AppointmentView>("/admin/appointments/" + selected.id, {
        realm: "platform",
        method: "PATCH",
        body: JSON.stringify({ status, expectedVersion: selected.version }),
      });
      replaceAppointment(updated);
      showToast("Статус записи обновлён");
    } catch (reason) {
      showToast(reason instanceof Error ? reason.message : "Не удалось обновить запись");
    } finally {
      setMutating(false);
    }
  }

  if (state.status === "loading") return <ScheduleLoading />;

  if (state.status === "error") {
    return (
      <section className="crm-dashboard-error">
        <span aria-hidden="true">!</span>
        <p className="crm-kicker">Расписание на паузе</p>
        <h1>Не удалось загрузить</h1>
        <p>{state.message}</p>
        <button
          className="button button--ink"
          type="button"
          onClick={() => {
            setState({ status: "loading" });
            setRefreshing(false);
            setRequestKey((value) => value + 1);
          }}
        >
          Попробовать снова
        </button>
      </section>
    );
  }

  const data = state.data;
  const activeCount = filtered.filter((item) => item.status !== "cancelled").length;
  const weekRevenue = filtered
    .filter((item) => item.status === "completed")
    .reduce((total, item) => total + Number(item.price), 0);

  return (
    <div
      className={
        "schedule-page" +
        (calendarFullscreen ? " schedule-page--calendar-fullscreen" : "")
      }
    >
      <section className="schedule-page__intro">
        <div>
          <p className="crm-kicker">Рабочее расписание</p>
          <h1>{mode === "calendar" ? "Календарь" : "Все записи"}<span>.</span></h1>
          <p>{titleRange} · время салона: {formatSalonTimezone(timezone)}</p>
        </div>
        <button className="button button--ink" type="button" onClick={() => setCreateOpen(true)}>
          <b>+</b> Новая запись
        </button>
      </section>

      <section className="schedule-summary" aria-label="Итоги недели">
        <span><strong>{activeCount}</strong> активных записей</span>
        <span><strong>{data.staff.length}</strong> мастеров</span>
        <span><strong>{formatMoney(weekRevenue)}</strong> завершено</span>
        <i>данные обновляются после каждого действия</i>
      </section>

      <div className="schedule-toolbar">
        <div className="schedule-view-switch" aria-label="Вид расписания">
          <Link className={mode === "calendar" ? "is-active" : ""} href={"/app/calendar" as Route}>
            <AppIcon name="calendar" /> Календарь
          </Link>
          <Link className={mode === "list" ? "is-active" : ""} href={"/app/appointments" as Route}>
            <AppIcon name="booking" /> Список
          </Link>
        </div>

        <div className="schedule-week-nav">
          <button type="button" onClick={() => changeWeek(-1)} aria-label="Предыдущая неделя">←</button>
          <button type="button" onClick={showCurrentWeek}>Сегодня</button>
          <button type="button" onClick={() => changeWeek(1)} aria-label="Следующая неделя">→</button>
        </div>

        <div className="schedule-filters">
          <label>
            <span>Мастер</span>
            <AppSelect
              value={staffFilter || "__all__"}
              onValueChange={(value) => setStaffFilter(value === "__all__" ? "" : value)}
              options={[{ value: "__all__", label: "Все мастера" }, ...data.staff.map((staff) => ({ value: staff.id, label: staff.name }))]}
            />
          </label>
          <label>
            <span>Услуга</span>
            <AppSelect
              value={serviceFilter || "__all__"}
              onValueChange={(value) => setServiceFilter(value === "__all__" ? "" : value)}
              options={[{ value: "__all__", label: "Все услуги" }, ...data.services.map((service) => ({ value: service.id, label: service.name }))]}
            />
          </label>
          <label>
            <span>Статус</span>
            <AppSelect
              value={statusFilter || "__all__"}
              onValueChange={(value) => setStatusFilter(value === "__all__" ? "" : value)}
              options={[{ value: "__all__", label: "Все статусы" }, ...Object.entries(appointmentStatuses).map(([value, item]) => ({ value, label: item.label }))]}
            />
          </label>
        </div>
        {mode === "calendar" && (
          <button
            className="schedule-calendar__fullscreen-toggle"
            type="button"
            aria-pressed={calendarFullscreen}
            onClick={() => setCalendarFullscreen((value) => !value)}
          >
            {calendarFullscreen
              ? <Minimize2 aria-hidden="true" />
              : <Maximize2 aria-hidden="true" />}
            {calendarFullscreen ? "Свернуть" : "На весь экран"}
          </button>
        )}
      </div>

      {mode === "calendar" ? (
        <div className="schedule-calendar-frame">
          {refreshing && <div className="schedule-calendar__refresh" role="status">Обновляем расписание…</div>}
          <CalendarGrid
            appointments={filtered}
            days={days}
            timezone={timezone}
            staff={data.staff}
            onSelect={setSelected}
          />
        </div>
      ) : (
        <section className="appointments-table">
          <header>
            <span>Дата и время</span><span>Клиент и питомец</span><span>Услуга</span><span>Мастер</span><span>Сумма</span><span>Статус</span>
          </header>
          {filtered.length ? filtered
            .slice()
            .sort((left, right) => left.startAt.localeCompare(right.startAt))
            .map((appointment) => {
              const status = appointmentStatuses[appointment.status];
              return (
                <button type="button" className="appointments-row" key={appointment.id} onClick={() => setSelected(appointment)}>
                  <time dateTime={appointment.startAt}>
                    <strong>{dateLabel(salonDayKey(appointment.startAt, timezone), { day: "numeric", month: "short" })}</strong>
                    <span>{formatSalonTime(appointment.startAt, timezone)}</span>
                  </time>
                  <span><strong>{appointment.petName || "Питомец"}</strong><small>{appointment.clientName || "Клиент"}</small></span>
                  <span>{appointment.serviceName || "Услуга"}</span>
                  <span>{appointment.staffName || "Не назначен"}</span>
                  <strong>{formatMoney(appointment.price)}</strong>
                  <i className={"crm-status crm-status--" + status.tone}>{status.label}</i>
                </button>
              );
            }) : (
              <div className="appointments-table__empty">
                <span aria-hidden="true">☼</span>
                <h2>Записей на этой неделе нет</h2>
                <p>Создайте запись вручную или опубликуйте сайт для онлайн-записи.</p>
              </div>
            )}
        </section>
      )}

      {selected && (
        <AppointmentDrawer
          appointment={selected}
          timezone={timezone}
          transitions={statusTransitions[selected.status]}
          pending={mutating}
          onTransition={transitionAppointment}
          onClose={() => setSelected(null)}
        />
      )}

      {createOpen && (
        <AppointmentForm
          clients={data.clients}
          services={data.services}
          staff={data.staff}
          timezone={timezone}
          initialDate={salonDayKey(new Date(), timezone)}
          onClose={() => setCreateOpen(false)}
          onCreated={(appointment) => {
            replaceAppointment(appointment);
            setCreateOpen(false);
            showToast("Новая запись добавлена");
          }}
        />
      )}

      {toast && <div className="crm-toast" role="status">{toast}</div>}
    </div>
  );
}
