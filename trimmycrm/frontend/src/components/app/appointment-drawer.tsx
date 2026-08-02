"use client";

import { useEffect, useRef } from "react";

import type { AppointmentView } from "@/lib/api/types";
import { appointmentServiceLabel } from "@/lib/app/calendar";
import { appointmentStatuses, formatMoney, formatSalonTime, salonDayKey } from "@/lib/app/dashboard";

const transitionLabels: Partial<Record<AppointmentView["status"], string>> = {
  confirmed: "Подтвердить",
  completed: "Завершить визит",
  cancelled: "Отменить запись",
  no_show: "Клиент не пришёл",
};

function formatDate(value: string, timezone: string) {
  const dateKey = salonDayKey(value, timezone);
  return new Intl.DateTimeFormat("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(dateKey + "T12:00:00Z"));
}

export function AppointmentDrawer({
  appointment,
  timezone,
  transitions,
  pending,
  onTransition,
  onClose,
}: {
  appointment: AppointmentView;
  timezone: string;
  transitions: AppointmentView["status"][];
  pending: boolean;
  onTransition: (status: AppointmentView["status"]) => void;
  onClose: () => void;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const status = appointmentStatuses[appointment.status];

  useEffect(() => {
    closeButton.current?.focus();
    document.body.classList.add("crm-dialog-open");
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.classList.remove("crm-dialog-open");
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div className="appointment-dialog">
      <button className="appointment-dialog__backdrop" type="button" onClick={onClose} aria-label="Закрыть карточку" />
      <aside className="appointment-drawer" role="dialog" aria-modal="true" aria-labelledby="appointment-title">
        <header>
          <div>
            <p className="crm-kicker">Карточка записи</p>
            <span className={"crm-status crm-status--" + status.tone}>{status.label}</span>
          </div>
          <button ref={closeButton} type="button" onClick={onClose} aria-label="Закрыть">×</button>
        </header>

        <section className="appointment-drawer__hero">
          <span aria-hidden="true">{(appointment.clientName || "К")[0]?.toUpperCase()}</span>
          <div>
            <h2 id="appointment-title">{appointment.clientName || "Клиент без имени"}</h2>
            <p>{appointmentServiceLabel(appointment)}</p>
          </div>
        </section>

        <dl className="appointment-details">
          <div>
            <dt>Дата</dt>
            <dd>{formatDate(appointment.startAt, timezone)}</dd>
          </div>
          <div>
            <dt>Время</dt>
            <dd>{formatSalonTime(appointment.startAt, timezone)} — {formatSalonTime(appointment.endAt, timezone)}</dd>
          </div>
          <div>
            <dt>Услуга</dt>
            <dd>{appointmentServiceLabel(appointment)}</dd>
          </div>
          <div>
            <dt>Мастер</dt>
            <dd>{appointment.staffName || "Не назначен"}</dd>
          </div>
          <div>
            <dt>Стоимость</dt>
            <dd>{formatMoney(appointment.price)}</dd>
          </div>
          <div>
            <dt>Оплата</dt>
            <dd>{appointment.prepaid ? "Есть предоплата" : "Без предоплаты"}</dd>
          </div>
        </dl>

        {appointment.items.length > 0 && (
          <section className="appointment-drawer__items" aria-labelledby="appointment-items-title">
            <p className="crm-kicker" id="appointment-items-title">Состав визита</p>
            <ol>
              {appointment.items.map((item, index) => (
                <li key={item.id}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <strong>{item.serviceName}</strong>
                    {item.variantLabel && <p>{item.variantLabel}</p>}
                    {item.addons.length > 0 && (
                      <p>{item.addons.map((addon) => addon.name).join(", ")}</p>
                    )}
                    <small>{item.durationMin} мин · {formatMoney(item.finalPrice ?? item.unitPrice)}</small>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}

        {appointment.notes && (
          <section className="appointment-drawer__notes">
            <p className="crm-kicker">Комментарий</p>
            <p>{appointment.notes}</p>
          </section>
        )}

        <section className="appointment-drawer__actions">
          <p className="crm-kicker">Следующее действие</p>
          {transitions.length ? (
            <div>
              {transitions.map((nextStatus) => (
                <button
                  className={
                    nextStatus === "cancelled" || nextStatus === "no_show"
                      ? "button appointment-action appointment-action--danger"
                      : "button button--ink appointment-action"
                  }
                  type="button"
                  disabled={pending}
                  onClick={() => onTransition(nextStatus)}
                  key={nextStatus}
                >
                  {transitionLabels[nextStatus] || appointmentStatuses[nextStatus].label}
                </button>
              ))}
            </div>
          ) : (
            <p>Запись находится в финальном статусе. История сохранена.</p>
          )}
        </section>
      </aside>
    </div>
  );
}
