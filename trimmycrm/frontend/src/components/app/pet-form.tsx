"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import { AppSelect } from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import { apiRequest } from "@/lib/api/client";
import type { ClientView, Paginated, PetView } from "@/lib/api/types";
import { petFormSchema, type PetFormValues } from "@/lib/app/crm";

function clientLabel(client?: ClientView) {
  return client?.fullName || client?.email || client?.phone || "Клиент без имени";
}

export function PetForm({
  clients,
  fixedClientId,
  onClose,
  onSaved,
}: {
  clients: ClientView[];
  fixedClientId?: string;
  onClose: () => void;
  onSaved: (pet: PetView) => void;
}) {
  const firstField = useRef<HTMLInputElement>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [clientSearch, setClientSearch] = useState("");
  const [clientOptions, setClientOptions] = useState(clients);
  const [clientsSearching, setClientsSearching] = useState(false);
  const {
    register,
    handleSubmit,
    setValue,
    control,
    formState: { errors, isSubmitting },
  } = useForm<PetFormValues>({
    resolver: zodResolver(petFormSchema),
    defaultValues: {
      clientId: fixedClientId || "",
      name: "",
      species: "dog",
      breed: "",
      birthDate: "",
      weightKg: "",
      coatType: "",
      temperament: "",
      allergies: "",
      medicalNotes: "",
      vaccinatedUntil: "",
    },
  });

  useEffect(() => {
    if (fixedClientId || clientSearch.trim().length < 2) return;
    const timer = window.setTimeout(() => {
      apiRequest<Paginated<ClientView>>(
        "/clients?page=1&limit=100&search=" + encodeURIComponent(clientSearch.trim()),
        { realm: "platform" },
      )
        .then((value) => setClientOptions(value.items))
        .catch((reason) => setFormError(
          reason instanceof Error ? reason.message : "Не удалось найти владельца"
        ))
        .finally(() => setClientsSearching(false));
    }, 280);
    return () => window.clearTimeout(timer);
  }, [clientSearch, fixedClientId]);

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

  async function submit(values: PetFormValues) {
    setFormError(null);
    try {
      const pet = await apiRequest<PetView>("/clients/" + values.clientId + "/pets", {
        realm: "platform",
        method: "POST",
        body: JSON.stringify({
          name: values.name,
          species: values.species,
          breed: values.breed || null,
          birthDate: values.birthDate || null,
          weightKg: values.weightKg ? Number(values.weightKg) : null,
          coatType: values.coatType || null,
          temperament: values.temperament || null,
          allergies: values.allergies || null,
          medicalNotes: values.medicalNotes || null,
          vaccinatedUntil: values.vaccinatedUntil || null,
        }),
      });
      onSaved(pet);
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : "Не удалось добавить питомца");
    }
  }

  const nameRegistration = register("name");
  const birthDate = useWatch({ control, name: "birthDate" });
  const vaccinatedUntil = useWatch({ control, name: "vaccinatedUntil" });

  return (
    <div className="appointment-dialog appointment-dialog--form">
      <button className="appointment-dialog__backdrop" type="button" onClick={onClose} aria-label="Закрыть форму" />
      <section className="crm-modal pet-form" role="dialog" aria-modal="true" aria-labelledby="pet-form-title">
        <header>
          <div>
            <p className="crm-kicker">Новая карточка</p>
            <h2 id="pet-form-title">Добавить питомца</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Закрыть">×</button>
        </header>

        <form onSubmit={handleSubmit(submit)} noValidate>
          <fieldset disabled={isSubmitting}>
            {fixedClientId ? (
              <div className="crm-field crm-modal__wide">
                <label>Владелец</label>
                <input type="hidden" {...register("clientId")} />
                <div className="crm-readonly-field">
                  {clientLabel(clients.find((client) => client.id === fixedClientId) || clients[0])}
                </div>
              </div>
            ) : (
              <>
                <div className="crm-field crm-modal__wide">
                  <label htmlFor="pet-owner-search">Поиск владельца <small>имя, email или телефон</small></label>
                  <input
                    id="pet-owner-search"
                    type="search"
                    value={clientSearch}
                    placeholder="Начните вводить — от 2 символов"
                    onChange={(event) => {
                      const value = event.target.value;
                      setClientSearch(value);
                      if (value.trim().length < 2) {
                        setClientOptions(clients);
                        setClientsSearching(false);
                      } else {
                        setClientsSearching(true);
                      }
                    }}
                  />
                </div>
                <div className="crm-field crm-modal__wide">
                  <label htmlFor="pet-owner">Владелец</label>
                  <AppSelect
                    id="pet-owner"
                    placeholder={clientsSearching ? "Ищем клиентов…" : "Выберите клиента"}
                    onValueChange={(value) => setValue("clientId", value, { shouldValidate: true })}
                    options={clientOptions.map((client) => ({ value: client.id, label: clientLabel(client) }))}
                  />
                  {errors.clientId && <p className="crm-field__error">{errors.clientId.message}</p>}
                </div>
              </>
            )}

            <div className="crm-field">
              <label htmlFor="pet-name">Кличка</label>
              <input
                id="pet-name"
                placeholder="Боня"
                aria-invalid={Boolean(errors.name)}
                {...nameRegistration}
                ref={(element) => {
                  nameRegistration.ref(element);
                  firstField.current = element;
                }}
              />
              {errors.name && <p className="crm-field__error">{errors.name.message}</p>}
            </div>

            <div className="crm-field">
              <label htmlFor="pet-species">Вид</label>
              <AppSelect
                id="pet-species"
                defaultValue="dog"
                onValueChange={(value) => setValue("species", value as PetFormValues["species"], { shouldValidate: true })}
                options={[
                  { value: "dog", label: "Собака" },
                  { value: "cat", label: "Кошка" },
                  { value: "other", label: "Другой" },
                ]}
              />
            </div>

            <div className="crm-field">
              <label htmlFor="pet-breed">Порода</label>
              <input id="pet-breed" placeholder="Шпиц" {...register("breed")} />
              {errors.breed && <p className="crm-field__error">{errors.breed.message}</p>}
            </div>

            <div className="crm-field">
              <label htmlFor="pet-weight">Вес, кг</label>
              <input id="pet-weight" inputMode="decimal" placeholder="4.8" {...register("weightKg")} />
              {errors.weightKg && <p className="crm-field__error">{errors.weightKg.message}</p>}
            </div>

            <div className="crm-field">
              <label htmlFor="pet-birth-date">Дата рождения</label>
              <DatePicker id="pet-birth-date" ariaLabel="Дата рождения питомца" value={birthDate} onValueChange={(value) => setValue("birthDate", value, { shouldDirty: true, shouldValidate: true })} max={new Date().toISOString().slice(0, 10)} clearable />
              <input type="hidden" {...register("birthDate")} />
            </div>

            <div className="crm-field">
              <label htmlFor="pet-vaccination">Прививки действуют до</label>
              <DatePicker id="pet-vaccination" ariaLabel="Срок действия прививок" value={vaccinatedUntil} onValueChange={(value) => setValue("vaccinatedUntil", value, { shouldDirty: true, shouldValidate: true })} clearable />
              <input type="hidden" {...register("vaccinatedUntil")} />
            </div>

            <div className="crm-field crm-modal__wide">
              <label htmlFor="pet-coat">Тип шерсти</label>
              <input id="pet-coat" placeholder="Двойная, густой подшёрсток" {...register("coatType")} />
            </div>

            <div className="crm-field crm-modal__wide">
              <label htmlFor="pet-temperament">Характер и поведение</label>
              <textarea id="pet-temperament" placeholder="Спокойный, не любит фен у морды" {...register("temperament")} />
            </div>

            <div className="crm-field">
              <label htmlFor="pet-allergies">Аллергии</label>
              <textarea id="pet-allergies" placeholder="Если есть" {...register("allergies")} />
            </div>

            <div className="crm-field">
              <label htmlFor="pet-medical">Медицинские заметки</label>
              <textarea id="pet-medical" placeholder="Важные ограничения" {...register("medicalNotes")} />
            </div>

            {formError && <p className="crm-form-error crm-modal__wide" role="alert">{formError}</p>}

            <button className="button button--ink crm-modal__submit" type="submit">
              {isSubmitting ? "Добавляем…" : "Добавить питомца →"}
            </button>
          </fieldset>
        </form>
      </section>
    </div>
  );
}
