"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";

import { AppIcon } from "@/components/app/app-icon";
import { AppSelect } from "@/components/ui/select";
import { useApp } from "@/components/app/app-provider";
import { StaffDrawer } from "@/components/app/staff-drawer";
import { StaffForm } from "@/components/app/staff-form";
import { apiRequest } from "@/lib/api/client";
import type { ServiceView, StaffView } from "@/lib/api/types";
import {
  normalizeSchedule,
  staffInitials,
  weeklyMinutes,
} from "@/lib/app/catalog";

type StaffState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; staff: StaffView[]; services: ServiceView[] };

export function StaffWorkspace() {
  const { me, site } = useApp();
  const [state, setState] = useState<StaffState>({ status: "loading" });
  const [requestKey, setRequestKey] = useState(0);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "inactive">("all");
  const [selected, setSelected] = useState<StaffView | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      apiRequest<StaffView[]>("/staff?include_inactive=true&limit=500", { realm: "platform" }),
      apiRequest<ServiceView[]>("/services?include_inactive=true&limit=500", { realm: "platform" }),
    ])
      .then(([staff, services]) => {
        if (active) setState({ status: "ready", staff, services });
      })
      .catch((reason) => {
        if (active) {
          setState({
            status: "error",
            message: reason instanceof Error ? reason.message : "Не удалось загрузить команду",
          });
        }
      });
    return () => {
      active = false;
    };
  }, [requestKey]);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), 3800);
  }

  function saveInState(member: StaffView) {
    setState((current) => {
      if (current.status !== "ready") return current;
      const exists = current.staff.some((item) => item.id === member.id);
      return {
        ...current,
        staff: exists
          ? current.staff.map((item) => item.id === member.id ? member : item)
          : [...current.staff, member],
      };
    });
    setSelected(member);
  }

  async function removeMember() {
    if (!selected) return;
    setRemoving(true);
    try {
      await apiRequest<void>("/staff/" + selected.id, {
        realm: "platform",
        method: "DELETE",
      });
      setSelected(null);
      setState({ status: "loading" });
      setRequestKey((value) => value + 1);
      notify("Состав команды обновлён");
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Не удалось убрать мастера");
    } finally {
      setRemoving(false);
    }
  }

  const filtered = useMemo(() => {
    if (state.status !== "ready") return [];
    const query = search.trim().toLocaleLowerCase("ru");
    return state.staff.filter((member) => {
      if (status === "active" && !member.isActive) return false;
      if (status === "inactive" && member.isActive) return false;
      return !query || [member.name, member.specialization]
        .some((value) => value?.toLocaleLowerCase("ru").includes(query));
    });
  }, [search, state, status]);

  if (state.status === "loading") {
    return (
      <div className="crm-directory crm-directory--loading" aria-busy="true">
        <div className="crm-skeleton crm-skeleton--title" />
        <div className="crm-skeleton crm-directory__loading-bar" />
        <div className="team-loading-grid">
          {Array.from({ length: 6 }, (_, index) => <div className="crm-skeleton" key={index} />)}
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <section className="crm-dashboard-error">
        <span aria-hidden="true">!</span>
        <p className="crm-kicker">Команда салона</p>
        <h1>Не удалось загрузить</h1>
        <p>{state.message}</p>
        <button className="button button--ink" type="button" onClick={() => {
          setState({ status: "loading" });
          setRequestKey((value) => value + 1);
        }}>Попробовать снова</button>
      </section>
    );
  }

  const activeCount = state.staff.filter((member) => member.isActive).length;
  const withAccess = state.staff.filter((member) => member.userId && member.isActive).length;
  const staffLimit = me.subscription?.plan.limits.staff;
  const salonSchedule = site?.workHours || {};
  const timezone = site?.timezone || "Europe/Moscow";

  return (
    <div className="crm-directory staff-directory">
      <section className="crm-directory__intro">
        <div>
          <p className="crm-kicker">Команда салона</p>
          <h1>Мастера<span>.</span></h1>
          <p>Услуги, смены, доступ в кабинет и точечные изменения графика каждого специалиста.</p>
        </div>
        <button className="button button--ink" type="button" onClick={() => setFormOpen(true)}>
          <b>+</b> Добавить мастера
        </button>
      </section>

      <section className="directory-stats" aria-label="Итоги команды">
        <article><span><AppIcon name="staff" /></span><p>Активных мастеров</p><strong>{activeCount}</strong></article>
        <article><span aria-hidden="true">@</span><p>С доступом</p><strong>{withAccess}</strong></article>
        <article><span aria-hidden="true">↗</span><p>Лимит тарифа</p><strong>{activeCount} / {staffLimit ?? "∞"}</strong></article>
      </section>

      <section className="directory-panel team-panel">
        <header className="directory-toolbar catalog-toolbar">
          <label className="directory-search">
            <AppIcon name="staff" />
            <span className="sr-only">Поиск мастеров</span>
            <input
              type="search"
              value={search}
              placeholder="Имя или специализация"
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
                { value: "all", label: "Вся команда" },
                { value: "active", label: "Только активные" },
                { value: "inactive", label: "Только неактивные" },
              ]}
            />
          </label>
        </header>

        {filtered.length ? (
          <div className="team-grid">
            {filtered.map((member, index) => {
              const portraitStyle = member.photoUrl
                ? { backgroundImage: 'url("' + member.photoUrl + '")' } as CSSProperties
                : undefined;
              const hours = weeklyMinutes(normalizeSchedule(member.schedule));
              return (
                <button
                  className={"staff-card staff-card--" + (index % 4) + (member.isActive ? "" : " is-inactive")}
                  type="button"
                  onClick={() => setSelected(member)}
                  key={member.id}
                >
                  <div className={"staff-card__portrait" + (portraitStyle ? " has-photo" : "")} style={portraitStyle}>
                    {!portraitStyle && <span>{staffInitials(member.name)}</span>}
                    <i>{member.photoUrl ? "salon team" : "photo soon"}</i>
                  </div>
                  <div className="staff-card__copy">
                    <span className={"crm-status crm-status--" + (member.isActive ? "lime" : "muted")}>
                      {member.isActive ? "Активен" : "Неактивен"}
                    </span>
                    <h2>{member.name}</h2>
                    <p>{member.specialization || "Мастер салона"}</p>
                  </div>
                  <dl>
                    <div><dt>Услуги</dt><dd>{member.serviceIds.length}</dd></div>
                    <div><dt>График</dt><dd>{hours ? Math.round(hours / 60) + " ч" : "салон"}</dd></div>
                    <div><dt>Кабинет</dt><dd>{member.userId ? "есть" : "нет"}</dd></div>
                  </dl>
                  <span className="staff-card__open">Профиль →</span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="directory-empty">
            <span aria-hidden="true">⌕</span>
            <h2>{search || status !== "all" ? "Ничего не нашли" : "Команда пока пуста"}</h2>
            <p>{search || status !== "all" ? "Измените запрос или фильтр." : "Добавьте первого мастера и назначьте ему услуги."}</p>
          </div>
        )}
      </section>

      {editing && selected ? (
        <StaffForm
          member={selected}
          services={state.services}
          salonSchedule={salonSchedule}
          onClose={() => setEditing(false)}
          onSaved={(member, notice) => {
            saveInState(member);
            setEditing(false);
            notify(notice || "Профиль мастера сохранён");
          }}
        />
      ) : selected ? (
        <StaffDrawer
          member={selected}
          services={state.services}
          salonSchedule={salonSchedule}
          timezone={timezone}
          removing={removing}
          onClose={() => setSelected(null)}
          onEdit={() => setEditing(true)}
          onRemove={() => void removeMember()}
          onNotify={notify}
        />
      ) : null}

      {formOpen && (
        <StaffForm
          services={state.services}
          salonSchedule={salonSchedule}
          onClose={() => setFormOpen(false)}
          onSaved={(member, notice) => {
            saveInState(member);
            setFormOpen(false);
            notify(notice || "Мастер добавлен");
          }}
        />
      )}

      {toast && <div className="crm-toast" role="status">{toast}</div>}
    </div>
  );
}
