"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Image from "next/image";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import { useApp } from "@/components/app/app-provider";
import { BrandMark } from "@/components/ui/brand-mark";
import { AppSelect } from "@/components/ui/select";
import { useHydrated } from "@/hooks/use-hydrated";
import { apiRequest, ApiError } from "@/lib/api/client";
import type { SiteView } from "@/lib/api/types";
import {
  onboardingSchema,
  slugifySalonName,
  type OnboardingValues,
} from "@/lib/app/onboarding";
import { salonTypeOptions } from "@/lib/app/salon-profile";
import { tenantBaseDomain } from "@/lib/app/site-url";

const timezones = [
  ["Europe/Kaliningrad", "Калининград · UTC+2"],
  ["Europe/Moscow", "Москва · UTC+3"],
  ["Europe/Samara", "Самара · UTC+4"],
  ["Asia/Yekaterinburg", "Екатеринбург · UTC+5"],
  ["Asia/Omsk", "Омск · UTC+6"],
  ["Asia/Novosibirsk", "Новосибирск · UTC+7"],
  ["Asia/Irkutsk", "Иркутск · UTC+8"],
  ["Asia/Yakutsk", "Якутск · UTC+9"],
  ["Asia/Vladivostok", "Владивосток · UTC+10"],
] as const;

type SlugStatus = "idle" | "checking" | "available" | "unavailable" | "error";

