"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { ScheduleExceptionForm } from "@/components/app/schedule-exception-form";
import { apiRequest } from "@/lib/api/client";
import type {
  ScheduleExceptionView,
  ServiceView,
  SiteView,
  StaffView,
} from "@/lib/api/types";
import {
  exceptionKinds,
  formatExceptionRange,
  normalizeSchedule,
  staffInitials,
  weekdays,
  weeklyMinutes,
  type WeeklySchedule,
} from "@/lib/app/catalog";
import {
  addDays,
  zonedDateTimeToIso,
} from "@/lib/app/calendar";
import { salonDayKey } from "@/lib/app/dashboard";

type ExceptionsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; items: ScheduleExceptionView[] };

function effectiveSchedule(
  member: StaffView,
  salonSchedule: SiteView["workHours"],
): WeeklySchedule {
  const personal = normalizeSchedule(member.schedule);
  const salon = normalizeSchedule(salonSchedule);
  return Object.fromEntries(
    weekdays.map((day) => [
      day.key,
      personal[day.key]?.length ? personal[day.key] : salon[day.key],
    ]),
  );
}

export function StaffDrawer({
  member,
  services,
  salonSchedule,
  timezone,
  removing,
  onClose,
  onEdit,
  onRemove,
  onNotify,
}: {
  member: StaffView;
  services: ServiceView[];
  salonSchedule: SiteView["workHours"];
  timezone: string;
  removing: boolean;
  onClose: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onNotify: (message: string) => void;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const [exceptions, setExceptions] = useState<ExceptionsState>({ status: "loading" });
  const [exceptionForm, setExceptionForm] = useState<ScheduleExceptionView | "new" | null>(null);
  const [deletingException, setDeletingException] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const schedule = useMemo(
    () => effectiveSchedule(member, salonSchedule),
    [member, salonSchedule],
  );
  const customDays = weekdays.filter((day) => normalizeSchedule(member.schedule)[day.key]?.length).length;
  const assigned = services.filter((service) => member.serviceIds.includes(service.id));
  const portraitStyle = member.photoUrl
    ? { backgroundImage: 'url("' + member.photoUrl + '")' } as CSSProperties
    : undefined;

  useEffect(() => {
    closeButton.current?.focus();
    document.body.classList.add("crm-dialog-open");
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !exceptionForm) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.classList.remove("crm-dialog-open");
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [exceptionForm, onClose]);

  useEffect(() => {
    let active = true;
    const day = salonDayKey(new Date(), timezone);
    const from = zonedDateTimeToIso(day, "00:00", timezone);
    const to = zonedDateTimeToIso(addDays(day, 365), "00:00", timezone);
    apiRequest<ScheduleExceptionView[]>(
      "/staff/" + member.id + "/schedule-exceptions?from=" +
        encodeURIComponent(from) + "&to=" + encodeURIComponent(to),
      { realm: "platform" },
    )
      .then((items) => {
        if (active) setExceptions({ status: "ready", items });
      })
      .catch((reason) => {
        if (active) {
          setExceptions({
            status: "error",
            message: reason instanceof Error ? reason.message : "Не удалось загрузить изменения графика",
          });
        }
      });
    return () => {
      active = false;
    };
  }, [member.id, timezone]);

  async function removeException(exceptionId: string) {
    setDeletingException(exceptionId);
    try {
      await apiRequest<void>(
        "/staff/" + member.id + "/schedule-exceptions/" + exceptionId,
        { realm: "platform", method: "DELETE" },
      );
      setExceptions((current) => current.status === "ready"
        ? { ...current, items: current.items.filter((item) => item.id !== exceptionId) }
        : current
      );
      onNotify("Изменение графика удалено");
    } catch (reason) {
      onNotify(reason instanceof Error ? reason.message : "Не удалось удалить изменение графика");
    } finally {
      setDeletingException(null);
    }
  }

  return (
    <div className="appointment-dialog">
      <button className="appointment-dialog__backdrop" type="button" onClick={onClose} aria-label="Закрыть профиль" />
      <aside
        className="staff-drawer"
        role="dialog"
        aria-modal="true"
        aria-hidden={Boolean(exceptionForm)}
        aria-labelledby="staff-title"
      >
        <header>
          <div>
            <p className="crm-kicker">Профиль мастера</p>
            <span className={"crm-status crm-status--" + (member.isActive ? "lime" : "muted")}>
              {member.isActive ? "Активен" : "Неактивен"}
            </span>
          </div>
          <button ref={closeButton} type="button" onClick={onClose} aria-label="Закрыть">×</button>
        </header>

        <section className="staff-drawer__hero">
          <div className={"staff-drawer__portrait" + (portraitStyle ? " has-photo" : "")} style={portraitStyle}>
            {!portraitStyle && <span>{staffInitials(member.name)}</span>}
            <i>{member.photoUrl ? "фото мастера" : "добавьте фото"}</i>
          </div>
          <div>
            <p>{member.specialization || "Мастер салона"}</p>
            <h2 id="staff-title">{member.name}</h2>
            <span>{member.userId ? "Есть доступ в кабинет" : "Профиль без входа"}</span>
          </div>
        </section>

        <dl className="staff-facts">
          <div><dt>Услуг</dt><dd>{assigned.length}</dd></div>
          <div><dt>Часов в неделю</dt><dd>{Math.round(weeklyMinutes(schedule) / 60)}</dd></div>
          <div><dt>Свой график</dt><dd>{customDays ? customDays + " дн." : "Нет"}</dd></div>
        </dl>

        <section className="staff-drawer__section staff-service-list">
          <header><div><p className="crm-kicker">Услуги</p><strong>{assigned.length}</strong></div></header>
          {assigned.length ? (
            <div>
              {assigned.map((service) => (
                <span className={service.isActive ? "" : "is-inactive"} key={service.id}>
                  <b>{service.name}</b>
                  <small>{service.category || "Без категории"}</small>
                </span>
              ))}
            </div>
          ) : (
            <p className="client-drawer__empty">Услуги пока не назначены.</p>
          )}
        </section>

        <section className="staff-drawer__section staff-week">
          <header>
            <div><p className="crm-kicker">Недельный график</p><strong>{customDays || "S"}</strong></div>
            <button type="button" onClick={onEdit}>Настроить</button>
          </header>
          <div>
            {weekdays.map((day) => {
              const ranges = schedule[day.key] || [];
              const personal = normalizeSchedule(member.schedule)[day.key]?.length > 0;
              return (
                <article key={day.key}>
                  <span>{day.short}</span>
                  <p>
                    {ranges.length
                      ? ranges.map((range) => range.start + "–" + range.end).join(", ")
                      : "Салон закрыт"}
                  </p>
                  <i>{personal ? "свой" : "салон"}</i>
                </article>
              );
            })}
          </div>
        </section>

        <section className="staff-drawer__section staff-exceptions">
          <header>
            <div>
              <p className="crm-kicker">Выходные и изменения</p>
              <strong>{exceptions.status === "ready" ? exceptions.items.length : "…"}</strong>
            </div>
            <button type="button" onClick={() => setExceptionForm("new")}>+ Добавить</button>
          </header>

          {exceptions.status === "loading" ? (
            <div className="staff-exceptions__loading"><span /><p>Загружаем график…</p></div>
          ) : exceptions.status === "error" ? (
            <p className="staff-exceptions__error">{exceptions.message}</p>
          ) : exceptions.items.length ? (
            <div>
              {exceptions.items.map((item) => {
                const kind = exceptionKinds[item.kind];
                return (
                  <article key={item.id}>
                    <span className={"crm-status crm-status--" + kind.tone}>{kind.label}</span>
                    <p><strong>{formatExceptionRange(item.startsAt, item.endsAt, timezone)}</strong><small>{item.reason || "Без комментария"}</small></p>
                    <button type="button" onClick={() => setExceptionForm(item)} aria-label={"Изменить: " + kind.label}>✎</button>
                    <button
                      type="button"
                      onClick={() => void removeException(item.id)}
                      disabled={deletingException === item.id}
                      aria-label={"Удалить: " + kind.label}
                    >
                      {deletingException === item.id ? "…" : "×"}
                    </button>
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="client-drawer__empty">На ближайший год изменений нет.</p>
          )}
        </section>

        <footer className="staff-drawer__actions">
          <button className="button button--ink" type="button" onClick={onEdit}>Изменить профиль</button>
          {!confirmingRemove ? (
            <button className="button staff-remove" type="button" onClick={() => setConfirmingRemove(true)}>Убрать из команды</button>
          ) : (
            <div className="service-remove-confirm">
              <p>Мастер с историей записей станет неактивным, без истории — будет удалён.</p>
              <button type="button" onClick={() => setConfirmingRemove(false)} disabled={removing}>Отмена</button>
              <button type="button" onClick={onRemove} disabled={removing}>{removing ? "Убираем…" : "Подтвердить"}</button>
            </div>
          )}
        </footer>
      </aside>

      {exceptionForm && (
        <ScheduleExceptionForm
          member={member}
          exception={exceptionForm === "new" ? null : exceptionForm}
          timezone={timezone}
          onClose={() => setExceptionForm(null)}
          onSaved={(saved) => {
            setExceptions((current) => current.status === "ready"
              ? {
                  ...current,
                  items: current.items.some((item) => item.id === saved.id)
                    ? current.items.map((item) => item.id === saved.id ? saved : item)
                    : [...current.items, saved].sort((left, right) => left.startsAt.localeCompare(right.startsAt)),
                }
              : current
            );
            setExceptionForm(null);
            onNotify("График мастера обновлён");
          }}
        />
      )}
    </div>
  );
}
