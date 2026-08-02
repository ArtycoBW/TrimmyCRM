"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import { Input } from "@/components/ui/input";
import { AppSelect } from "@/components/ui/select";
import { apiRequest } from "@/lib/api/client";
import type {
  ServiceAudience,
  ServiceCategoryView,
  ServiceView,
} from "@/lib/api/types";
import {
  buildServicePayload,
  serviceAudienceOptions,
  serviceFormSchema,
  type ServiceFormValues,
  servicePriceTypeOptions,
} from "@/lib/app/catalog";

export function ServiceForm({
  service,
  categories,
  onCategoryCreated,
  onClose,
  onSaved,
}: {
  service?: ServiceView | null;
  categories: ServiceCategoryView[];
  onCategoryCreated: (category: ServiceCategoryView) => void;
  onClose: () => void;
  onSaved: (service: ServiceView) => void;
}) {
  const firstField = useRef<HTMLInputElement>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryAudience, setNewCategoryAudience] = useState<ServiceAudience>("all");
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [creatingCategory, setCreatingCategory] = useState(false);
  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<ServiceFormValues>({
    resolver: zodResolver(serviceFormSchema),
    defaultValues: {
      name: service?.name || "",
      categoryId: service?.categoryId || "uncategorized",
      description: service?.description || "",
      priceType: service?.priceType || "fixed",
      price: service ? String(service.price) : "",
      maxPrice: service?.maxPrice === null || service?.maxPrice === undefined
        ? ""
        : String(service.maxPrice),
      durationMin: service ? String(service.durationMin) : "60",
      bufferBeforeMin: service ? String(service.bufferBeforeMin) : "0",
      bufferAfterMin: service ? String(service.bufferAfterMin) : "15",
      requiresConsultation: service?.requiresConsultation ?? false,
      requiresPatchTest: service?.requiresPatchTest ?? false,
      allowOnlineBooking: service?.allowOnlineBooking ?? true,
      variantSelectionRequired: service?.variantSelectionRequired ?? false,
      preparationText: service?.preparationText || "",
      aftercareText: service?.aftercareText || "",
      isActive: service?.isActive ?? true,
    },
  });
  const categoryId = useWatch({ control, name: "categoryId" });
  const priceType = useWatch({ control, name: "priceType" });

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

  async function createCategory() {
    const name = newCategoryName.trim();
    if (name.length < 2) {
      setCategoryError("Введите название категории");
      return;
    }
    setCreatingCategory(true);
    setCategoryError(null);
    try {
      const category = await apiRequest<ServiceCategoryView>("/service-categories", {
        realm: "platform",
        method: "POST",
        body: JSON.stringify({
          name,
          slug: "category-" + crypto.randomUUID().slice(0, 12),
          audience: newCategoryAudience,
          sortOrder: categories.length * 10,
          isActive: true,
        }),
      });
      onCategoryCreated(category);
      setValue("categoryId", category.id, { shouldDirty: true, shouldValidate: true });
      setNewCategoryName("");
    } catch (reason) {
      setCategoryError(reason instanceof Error ? reason.message : "Не удалось создать категорию");
    } finally {
      setCreatingCategory(false);
    }
  }

  async function submit(values: ServiceFormValues) {
    setFormError(null);
    try {
      const saved = await apiRequest<ServiceView>(
        service ? "/services/" + service.id : "/services",
        {
          realm: "platform",
          method: service ? "PATCH" : "POST",
          body: JSON.stringify(buildServicePayload(values)),
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
          <fieldset disabled={isSubmitting || creatingCategory}>
            <div className="crm-field crm-modal__wide">
              <label htmlFor="service-name">Название</label>
              <input
                id="service-name"
                placeholder="Стрижка и укладка"
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
                value={categoryId}
                placeholder="Выберите категорию"
                onValueChange={(value) => setValue("categoryId", value, { shouldDirty: true })}
                options={[
                  { value: "uncategorized", label: "Без категории" },
                  ...categories.filter((category) => category.isActive).map((category) => ({
                    value: category.id,
                    label: category.name,
                  })),
                ]}
              />
            </div>

            <div className="crm-field">
              <label htmlFor="service-price-type">Формат цены</label>
              <AppSelect
                id="service-price-type"
                value={priceType}
                onValueChange={(value) => setValue(
                  "priceType",
                  value as ServiceFormValues["priceType"],
                  { shouldDirty: true, shouldValidate: true },
                )}
                options={servicePriceTypeOptions}
              />
            </div>

            <details className="service-category-create crm-modal__wide">
              <summary>+ Создать категорию</summary>
              <div>
                <div className="crm-field">
                  <label htmlFor="new-service-category">Название категории</label>
                  <input
                    id="new-service-category"
                    value={newCategoryName}
                    onChange={(event) => setNewCategoryName(event.target.value)}
                    placeholder="Окрашивание"
                  />
                </div>
                <div className="crm-field">
                  <label htmlFor="new-service-audience">Направление</label>
                  <AppSelect
                    id="new-service-audience"
                    value={newCategoryAudience}
                    onValueChange={(value) => setNewCategoryAudience(value as ServiceAudience)}
                    options={serviceAudienceOptions}
                  />
                </div>
                <button className="button" type="button" onClick={() => void createCategory()}>
                  {creatingCategory ? "Создаём…" : "Добавить категорию"}
                </button>
              </div>
              {categoryError && <p className="crm-field__error" role="alert">{categoryError}</p>}
            </details>

            <div className="crm-field">
              <label htmlFor="service-price">
                {priceType === "range" ? "Цена от, ₽" : "Базовая цена, ₽"}
              </label>
              <input id="service-price" inputMode="decimal" placeholder="3000" {...register("price")} />
              {errors.price && <p className="crm-field__error">{errors.price.message}</p>}
            </div>

            {priceType === "range" && (
              <div className="crm-field">
                <label htmlFor="service-max-price">Цена до, ₽</label>
                <input id="service-max-price" inputMode="decimal" placeholder="5000" {...register("maxPrice")} />
                {errors.maxPrice && <p className="crm-field__error">{errors.maxPrice.message}</p>}
              </div>
            )}

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
                placeholder="Что входит в услугу и как подготовиться к визиту"
                {...register("description")}
              />
              {errors.description && <p className="crm-field__error">{errors.description.message}</p>}
            </div>

            <div className="crm-field">
              <label htmlFor="service-preparation">Подготовка клиента</label>
              <textarea id="service-preparation" placeholder="Например: прийти с чистыми волосами" {...register("preparationText")} />
              {errors.preparationText && <p className="crm-field__error">{errors.preparationText.message}</p>}
            </div>

            <div className="crm-field">
              <label htmlFor="service-aftercare">Рекомендации после</label>
              <textarea id="service-aftercare" placeholder="Домашний уход после процедуры" {...register("aftercareText")} />
              {errors.aftercareText && <p className="crm-field__error">{errors.aftercareText.message}</p>}
            </div>

            <div className="service-policy-grid crm-modal__wide">
              <label className="crm-consent">
                <input type="checkbox" {...register("requiresConsultation")} />
                <span aria-hidden="true" />
                <p><strong>Нужна консультация</strong> перед подтверждением результата и цены.</p>
              </label>
              <label className="crm-consent">
                <input type="checkbox" {...register("requiresPatchTest")} />
                <span aria-hidden="true" />
                <p><strong>Нужен патч-тест</strong> — это журнал проверки, не медицинский вывод.</p>
              </label>
              <label className="crm-consent">
                <input type="checkbox" {...register("variantSelectionRequired")} />
                <span aria-hidden="true" />
                <p><strong>Вариант обязателен</strong> — например, длина или сложность.</p>
              </label>
              <label className="crm-consent">
                <input type="checkbox" {...register("allowOnlineBooking")} />
                <span aria-hidden="true" />
                <p><strong>Доступна онлайн</strong> на опубликованном сайте салона.</p>
              </label>
              <label className="crm-consent">
                <input type="checkbox" {...register("isActive")} />
                <span aria-hidden="true" />
                <p><strong>Услуга активна</strong> и доступна мастерам в календаре.</p>
              </label>
            </div>

            <p className="service-form__options-note crm-modal__wide">
              Варианты длины и дополнительные услуги можно добавить в карточке после сохранения.
            </p>

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
