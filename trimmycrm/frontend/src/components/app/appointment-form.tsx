"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { AppSelect } from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import { apiRequest } from "@/lib/api/client";
import type {
  AppointmentView,
  ClientDetailsView,
  ClientView,
  Paginated,
  ServiceView,
  StaffView,
} from "@/lib/api/types";
import { addDays, zonedDateTimeToIso } from "@/lib/app/calendar";
import { formatMoney } from "@/lib/app/dashboard";

const timeOptions = Array.from({ length: 27 }, (_, index) => {
  const minutes = 8 * 60 + index * 30;
  return String(Math.floor(minutes / 60)).padStart(2, "0") + ":" + String(minutes % 60).padStart(2, "0");
});

function clientLabel(client: ClientView) {
  return client.fullName || client.email || client.phone || "Клиент без имени";
}

export function AppointmentForm({
  clients,
  services,
  staff,
  timezone,
  initialDate,
  onClose,
  onCreated,
}: {
  clients: ClientView[];
  services: ServiceView[];
  staff: StaffView[];
  timezone: string;
  initialDate: string;
  onClose: () => void;
  onCreated: (appointment: AppointmentView) => void;
}) {
  const firstField = useRef<HTMLInputElement>(null);
  const [clientId, setClientId] = useState("");
  const [clientSearch, setClientSearch] = useState("");
  const [clientOptions, setClientOptions] = useState(clients);
  const [clientsSearching, setClientsSearching] = useState(false);
  const [clientDetails, setClientDetails] = useState<ClientDetailsView | null>(null);
  const [petsLoading, setPetsLoading] = useState(false);
  const [petId, setPetId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState("10:00");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    firstField.current?.focus();
    document.body.classList.add("crm-dialog-open");
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !document.querySelector('.ui-popover-content[data-state="open"]')) onClose();
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.body.classList.remove("crm-dialog-open");
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [onClose]);

  useEffect(() => {
    const query = clientSearch.trim();
    if (query.length < 2) return;
    const timer = window.setTimeout(() => {
      apiRequest<Paginated<ClientView>>(
        "/clients?page=1&limit=100&search=" + encodeURIComponent(query),
        { realm: "platform" },
      )
        .then((value) => setClientOptions(value.items))
        .catch((reason) => setFormError(
          reason instanceof Error ? reason.message : "Не удалось найти клиента"
        ))
        .finally(() => setClientsSearching(false));
    }, 280);
    return () => window.clearTimeout(timer);
  }, [clientSearch]);

  useEffect(() => {
    if (!clientId) return;
    let active = true;
    apiRequest<ClientDetailsView>("/clients/" + clientId, { realm: "platform" })
      .then((value) => {
        if (!active) return;
        setClientDetails(value);
        setPetId(value.pets[0]?.id || "");
      })
      .catch((reason) => {
        if (active) setFormError(reason instanceof Error ? reason.message : "Не удалось загрузить питомцев");
      })
      .finally(() => {
        if (active) setPetsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [clientId]);

  const selectedService = useMemo(
    () => services.find((service) => service.id === serviceId) || null,
    [serviceId, services],
  );

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    if (!clientId || !petId || !serviceId || !date || !time) {
      setFormError("Заполните клиента, питомца, услугу, дату и время");
      return;
    }
    setSubmitting(true);
    try {
      const appointment = await apiRequest<AppointmentView>("/admin/appointments", {
        realm: "platform",
        method: "POST",
        body: JSON.stringify({
          tenantUserId: clientId,
          petId,
          serviceId,
          staffId: staffId || null,
          startAt: zonedDateTimeToIso(date, time, timezone),
          notes: notes.trim() || null,
        }),
      });
      onCreated(appointment);
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : "Не удалось создать запись");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="appointment-dialog appointment-dialog--form">
      <button className="appointment-dialog__backdrop" type="button" onClick={onClose} aria-label="Закрыть форму" />
      <section className="appointment-form" role="dialog" aria-modal="true" aria-labelledby="new-appointment-title">
        <header>
          <div>
            <p className="crm-kicker">Ручная запись</p>
            <h2 id="new-appointment-title">Добавить визит</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Закрыть">×</button>
        </header>

        <div className="appointment-form__steps" aria-hidden="true">
          <span className="is-active"><i>1</i> Кто</span>
          <span><i>2</i> Что</span>
          <span><i>3</i> Когда</span>
        </div>

        <form onSubmit={submit}>
          <fieldset disabled={submitting}>
            <div className="crm-field appointment-form__wide">
              <label htmlFor="appointment-client-search">Поиск по базе <small>имя, email или телефон</small></label>
              <input
                id="appointment-client-search"
                ref={firstField}
                type="search"
                value={clientSearch}
                placeholder="Начните вводить — от 2 символов"
                onChange={(event) => {
                  const value = event.target.value;
                  setClientSearch(value);
                  setFormError(null);
                  if (value.trim().length < 2) {
                    setClientOptions(clients);
                    setClientsSearching(false);
                  } else {
                    setClientsSearching(true);
                  }
                }}
              />
            </div>

            <div className="crm-field appointment-form__wide">
              <label htmlFor="appointment-client">Клиент</label>
              <AppSelect
                id="appointment-client"
                value={clientId}
                onValueChange={(value) => {
                  setClientId(value);
                  setClientDetails(null);
                  setPetId("");
                  setPetsLoading(Boolean(value));
                  setFormError(null);
                }}
                placeholder={clientsSearching ? "Ищем клиентов…" : "Выберите клиента"}
                options={clientOptions.map((client) => ({ value: client.id, label: clientLabel(client) }))}
              />
              {!clientsSearching && !clientOptions.length && (
                <p className="appointment-form__hint">Клиенты не найдены. Добавьте клиента в CRM.</p>
              )}
            </div>

            <div className="crm-field appointment-form__wide">
              <label htmlFor="appointment-pet">Питомец</label>
              <AppSelect
                id="appointment-pet"
                value={petId}
                onValueChange={setPetId}
                disabled={!clientId || petsLoading}
                placeholder={petsLoading ? "Загружаем питомцев…" : "Выберите питомца"}
                options={(clientDetails?.pets || []).map((pet) => ({ value: pet.id, label: pet.name + (pet.breed ? " · " + pet.breed : "") }))}
              />
              {clientDetails && !clientDetails.pets.length && (
                <p className="appointment-form__hint appointment-form__hint--error">У клиента пока нет питомцев.</p>
              )}
            </div>

            <div className="crm-field">
              <label htmlFor="appointment-service">Услуга</label>
              <AppSelect
                id="appointment-service"
                value={serviceId}
                onValueChange={setServiceId}
                placeholder="Выберите услугу"
                options={services.map((service) => ({ value: service.id, label: service.name + " · " + formatMoney(service.price) }))}
              />
            </div>

            <div className="crm-field">
              <label htmlFor="appointment-staff">Мастер</label>
              <AppSelect
                id="appointment-staff"
                value={staffId}
                onValueChange={setStaffId}
                placeholder="Любой свободный"
                options={staff
                  .filter((member) => !serviceId || member.serviceIds.includes(serviceId))
                  .map((member) => ({ value: member.id, label: member.name }))}
              />
            </div>

            <div className="crm-field">
              <label htmlFor="appointment-date">Дата</label>
              <DatePicker
                id="appointment-date"
                ariaLabel="Дата визита"
                min={initialDate}
                max={addDays(initialDate, 180)}
                value={date}
                onValueChange={setDate}
                required
              />
            </div>

            <div className="crm-field">
              <label htmlFor="appointment-time">Время</label>
              <AppSelect
                id="appointment-time"
                value={time}
                onValueChange={setTime}
                options={timeOptions.map((value) => ({ value, label: value }))}
              />
            </div>

            <div className="crm-field appointment-form__wide">
              <label htmlFor="appointment-notes">Комментарий <small>необязательно</small></label>
              <textarea
                id="appointment-notes"
                value={notes}
                maxLength={5000}
                placeholder="Пожелания клиента, особенности питомца"
                onChange={(event) => setNotes(event.target.value)}
              />
            </div>

            {selectedService && (
              <div className="appointment-form__total">
                <span>Продолжительность <strong>{selectedService.durationMin} мин</strong></span>
                <span>Стоимость <strong>{formatMoney(selectedService.price)}</strong></span>
              </div>
            )}

            {formError && <p className="crm-form-error appointment-form__wide" role="alert">{formError}</p>}

            <button className="button button--ink appointment-form__submit" type="submit">
              {submitting ? "Добавляем…" : "Добавить запись →"}
            </button>
          </fieldset>
        </form>
      </section>
    </div>
  );
}
