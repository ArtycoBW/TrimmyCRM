"use client";

import { type FormEvent, useState } from "react";

import { apiRequest } from "@/lib/api/client";
import type { ServiceAddonView, ServiceVariantView, ServiceView } from "@/lib/api/types";
import {
  buildCatalogOptionPayload,
  catalogOptionSchema,
} from "@/lib/app/catalog";
import { formatMoney } from "@/lib/app/dashboard";

type OptionKind = "variant" | "addon";

export function ServiceOptionEditor({
  service,
  onChanged,
}: {
  service: ServiceView;
  onChanged: (service: ServiceView) => void;
}) {
  return (
    <section className="service-options" aria-label="Варианты и дополнения услуги">
      <header>
        <p className="crm-kicker">Конструктор услуги</p>
        <p>Цена и время добавляются к базовым значениям.</p>
      </header>
      <OptionSection kind="variant" service={service} onChanged={onChanged} />
      <OptionSection kind="addon" service={service} onChanged={onChanged} />
    </section>
  );
}

function OptionSection({
  kind,
  service,
  onChanged,
}: {
  kind: OptionKind;
  service: ServiceView;
  onChanged: (service: ServiceView) => void;
}) {
  const isVariant = kind === "variant";
  const items = isVariant ? service.variants : service.addons;
  const [label, setLabel] = useState("");
  const [priceDelta, setPriceDelta] = useState("0");
  const [durationDeltaMin, setDurationDeltaMin] = useState("0");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function addOption(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const parsed = catalogOptionSchema.safeParse({ label, priceDelta, durationDeltaMin });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message || "Проверьте значения");
      return;
    }
    setBusyId("new");
    try {
      const common = {
        ...buildCatalogOptionPayload(parsed.data),
        sortOrder: items.length * 10,
        isActive: true,
      };
      if (isVariant) {
        const created = await apiRequest<ServiceVariantView>(
          `/services/${service.id}/variants`,
          {
            realm: "platform",
            method: "POST",
            body: JSON.stringify({ label: parsed.data.label, ...common }),
          },
        );
        onChanged({ ...service, variants: [...service.variants, created] });
      } else {
        const created = await apiRequest<ServiceAddonView>(`/services/${service.id}/addons`, {
          realm: "platform",
          method: "POST",
          body: JSON.stringify({ name: parsed.data.label, ...common }),
        });
        onChanged({ ...service, addons: [...service.addons, created] });
      }
      setLabel("");
      setPriceDelta("0");
      setDurationDeltaMin("0");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось сохранить вариант");
    } finally {
      setBusyId(null);
    }
  }

  async function removeOption(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await apiRequest<void>(
        `/services/${service.id}/${isVariant ? "variants" : "addons"}/${id}`,
        { realm: "platform", method: "DELETE" },
      );
      onChanged(isVariant
        ? { ...service, variants: service.variants.filter((item) => item.id !== id) }
        : { ...service, addons: service.addons.filter((item) => item.id !== id) });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось убрать вариант");
    } finally {
      setBusyId(null);
    }
  }

  const noun = isVariant ? "варианта" : "дополнения";
  return (
    <article className="service-options__group">
      <div className="service-options__title">
        <h3>{isVariant ? "Варианты" : "Дополнения"}</h3>
        <span>{items.length}</span>
      </div>
      {items.length ? (
        <ul>
          {items.map((item) => (
            <li key={item.id}>
              <div>
                <strong>{"label" in item ? item.label : item.name}</strong>
                <span>
                  +{formatMoney(item.priceDelta)} · +{item.durationDeltaMin} мин
                </span>
              </div>
              <button
                type="button"
                aria-label={`Убрать ${"label" in item ? item.label : item.name}`}
                disabled={busyId !== null}
                onClick={() => void removeOption(item.id)}
              >
                {busyId === item.id ? "…" : "×"}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="service-options__empty">
          {isVariant ? "Например: короткие, до плеч, ниже плеч." : "Например: уход или укладка."}
        </p>
      )}
      <form onSubmit={(event) => void addOption(event)}>
        <label>
          <span>Название {noun}</span>
          <input value={label} onChange={(event) => setLabel(event.target.value)} />
        </label>
        <label>
          <span>Доплата, ₽</span>
          <input inputMode="decimal" value={priceDelta} onChange={(event) => setPriceDelta(event.target.value)} />
        </label>
        <label>
          <span>Доп. время, мин</span>
          <input inputMode="numeric" value={durationDeltaMin} onChange={(event) => setDurationDeltaMin(event.target.value)} />
        </label>
        <button className="button" type="submit" disabled={busyId !== null}>
          {busyId === "new" ? "Добавляем…" : `+ Добавить ${isVariant ? "вариант" : "дополнение"}`}
        </button>
      </form>
      {error && <p className="crm-field__error" role="alert">{error}</p>}
    </article>
  );
}
