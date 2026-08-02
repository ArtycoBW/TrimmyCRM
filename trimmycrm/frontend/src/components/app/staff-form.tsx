"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useForm } from "react-hook-form";

import { WeeklyScheduleEditor } from "@/components/app/weekly-schedule-editor";
import { apiRequest } from "@/lib/api/client";
import type {
  MediaView,
  ServiceView,
  SiteView,
  StaffView,
} from "@/lib/api/types";
import {
  compactSchedule,
  normalizeSchedule,
  staffFormSchema,
  staffInitials,
  validateSchedule,
  type StaffFormValues,
} from "@/lib/app/catalog";

const allowedPhotoTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxPhotoBytes = 10 * 1024 * 1024;

export function StaffForm({
  member,
  services,
  salonSchedule,
  onClose,
  onSaved,
}: {
  member?: StaffView | null;
  services: ServiceView[];
  salonSchedule: SiteView["workHours"];
  onClose: () => void;
  onSaved: (member: StaffView, notice?: string) => void;
}) {
  const firstField = useRef<HTMLInputElement>(null);
  const activeServices = useMemo(() => services.filter((service) => service.isActive), [services]);
  const activeServiceIds = useMemo(() => new Set(activeServices.map((service) => service.id)), [activeServices]);
  const [formError, setFormError] = useState<string | null>(null);
  const [selectedServiceIds, setSelectedServiceIds] = useState(
    () => member?.serviceIds.filter((id) => activeServiceIds.has(id)) || [],
  );
  const [inheritSchedule, setInheritSchedule] = useState(
    () => !member || Object.keys(member.schedule || {}).length === 0,
  );
  const [schedule, setSchedule] = useState(() =>
    normalizeSchedule(
      member && Object.keys(member.schedule || {}).length ? member.schedule : salonSchedule,
    )
  );
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<StaffFormValues>({
    resolver: zodResolver(staffFormSchema),
    defaultValues: {
      name: member?.name || "",
      email: "",
      specialization: member?.specialization || "",
      isActive: member?.isActive ?? true,
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

  useEffect(() => {
    return () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview);
    };
  }, [photoPreview]);

  async function submit(values: StaffFormValues) {
    setFormError(null);
    if (!inheritSchedule) {
      const scheduleError = validateSchedule(schedule);
      if (scheduleError) {
        setFormError(scheduleError);
        return;
      }
    }

    try {
      const payload = {
        name: values.name,
        specialization: values.specialization || null,
        schedule: inheritSchedule ? {} : compactSchedule(schedule),
        serviceIds: selectedServiceIds,
        isActive: values.isActive,
        ...(member ? {} : { email: values.email || null }),
      };
      let saved = await apiRequest<StaffView>(member ? "/staff/" + member.id : "/staff", {
        realm: "platform",
        method: member ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });

      if (photoFile) {
        const formData = new FormData();
        formData.append("file", photoFile);
        formData.append("purpose", "staff");
        formData.append("targetId", saved.id);
        try {
          const media = await apiRequest<MediaView>("/media", {
            realm: "platform",
            method: "POST",
            body: formData,
          });
          saved = { ...saved, photoUrl: media.url };
        } catch (reason) {
          onSaved(
            saved,
            "Данные сохранены, но фото не загрузилось: " +
              (reason instanceof Error ? reason.message : "повторите позже"),
          );
          return;
        }
      }
      onSaved(saved);
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : "Не удалось сохранить мастера");
    }
  }

  const nameRegistration = register("name");
  const portraitStyle = (photoPreview || member?.photoUrl)
    ? { backgroundImage: 'url("' + (photoPreview || member?.photoUrl) + '")' } as CSSProperties
    : undefined;

  return (
    <div className="appointment-dialog appointment-dialog--form">
      <button className="appointment-dialog__backdrop" type="button" onClick={onClose} aria-label="Закрыть форму" />
      <section className="crm-modal staff-form" role="dialog" aria-modal="true" aria-labelledby="staff-form-title">
        <header>
          <div>
            <p className="crm-kicker">{member ? "Профиль мастера" : "Новый участник"}</p>
            <h2 id="staff-form-title">{member ? "Редактировать мастера" : "Добавить в команду"}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Закрыть">×</button>
        </header>

        <form onSubmit={handleSubmit(submit)} noValidate>
          <fieldset disabled={isSubmitting}>
            <section className="staff-form__identity crm-modal__wide">
              <div className={"staff-photo-preview" + (portraitStyle ? " has-photo" : "")} style={portraitStyle}>
                {!portraitStyle && <span>{staffInitials(member?.name || "М")}</span>}
              </div>
              <div>
                <label className="staff-photo-upload">
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(event) => {
                      const file = event.target.files?.[0] || null;
                      if (file && (!allowedPhotoTypes.has(file.type) || file.size > maxPhotoBytes)) {
                        setFormError("Фото должно быть JPEG, PNG или WebP размером до 10 МБ");
                        event.target.value = "";
                        setPhotoFile(null);
                        setPhotoPreview(null);
                        return;
                      }
                      setFormError(null);
                      setPhotoFile(file);
                      setPhotoPreview(file ? URL.createObjectURL(file) : null);
                    }}
                  />
                  <span>{photoFile ? "Выбрать другое фото" : member?.photoUrl ? "Обновить фото" : "Добавить фото"}</span>
                </label>
                <p>JPEG, PNG или WebP · до 10 МБ. Фото будет видно на сайте салона.</p>
              </div>
            </section>

            <div className="crm-field">
              <label htmlFor="staff-name">Имя и фамилия</label>
              <input
                id="staff-name"
                placeholder="Мария Волкова"
                aria-invalid={Boolean(errors.name)}
                {...nameRegistration}
                ref={(element) => {
                  nameRegistration.ref(element);
                  firstField.current = element;
                }}
              />
              {errors.name && <p className="crm-field__error">{errors.name.message}</p>}
            </div>

            {!member && (
              <div className="crm-field">
                <label htmlFor="staff-email">Email <small>необязательно</small></label>
                <input id="staff-email" type="email" placeholder="master@example.ru" {...register("email")} />
                {errors.email && <p className="crm-field__error">{errors.email.message}</p>}
              </div>
            )}

            <div className={"crm-field " + (member ? "" : "crm-modal__wide")}>
              <label htmlFor="staff-specialization">Специализация</label>
              <input
                id="staff-specialization"
                placeholder="Грумер · тримминг и экспресс-линька"
                {...register("specialization")}
              />
              {errors.specialization && <p className="crm-field__error">{errors.specialization.message}</p>}
            </div>

            <section className="staff-services-picker crm-modal__wide">
              <header>
                <div><p className="crm-kicker">Услуги мастера</p><span>{selectedServiceIds.length}</span></div>
                {selectedServiceIds.length > 0 && (
                  <button type="button" onClick={() => setSelectedServiceIds([])}>Снять все</button>
                )}
              </header>
              {activeServices.length ? (
                <div>
                  {activeServices.map((service) => (
                    <label key={service.id}>
                      <input
                        type="checkbox"
                        checked={selectedServiceIds.includes(service.id)}
                        onChange={(event) => setSelectedServiceIds((current) =>
                          event.target.checked
                            ? [...current, service.id]
                            : current.filter((id) => id !== service.id)
                        )}
                      />
                      <span aria-hidden="true" />
                      <p><strong>{service.name}</strong><small>{service.category || "Без категории"}</small></p>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="staff-services-picker__empty">Сначала добавьте активные услуги.</p>
              )}
            </section>

            <section className="staff-schedule-mode crm-modal__wide">
              <header>
                <div>
                  <p className="crm-kicker">Рабочий график</p>
                  <p>Пустой персональный график наследует часы салона.</p>
                </div>
                <div role="group" aria-label="Режим рабочего графика">
                  <button type="button" className={inheritSchedule ? "is-active" : ""} onClick={() => setInheritSchedule(true)}>
                    Как у салона
                  </button>
                  <button type="button" className={!inheritSchedule ? "is-active" : ""} onClick={() => setInheritSchedule(false)}>
                    Свои смены
                  </button>
                </div>
              </header>
              {!inheritSchedule && <WeeklyScheduleEditor schedule={schedule} onChange={setSchedule} />}
            </section>

            <label className="crm-consent crm-modal__wide">
              <input type="checkbox" {...register("isActive")} />
              <span aria-hidden="true" />
              <p><strong>Мастер активен</strong> и доступен для назначения в календаре и онлайн-записи.</p>
            </label>

            {formError && <p className="crm-form-error crm-modal__wide" role="alert">{formError}</p>}

            <button className="button button--ink crm-modal__submit" type="submit">
              {isSubmitting ? "Сохраняем…" : member ? "Сохранить профиль →" : "Добавить мастера →"}
            </button>
          </fieldset>
        </form>
      </section>
    </div>
  );
}
