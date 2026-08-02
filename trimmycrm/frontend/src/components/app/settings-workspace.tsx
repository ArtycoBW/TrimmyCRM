"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";

import { useApp } from "@/components/app/app-provider";
import { Input } from "@/components/ui/input";
import { AppSelect } from "@/components/ui/select";
import { apiRequest } from "@/lib/api/client";
import type { MediaView, SiteView } from "@/lib/api/types";
import { formatRussianPhone, normalizeRussianPhone } from "@/lib/app/phone";
import { salonTypeOptions, type SalonType } from "@/lib/app/salon-profile";
import { tenantSiteUrl } from "@/lib/app/site-url";

const timezones = [
  { value: "Europe/Kaliningrad", label: "Калининград · UTC+2" },
  { value: "Europe/Moscow", label: "Москва · UTC+3" },
  { value: "Europe/Samara", label: "Самара · UTC+4" },
  { value: "Asia/Yekaterinburg", label: "Екатеринбург · UTC+5" },
  { value: "Asia/Omsk", label: "Омск · UTC+6" },
  { value: "Asia/Novosibirsk", label: "Новосибирск · UTC+7" },
  { value: "Asia/Irkutsk", label: "Иркутск · UTC+8" },
  { value: "Asia/Yakutsk", label: "Якутск · UTC+9" },
  { value: "Asia/Vladivostok", label: "Владивосток · UTC+10" },
];

function publicLogoUrl(site: SiteView | null) {
  if (!site?.logoUrl) return null;
  if (!site.logoUrl.startsWith("/")) return site.logoUrl;
  return new URL(site.logoUrl, tenantSiteUrl(site.slug)).toString();
}

function logoMediaId(url: string | null | undefined) {
  return url?.match(/\/public\/media\/([0-9a-f-]{36})$/i)?.[1] || null;
}

export function SettingsWorkspace() {
  const { site, setSite } = useApp();
  const [name, setName] = useState(site?.name || "");
  const [description, setDescription] = useState(site?.description || "");
  const [city, setCity] = useState(site?.city || "");
  const [street, setStreet] = useState(site?.street || "");
  const [phone, setPhone] = useState(site?.phone ? formatRussianPhone(site.phone) : "");
  const [salonType, setSalonType] = useState<SalonType>(site?.salonType || "unisex_hair_salon");
  const [timezone, setTimezone] = useState(site?.timezone || "Europe/Moscow");
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [updatingLogo, setUpdatingLogo] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setStatus(null);
    try {
      const saved = await apiRequest<SiteView>("/sites/mine", {
        realm: "platform",
        method: "PATCH",
        body: JSON.stringify({
          name,
          description: description || null,
          city: city || null,
          street: street || null,
          phone: normalizeRussianPhone(phone) || null,
          salonType,
          timezone,
        }),
      });
      setSite(saved);
      setStatus("Настройки сохранены");
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "Не удалось сохранить настройки");
    } finally {
      setSaving(false);
    }
  }

  async function uploadLogo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(file.type)) {
      setStatus("Для логотипа подойдут JPEG, PNG или WebP.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setStatus("Размер логотипа не должен превышать 10 МБ.");
      return;
    }

    setUpdatingLogo(true);
    setStatus(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("purpose", "logo");
      await apiRequest<MediaView>("/media", { realm: "platform", method: "POST", body: form });
      const saved = await apiRequest<SiteView>("/sites/mine", { realm: "platform" });
      setSite(saved);
      setStatus("Логотип сайта обновлён.");
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "Не удалось загрузить логотип.");
    } finally {
      setUpdatingLogo(false);
    }
  }

  async function removeLogo() {
    const mediaId = logoMediaId(site?.logoUrl);
    if (!mediaId) return;

    setUpdatingLogo(true);
    setStatus(null);
    try {
      await apiRequest(`/media/${mediaId}`, { realm: "platform", method: "DELETE" });
      const saved = await apiRequest<SiteView>("/sites/mine", { realm: "platform" });
      setSite(saved);
      setStatus("Логотип удалён.");
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "Не удалось удалить логотип.");
    } finally {
      setUpdatingLogo(false);
    }
  }

  const logo = publicLogoUrl(site);

  return (
    <section className="settings-workspace" aria-labelledby="settings-title">
      <header className="workspace-heading">
        <div>
          <p className="crm-kicker">Профиль салона</p>
          <h1 id="settings-title">Настройки</h1>
          <p>Эти данные используются в CRM и на странице салона.</p>
        </div>
      </header>

      <form className="settings-form" onSubmit={submit}>
        <div className="settings-logo settings-form__wide">
          <div className="settings-logo__preview" aria-hidden="true">
            {logo ? (
              // The public logo lives on the tenant host, which is intentionally outside Next image optimization.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt="" />
            ) : (site?.name || name || "С").charAt(0).toUpperCase()}
          </div>
          <div>
            <strong>Логотип сайта</strong>
            <p>Он появится на сайте салона, в кабинете клиента и на странице входа.</p>
            <div className="settings-logo__actions">
              <label className="button button--ink" htmlFor="settings-logo">
                {updatingLogo ? "Загружаем…" : logo ? "Заменить логотип" : "Загрузить логотип"}
              </label>
              <input
                id="settings-logo"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                aria-label="Загрузить логотип"
                disabled={updatingLogo}
                onChange={(event) => void uploadLogo(event)}
              />
              {site?.logoUrl && (
                <button className="settings-logo__remove" type="button" disabled={updatingLogo} onClick={() => void removeLogo()}>
                  Удалить
                </button>
              )}
            </div>
            <small>JPEG, PNG или WebP, до 10 МБ.</small>
          </div>
        </div>

        <div className="crm-field">
          <label htmlFor="settings-name">Название салона</label>
          <Input id="settings-name" value={name} onChange={(event) => setName(event.target.value)} required />
        </div>
        <div className="crm-field">
          <label htmlFor="settings-phone">Телефон</label>
          <Input id="settings-phone" type="tel" value={phone} placeholder="+7 (988) 650 16 49" onChange={(event) => setPhone(formatRussianPhone(event.target.value))} />
        </div>
        <div className="crm-field settings-form__wide">
          <label htmlFor="settings-salon-type">Тип салона</label>
          <AppSelect
            id="settings-salon-type"
            value={salonType}
            onValueChange={(value) => setSalonType(value as SalonType)}
            options={salonTypeOptions.map(({ value, label }) => ({ value, label }))}
          />
          <small>Тип меняет профиль и тексты сайта, но не удаляет ваши услуги и данные.</small>
        </div>
        <div className="crm-field">
          <label htmlFor="settings-city">Город</label>
          <Input id="settings-city" value={city} onChange={(event) => setCity(event.target.value)} />
        </div>
        <div className="crm-field">
          <label htmlFor="settings-street">Адрес</label>
          <Input id="settings-street" value={street} onChange={(event) => setStreet(event.target.value)} />
        </div>
        <div className="crm-field settings-form__wide">
          <label htmlFor="settings-timezone">Часовой пояс</label>
          <AppSelect id="settings-timezone" value={timezone} onValueChange={setTimezone} options={timezones} />
        </div>
        <div className="crm-field settings-form__wide">
          <label htmlFor="settings-description">Описание для сайта</label>
          <textarea id="settings-description" value={description} maxLength={5000} onChange={(event) => setDescription(event.target.value)} />
        </div>
        {status && <p className="workspace-notice settings-form__wide" role="status">{status}</p>}
        <button className="button button--ink settings-form__wide" type="submit" disabled={saving || updatingLogo}>Сохранить настройки</button>
      </form>
    </section>
  );
}
