"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { useState } from "react";
import { Controller, useForm, useWatch, type FieldPath } from "react-hook-form";

import { CheckEmailCard } from "@/components/auth/check-email-card";
import {
  platformRegisterSchema,
  registerSchema,
  type RegisterValues,
} from "@/components/auth/auth-schemas";
import { authErrorMessage, passwordChecks } from "@/components/auth/auth-utils";
import { PasswordField } from "@/components/auth/password-field";
import { useAuthRealm } from "@/components/auth/use-auth-realm";
import { AppSelect } from "@/components/ui/select";
import { useHydrated } from "@/hooks/use-hydrated";
import { formatRussianPhone, normalizeRussianPhone } from "@/lib/app/phone";
import { salonTypeOptions } from "@/lib/app/salon-profile";
import { authRequest } from "@/lib/api/client";

const platformSteps = ["Контакты", "Салон", "Защита"] as const;
const tenantSteps = ["Контакты", "Защита", "Согласие"] as const;

const timezoneOptions = [
  { value: "Europe/Kaliningrad", label: "Калининград · UTC+2" },
  { value: "Europe/Moscow", label: "Москва · UTC+3" },
  { value: "Europe/Samara", label: "Самара · UTC+4" },
  { value: "Asia/Yekaterinburg", label: "Екатеринбург · UTC+5" },
  { value: "Asia/Omsk", label: "Омск · UTC+6" },
  { value: "Asia/Krasnoyarsk", label: "Красноярск · UTC+7" },
  { value: "Asia/Irkutsk", label: "Иркутск · UTC+8" },
  { value: "Asia/Yakutsk", label: "Якутск · UTC+9" },
  { value: "Asia/Vladivostok", label: "Владивосток · UTC+10" },
  { value: "Asia/Magadan", label: "Магадан · UTC+11" },
  { value: "Asia/Kamchatka", label: "Камчатка · UTC+12" },
];

