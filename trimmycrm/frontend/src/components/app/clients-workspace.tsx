"use client";

import { useEffect, useState } from "react";

import { ClientDrawer } from "@/components/app/client-drawer";
import { ClientForm } from "@/components/app/client-form";
import { useApp } from "@/components/app/app-provider";
import { AppIcon } from "@/components/app/app-icon";
import { apiRequest } from "@/lib/api/client";
import type {
  ClientDetailsView,
  ClientView,
  Paginated,
} from "@/lib/api/types";
import {
  clientStatuses,
  formatShortDate,
  personInitials,
} from "@/lib/app/crm";

type ClientsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; result: Paginated<ClientView> };

export function ClientsWorkspace() {
  const { me, site } = useApp();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [requestKey, setRequestKey] = useState(0);
  const [state, setState] = useState<ClientsState>({ status: "loading" });
  const [details, setDetails] = useState<ClientDetailsView | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ page: String(page), limit: "20" });
      if (search.trim()) params.set("search", search.trim());
      apiRequest<Paginated<ClientView>>("/clients?" + params.toString(), { realm: "platform" })
        .then((result) => {
          if (active) setState({ status: "ready", result });
        })
        .catch((reason) => {
          if (active) {
            setState({
              status: "error",
              message: reason instanceof Error ? reason.message : "Не удалось загрузить клиентов",
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

  async function openClient(clientId: string) {
    setDetailsLoading(true);
    try {
      const value = await apiRequest<ClientDetailsView>("/clients/" + clientId, { realm: "platform" });
      setDetails(value);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Не удалось открыть клиента");
    } finally {
      setDetailsLoading(false);
    }
  }

  function updateClientInList(client: ClientView) {
    setState((current) => {
      if (current.status !== "ready") return current;
      const exists = current.result.items.some((item) => item.id === client.id);
      return {
        ...current,
        result: {
          ...current.result,
          total: exists ? current.result.total : current.result.total + 1,
          items: exists
            ? current.result.items.map((item) => item.id === client.id ? { ...item, ...client } : item)
            : [client, ...current.result.items].slice(0, current.result.limit),
        },
      };
    });
  }

  if (state.status === "loading") {
    return (
      <div className="crm-directory crm-directory--loading" aria-busy="true">
        <div className="crm-skeleton crm-skeleton--title" />
        <div className="crm-skeleton crm-directory__loading-bar" />
        <div className="crm-skeleton crm-directory__loading-table" />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <section className="crm-dashboard-error">
        <span aria-hidden="true">!</span>
        <p className="crm-kicker">Клиентская база</p>
        <h1>Не удалось загрузить</h1>
        <p>{state.message}</p>
        <button className="button button--ink" type="button" onClick={() => {
          setState({ status: "loading" });
          setRequestKey((value) => value + 1);
        }}>Попробовать снова</button>
      </section>
    );
  }

  const result = state.result;
  const pages = Math.max(1, Math.ceil(result.total / result.limit));
  const activeOnPage = result.items.filter((client) => client.status === "active").length;
  const clientLimit = me.subscription?.plan.limits.clients;

  return (
    <div className="crm-directory">
      <section className="crm-directory__intro">
        <div>
          <p className="crm-kicker">Клиентская база</p>
          <h1>Клиенты<span>.</span></h1>
          <p>Контакты, профиль волос и вся история визитов — без разрозненных заметок.</p>
        </div>
        <button className="button button--ink" type="button" onClick={() => setCreateOpen(true)}>
          <b>+</b> Добавить клиента
        </button>
      </section>

      <section className="directory-stats" aria-label="Итоги клиентской базы">
        <article><span><AppIcon name="clients" /></span><p>Всего клиентов</p><strong>{result.total}</strong></article>
        <article><span aria-hidden="true">✓</span><p>Активны на странице</p><strong>{activeOnPage}</strong></article>
        <article><span aria-hidden="true">↗</span><p>Лимит тарифа</p><strong>{result.total} / {clientLimit ?? "∞"}</strong></article>
      </section>

      <section className="directory-panel">
        <header className="directory-toolbar">
          <label className="directory-search">
            <AppIcon name="clients" />
            <span className="sr-only">Поиск клиентов</span>
            <input
              type="search"
              value={search}
              placeholder="Имя, телефон или email"
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

        <div className="clients-table">
          <header>
            <span>Клиент</span><span>Контакты</span><span>Статус</span><span>В CRM с</span><span />
          </header>
          {result.items.length ? result.items.map((client) => {
            const status = clientStatuses[client.status] || clientStatuses.crm_only;
            return (
              <button className="client-row" type="button" onClick={() => void openClient(client.id)} key={client.id}>
                <span className="client-row__person">
                  <i aria-hidden="true">{personInitials(client.fullName)}</i>
                  <span><strong>{client.fullName || "Без имени"}</strong><small>ID · {client.id.slice(0, 8)}</small></span>
                </span>
                <span className="client-row__contacts">
                  <strong>{client.phone || "Телефон не указан"}</strong>
                  <small>{client.email || "Email не указан"}</small>
                </span>
                <span><i className={"crm-status crm-status--" + status.tone}>{status.label}</i></span>
                <time dateTime={client.createdAt}>{formatShortDate(client.createdAt)}</time>
                <b aria-hidden="true">→</b>
              </button>
            );
          }) : (
            <div className="directory-empty">
              <span aria-hidden="true">⌕</span>
              <h2>{search ? "Ничего не нашли" : "Клиентов пока нет"}</h2>
              <p>{search ? "Попробуйте другой запрос." : "Добавьте первого клиента — его профиль и визиты будут собраны здесь."}</p>
            </div>
          )}
        </div>

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

      {detailsLoading && (
        <div className="crm-side-loader" role="status"><span /><p>Открываем карточку…</p></div>
      )}

      {editOpen && details ? (
        <ClientForm
          client={details}
          onClose={() => setEditOpen(false)}
          onSaved={(client) => {
            updateClientInList(client);
            setDetails((current) => current
              ? {
                  ...current,
                  ...client,
                  appointmentHistory: current.appointmentHistory,
                }
              : current
            );
            setEditOpen(false);
            notify("Данные клиента сохранены");
          }}
        />
      ) : details ? (
        <ClientDrawer
          client={details}
          timezone={site?.timezone || "Europe/Moscow"}
          onClose={() => setDetails(null)}
          onEdit={() => setEditOpen(true)}
        />
      ) : null}

      {createOpen && (
        <ClientForm
          onClose={() => setCreateOpen(false)}
          onSaved={(client) => {
            updateClientInList(client);
            setCreateOpen(false);
            setDetails({ ...client, appointmentHistory: [] });
            notify("Клиент добавлен");
          }}
        />
      )}

      {toast && <div className="crm-toast" role="status">{toast}</div>}
    </div>
  );
}