export function OnboardingForm() {
  const router = useRouter();
  const hydrated = useHydrated();
  const { me, setSite, signOut } = useApp();
  const slugEdited = useRef(false);
  const [slugStatus, setSlugStatus] = useState<SlugStatus>("idle");
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    setValue,
    control,
    formState: { errors, isSubmitting },
  } = useForm<OnboardingValues>({
    resolver: zodResolver(onboardingSchema),
    defaultValues: {
      name: "",
      salonType: "unisex_hair_salon",
      city: "",
      slug: "",
      timezone: "Europe/Moscow",
    },
  });
  const slug = useWatch({ control, name: "slug" });
  const nameRegistration = register("name");
  const slugRegistration = register("slug");

  async function checkSlug(value: string) {
    if (!/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/.test(value)) {
      setSlugStatus("idle");
      return false;
    }
    setSlugStatus("checking");
    try {
      const result = await apiRequest<{ available: boolean }>(
        "/sites/slug-available?slug=" + encodeURIComponent(value),
        { realm: "platform" },
      );
      setSlugStatus(result.available ? "available" : "unavailable");
      if (!result.available) {
        setError("slug", { message: "Этот адрес уже занят" });
      }
      return result.available;
    } catch {
      setSlugStatus("error");
      return true;
    }
  }

  async function onSubmit(values: OnboardingValues) {
    setFormError(null);
    const available = slugStatus === "available" ? true : await checkSlug(values.slug);
    if (!available) return;

    try {
      const site = await apiRequest<SiteView>("/sites", {
        realm: "platform",
        method: "POST",
        body: JSON.stringify({
          name: values.name,
          salonType: values.salonType,
          city: values.city || null,
          slug: values.slug,
          timezone: values.timezone,
        }),
      });
      setSite(site);
      router.replace("/app" as Route);
    } catch (reason) {
      if (reason instanceof ApiError && reason.code === "slug_taken") {
        setSlugStatus("unavailable");
        setError("slug", { message: "Этот адрес уже занят" });
        return;
      }
      setFormError(reason instanceof Error ? reason.message : "Не удалось создать салон");
    }
  }

  return (
    <main className="onboarding">
      <section className="onboarding-story" aria-label="Начало работы">
        <BrandMark />
        <div className="onboarding-story__copy">
          <p className="eyebrow">Почти готово</p>
          <h1>Дадим салону<br /><em>имя и адрес.</em></h1>
          <p>Эти данные станут основой кабинета и будущего сайта. Всё остальное спокойно настроим внутри.</p>
        </div>
        <figure className="onboarding-polaroid">
          <Image
            src="/images/landing/studio-cut.svg"
            alt="Абстрактный образ студии волос"
            width={900}
            height={760}
            sizes="(max-width: 900px) 0px, 280px"
            priority
          />
          <figcaption>место, куда возвращаются</figcaption>
        </figure>
        <div className="onboarding-story__steps" aria-label="Этапы запуска">
          <span className="is-current"><i>1</i> Салон</span>
          <span><i>2</i> Услуги</span>
          <span><i>3</i> Запись</span>
        </div>
      </section>

      <section className="onboarding-panel">
        <header className="onboarding-panel__header">
          <div className="onboarding-panel__brand"><BrandMark compact /></div>
          <p><span>Шаг 1 из 3</span><strong>{me.subscription?.plan.name || "Старт"} · 14 дней бесплатно</strong></p>
          <button type="button" onClick={() => void signOut()}>Выйти</button>
        </header>

        <div className="onboarding-form-wrap">
          <div className="onboarding-form__heading">
            <p className="crm-kicker">Карточка салона</p>
            <h2>Как вас представить?</h2>
            <p>Название увидят клиенты. Адрес поддомена можно выбрать сейчас — позже он останется за вами.</p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} noValidate>
            <fieldset disabled={!hydrated || isSubmitting}>
              <div className="crm-field">
                <label htmlFor="salon-name">Название салона</label>
                <input
                  id="salon-name"
                  placeholder="Например, ФОРМА"
                  autoComplete="organization"
                  aria-invalid={Boolean(errors.name)}
                  {...nameRegistration}
                  onChange={(event) => {
                    void nameRegistration.onChange(event);
                    if (!slugEdited.current) {
                      setValue("slug", slugifySalonName(event.target.value), { shouldValidate: false });
                      setSlugStatus("idle");
                    }
                  }}
                />
                {errors.name && <p className="crm-field__error">{errors.name.message}</p>}
              </div>

              <div className="crm-field">
                <label htmlFor="salon-type">Тип салона</label>
                <AppSelect
                  id="salon-type"
                  defaultValue="unisex_hair_salon"
                  onValueChange={(value) => setValue("salonType", value as OnboardingValues["salonType"], { shouldValidate: true })}
                  options={salonTypeOptions.map(({ value, label }) => ({ value, label }))}
                />
                {errors.salonType && <p className="crm-field__error">{errors.salonType.message}</p>}
              </div>

              <div className="crm-field">
                <label htmlFor="salon-city">Город <small>необязательно</small></label>
                <input
                  id="salon-city"
                  placeholder="Москва"
                  autoComplete="address-level2"
                  aria-invalid={Boolean(errors.city)}
                  {...register("city")}
                />
                {errors.city && <p className="crm-field__error">{errors.city.message}</p>}
              </div>

              <div className="crm-field">
                <label htmlFor="salon-slug">Адрес сайта</label>
                <div className={"crm-slug-input" + (errors.slug ? " has-error" : "")}>
                  <input
                    id="salon-slug"
                    value={slug || ""}
                    aria-invalid={Boolean(errors.slug)}
                    {...slugRegistration}
                    onChange={(event) => {
                      slugEdited.current = true;
                      event.target.value = slugifySalonName(event.target.value);
                      void slugRegistration.onChange(event);
                      setSlugStatus("idle");
                    }}
                    onBlur={(event) => {
                      void slugRegistration.onBlur(event);
                      void checkSlug(event.currentTarget.value);
                    }}
                  />
                  <span>.{tenantBaseDomain()}</span>
                </div>
                <div className="crm-slug-status" aria-live="polite">
                  {slugStatus === "checking" && "Проверяем адрес…"}
                  {slugStatus === "available" && <span>✓ Адрес свободен</span>}
                  {slugStatus === "error" && "Не удалось проверить сейчас — проверим при сохранении."}
                </div>
                {errors.slug && <p className="crm-field__error">{errors.slug.message}</p>}
              </div>

              <div className="crm-field">
                <label htmlFor="salon-timezone">Часовой пояс</label>
                <AppSelect
                  id="salon-timezone"
                  defaultValue="Europe/Moscow"
                  onValueChange={(value) => setValue("timezone", value, { shouldValidate: true })}
                  options={timezones.map(([value, label]) => ({ value, label }))}
                />
                {errors.timezone && <p className="crm-field__error">{errors.timezone.message}</p>}
              </div>

              {formError && <p className="crm-form-error" role="alert">{formError}</p>}

              <button className="button button--ink onboarding-submit" type="submit">
                {isSubmitting ? "Создаём кабинет…" : "Создать кабинет →"}
              </button>
            </fieldset>
          </form>

          <p className="onboarding-form__note">Следом добавим услуги и мастеров. Можно пропустить и вернуться к этому позже.</p>
        </div>
      </section>
    </main>
  );
}
