"use client";

import type { Route } from "next";
import Link from "next/link";
import { useEffect, useRef } from "react";

import type { ClientDetailsView, PetView } from "@/lib/api/types";
import {
  appointmentStatuses,
  formatMoney,
  formatSalonTime,
  salonDayKey,
} from "@/lib/app/dashboard";
import {
  clientStatuses,
  formatShortDate,
  personInitials,
  speciesLabels,
} from "@/lib/app/crm";

export function ClientDrawer({
  client,
  timezone,
  onClose,
  onEdit,
  onAddPet,
  onPetSelect,
}: {
  client: ClientDetailsView;
  timezone: string;
  onClose: () => void;
  onEdit: () => void;
  onAddPet: () => void;
  onPetSelect: (pet: PetView) => void;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const status = clientStatuses[client.status] || clientStatuses.crm_only;

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
      <aside className="client-drawer" role="dialog" aria-modal="true" aria-labelledby="client-title">
        <header>
          <div>
            <p className="crm-kicker">Карточка клиента</p>
            <span className={"crm-status crm-status--" + status.tone}>{status.label}</span>
          </div>
          <button ref={closeButton} type="button" onClick={onClose} aria-label="Закрыть">×</button>
        </header>

        <section className="client-drawer__hero">
          <span aria-hidden="true">{personInitials(client.fullName)}</span>
          <div>
            <h2 id="client-title">{client.fullName || "Клиент без имени"}</h2>
            <p>в CRM с {formatShortDate(client.createdAt)}</p>
          </div>
          <button type="button" onClick={onEdit}>Изменить</button>
        </section>

        <dl className="client-contacts">
          <div><dt>Телефон</dt><dd>{client.phone || "Не указан"}</dd></div>
          <div><dt>Email</dt><dd>{client.email || "Не указан"}</dd></div>
          <div><dt>Email подтверждён</dt><dd>{client.emailVerified ? "Да" : "Нет"}</dd></div>
          <div><dt>Всего визитов</dt><dd>{client.appointmentHistory.length}</dd></div>
        </dl>

        <section className="client-drawer__section">
          <header>
            <div><p className="crm-kicker">Питомцы</p><strong>{client.pets.length}</strong></div>
            <button type="button" onClick={onAddPet}>+ Добавить</button>
          </header>
          {client.pets.length ? (
            <div className="client-pets">
              {client.pets.map((pet) => (
                <button type="button" onClick={() => onPetSelect(pet)} key={pet.id}>
                  <span aria-hidden="true">{pet.photos[0] ? "●" : pet.name[0]?.toUpperCase()}</span>
                  <p><strong>{pet.name}</strong><small>{pet.breed || speciesLabels[pet.species]}</small></p>
                  <i>→</i>
                </button>
              ))}
            </div>
          ) : (
            <p className="client-drawer__empty">Добавьте питомца — он появится здесь и в форме записи.</p>
          )}
        </section>

        <section className="client-drawer__section client-history">
          <header>
            <div><p className="crm-kicker">История визитов</p><strong>{client.appointmentHistory.length}</strong></div>
            <Link href={"/app/calendar" as Route}>К календарю →</Link>
          </header>
          {client.appointmentHistory.length ? (
            <div>
              {client.appointmentHistory.slice(0, 8).map((appointment) => {
                const statusKey = appointment.status as keyof typeof appointmentStatuses;
                const status = appointmentStatuses[statusKey] || appointmentStatuses.new;
                return (
                  <article key={appointment.id}>
                    <time dateTime={appointment.startAt}>
                      <strong>{formatShortDate(salonDayKey(appointment.startAt, timezone))}</strong>
                      <span>{formatSalonTime(appointment.startAt, timezone)}</span>
                    </time>
                    <p><strong>{appointment.petName || "Питомец"}</strong><small>{appointment.serviceName || "Услуга"}</small></p>
                    <span>{appointment.staffName || "Без мастера"}</span>
                    <b>{formatMoney(appointment.price || 0)}</b>
                    <i className={"crm-status crm-status--" + status.tone}>{status.label}</i>
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="client-drawer__empty">История появится после первой записи.</p>
          )}
        </section>
      </aside>
    </div>
  );
}
