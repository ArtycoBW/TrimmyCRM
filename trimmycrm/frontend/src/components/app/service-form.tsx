"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";

import { apiRequest } from "@/lib/api/client";
import { Input } from "@/components/ui/input";
import { AppSelect } from "@/components/ui/select";
import type { ServiceView } from "@/lib/api/types";
import {
  serviceFormSchema,
  type ServiceFormValues,
} from "@/lib/app/catalog";

export function ServiceForm({
  service,
  categories,
  onClose,
  onSaved,
}: {
  service?: ServiceView | null;
  categories: string[];
  onClose: () => void;
  onSaved: (service: ServiceView) => void;
}) {
  const firstField = useRef<HTMLInputElement>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<ServiceFormValues>({
    resolver: zodResolver(serviceFormSchema),
    defaultValues: {
      name: service?.name || "",
      category: service?.category || "",
      description: service?.description || "",
      price: service ? String(service.price) : "",
      durationMin: service ? String(service.durationMin) : "60",
      bufferBeforeMin: service ? String(service.bufferBeforeMin) : "0",
      bufferAfterMin: service ? String(service.bufferAfterMin) : "15",
      isActive: service?.isActive ?? true,
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

  async function submit(values: ServiceFormValues) {
    setFormError(null);
    try {
      const saved = await apiRequest<ServiceView>(
        service ? "/services/" + service.id : "/services",
        {
          realm: "platform",
          method: service ? "PATCH" : "POST",
          body: JSON.stringify({
            name: values.name,
            description: values.description || null,
            price: Number(values.price.replace(",", ".")),
            durationMin: Number(values.durationMin),
            bufferBeforeMin: Number(values.bufferBeforeMin),
            bufferAfterMin: Number(values.bufferAfterMin),
            category: values.category || null,
            isActive: values.isActive,
          }),
        },
      );
      onSaved(saved);
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : "Не удалось сохранить услугу");
    }
  }

  const nameRegistration = register("name");

  return (
    <div className="appointment-dialog appointment-dialog--form">
      <button className="appointment-dialog__backdrop" type="button" onClick={onClose} aria-label="Закрыть форму" />
      <section className="crm-modal service-form" role="dialog" aria-modal="true" aria-labelledby="service-form-title">
        <header>
          <div>
            <p className="crm-kicker">{service ? "Карточка услуги" : "Новая позиция"}</p>
            <h2 id="service-form-title">{service ? "Редактировать услугу" : "Добавить услугу"}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Закрыть">×</button>
        </header>

        <form onSubmit={handleSubmit(submit)} noValidate>
          <fieldset disabled={isSubmitting}>
            <div className="crm-field crm-modal__wide">
              <label htmlFor="service-name">Название</label>
              <input
                id="service-name"
                placeholder="Комплексный уход"
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
              <label htmlFor="service-category">Категория</label>
              <AppSelect
                id="service-category"
                defaultValue={service?.category || ""}
                placeholder="Выберите категорию"
                onValueChange={(value) => setValue("category", value, { shouldValidate: true })}
                options={[
                  { value: "", label: "Без категории" },
                  ...categories.map((category) => ({ value: category, label: category })),
                ]}
              />
              {errors.category && <p className="crm-field__error">{errors.category.message}</p>}
            </div>

            <div className="crm-field">
              <label htmlFor="service-price">Цена, ₽</label>
              <input id="service-price" inputMode="decimal" placeholder="2400" {...register("price")} />
              {errors.price && <p className="crm-field__error">{errors.price.message}</p>}
            </div>

            <div className="crm-field">
              <label htmlFor="service-duration">Длительность, мин</label>
              <Input id="service-duration" type="text" inputMode="numeric" pattern="[0-9]*" {...register("durationMin")} />
              {errors.durationMin && <p className="crm-field__error">{errors.durationMin.message}</p>}
            </div>

            <div className="crm-field">
              <label htmlFor="service-buffer-before">Подготовка до, мин</label>
              <Input id="service-buffer-before" type="text" inputMode="numeric" pattern="[0-9]*" {...register("bufferBeforeMin")} />
              {errors.bufferBeforeMin && <p className="crm-field__error">{errors.bufferBeforeMin.message}</p>}
            </div>

            <div className="crm-field">
              <label htmlFor="service-buffer-after">Буфер после, мин</label>
              <Input id="service-buffer-after" type="text" inputMode="numeric" pattern="[0-9]*" {...register("bufferAfterMin")} />
              {errors.bufferAfterMin && <p className="crm-field__error">{errors.bufferAfterMin.message}</p>}
            </div>

            <div className="crm-field crm-modal__wide">
              <label htmlFor="service-description">Описание <small>увидит клиент</small></label>
              <textarea
                id="service-description"
                placeholder="Что входит в услугу и для каких питомцев она подходит"
                {...register("description")}
              />
              {errors.description && <p className="crm-field__error">{errors.description.message}</p>}
            </div>

            <label className="crm-consent crm-modal__wide">
              <input type="checkbox" {...register("isActive")} />
              <span aria-hidden="true" />
              <p><strong>Услуга активна</strong> и доступна в календаре и публичной онлайн-записи.</p>
            </label>

            {formError && <p className="crm-form-error crm-modal__wide" role="alert">{formError}</p>}

            <button className="button button--ink crm-modal__submit" type="submit">
              {isSubmitting ? "Сохраняем…" : service ? "Сохранить изменения →" : "Добавить услугу →"}
            </button>
          </fieldset>
        </form>
      </section>
    </div>
  );
}
