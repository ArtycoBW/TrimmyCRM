"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";

import { AppSelect } from "@/components/ui/select";
import { ApiError, apiRequest } from "@/lib/api/client";
import type { ClientHairProfileView } from "@/lib/api/types";
import {
  hairDensityOptions,
  hairLengthOptions,
  hairPorosityOptions,
  hairProfileFormSchema,
  hairProfileInitialValues,
  hairProfilePayload,
  hairTextureOptions,
  type HairProfileFormValues,
} from "@/lib/app/hair-profile";

export function HairProfileForm({
  clientId,
  profile,
  onCancel,
  onSaved,
}: {
  clientId: string;
  profile: ClientHairProfileView | null;
  onCancel: () => void;
  onSaved: (value: ClientHairProfileView) => void;
}) {
  const {
    register,
    control,
    handleSubmit,
    setError,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<HairProfileFormValues>({
    resolver: zodResolver(hairProfileFormSchema),
    defaultValues: hairProfileInitialValues(profile),
  });
  const values = useWatch({ control });

  async function submit(formValues: HairProfileFormValues) {
    try {
      const saved = await apiRequest<ClientHairProfileView>(
        `/clients/${clientId}/hair-profile`,
        {
          realm: "platform",
          method: "PUT",
          body: JSON.stringify(hairProfilePayload(formValues, profile?.version || 0)),
        },
      );
      onSaved(saved);
    } catch (reason) {
      setError("root", {
        message: reason instanceof ApiError && reason.code === "hair_profile_version_conflict"
          ? "Профиль изменён в другой вкладке. Закройте форму, обновите карточку и повторите."
          : reason instanceof Error
            ? reason.message
            : "Не удалось сохранить профиль",
      });
    }
  }

  const select = (
    name: "hairLength" | "density" | "texture" | "porosity",
    options: ReadonlyArray<{ value: string; label: string }>,
  ) => (
    <AppSelect
      ariaLabel={{ hairLength: "Длина", density: "Густота", texture: "Текстура", porosity: "Пористость" }[name]}
      value={values[name] || ""}
      onValueChange={(value) => setValue(name, value as HairProfileFormValues[typeof name], { shouldDirty: true })}
      options={[...options]}
    />
  );

  return (
    <form className="hair-profile-form" onSubmit={handleSubmit(submit)} noValidate>
      <fieldset disabled={isSubmitting}>
        <p className="hair-profile-form__notice">
          Записывайте только технические наблюдения и сведения со слов клиента. Не ставьте диагнозы.
        </p>

        <div className="hair-profile-form__grid">
          <label><span>Длина</span>{select("hairLength", hairLengthOptions)}</label>
          <label><span>Густота</span>{select("density", hairDensityOptions)}</label>
          <label><span>Текстура</span>{select("texture", hairTextureOptions)}</label>
          <label><span>Пористость</span>{select("porosity", hairPorosityOptions)}</label>
        </div>

        <div className="hair-profile-form__grid">
          <label>
            <span>Натуральная база</span>
            <input maxLength={160} placeholder="Например, уровень 6" {...register("naturalColor")} />
            {errors.naturalColor && <small>{errors.naturalColor.message}</small>}
          </label>
          <label>
            <span>Текущий цвет</span>
            <input maxLength={160} placeholder="Например, 7.1" {...register("currentColor")} />
            {errors.currentColor && <small>{errors.currentColor.message}</small>}
          </label>
          <label>
            <span>Седина, %</span>
            <input type="number" min="0" max="100" inputMode="numeric" {...register("grayPercentage")} />
            {errors.grayPercentage && <small>{errors.grayPercentage.message}</small>}
          </label>
          <label>
            <span>Длина бороды</span>
            <input maxLength={160} placeholder="Если применимо" {...register("beardLength")} />
            {errors.beardLength && <small>{errors.beardLength.message}</small>}
          </label>
        </div>

        <label className="hair-profile-form__wide">
          <span>Состояние волос</span>
          <textarea maxLength={3000} placeholder="Сухость, ломкость, повреждённые участки — только наблюдаемые признаки" {...register("conditionNotes")} />
          {errors.conditionNotes && <small>{errors.conditionNotes.message}</small>}
        </label>
        <label className="hair-profile-form__wide">
          <span>Чувствительность кожи головы со слов клиента</span>
          <textarea maxLength={3000} placeholder="Не заполняйте без необходимости и согласия клиента" {...register("scalpSensitivityNotes")} />
          {errors.scalpSensitivityNotes && <small>{errors.scalpSensitivityNotes.message}</small>}
        </label>
        <label className="hair-profile-form__wide">
          <span>История окрашивания</span>
          <textarea maxLength={5000} placeholder="Предыдущие техники, осветление, бытовой краситель" {...register("colorHistory")} />
          {errors.colorHistory && <small>{errors.colorHistory.message}</small>}
        </label>

        <div className="hair-profile-form__grid">
          <label>
            <span>Форма бороды</span>
            <input maxLength={500} {...register("beardStyle")} />
            {errors.beardStyle && <small>{errors.beardStyle.message}</small>}
          </label>
          <label>
            <span>Форма усов</span>
            <input maxLength={500} {...register("moustacheStyle")} />
            {errors.moustacheStyle && <small>{errors.moustacheStyle.message}</small>}
          </label>
        </div>

        <label className="hair-profile-form__wide">
          <span>Пожелания клиента</span>
          <textarea maxLength={5000} placeholder="Желаемая форма, длина, привычная укладка, ограничения по времени" {...register("preferences")} />
          {errors.preferences && <small>{errors.preferences.message}</small>}
        </label>

        {errors.root && <p className="hair-profile-form__error" role="alert">{errors.root.message}</p>}
        <div className="hair-profile-form__actions">
          <button type="button" onClick={onCancel}>Отмена</button>
          <button className="button button--ink" type="submit">
            {isSubmitting ? "Сохраняем…" : "Сохранить профиль"}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
