"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AppSelect } from "@/components/ui/select";
import { BrandMark } from "@/components/ui/brand-mark";
import { ApiError, apiRequest } from "@/lib/api/client";
import type { MeResponse, PlanView } from "@/lib/api/types";

type AdminUser = {
  id: string;
  email: string;
  fullName: string | null;
  phone: string | null;
  role: string;
  status: string;
  emailVerified: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  site: { id: string; name: string; slug: string; status: string } | null;
  subscription: { id: string; status: string; currentPeriodEnd: string | null; plan: { id: string; code: string; name: string } | null } | null;
};

type Feedback = {
  id: string;
  message: string;
  createdAt: string;
  readAt: string | null;
  author: { id: string; email: string; fullName: string | null; phone: string | null };
};

type LandingLead = { id: string; kind: "question" | "callback"; name: string; phone: string; question: string | null; preferredTime: string | null; createdAt: string; readAt: string | null };
type ChatLead = { id: string; name: string; phone: string; question: string | null; createdAt: string; readAt: string | null };

type Page<T> = { items: T[]; total: number; page: number; limit: number };
type Tab = "users" | "feedback" | "leads" | "chat";

const formatDate = (value: string | null) => value ? new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
const roleLabel: Record<string, string> = { superadmin: "Владелец платформы", owner: "Владелец салона", staff: "Сотрудник" };
const statusLabel: Record<string, string> = { active: "Активен", pending: "Ожидает", blocked: "Заблокирован", trialing: "Пробный", past_due: "Просрочен", canceled: "Отменён", expired: "Истёк" };

