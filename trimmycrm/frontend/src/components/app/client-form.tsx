"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";

import { AppSelect } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/api/client";
import type { ClientView } from "@/lib/api/types";
import { clientFormSchema, type ClientFormValues } from "@/lib/app/crm";
import { formatRussianPhone, normalizeRussianPhone } from "@/lib/app/phone";

export function ClientForm({
  client,
  onClose,
  onSaved,
}: {
  client?: ClientView | null;
  onClose: () => void;
  onSaved: (client: ClientView) => void;
}) {
  const firstField = useRef<HTMLInputElement>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<ClientFormValues>({
    resolver: zodResolver(clientFormSchema),
    defaultValues: {
      fullName: client?.fullName || "",
      email: client?.email || "",
      phone: client?.phone ? formatRussianPhone(client.phone) : "",
      consent: false,
      status: (client?.status === "pending" || client?.status === "active" || client?.status === "blocked")
        ? client.status
        : "crm_only",
    },
  });

  useEffect(() => {
    firstField.current?.focus();
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

  async function submit(values: ClientFormValues) {
    setFormError(null);
    try {
      const payload = client
        ? {
            fullName: values.fullName,
            email: values.email || null,
            phone: normalizeRussianPhone(values.phone) || null,
            status: values.status,
          }
        : {
            fullName: values.fullName,
            email: values.email || null,
            phone: normalizeRussianPhone(values.phone) || null,
            consent: values.consent,
          };
      const saved = await apiRequest<ClientView>(client ? "/clients/" + client.id : "/clients", {
        realm: "platform",
        method: client ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      onSaved(saved);
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : "Не удалось сохранить клиента");
    }
  }

  const fullNameRegistration = register("fullName");
  const phoneRegistration = register("phone");

  return (
    <div className="appointment-dialog appointment-dialog--form">
      <button className="appointment-dialog__backdrop" type="button" onClick={onClose} aria-label="Закрыть форму" />
      <section className="crm-modal client-form" role="dialog" aria-modal="true" aria-labelledby="client-form-title">
        <header>
          <div>
            <p className="crm-kicker">{client ? "Карточка клиента" : "Новый контакт"}</p>
            <h2 id="client-form-title">{client ? "Редактировать" : "Добавить клиента"}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Закрыть">×</button>
        </header>

        <form onSubmit={handleSubmit(submit)} noValidate>
          <fieldset disabled={isSubmitting}>
            <div className="crm-field crm-modal__wide">
              <label htmlFor="client-name">Имя и фамилия</label>
              <Input
                id="client-name"
                autoComplete="name"
                placeholder="Анна Петрова"
                aria-invalid={Boolean(errors.fullName)}
                {...fullNameRegistration}
                ref={(element) => {
                  fullNameRegistration.ref(element);
                  firstField.current = element;
                }}
              />
              {errors.fullName && <p className="crm-field__error">{errors.fullName.message}</p>}
            </div>

            <div className="crm-field">
              <label htmlFor="client-phone">Телефон</label>
              <input
                id="client-phone"
                type="tel"
                autoComplete="tel"
                placeholder="+7 (988) 650 16 49"
                aria-invalid={Boolean(errors.phone)}
                {...phoneRegistration}
                onChange={(event) => {
                  event.target.value = formatRussianPhone(event.target.value);
                  void phoneRegistration.onChange(event);
                }}
              />
              {errors.phone && <p className="crm-field__error">{errors.phone.message}</p>}
            </div>

            <div className="crm-field">
              <label htmlFor="client-email">Email</label>
              <input
                id="client-email"
                type="email"
                autoComplete="email"
                placeholder="client@example.ru"
                aria-invalid={Boolean(errors.email)}
                {...register("email")}
              />
              {errors.email && <p className="crm-field__error">{errors.email.message}</p>}
            </div>

            {client ? (
              <div className="crm-field crm-modal__wide">
                <label htmlFor="client-status">Статус доступа</label>
                <AppSelect
                  id="client-status"
                  defaultValue={client.status}
                  onValueChange={(value) => setValue("status", value as ClientFormValues["status"], { shouldValidate: true })}
                  options={[
                    { value: "crm_only", label: "Только CRM" },
                    { value: "pending", label: "Ждёт подтверждения email" },
                    { value: "active", label: "Активен" },
                    { value: "blocked", label: "Заблокирован" },
                  ]}
                />
              </div>
            ) : (
              <label className="crm-consent crm-modal__wide">
                <input type="checkbox" {...register("consent")} />
                <span aria-hidden="true" />
                <p><strong>Подтверждаю, что салон получил согласие клиента или располагает иным законным основанием</strong> для обработки его данных. Эта отметка не является согласием, данным от имени клиента. <a href="/data-processing-instructions" target="_blank" rel="noreferrer">Подробнее о поручении</a>.</p>
              </label>
            )}

            {formError && <p className="crm-form-error crm-modal__wide" role="alert">{formError}</p>}

            <button className="button button--ink crm-modal__submit" type="submit">
              {isSubmitting ? "Сохраняем…" : client ? "Сохранить изменения →" : "Добавить клиента →"}
            </button>
          </fieldset>
        </form>
      </section>
    </div>
  );
}
