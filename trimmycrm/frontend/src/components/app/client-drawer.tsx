"use client";

import type { Route } from "next";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { HairProfileForm } from "@/components/app/hair-profile-form";
import { apiRequest } from "@/lib/api/client";
import type { ClientDetailsView, ClientHairProfileView } from "@/lib/api/types";
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
} from "@/lib/app/crm";
import { hairCharacteristicLabel } from "@/lib/app/hair-profile";

type HairProfileState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; value: ClientHairProfileView | null };

export function ClientDrawer({
  client,
  timezone,
  onClose,
  onEdit,
}: {
  client: ClientDetailsView;
  timezone: string;
  onClose: () => void;
  onEdit: () => void;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const status = clientStatuses[client.status] || clientStatuses.crm_only;
  const [hairProfile, setHairProfile] = useState<HairProfileState>({ status: "loading" });
  const [hairProfileEditing, setHairProfileEditing] = useState(false);
  const [hairProfileRequestKey, setHairProfileRequestKey] = useState(0);

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

  useEffect(() => {
    let active = true;
    apiRequest<ClientHairProfileView | null>(`/clients/${client.id}/hair-profile`, {
      realm: "platform",
    })
      .then((value) => {
        if (active) setHairProfile({ status: "ready", value });
      })
      .catch((reason) => {
        if (active) {
          setHairProfile({
            status: "error",
            message: reason instanceof Error ? reason.message : "Не удалось загрузить профиль",
          });
        }
      });
    return () => { active = false; };
  }, [client.id, hairProfileRequestKey]);

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

        <section className="client-drawer__section client-hair-profile">
          <header>
            <div><p className="crm-kicker">Профиль волос</p></div>
            {hairProfile.status === "ready" && !hairProfileEditing && (
              <button type="button" onClick={() => setHairProfileEditing(true)}>
                {hairProfile.value ? "Изменить" : "+ Добавить"}
              </button>
            )}
          </header>
          {hairProfile.status === "loading" ? (
            <p className="client-drawer__empty" role="status">Загружаем технический профиль…</p>
          ) : hairProfile.status === "error" ? (
            <div className="client-hair-profile__error">
              <p>{hairProfile.message}</p>
              <button type="button" onClick={() => {
                setHairProfile({ status: "loading" });
                setHairProfileRequestKey((value) => value + 1);
              }}>Повторить</button>
            </div>
          ) : hairProfileEditing ? (
            <HairProfileForm
              clientId={client.id}
              profile={hairProfile.value}
              onCancel={() => setHairProfileEditing(false)}
              onSaved={(value) => {
                setHairProfile({ status: "ready", value });
                setHairProfileEditing(false);
              }}
            />
          ) : hairProfile.value ? (
            <div className="client-hair-profile__summary">
              <dl>
                <div><dt>Длина</dt><dd>{hairCharacteristicLabel(hairProfile.value.hairLength)}</dd></div>
                <div><dt>Густота</dt><dd>{hairCharacteristicLabel(hairProfile.value.density)}</dd></div>
                <div><dt>Текстура</dt><dd>{hairCharacteristicLabel(hairProfile.value.texture)}</dd></div>
                <div><dt>Пористость</dt><dd>{hairCharacteristicLabel(hairProfile.value.porosity)}</dd></div>
                <div><dt>Текущий цвет</dt><dd>{hairProfile.value.currentColor || "Не указан"}</dd></div>
                <div><dt>Седина</dt><dd>{hairProfile.value.grayPercentage == null ? "Не указана" : `${hairProfile.value.grayPercentage}%`}</dd></div>
              </dl>
              {hairProfile.value.conditionNotes && <p><strong>Состояние</strong><span>{hairProfile.value.conditionNotes}</span></p>}
              {hairProfile.value.colorHistory && <p><strong>История окрашивания</strong><span>{hairProfile.value.colorHistory}</span></p>}
              {(hairProfile.value.beardLength || hairProfile.value.beardStyle) && <p><strong>Борода</strong><span>{[hairProfile.value.beardLength, hairProfile.value.beardStyle].filter(Boolean).join(" · ")}</span></p>}
              {hairProfile.value.preferences && <p><strong>Пожелания</strong><span>{hairProfile.value.preferences}</span></p>}
            </div>
          ) : (
            <p className="client-drawer__empty">Добавьте технические параметры, чтобы следующий визит продолжил историю клиента.</p>
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
                    <p><strong>{appointment.serviceName || "Услуга"}</strong><small>Визит клиента</small></p>
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
