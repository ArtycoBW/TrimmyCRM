"use client";

import { useEffect, useState } from "react";

import { AppIcon } from "@/components/app/app-icon";
import { PetDrawer } from "@/components/app/pet-drawer";
import { PetForm } from "@/components/app/pet-form";
import { apiRequest } from "@/lib/api/client";
import type { ClientView, Paginated, PetView } from "@/lib/api/types";
import { formatShortDate, speciesLabels } from "@/lib/app/crm";

type PetsData = {
  pets: Paginated<PetView>;
  clients: ClientView[];
};

type PetsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: PetsData };

export function PetsWorkspace() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [requestKey, setRequestKey] = useState(0);
  const [state, setState] = useState<PetsState>({ status: "loading" });
  const [selected, setSelected] = useState<PetView | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ page: String(page), limit: "24" });
      if (search.trim()) params.set("search", search.trim());
      Promise.all([
        apiRequest<Paginated<PetView>>("/admin/pets?" + params.toString(), { realm: "platform" }),
        apiRequest<Paginated<ClientView>>("/clients?page=1&limit=100", { realm: "platform" }),
      ])
        .then(([pets, clients]) => {
          if (active) setState({ status: "ready", data: { pets, clients: clients.items } });
        })
        .catch((reason) => {
          if (active) {
            setState({
              status: "error",
              message: reason instanceof Error ? reason.message : "Не удалось загрузить питомцев",
            });
          }
        });
    }, search ? 260 : 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [page, requestKey, search]);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), 3000);
  }

  if (state.status === "loading") {
    return (
      <div className="crm-directory crm-directory--loading" aria-busy="true">
        <div className="crm-skeleton crm-skeleton--title" />
        <div className="crm-skeleton crm-directory__loading-bar" />
        <div className="pets-loading-grid">
          {Array.from({ length: 8 }, (_, index) => <div className="crm-skeleton" key={index} />)}
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <section className="crm-dashboard-error">
        <span aria-hidden="true">!</span>
        <p className="crm-kicker">База питомцев</p>
        <h1>Не удалось загрузить</h1>
        <p>{state.message}</p>
        <button className="button button--ink" type="button" onClick={() => {
          setState({ status: "loading" });
          setRequestKey((value) => value + 1);
        }}>Попробовать снова</button>
      </section>
    );
  }

  const { pets, clients } = state.data;
  const pages = Math.max(1, Math.ceil(pets.total / pets.limit));
  const dogs = pets.items.filter((pet) => pet.species === "dog").length;
  const cats = pets.items.filter((pet) => pet.species === "cat").length;
  const clientNames = new Map(clients.map((client) => [client.id, client.fullName]));

  return (
    <div className="crm-directory pets-directory">
      <section className="crm-directory__intro">
        <div>
          <p className="crm-kicker">Все хвосты салона</p>
          <h1>Питомцы<span>.</span></h1>
          <p>Порода, особенности, вакцинация и важные заметки перед каждым визитом.</p>
        </div>
        <button className="button button--ink" type="button" onClick={() => setFormOpen(true)}>
          <b>+</b> Добавить питомца
        </button>
      </section>

      <section className="directory-stats" aria-label="Итоги базы питомцев">
        <article><span><AppIcon name="pets" /></span><p>Всего питомцев</p><strong>{pets.total}</strong></article>
        <article><span aria-hidden="true">С</span><p>Собак на странице</p><strong>{dogs}</strong></article>
        <article><span aria-hidden="true">К</span><p>Кошек на странице</p><strong>{cats}</strong></article>
      </section>

      <section className="directory-panel pets-panel">
        <header className="directory-toolbar">
          <label className="directory-search">
            <AppIcon name="pets" />
            <span className="sr-only">Поиск питомцев</span>
            <input
              type="search"
              value={search}
              placeholder="Кличка или порода"
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
            {search && <button type="button" onClick={() => {
              setSearch("");
              setPage(1);
            }} aria-label="Очистить поиск">×</button>}
          </label>
          <p>Страница {page} из {pages}</p>
        </header>

        {pets.items.length ? (
          <div className="pets-grid">
            {pets.items.map((pet, index) => (
              <button className={"pet-card pet-card--" + (index % 4)} type="button" onClick={() => setSelected(pet)} key={pet.id}>
                <div className="pet-card__portrait">
                  <span aria-hidden="true">{pet.name[0]?.toUpperCase()}</span>
                  <i>{speciesLabels[pet.species]}</i>
                </div>
                <div className="pet-card__copy">
                  <p className="crm-kicker">{pet.breed || speciesLabels[pet.species]}</p>
                  <h2>{pet.name}</h2>
                  <span>владелец · {clientNames.get(pet.ownerId) || "клиент CRM"}</span>
                </div>
                <dl>
                  <div><dt>Возраст</dt><dd>{pet.ageYears === null ? "—" : pet.ageYears + " г."}</dd></div>
                  <div><dt>Вес</dt><dd>{pet.weightKg === null ? "—" : pet.weightKg + " кг"}</dd></div>
                  <div className={pet.vaccinationCurrent === false ? "has-warning" : ""}>
                    <dt>Прививки</dt><dd>{pet.vaccinatedUntil ? formatShortDate(pet.vaccinatedUntil) : "нет данных"}</dd>
                  </div>
                </dl>
                <span className="pet-card__open">Открыть →</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="directory-empty">
            <span aria-hidden="true">⌕</span>
            <h2>{search ? "Ничего не нашли" : "Питомцев пока нет"}</h2>
            <p>{search ? "Проверьте кличку или породу." : "Создайте карточку питомца из этого раздела или карточки клиента."}</p>
          </div>
        )}

        {pages > 1 && (
          <footer className="directory-pagination">
            <button type="button" disabled={page <= 1} onClick={() => {
              setState({ status: "loading" });
              setPage((value) => value - 1);
            }}>← Назад</button>
            <span>{page} / {pages}</span>
            <button type="button" disabled={page >= pages} onClick={() => {
              setState({ status: "loading" });
              setPage((value) => value + 1);
            }}>Дальше →</button>
          </footer>
        )}
      </section>

      {selected && (
        <PetDrawer
          pet={selected}
          ownerName={clientNames.get(selected.ownerId)}
          onClose={() => setSelected(null)}
        />
      )}

      {formOpen && (
        <PetForm
          clients={clients}
          onClose={() => setFormOpen(false)}
          onSaved={(pet) => {
            setState((current) => current.status === "ready"
              ? {
                  ...current,
                  data: {
                    ...current.data,
                    pets: {
                      ...current.data.pets,
                      total: current.data.pets.total + 1,
                      items: [pet, ...current.data.pets.items].slice(0, current.data.pets.limit),
                    },
                  },
                }
              : current
            );
            setFormOpen(false);
            setSelected(pet);
            notify("Питомец добавлен");
          }}
        />
      )}

      {toast && <div className="crm-toast" role="status">{toast}</div>}
    </div>
  );
}
