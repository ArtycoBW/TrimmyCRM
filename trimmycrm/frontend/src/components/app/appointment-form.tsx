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

type BookingItemDraft = {
  serviceId: string;
  variantId: string;
  addonIds: string[];
};

function clientLabel(client: ClientView) {
  return client.fullName || client.email || client.phone || "Клиент без имени";
}

function itemEstimate(service: ServiceView, item: BookingItemDraft) {
  const variant = service.variants.find((value) => value.id === item.variantId);
  const addons = service.addons.filter((value) => item.addonIds.includes(value.id));
  return {
    price: Number(service.price) + Number(variant?.priceDelta || 0) +
      addons.reduce((total, value) => total + Number(value.priceDelta), 0),
    duration: service.durationMin + (variant?.durationDeltaMin || 0) +
      addons.reduce((total, value) => total + value.durationDeltaMin, 0),
  };
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
  const [serviceToAdd, setServiceToAdd] = useState("");
  const [items, setItems] = useState<BookingItemDraft[]>([]);
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

  const selectedItems = useMemo(() => items.flatMap((item) => {
    const service = services.find((value) => value.id === item.serviceId);
    return service ? [{ item, service }] : [];
  }), [items, services]);
  const eligibleStaff = useMemo(
    () => staff.filter((member) => items.every((item) => member.serviceIds.includes(item.serviceId))),
    [items, staff],
  );
  const estimate = useMemo(() => selectedItems.reduce(
    (total, value) => {
      const current = itemEstimate(value.service, value.item);
      return { price: total.price + current.price, duration: total.duration + current.duration };
    },
    { price: 0, duration: 0 },
  ), [selectedItems]);

  function commitItems(next: BookingItemDraft[]) {
    setItems(next);
    if (staffId) {
      const selectedStaff = staff.find((member) => member.id === staffId);
      if (!selectedStaff || next.some((item) => !selectedStaff.serviceIds.includes(item.serviceId))) {
        setStaffId("");
      }
    }
    setFormError(null);
  }

  function addService() {
    if (!serviceToAdd || items.some((item) => item.serviceId === serviceToAdd)) return;
    if (items.length >= 10) {
      setFormError("В одной записи может быть не более 10 услуг");
      return;
    }
    commitItems([...items, { serviceId: serviceToAdd, variantId: "", addonIds: [] }]);
    setServiceToAdd("");
  }

  function updateItem(serviceId: string, update: Partial<BookingItemDraft>) {
    commitItems(items.map((item) => item.serviceId === serviceId ? { ...item, ...update } : item));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    if (!clientId || !petId || !items.length || !date || !time) {
      setFormError("Заполните клиента, профиль, услуги, дату и время");
      return;
    }
    const missingVariant = selectedItems.find(
      ({ item, service }) => service.variantSelectionRequired && !item.variantId,
    );
    if (missingVariant) {
      setFormError("Выберите вариант услуги «" + missingVariant.service.name + "»");
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
          items: items.map((item) => ({
            serviceId: item.serviceId,
            variantId: item.variantId || null,
            addonIds: item.addonIds,
          })),
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

            <section className="appointment-form__services appointment-form__wide">
              <div className="appointment-form__service-add">
                <div className="crm-field">
                  <label id="appointment-services-title" htmlFor="appointment-service-add">Услуги визита</label>
                  <AppSelect
                    id="appointment-service-add"
                    value={serviceToAdd}
                    onValueChange={setServiceToAdd}
                    placeholder="Выберите услугу"
                    options={services
                      .filter((service) => !items.some((item) => item.serviceId === service.id))
                      .map((service) => ({
                        value: service.id,
                        label: service.name + " · " + formatMoney(service.price),
                      }))}
                  />
                </div>
                <button
                  className="button appointment-form__service-add-button"
                  type="button"
                  disabled={!serviceToAdd}
                  onClick={addService}
                >
                  Добавить услугу
                </button>
              </div>

              {selectedItems.length ? (
                <ol className="appointment-form__service-list">
                  {selectedItems.map(({ item, service }, index) => {
                    const current = itemEstimate(service, item);
                    return (
                      <li key={service.id}>
                        <header>
                          <span>{String(index + 1).padStart(2, "0")}</span>
                          <div>
                            <strong>{service.name}</strong>
                            <small>{current.duration} мин · {formatMoney(current.price)}</small>
                          </div>
                          <button
                            type="button"
                            onClick={() => commitItems(items.filter((value) => value.serviceId !== service.id))}
                            aria-label={"Убрать услугу «" + service.name + "»"}
                          >
                            Убрать
                          </button>
                        </header>

                        {service.variants.length > 0 && (
                          <div className="crm-field appointment-form__service-variant">
                            <label htmlFor={"appointment-variant-" + service.id}>
                              Вариант {service.variantSelectionRequired ? <small>обязательно</small> : <small>необязательно</small>}
                            </label>
                            <AppSelect
                              id={"appointment-variant-" + service.id}
                              value={item.variantId || (service.variantSelectionRequired ? "__select__" : "__none__")}
                              onValueChange={(value) => updateItem(service.id, {
                                variantId: value === "__none__" || value === "__select__" ? "" : value,
                              })}
                              options={[
                                ...(service.variantSelectionRequired
                                  ? [{ value: "__select__", label: "Выберите вариант", disabled: true }]
                                  : [{ value: "__none__", label: "Без варианта" }]),
                                ...service.variants.map((variant) => ({
                                  value: variant.id,
                                  label: variant.label + " · +" + formatMoney(variant.priceDelta) + " · +" + variant.durationDeltaMin + " мин",
                                })),
                              ]}
                              placeholder="Выберите вариант"
                            />
                          </div>
                        )}

                        {service.addons.length > 0 && (
                          <div className="appointment-form__addons" role="group" aria-label={"Дополнения к услуге «" + service.name + "»"}>
                            <p>Дополнения <small>можно несколько</small></p>
                            <div>
                              {service.addons.map((addon) => (
                                <label key={addon.id}>
                                  <input
                                    type="checkbox"
                                    checked={item.addonIds.includes(addon.id)}
                                    onChange={(event) => updateItem(service.id, {
                                      addonIds: event.target.checked
                                        ? [...item.addonIds, addon.id]
                                        : item.addonIds.filter((value) => value !== addon.id),
                                    })}
                                  />
                                  <span>
                                    <strong>{addon.name}</strong>
                                    <small>+{formatMoney(addon.priceDelta)} · +{addon.durationDeltaMin} мин</small>
                                  </span>
                                </label>
                              ))}
                            </div>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="appointment-form__services-empty">Добавьте одну или несколько услуг визита.</p>
              )}
            </section>

            <div className="crm-field appointment-form__wide">
              <label htmlFor="appointment-staff">Мастер</label>
              <AppSelect
                id="appointment-staff"
                value={staffId}
                onValueChange={setStaffId}
                placeholder="Любой свободный"
                options={eligibleStaff.map((member) => ({ value: member.id, label: member.name }))}
              />
              {items.length > 0 && !eligibleStaff.length && (
                <p className="appointment-form__hint appointment-form__hint--error">Нет мастера, который оказывает весь выбранный набор.</p>
              )}
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
                placeholder="Пожелания клиента и детали визита"
                onChange={(event) => setNotes(event.target.value)}
              />
            </div>

            {selectedItems.length > 0 && (
              <div className="appointment-form__total">
                <span>Предварительная длительность <strong>{estimate.duration} мин</strong></span>
                <span>Предварительная стоимость <strong>{formatMoney(estimate.price)}</strong></span>
                <small>Сервер проверит каталог, мастера и слот перед сохранением.</small>
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
