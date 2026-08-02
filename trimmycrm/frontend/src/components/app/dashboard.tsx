"use client";

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useMemo, useState } from "react";

import { AppIcon } from "@/components/app/app-icon";
import { useApp } from "@/components/app/app-provider";
import { apiRequest } from "@/lib/api/client";
import type {
  AppointmentView,
  Paginated,
  ServiceView,
  StaffView,
} from "@/lib/api/types";
import { appointmentServiceLabel } from "@/lib/app/calendar";
import {
  appointmentStatuses,
  formatMoney,
  formatSalonTime,
  launchChecklist,
  salonDayKey,
} from "@/lib/app/dashboard";
import { tenantHostname } from "@/lib/app/site-url";

type ClientSummary = {
  id: string;
  createdAt: string;
};

type DashboardData = {
  appointments: AppointmentView[];
  clients: Paginated<ClientSummary>;
  services: ServiceView[];
  staff: StaffView[];
};

type DashboardState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: DashboardData };

function DashboardSkeleton() {
  return (
    <div className="crm-dashboard crm-dashboard--loading" aria-busy="true">
      <div className="crm-skeleton crm-skeleton--title" />
      <div className="crm-metrics">
        {Array.from({ length: 4 }, (_, index) => <div className="crm-skeleton crm-skeleton--metric" key={index} />)}
      </div>
      <div className="crm-skeleton crm-skeleton--panel" />
    </div>
  );
}

