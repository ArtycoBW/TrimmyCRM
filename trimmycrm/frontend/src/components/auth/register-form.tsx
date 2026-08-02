"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import { CheckEmailCard } from "@/components/auth/check-email-card";
import {
  platformRegisterSchema,
  registerSchema,
  type RegisterValues,
} from "@/components/auth/auth-schemas";
import { authErrorMessage, passwordChecks } from "@/components/auth/auth-utils";
import { PasswordField } from "@/components/auth/password-field";
import { useAuthRealm } from "@/components/auth/use-auth-realm";
import { useHydrated } from "@/hooks/use-hydrated";
import { formatRussianPhone, normalizeRussianPhone } from "@/lib/app/phone";
import { salonTypeOptions } from "@/lib/app/salon-profile";
import { authRequest } from "@/lib/api/client";

export function RegisterForm() {
  const realm = useAuthRealm();
  const hydrated = useHydrated();
  const [formError, setFormError] = useState<string | null>(null);
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<RegisterValues>({
    resolver: zodResolver(realm === "platform" ? platformRegisterSchema : registerSchema),
    defaultValues: {
      email: "",
      phone: "",
      password: "",
      passwordConfirm: "",
      termsAccepted: false,
      consent: false,
      dataProcessingInstructionAccepted: false,
      salonName: "",
      salonType: undefined,
      city: "",
      timezone: "Europe/Moscow",
    },
  });
  const password = useWatch({ control, name: "password" });
  const phoneRegistration = register("phone");

  async function onSubmit(values: RegisterValues) {
    setFormError(null);
    try {
      const payload = {
        email: values.email,
        phone: normalizeRussianPhone(values.phone),
        password: values.password,
        passwordConfirm: values.passwordConfirm,
        termsAccepted: values.termsAccepted,
        consent: values.consent,
        ...(realm === "platform"
          ? { dataProcessingInstructionAccepted: values.dataProcessingInstructionAccepted }
          : {}),
        ...(realm === "platform"
          ? {
              salonName: values.salonName,
              salonType: values.salonType,
              city: values.city || null,
              timezone: values.timezone || "Europe/Moscow",
            }
          : {}),
      };
      await authRequest(realm, "register", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setRegisteredEmail(values.email);
    } catch (reason) {
      setFormError(authErrorMessage(reason));
    }
  }

  if (registeredEmail) {
    return <CheckEmailCard email={registeredEmail} realm={realm} />;
  }

  return (
    <div className="auth-form-card auth-form-card--wide">
      <div className="auth-form-heading">
        <p className="auth-kicker">14 дней бесплатно</p>
        <h2>{realm === "platform" ? "Создать аккаунт" : "Стать клиентом салона"}</h2>
        <p>{realm === "platform" ? "Карта не нужна. Сначала соберите всё под себя." : "Выбирайте услуги и записывайтесь онлайн."}</p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <fieldset className="auth-fieldset" disabled={!hydrated || isSubmitting}>
        <div className="auth-field">
          <label htmlFor="register-email">Email</label>
          <div className={`auth-input-wrap${errors.email ? " auth-input-wrap--error" : ""}`}>
            <input
              id="register-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="name@example.ru"
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? "register-email-error" : undefined}
              {...register("email")}
            />
          </div>
          {errors.email && <p className="auth-field__error" id="register-email-error">{errors.email.message}</p>}
        </div>

        <div className="auth-field">
          <label htmlFor="register-phone">Телефон</label>
          <div className={`auth-input-wrap${errors.phone ? " auth-input-wrap--error" : ""}`}>
            <input
              id="register-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="+7 (900) 000-00-00"
              aria-invalid={Boolean(errors.phone)}
              aria-describedby={errors.phone ? "register-phone-error" : undefined}
              {...phoneRegistration}
              onChange={(event) => {
                event.target.value = formatRussianPhone(event.target.value);
                void phoneRegistration.onChange(event);
              }}
            />
          </div>
          {errors.phone && <p className="auth-field__error" id="register-phone-error">{errors.phone.message}</p>}
        </div>

        {realm === "platform" && <div className="auth-salon-profile">
          <div className="auth-field">
            <label htmlFor="register-salon-name">Название салона</label>
            <div className={`auth-input-wrap${errors.salonName ? " auth-input-wrap--error" : ""}`}>
              <input
                id="register-salon-name"
                type="text"
                autoComplete="organization"
                placeholder="Например, ФОРМА"
                aria-invalid={Boolean(errors.salonName)}
                aria-describedby={errors.salonName ? "register-salon-name-error" : undefined}
                {...register("salonName")}
              />
            </div>
            {errors.salonName && <p className="auth-field__error" id="register-salon-name-error">{errors.salonName.message}</p>}
          </div>

          <fieldset className="auth-salon-types" aria-describedby={errors.salonType ? "register-salon-type-error" : undefined}>
            <legend>Тип салона</legend>
            <div>
              {salonTypeOptions.map((option) => (
                <label key={option.value}>
                  <input type="radio" value={option.value} {...register("salonType")} />
                  <span><strong>{option.label}</strong><small>{option.description}</small></span>
                </label>
              ))}
            </div>
            {errors.salonType && <p className="auth-field__error" id="register-salon-type-error">{errors.salonType.message}</p>}
          </fieldset>

          <div className="auth-location-grid">
            <div className="auth-field">
              <label htmlFor="register-city">Город</label>
              <div className={`auth-input-wrap${errors.city ? " auth-input-wrap--error" : ""}`}>
                <input id="register-city" type="text" autoComplete="address-level2" placeholder="Москва" {...register("city")} />
              </div>
              {errors.city && <p className="auth-field__error">{errors.city.message}</p>}
            </div>
            <div className="auth-field">
              <label htmlFor="register-timezone">Часовой пояс</label>
              <div className={`auth-input-wrap${errors.timezone ? " auth-input-wrap--error" : ""}`}>
                <select id="register-timezone" {...register("timezone")}>
                  <option value="Europe/Kaliningrad">Калининград · UTC+2</option>
                  <option value="Europe/Moscow">Москва · UTC+3</option>
                  <option value="Europe/Samara">Самара · UTC+4</option>
                  <option value="Asia/Yekaterinburg">Екатеринбург · UTC+5</option>
                  <option value="Asia/Omsk">Омск · UTC+6</option>
                  <option value="Asia/Krasnoyarsk">Красноярск · UTC+7</option>
                  <option value="Asia/Irkutsk">Иркутск · UTC+8</option>
                  <option value="Asia/Yakutsk">Якутск · UTC+9</option>
                  <option value="Asia/Vladivostok">Владивосток · UTC+10</option>
                  <option value="Asia/Magadan">Магадан · UTC+11</option>
                  <option value="Asia/Kamchatka">Камчатка · UTC+12</option>
                </select>
              </div>
              {errors.timezone && <p className="auth-field__error">{errors.timezone.message}</p>}
            </div>
          </div>
        </div>}

        <PasswordField
          id="register-password"
          label="Пароль"
          autoComplete="new-password"
          registration={register("password")}
          error={errors.password?.message}
          hint={
            <ul className="password-checks" aria-label="Требования к паролю">
              {passwordChecks(password || "").map((check) => (
                <li className={check.met ? "is-met" : ""} key={check.label}>
                  <span aria-hidden="true">{check.met ? "✓" : "·"}</span>{check.label}
                </li>
              ))}
            </ul>
          }
        />

        <PasswordField
          id="register-password-confirm"
          label="Повторите пароль"
          autoComplete="new-password"
          registration={register("passwordConfirm")}
          error={errors.passwordConfirm?.message}
        />

        <div className="auth-consents">
        <label className={`auth-checkbox${errors.termsAccepted ? " auth-checkbox--error" : ""}`}>
          <input type="checkbox" {...register("termsAccepted")} />
          <span aria-hidden="true" />
          <span>Я принимаю <a href="/terms" target="_blank" rel="noreferrer">условия использования TrimmyCRM</a>.</span>
        </label>
        {errors.termsAccepted && <p className="auth-field__error">{errors.termsAccepted.message}</p>}

        <label className={`auth-checkbox${errors.consent ? " auth-checkbox--error" : ""}`}>
          <input type="checkbox" {...register("consent")} />
          <span aria-hidden="true" />
          <span>Я даю отдельное <a href={realm === "platform" ? "/consent" : "/client-consent"} target="_blank" rel="noreferrer">согласие на обработку персональных данных</a> и ознакомлен(а) с <a href="/privacy" target="_blank" rel="noreferrer">Политикой</a>.</span>
        </label>
        {errors.consent && <p className="auth-field__error">{errors.consent.message}</p>}
        {realm === "platform" && <>
          <label className={`auth-checkbox${errors.dataProcessingInstructionAccepted ? " auth-checkbox--error" : ""}`}>
            <input type="checkbox" {...register("dataProcessingInstructionAccepted")} />
            <span aria-hidden="true" />
            <span>Я принимаю <a href="/data-processing-instructions" target="_blank" rel="noreferrer">поручение на обработку клиентской базы салона</a>.</span>
          </label>
          {errors.dataProcessingInstructionAccepted && <p className="auth-field__error">{errors.dataProcessingInstructionAccepted.message}</p>}
        </>}
        </div>

        {formError && <p className="auth-alert auth-alert--error" role="alert">{formError}</p>}

        <button className="button button--ink auth-submit" type="submit" disabled={!hydrated || isSubmitting}>
          {isSubmitting ? "Создаём…" : "Создать аккаунт →"}
        </button>
        </fieldset>
      </form>

      <p className="auth-switch">Уже зарегистрированы? <a href="/login">Войти</a></p>
    </div>
  );
}