export function RegisterForm() {
  const realm = useAuthRealm();
  const hydrated = useHydrated();
  const [currentStep, setCurrentStep] = useState(0);
  const [attemptedSteps, setAttemptedSteps] = useState([false, false, false]);
  const [formError, setFormError] = useState<string | null>(null);
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    control,
    trigger,
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
  const steps = realm === "platform" ? platformSteps : tenantSteps;
  const lastStep = currentStep === steps.length - 1;
  const visibleErrors = attemptedSteps[currentStep] ? errors : ({} as typeof errors);
  const stepFields: FieldPath<RegisterValues>[][] = realm === "platform"
    ? [
        ["email", "phone"],
        ["salonName", "salonType", "city", "timezone"],
        ["password", "passwordConfirm", "termsAccepted", "consent", "dataProcessingInstructionAccepted"],
      ]
    : [
        ["email", "phone"],
        ["password", "passwordConfirm"],
        ["termsAccepted", "consent"],
      ];

  async function nextStep() {
    setAttemptedSteps((attempted) => attempted.map((value, index) => index === currentStep ? true : value));
    const valid = await trigger(stepFields[currentStep], { shouldFocus: true });
    if (!valid) return;
    setFormError(null);
    setCurrentStep((step) => Math.min(step + 1, steps.length - 1));
  }

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

  const contacts = (
    <>
      <div className="auth-field">
        <label htmlFor="register-email">Email</label>
        <div className={`auth-input-wrap${visibleErrors.email ? " auth-input-wrap--error" : ""}`}>
          <input
            id="register-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="name@example.ru"
            aria-invalid={Boolean(visibleErrors.email)}
            aria-describedby={visibleErrors.email ? "register-email-error" : undefined}
            {...register("email")}
          />
        </div>
        {visibleErrors.email && <p className="auth-field__error" id="register-email-error">{visibleErrors.email.message}</p>}
      </div>

      <div className="auth-field">
        <label htmlFor="register-phone">Телефон</label>
        <div className={`auth-input-wrap${visibleErrors.phone ? " auth-input-wrap--error" : ""}`}>
          <input
            id="register-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+7 (900) 000-00-00"
            aria-invalid={Boolean(visibleErrors.phone)}
            aria-describedby={visibleErrors.phone ? "register-phone-error" : undefined}
            {...phoneRegistration}
            onChange={(event) => {
              event.target.value = formatRussianPhone(event.target.value);
              void phoneRegistration.onChange(event);
            }}
          />
        </div>
        {visibleErrors.phone && <p className="auth-field__error" id="register-phone-error">{visibleErrors.phone.message}</p>}
      </div>
    </>
  );

  const salonProfile = (
    <div className="auth-salon-profile">
      <div className="auth-field">
        <label htmlFor="register-salon-name">Название салона</label>
        <div className={`auth-input-wrap${visibleErrors.salonName ? " auth-input-wrap--error" : ""}`}>
          <input
            id="register-salon-name"
            type="text"
            autoComplete="organization"
            placeholder="Например, ФОРМА"
            aria-invalid={Boolean(visibleErrors.salonName)}
            aria-describedby={visibleErrors.salonName ? "register-salon-name-error" : undefined}
            {...register("salonName")}
          />
        </div>
        {visibleErrors.salonName && <p className="auth-field__error" id="register-salon-name-error">{visibleErrors.salonName.message}</p>}
      </div>

      <fieldset className="auth-salon-types" aria-describedby={visibleErrors.salonType ? "register-salon-type-error" : undefined}>
        <legend>Тип салона</legend>
        <div>
          {salonTypeOptions.map((option) => (
            <label key={option.value}>
              <input type="radio" value={option.value} {...register("salonType")} />
              <span><strong>{option.label}</strong><small>{option.description}</small></span>
            </label>
          ))}
        </div>
        {visibleErrors.salonType && <p className="auth-field__error" id="register-salon-type-error">{visibleErrors.salonType.message}</p>}
      </fieldset>

      <div className="auth-location-grid">
        <div className="auth-field">
          <label htmlFor="register-city">Город</label>
          <div className={`auth-input-wrap${visibleErrors.city ? " auth-input-wrap--error" : ""}`}>
            <input id="register-city" type="text" autoComplete="address-level2" placeholder="Москва" {...register("city")} />
          </div>
          {visibleErrors.city && <p className="auth-field__error">{visibleErrors.city.message}</p>}
        </div>
        <div className="auth-field">
          <label htmlFor="register-timezone">Часовой пояс</label>
          <Controller
            control={control}
            name="timezone"
            render={({ field }) => (
              <AppSelect
                id="register-timezone"
                value={field.value || undefined}
                onValueChange={field.onChange}
                options={timezoneOptions}
                triggerClassName={`auth-select-trigger${visibleErrors.timezone ? " auth-select-trigger--error" : ""}`}
              />
            )}
          />
          {visibleErrors.timezone && <p className="auth-field__error">{visibleErrors.timezone.message}</p>}
        </div>
      </div>
    </div>
  );

  const passwordFields = (
    <>
      <PasswordField
        id="register-password"
        label="Пароль"
        autoComplete="new-password"
        registration={register("password")}
        error={visibleErrors.password?.message}
        hint={
          <ul className="password-checks" aria-label="Требования к паролю">
            {passwordChecks(password || "").map((check) => (
              <li className={check.met ? "is-met" : ""} key={check.label}>
                <span aria-hidden="true">{check.met && <Check />}</span>{check.label}
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
        error={visibleErrors.passwordConfirm?.message}
      />
    </>
  );

  const consents = (
    <div className="auth-consents">
      <label className={`auth-checkbox${visibleErrors.termsAccepted ? " auth-checkbox--error" : ""}`}>
        <input type="checkbox" {...register("termsAccepted")} />
        <span aria-hidden="true" />
        <span>Я принимаю <a href="/terms" target="_blank" rel="noreferrer">условия использования TrimmyCRM</a>.</span>
      </label>
      {visibleErrors.termsAccepted && <p className="auth-field__error">{visibleErrors.termsAccepted.message}</p>}

      <label className={`auth-checkbox${visibleErrors.consent ? " auth-checkbox--error" : ""}`}>
        <input type="checkbox" {...register("consent")} />
        <span aria-hidden="true" />
        <span>Я даю отдельное <a href={realm === "platform" ? "/consent" : "/client-consent"} target="_blank" rel="noreferrer">согласие на обработку персональных данных</a> и ознакомлен(а) с <a href="/privacy" target="_blank" rel="noreferrer">Политикой</a>.</span>
      </label>
      {visibleErrors.consent && <p className="auth-field__error">{visibleErrors.consent.message}</p>}

      {realm === "platform" && <>
        <label className={`auth-checkbox${visibleErrors.dataProcessingInstructionAccepted ? " auth-checkbox--error" : ""}`}>
          <input type="checkbox" {...register("dataProcessingInstructionAccepted")} />
          <span aria-hidden="true" />
          <span>Я принимаю <a href="/data-processing-instructions" target="_blank" rel="noreferrer">поручение на обработку клиентской базы салона</a>.</span>
        </label>
        {visibleErrors.dataProcessingInstructionAccepted && <p className="auth-field__error">{visibleErrors.dataProcessingInstructionAccepted.message}</p>}
      </>}
    </div>
  );

  return (
    <div className="auth-form-card auth-form-card--wide">
      <div className="auth-form-heading">
        <p className="auth-kicker">14 дней бесплатно</p>
        <h2>{realm === "platform" ? "Создать аккаунт" : "Стать клиентом салона"}</h2>
        <p>{realm === "platform" ? "Три коротких шага. Карта для старта не нужна." : "Выбирайте услуги и записывайтесь онлайн."}</p>
      </div>

      <ol className="auth-stepper" aria-label="Шаги регистрации">
        {steps.map((step, index) => (
          <li
            data-state={index === currentStep ? "active" : index < currentStep ? "complete" : "upcoming"}
            key={step}
          >
            <span aria-hidden="true">0{index + 1}</span>
            <strong>{step}</strong>
          </li>
        ))}
      </ol>

      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <fieldset className="auth-fieldset" disabled={!hydrated || isSubmitting}>
          <div className="auth-step-panel" data-errors-visible={attemptedSteps[currentStep]} key={`${realm}-${currentStep}`}>
            {currentStep === 0 && contacts}
            {currentStep === 1 && (realm === "platform" ? salonProfile : passwordFields)}
            {currentStep === 2 && <>{realm === "platform" && passwordFields}{consents}</>}
            {formError && <p className="auth-alert auth-alert--error" role="alert">{formError}</p>}
          </div>

          <div className="auth-step-actions">
            {currentStep > 0 && (
              <button className="auth-step-back" type="button" onClick={() => setCurrentStep((step) => Math.max(0, step - 1))}>
                <ArrowLeft aria-hidden="true" /> Назад
              </button>
            )}
            {lastStep ? (
              <button
                className="button button--ink auth-submit"
                type="submit"
                disabled={!hydrated || isSubmitting}
                onClick={() => setAttemptedSteps((attempted) => attempted.map((value, index) => index === currentStep ? true : value))}
              >
                {isSubmitting ? "Создаём…" : "Создать аккаунт →"}
              </button>
            ) : (
              <button className="button button--ink auth-submit" type="button" onClick={() => void nextStep()}>
                Продолжить <ArrowRight aria-hidden="true" />
              </button>
            )}
          </div>
        </fieldset>
      </form>

      <p className="auth-switch">Уже зарегистрированы? <a href="/login">Войти</a></p>
    </div>
  );
}