export function AdminWorkspace() {
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);
  const [tab, setTab] = useState<Tab>("users");
  const [users, setUsers] = useState<Page<AdminUser> | null>(null);
  const [feedback, setFeedback] = useState<Page<Feedback> | null>(null);
  const [leads, setLeads] = useState<Page<LandingLead> | null>(null);
  const [chatLeads, setChatLeads] = useState<Page<ChatLead> | null>(null);
  const [plans, setPlans] = useState<PlanView[]>([]);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [role, setRole] = useState("all");
  const [status, setStatus] = useState("all");
  const [planId, setPlanId] = useState("all");
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void apiRequest<MeResponse>("/auth/me", { realm: "platform" })
      .then((me) => {
        if (!active) return;
        if (me.user.role !== "superadmin") {
          router.replace("/app");
          return;
        }
        setAllowed(true);
      })
      .catch((reason) => {
        if (!active) return;
        if (reason instanceof ApiError && reason.status === 401) router.replace("/login?next=/admin");
        else setError(reason instanceof Error ? reason.message : "Не удалось открыть панель администратора");
      });
    return () => { active = false; };
  }, [router]);

  useEffect(() => {
    if (!allowed) return;
    void apiRequest<PlanView[]>("/admin/plans", { realm: "platform" }).then(setPlans).catch(() => undefined);
  }, [allowed]);

  useEffect(() => {
    if (!allowed) return;
    const params = new URLSearchParams({ page: String(page), limit: "20" });
    if (appliedSearch) params.set("search", appliedSearch);
    if (tab === "users") {
      if (role !== "all") params.set("role", role);
      if (status !== "all") params.set("status", status);
      if (planId !== "all") params.set("planId", planId);
    } else {
      if (tab === "leads" && role !== "all") params.set("kind", role);
      if (status !== "all") params.set("status", status);
    }
    const endpoint = tab === "users" ? "/admin/users" : tab === "feedback" ? "/admin/feedback" : tab === "leads" ? "/admin/landing-leads" : "/admin/chat-leads";
    void apiRequest<Page<AdminUser> | Page<Feedback> | Page<LandingLead> | Page<ChatLead>>(`${endpoint}?${params}`, { realm: "platform" })
      .then((payload) => {
        setError(null);
        if (tab === "users") setUsers(payload as Page<AdminUser>);
        else if (tab === "feedback") setFeedback(payload as Page<Feedback>);
        else if (tab === "leads") setLeads(payload as Page<LandingLead>);
        else setChatLeads(payload as Page<ChatLead>);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Не удалось получить данные"));
  }, [allowed, appliedSearch, page, planId, role, status, tab]);

  function selectTab(nextTab: Tab) {
    setTab(nextTab);
    setPage(1);
    setStatus("all");
    setRole("all");
    setPlanId("all");
  }

  function applyFilters(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAppliedSearch(search.trim());
    setPage(1);
  }

  async function setRead(item: Feedback, read: boolean) {
    setUpdatingId(item.id);
    try {
      await apiRequest(`/admin/feedback/${item.id}`, { realm: "platform", method: "PATCH", body: JSON.stringify({ read }) });
      setFeedback((current) => current && {
        ...current,
        items: current.items.map((message) => message.id === item.id ? { ...message, readAt: read ? new Date().toISOString() : null } : message),
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось обновить сообщение");
    } finally {
      setUpdatingId(null);
    }
  }

  async function setPublicLeadRead(kind: "leads" | "chat", item: LandingLead | ChatLead, read: boolean) {
    setUpdatingId(item.id);
    try {
      await apiRequest(`/admin/${kind === "leads" ? "landing-leads" : "chat-leads"}/${item.id}`, { realm: "platform", method: "PATCH", body: JSON.stringify({ read }) });
      const update = <T extends { id: string; readAt: string | null }>(current: Page<T> | null) => current && { ...current, items: current.items.map((lead) => lead.id === item.id ? { ...lead, readAt: read ? new Date().toISOString() : null } : lead) };
      if (kind === "leads") setLeads(update);
      else setChatLeads(update);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось обновить обращение");
    } finally {
      setUpdatingId(null);
    }
  }

  if (!allowed) return <main className="crm-gate" aria-busy="true"><BrandMark /><p>{error || "Проверяем доступ к панели…"}</p></main>;
  const current = tab === "users" ? users : tab === "feedback" ? feedback : tab === "leads" ? leads : chatLeads;
  const totalPages = Math.max(1, Math.ceil((current?.total || 0) / 20));

  return (
    <section className="admin-workspace">
        <header className="admin-header">
          <div><p className="crm-kicker">Закрытый раздел</p><h1>Панель администратора</h1><p>Пользователи сервиса, подписки и обращения в одном месте.</p></div>
        </header>
        <div className="admin-tabs" role="tablist" aria-label="Разделы панели">
          <button type="button" role="tab" aria-selected={tab === "users"} className={tab === "users" ? "is-active" : ""} onClick={() => selectTab("users")}>Пользователи</button>
          <button type="button" role="tab" aria-selected={tab === "feedback"} className={tab === "feedback" ? "is-active" : ""} onClick={() => selectTab("feedback")}>Обратная связь</button>
          <button type="button" role="tab" aria-selected={tab === "leads"} className={tab === "leads" ? "is-active" : ""} onClick={() => selectTab("leads")}>Заявки с лендинга</button>
          <button type="button" role="tab" aria-selected={tab === "chat"} className={tab === "chat" ? "is-active" : ""} onClick={() => selectTab("chat")}>Чат-бот</button>
        </div>
        <form className="admin-filters" onSubmit={applyFilters}>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={tab === "users" ? "Email, имя, телефон или салон" : tab === "feedback" ? "Сообщение, email, имя или телефон" : "Имя, телефон или вопрос"} aria-label="Поиск" />
          {tab === "users" && <>
            <AppSelect value={role} onValueChange={(value) => { setRole(value); setPage(1); }} options={[{ value: "all", label: "Все роли" }, { value: "superadmin", label: "Владелец платформы" }, { value: "owner", label: "Владельцы салонов" }, { value: "staff", label: "Сотрудники" }]} />
            <AppSelect value={status} onValueChange={(value) => { setStatus(value); setPage(1); }} options={[{ value: "all", label: "Все статусы" }, { value: "active", label: "Активные" }, { value: "pending", label: "Ожидают подтверждения" }, { value: "blocked", label: "Заблокированные" }]} />
            <AppSelect value={planId} onValueChange={(value) => { setPlanId(value); setPage(1); }} options={[{ value: "all", label: "Все тарифы" }, ...plans.map((plan) => ({ value: plan.id, label: plan.name }))]} />
          </>}
          {tab === "feedback" && <AppSelect value={status} onValueChange={(value) => { setStatus(value); setPage(1); }} options={[{ value: "all", label: "Все сообщения" }, { value: "new", label: "Новые" }, { value: "read", label: "Прочитанные" }]} />}
          {tab === "leads" && <><AppSelect value={role} onValueChange={(value) => { setRole(value); setPage(1); }} options={[{ value: "all", label: "Все типы" }, { value: "question", label: "Вопросы" }, { value: "callback", label: "Заказ звонка" }]} /><AppSelect value={status} onValueChange={(value) => { setStatus(value); setPage(1); }} options={[{ value: "all", label: "Все заявки" }, { value: "new", label: "Новые" }, { value: "read", label: "Прочитанные" }]} /></>}
          {tab === "chat" && <AppSelect value={status} onValueChange={(value) => { setStatus(value); setPage(1); }} options={[{ value: "all", label: "Все обращения" }, { value: "new", label: "Новые" }, { value: "read", label: "Прочитанные" }]} />}
          <button className="button button--ink" type="submit">Найти</button>
        </form>
        {error && <p className="workspace-notice" role="alert">{error}</p>}
        {tab === "users" ? <UsersTable data={users} /> : tab === "feedback" ? <FeedbackList data={feedback} updatingId={updatingId} onSetRead={setRead} /> : tab === "leads" ? <LandingLeadList data={leads} updatingId={updatingId} onSetRead={(item, read) => setPublicLeadRead("leads", item, read)} /> : <ChatLeadList data={chatLeads} updatingId={updatingId} onSetRead={(item, read) => setPublicLeadRead("chat", item, read)} />}
        {current && current.total > 0 && <div className="admin-pagination"><span>Показано {(page - 1) * 20 + 1}–{Math.min(page * 20, current.total)} из {current.total}</span><div><button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Назад</button><span>{page} / {totalPages}</span><button type="button" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>Вперёд</button></div></div>}
    </section>
  );
}

function UsersTable({ data }: { data: Page<AdminUser> | null }) {
  if (!data) return <div className="admin-skeleton" aria-busy="true"><span /><span /><span /></div>;
  if (!data.items.length) return <p className="admin-empty">По заданным фильтрам пользователей не найдено.</p>;
  return <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Пользователь</th><th>Контакты</th><th>Роль и доступ</th><th>Салон</th><th>Тариф</th><th>Активность</th></tr></thead><tbody>{data.items.map((user) => <tr key={user.id}><td><strong>{user.fullName || "Без имени"}</strong><small>{user.email}</small></td><td><strong>{user.phone || "Телефон не указан"}</strong><small>{user.emailVerified ? "Email подтверждён" : "Email не подтверждён"}</small></td><td><span className="admin-badge">{roleLabel[user.role] || user.role}</span><small>{statusLabel[user.status] || user.status}</small></td><td>{user.site ? <><strong>{user.site.name}</strong><small>{user.site.slug} · {user.site.status}</small></> : "—"}</td><td>{user.subscription ? <><strong>{user.subscription.plan?.name || "Без тарифа"}</strong><small>{statusLabel[user.subscription.status] || user.subscription.status} до {formatDate(user.subscription.currentPeriodEnd)}</small></> : "—"}</td><td><strong>Регистрация: {formatDate(user.createdAt)}</strong><small>Вход: {formatDate(user.lastLoginAt)}</small></td></tr>)}</tbody></table></div>;
}

function FeedbackList({ data, updatingId, onSetRead }: { data: Page<Feedback> | null; updatingId: string | null; onSetRead: (item: Feedback, read: boolean) => void }) {
  if (!data) return <div className="admin-skeleton" aria-busy="true"><span /><span /><span /></div>;
  if (!data.items.length) return <p className="admin-empty">Обращений по заданным фильтрам пока нет.</p>;
  return <div className="admin-feedback-list">{data.items.map((item) => <article className={item.readAt ? "is-read" : ""} key={item.id}><header><div><strong>{item.author.fullName || item.author.email}</strong><span>{item.author.email} · {item.author.phone || "Телефон не указан"}</span></div><time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time></header><p>{item.message}</p><footer><span className="admin-badge">{item.readAt ? "Прочитано" : "Новое"}</span><button type="button" disabled={updatingId === item.id} onClick={() => onSetRead(item, !item.readAt)}>{item.readAt ? "Вернуть в новые" : "Отметить прочитанным"}</button></footer></article>)}</div>;
}

function LandingLeadList({ data, updatingId, onSetRead }: { data: Page<LandingLead> | null; updatingId: string | null; onSetRead: (item: LandingLead, read: boolean) => void }) {
  if (!data) return <div className="admin-skeleton" aria-busy="true"><span /><span /><span /></div>;
  if (!data.items.length) return <p className="admin-empty">Заявок с лендинга пока нет.</p>;
  return <div className="admin-feedback-list">{data.items.map((item) => <article className={item.readAt ? "is-read" : ""} key={item.id}><header><div><strong>{item.name}</strong><span>{item.phone} · {item.kind === "callback" ? `Звонок: ${item.preferredTime}` : "Вопрос с лендинга"}</span></div><time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time></header>{item.question && <p>{item.question}</p>}<footer><span className="admin-badge">{item.readAt ? "Прочитано" : "Новое"}</span><button type="button" disabled={updatingId === item.id} onClick={() => onSetRead(item, !item.readAt)}>{item.readAt ? "Вернуть в новые" : "Отметить прочитанным"}</button></footer></article>)}</div>;
}

function ChatLeadList({ data, updatingId, onSetRead }: { data: Page<ChatLead> | null; updatingId: string | null; onSetRead: (item: ChatLead, read: boolean) => void }) {
  if (!data) return <div className="admin-skeleton" aria-busy="true"><span /><span /><span /></div>;
  if (!data.items.length) return <p className="admin-empty">Контактов из чата пока нет.</p>;
  return <div className="admin-feedback-list">{data.items.map((item) => <article className={item.readAt ? "is-read" : ""} key={item.id}><header><div><strong>{item.name}</strong><span>{item.phone} · Чат-бот</span></div><time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time></header>{item.question && <p>{item.question}</p>}<footer><span className="admin-badge">{item.readAt ? "Прочитано" : "Новое"}</span><button type="button" disabled={updatingId === item.id} onClick={() => onSetRead(item, !item.readAt)}>{item.readAt ? "Вернуть в новые" : "Отметить прочитанным"}</button></footer></article>)}</div>;
}