export function Dashboard() {
  const { me, site } = useApp();
  const [now] = useState(() => new Date());
  const [requestKey, setRequestKey] = useState(0);
  const [state, setState] = useState<DashboardState>({ status: "loading" });
  const timezone = site?.timezone || "Europe/Moscow";

  useEffect(() => {
    let active = true;
    const from = new Date(now.getTime() - 86_400_000).toISOString();
    const to = new Date(now.getTime() + 8 * 86_400_000).toISOString();

    Promise.all([
      apiRequest<AppointmentView[]>(
        "/admin/appointments?from=" + encodeURIComponent(from) + "&to=" + encodeURIComponent(to),
        { realm: "platform" },
      ),
      apiRequest<Paginated<ClientSummary>>("/clients?page=1&limit=100", { realm: "platform" }),
      apiRequest<ServiceView[]>("/services", { realm: "platform" }),
      apiRequest<StaffView[]>("/staff", { realm: "platform" }),
    ])
      .then(([appointments, clients, services, staff]) => {
        if (active) setState({ status: "ready", data: { appointments, clients, services, staff } });
      })
      .catch((reason) => {
        if (active) {
          setState({
            status: "error",
            message: reason instanceof Error ? reason.message : "Не удалось загрузить обзор",
          });
        }
      });

    return () => {
      active = false;
    };
  }, [now, requestKey]);

  const firstName = me.user.fullName?.trim().split(/s+/)[0];
  const analyticsUnlocked = Boolean(
    me.subscription?.plan.features.some((feature) =>
      feature === "basic_analytics" || feature === "advanced_analytics"
    ),
  );

  const derived = useMemo(() => {
    if (state.status !== "ready") return null;
    const today = salonDayKey(now, timezone);
    const todayAppointments = state.data.appointments
      .filter((appointment) => salonDayKey(appointment.startAt, timezone) === today)
      .sort((left, right) => left.startAt.localeCompare(right.startAt));
    const activeToday = todayAppointments.filter((appointment) => appointment.status !== "cancelled");
    const revenue = todayAppointments
      .filter((appointment) => appointment.status === "completed")
      .reduce((total, appointment) => total + Number(appointment.price), 0);
    const checklist = site
      ? launchChecklist(site, state.data.services.length, state.data.staff.length)
      : [];
    const completed = checklist.filter((item) => item.complete).length;

    return {
      todayAppointments,
      activeToday,
      revenue,
      checklist,
      progress: checklist.length ? Math.round((completed / checklist.length) * 100) : 100,
      data: state.data,
    };
  }, [now, site, state, timezone]);

  if (state.status === "loading") return <DashboardSkeleton />;

  if (state.status === "error") {
    return (
      <section className="crm-dashboard-error">
        <span aria-hidden="true">!</span>
        <p className="crm-kicker">Что-то отвлекло кабинет</p>
        <h1>Обзор не загрузился</h1>
        <p>{state.message}</p>
        <button
          className="button button--ink"
          type="button"
          onClick={() => {
            setState({ status: "loading" });
            setRequestKey((value) => value + 1);
          }}
        >
          Попробовать снова
        </button>
      </section>
    );
  }

  if (!derived) return null;

  return (
    <div className="crm-dashboard">
      <section className="crm-dashboard__intro">
        <div>
          <p className="crm-kicker">Обзор салона</p>
          <h1>Добрый день{firstName ? ", " + firstName : ""}<span>!</span></h1>
          <p>
            {derived.activeToday.length
              ? "Сегодня есть хвосты в расписании — всё важное уже собрано ниже."
              : "Сегодня спокойно. Самое время завершить настройку и открыть онлайн-запись."}
          </p>
        </div>
        <div className="crm-dashboard__intro-actions">
          <span>Добавляйте визиты прямо в недельную сетку</span>
          <Link className="button button--ink" href={"/app/calendar" as Route}>
            <b>+</b> Открыть календарь
          </Link>
        </div>
      </section>

      <section className="crm-metrics" aria-label="Ключевые показатели">
        <article className="crm-metric crm-metric--lime">
          <span><AppIcon name="calendar" /></span>
          <p>Записей сегодня</p>
          <strong>{derived.activeToday.length}</strong>
          <small>{derived.activeToday.filter((item) => item.status === "new").length} ждут подтверждения</small>
        </article>
        <article className="crm-metric crm-metric--peach">
          <span aria-hidden="true">₽</span>
          <p>Выручка сегодня</p>
          <strong>{formatMoney(derived.revenue)}</strong>
          <small>по завершённым визитам</small>
        </article>
        <article className="crm-metric crm-metric--lavender">
          <span><AppIcon name="clients" /></span>
          <p>Клиентов в базе</p>
          <strong>{derived.data.clients.total}</strong>
          <small>
            {typeof me.subscription?.plan.limits.clients === "number"
              ? "лимит тарифа — " + me.subscription.plan.limits.clients
              : "без ограничения по тарифу"}
          </small>
        </article>
        <article className="crm-metric crm-metric--magenta">
          <span aria-hidden="true">↗</span>
          <p>Готовность запуска</p>
          <strong>{derived.progress}%</strong>
          <small>{derived.data.staff.length} мастеров в команде</small>
        </article>
      </section>

      <div className="crm-dashboard-grid">
        <section className="crm-card crm-today">
          <header className="crm-card__header">
            <div>
              <p className="crm-kicker">Расписание</p>
              <h2>Сегодня в салоне</h2>
            </div>
            <Link href={"/app/calendar" as Route}>Весь календарь <AppIcon name="arrow" /></Link>
          </header>

          {derived.todayAppointments.length ? (
            <div className="crm-appointment-list">
              {derived.todayAppointments.slice(0, 6).map((appointment) => {
                const status = appointmentStatuses[appointment.status];
                return (
                  <article className="crm-appointment" key={appointment.id}>
                    <time dateTime={appointment.startAt}>
                      {formatSalonTime(appointment.startAt, timezone)}
                      <small>{formatSalonTime(appointment.endAt, timezone)}</small>
                    </time>
                    <span className="crm-appointment__pet" aria-hidden="true">
                      {(appointment.petName || "П")[0]?.toUpperCase()}
                    </span>
                    <div className="crm-appointment__main">
                      <strong>{appointment.petName || "Питомец"}</strong>
                      <p>{appointmentServiceLabel(appointment)} · {appointment.clientName || "Клиент"}</p>
                    </div>
                    <div className="crm-appointment__staff">
                      <small>мастер</small>
                      <span>{appointment.staffName || "Не назначен"}</span>
                    </div>
                    <div className="crm-appointment__price">
                      <strong>{formatMoney(appointment.price)}</strong>
                      <span className={"crm-status crm-status--" + status.tone}>{status.label}</span>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="crm-empty-day">
              <span aria-hidden="true">☼</span>
              <h3>На сегодня записей нет</h3>
              <p>Когда клиент выберет слот на сайте, запись сразу появится здесь.</p>
            </div>
          )}
        </section>

        {site && (
          <aside className="crm-card crm-launch">
            <header>
              <p className="crm-kicker">Быстрый запуск</p>
              <strong>{derived.progress}%</strong>
            </header>
            <h2>Подготовим салон к записи</h2>
            <p>Пять коротких шагов — и клиенты смогут записываться самостоятельно.</p>
            <div className="crm-launch__progress"><span style={{ width: derived.progress + "%" }} /></div>
            <ul>
              {derived.checklist.map((item) => (
                <li className={item.complete ? "is-complete" : ""} key={item.id}>
                  <span aria-hidden="true">{item.complete ? "✓" : "·"}</span>
                  <p>{item.label}</p>
                  {!item.complete && <button type="button" disabled>→</button>}
                </li>
              ))}
            </ul>
            <small>Настройки откроются по разделам — ничего не потеряется.</small>
          </aside>
        )}
      </div>

      <div className="crm-dashboard-bottom">
        {site && (
          <section className="crm-site-preview">
            <div className="crm-site-preview__copy">
              <p className="crm-kicker">Сайт салона</p>
              <h2>{site.name}</h2>
              <p>{tenantHostname(site.slug)}</p>
              <span className={site.publishedVersion ? "is-live" : ""}>
                {site.publishedVersion ? "● опубликован" : "○ черновик"}
              </span>
              <Link className="button button--outline" href={"/app/site" as Route}>
                Настроить сайт →
              </Link>
            </div>
            <div className="crm-site-preview__visual" aria-hidden="true">
              <span>груминг-салон</span>
              <strong>{site.name}</strong>
              <i>бережно.<br />красиво.<br />рядом.</i>
              <b>записаться →</b>
            </div>
          </section>
        )}

        <section className={"crm-insight" + (analyticsUnlocked ? "" : " is-locked")}>
          <div className="crm-insight__chart" aria-hidden="true">
            {[34, 55, 42, 76, 64, 88, 71].map((height, index) => (
              <i style={{ height: height + "%" }} key={index} />
            ))}
          </div>
          <div>
            <p className="crm-kicker">Аналитика</p>
            <h2>{analyticsUnlocked ? "Данные копятся с первой записи" : "Расти — с понятными цифрами"}</h2>
            <p>
              {analyticsUnlocked
                ? "Выручка, загрузка и популярные услуги появятся здесь, когда накопятся визиты."
                : "Подробная выручка и загрузка доступны на тарифах «Бизнес» и «Профи»."}
            </p>
            <Link href={(analyticsUnlocked ? "/app/analytics" : "/app/settings") as Route}>
              {analyticsUnlocked ? "Открыть аналитику →" : "Сравнить тарифы →"}
            </Link>
          </div>
          {!analyticsUnlocked && <span className="crm-insight__lock" aria-hidden="true">🔒</span>}
        </section>
      </div>
    </div>
  );
}
