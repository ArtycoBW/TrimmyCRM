"use client";

import { useEffect, useMemo, useState } from "react";

import { AppIcon } from "@/components/app/app-icon";
import { AppSelect } from "@/components/ui/select";
import { ServiceDrawer } from "@/components/app/service-drawer";
import { ServiceForm } from "@/components/app/service-form";
import { apiRequest } from "@/lib/api/client";
import type { ServiceCategoryView, ServiceView, StaffView } from "@/lib/api/types";
import { formatDuration, formatServicePrice } from "@/lib/app/catalog";
import { formatMoney } from "@/lib/app/dashboard";

type ServicesState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      services: ServiceView[];
      staff: StaffView[];
      categories: ServiceCategoryView[];
    };

export function ServicesWorkspace() {
  const [state, setState] = useState<ServicesState>({ status: "loading" });
  const [requestKey, setRequestKey] = useState(0);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "inactive">("all");
  const [selected, setSelected] = useState<ServiceView | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      apiRequest<ServiceView[]>("/services?include_inactive=true&limit=500", { realm: "platform" }),
      apiRequest<StaffView[]>("/staff?include_inactive=true&limit=500", { realm: "platform" }),
      apiRequest<ServiceCategoryView[]>("/service-categories?include_inactive=true", {
        realm: "platform",
      }),
    ])
      .then(([services, staff, categories]) => {
        if (active) setState({ status: "ready", services, staff, categories });
      })
      .catch((reason) => {
        if (active) {
          setState({
            status: "error",
            message: reason instanceof Error ? reason.message : "Не удалось загрузить услуги",
          });
        }
      });
    return () => {
      active = false;
    };
  }, [requestKey]);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), 3000);
  }

  function saveInState(service: ServiceView) {
    setState((current) => {
      if (current.status !== "ready") return current;
      const exists = current.services.some((item) => item.id === service.id);
      return {
        ...current,
        services: exists
          ? current.services.map((item) => item.id === service.id ? service : item)
          : [...current.services, service],
      };
    });
    setSelected(service);
  }

  function addCategoryToState(category: ServiceCategoryView) {
    setState((current) => current.status === "ready"
      ? { ...current, categories: [...current.categories, category] }
      : current);
  }

  async function removeService() {
    if (!selected) return;
    setRemoving(true);
    try {
      await apiRequest<void>("/services/" + selected.id, {
        realm: "platform",
        method: "DELETE",
      });
      setSelected(null);
      setState({ status: "loading" });
      setRequestKey((value) => value + 1);
      notify("Каталог услуг обновлён");
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Не удалось убрать услугу");
    } finally {
      setRemoving(false);
    }
  }

  const filtered = useMemo(() => {
    if (state.status !== "ready") return [];
    const query = search.trim().toLocaleLowerCase("ru");
    return state.services.filter((service) => {
      if (status === "active" && !service.isActive) return false;
      if (status === "inactive" && service.isActive) return false;
      return !query || [service.name, service.categoryName, service.category, service.description]
        .some((value) => value?.toLocaleLowerCase("ru").includes(query));
    });
  }, [search, state, status]);

  if (state.status === "loading") {
    return (
      <div className="crm-directory crm-directory--loading" aria-busy="true">
        <div className="crm-skeleton crm-skeleton--title" />
        <div className="crm-skeleton crm-directory__loading-bar" />
        <div className="catalog-loading-grid">
          {Array.from({ length: 6 }, (_, index) => <div className="crm-skeleton" key={index} />)}
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <section className="crm-dashboard-error">
        <span aria-hidden="true">!</span>
        <p className="crm-kicker">Каталог услуг</p>
        <h1>Не удалось загрузить</h1>
        <p>{state.message}</p>
        <button className="button button--ink" type="button" onClick={() => {
          setState({ status: "loading" });
          setRequestKey((value) => value + 1);
        }}>Попробовать снова</button>
      </section>
    );
  }

  const activeCount = state.services.filter((service) => service.isActive).length;
  const averagePrice = activeCount
    ? state.services.filter((service) => service.isActive).reduce((sum, service) => sum + Number(service.price), 0) / activeCount
    : 0;

  return (
    <div className="crm-directory services-directory">
      <section className="crm-directory__intro">
        <div>
          <p className="crm-kicker">Меню салона</p>
          <h1>Услуги<span>.</span></h1>
          <p>Цены, длительность и технологические буферы, из которых собираются свободные слоты.</p>
        </div>
        <button className="button button--ink" type="button" onClick={() => setFormOpen(true)}>
          <b>+</b> Добавить услугу
        </button>
      </section>

      <section className="directory-stats" aria-label="Итоги каталога услуг">
        <article><span><AppIcon name="services" /></span><p>Активных услуг</p><strong>{activeCount}</strong></article>
        <article><span aria-hidden="true">#</span><p>Категорий</p><strong>{state.categories.filter((category) => category.isActive).length}</strong></article>
        <article><span aria-hidden="true">₽</span><p>Средний чек</p><strong>{formatMoney(averagePrice)}</strong></article>
      </section>

      <section className="directory-panel catalog-panel">
        <header className="directory-toolbar catalog-toolbar">
          <label className="directory-search">
            <AppIcon name="services" />
            <span className="sr-only">Поиск услуг</span>
            <input
              type="search"
              value={search}
              placeholder="Название, категория или описание"
              onChange={(event) => setSearch(event.target.value)}
            />
            {search && <button type="button" onClick={() => setSearch("")} aria-label="Очистить поиск">×</button>}
          </label>
          <label className="catalog-filter">
            <span>Статус</span>
            <AppSelect
              value={status}
              onValueChange={(value) => setStatus(value as typeof status)}
              options={[
                { value: "all", label: "Все услуги" },
                { value: "active", label: "Только активные" },
                { value: "inactive", label: "Только скрытые" },
              ]}
            />
          </label>
        </header>

        {filtered.length ? (
          <div className="service-grid">
            {filtered.map((service, index) => {
              const assigned = state.staff.filter((member) => member.serviceIds.includes(service.id) && member.isActive).length;
              return (
                <button
                  className={"service-card service-card--" + (index % 4) + (service.isActive ? "" : " is-inactive")}
                  type="button"
                  onClick={() => setSelected(service)}
                  key={service.id}
                >
                  <span className="service-card__category">{service.categoryName || service.category || "Без категории"}</span>
                  <span className={"crm-status crm-status--" + (service.isActive ? "lime" : "muted")}>
                    {service.isActive ? "В записи" : "Скрыта"}
                  </span>
                  <h2>{service.name}</h2>
                  <p>{service.description || "Описание ещё не добавлено."}</p>
                  <dl>
                    <div><dt>Цена</dt><dd>{formatServicePrice(service)}</dd></div>
                    <div><dt>Время</dt><dd>{formatDuration(service.durationMin)}</dd></div>
                    <div><dt>Мастера</dt><dd>{assigned || "—"}</dd></div>
                  </dl>
                  <span className="service-card__open">Открыть →</span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="directory-empty">
            <span aria-hidden="true">⌕</span>
            <h2>{search || status !== "all" ? "Ничего не нашли" : "Услуг пока нет"}</h2>
            <p>{search || status !== "all" ? "Измените запрос или фильтр." : "Добавьте первую услугу, чтобы открыть онлайн-запись."}</p>
          </div>
        )}
      </section>

      {editing && selected ? (
        <ServiceForm
          service={selected}
          categories={state.categories}
          onCategoryCreated={addCategoryToState}
          onClose={() => setEditing(false)}
          onSaved={(service) => {
            saveInState(service);
            setEditing(false);
            notify("Услуга сохранена");
          }}
        />
      ) : selected ? (
        <ServiceDrawer
          service={selected}
          staff={state.staff.filter((member) => member.serviceIds.includes(selected.id))}
          removing={removing}
          onClose={() => setSelected(null)}
          onChanged={saveInState}
          onEdit={() => setEditing(true)}
          onRemove={() => void removeService()}
        />
      ) : null}

      {formOpen && (
        <ServiceForm
          categories={state.categories}
          onCategoryCreated={addCategoryToState}
          onClose={() => setFormOpen(false)}
          onSaved={(service) => {
            saveInState(service);
            setFormOpen(false);
            notify("Услуга добавлена");
          }}
        />
      )}

      {toast && <div className="crm-toast" role="status">{toast}</div>}
    </div>
  );
}
