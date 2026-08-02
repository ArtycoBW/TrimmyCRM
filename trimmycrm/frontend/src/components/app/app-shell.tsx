"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { AppIcon, type AppIconName } from "@/components/app/app-icon";
import { useApp } from "@/components/app/app-provider";
import { BrandMark } from "@/components/ui/brand-mark";
import { DashboardTour } from "@/components/app/dashboard-tour";
import { FeedbackDialog } from "@/components/app/feedback-dialog";
import { PlanDialog } from "@/components/app/plan-dialog";
import { useHydrated } from "@/hooks/use-hydrated";
import { apiRequest } from "@/lib/api/client";
import { tenantSiteUrl } from "@/lib/app/site-url";

const navigation: Array<{
  label: string;
  href: string;
  icon: AppIconName;
  enabled: boolean;
  separator?: boolean;
}> = [
  { label: "Обзор", href: "/app", icon: "home", enabled: true },
  { label: "Календарь", href: "/app/calendar", icon: "calendar", enabled: true },
  { label: "Записи", href: "/app/appointments", icon: "booking", enabled: true },
  { label: "Клиенты", href: "/app/clients", icon: "clients", enabled: true, separator: true },
  { label: "Услуги", href: "/app/services", icon: "services", enabled: true },
  { label: "Команда", href: "/app/staff", icon: "staff", enabled: true },
  { label: "Сайт салона", href: "/app/site", icon: "site", enabled: true, separator: true },
  { label: "Аналитика", href: "/app/analytics", icon: "analytics", enabled: true },
  { label: "Настройки", href: "/app/settings", icon: "settings", enabled: true },
  { label: "Обратная связь", href: "#feedback", icon: "feedback", enabled: true },
  { label: "Инструкция", href: "/app/instructions", icon: "guide", enabled: true },
];

function initials(name: string | null, email: string) {
  const source = name?.trim() || email.split("@")[0] || "GC";
  return source
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function trialDaysLeft(value: string | null | undefined) {
  if (!value) return null;
  return Math.max(0, Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000));
}

export function AppFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/app/onboarding") return children;
  return <AppShell>{children}</AppShell>;
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const hydrated = useHydrated();
  const { me, site, signOut } = useApp();
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const plan = me.subscription?.plan;
  const daysLeft = trialDaysLeft(me.subscription?.currentPeriodEnd);
  const userInitials = initials(me.user.fullName, me.user.email);
  const visibleNavigation = me.user.role === "superadmin"
    ? [...navigation, { label: "Панель администратора", href: "/admin", icon: "admin" as const, enabled: true, separator: true }]
    : navigation;

  useEffect(() => {
    document.body.classList.toggle("crm-menu-open", menuOpen);
    return () => document.body.classList.remove("crm-menu-open");
  }, [menuOpen]);

  useEffect(() => {
    let active = true;
    const startTour = () => setTourOpen(true);
    window.addEventListener("trimmycrm:start-dashboard-tour", startTour);
    void apiRequest<{ shouldShow: boolean }>("/auth/dashboard-tour/claim", { realm: "platform", method: "POST" })
      .then(({ shouldShow }) => { if (active && shouldShow) setTourOpen(true); })
      .catch(() => undefined);
    return () => {
      active = false;
      window.removeEventListener("trimmycrm:start-dashboard-tour", startTour);
    };
  }, []);

  const today = useMemo(
    () =>
      new Intl.DateTimeFormat("ru-RU", {
        weekday: "long",
        day: "numeric",
        month: "long",
        timeZone: site?.timezone || "Europe/Moscow",
      }).format(new Date()),
    [site?.timezone],
  );

  async function handleSignOut() {
    setLoggingOut(true);
    await signOut();
  }

  return (
    <div className="crm-layout">
      <aside className={"crm-sidebar" + (menuOpen ? " crm-sidebar--open" : "")}>
        <div className="crm-sidebar__brand">
          <Link href="/app" aria-label="TrimmyCRM — обзор">
            <BrandMark />
          </Link>
          <button type="button" onClick={() => setMenuOpen(false)} aria-label="Закрыть меню">
            ×
          </button>
        </div>

        <div className="crm-salon-card">
          <span className="crm-salon-card__mark" aria-hidden="true">
            {(site?.name || "G")[0]?.toUpperCase()}
          </span>
          <span>
            <small>рабочий кабинет</small>
            <strong>{site?.name || "Команда салона"}</strong>
          </span>
          <i aria-hidden="true">•••</i>
        </div>

        <nav className="crm-nav" aria-label="Навигация кабинета">
          {visibleNavigation.map((item) => {
            const active = item.href.startsWith("/") && (item.href === "/app" ? pathname === item.href : pathname.startsWith(item.href));
            const content = (
              <>
                <AppIcon name={item.icon} />
                <span>{item.label}</span>
                {!item.enabled && <small>скоро</small>}
              </>
            );
            return (
              <div className={item.separator ? "crm-nav__item crm-nav__item--separated" : "crm-nav__item"} key={item.href}>
                {item.href === "#feedback" ? (
                  <button type="button" onClick={() => { setFeedbackOpen(true); setMenuOpen(false); }}>
                    {content}
                  </button>
                ) : item.enabled ? (
                  <Link className={active ? "is-active" : ""} data-tour={item.href === "/app/calendar" ? "calendar" : item.href === "/app/clients" ? "clients" : item.href === "/app/site" ? "site" : item.href === "/app/settings" ? "settings" : undefined} href={item.href as Route} onClick={() => setMenuOpen(false)}>
                    {content}
                  </Link>
                ) : (
                  <span className="is-disabled" aria-disabled="true">{content}</span>
                )}
              </div>
            );
          })}
        </nav>

        <div className="crm-sidebar__bottom">
          {me.subscription?.status === "trialing" && (
            <div className="crm-trial-card">
              <span>{daysLeft ?? 14}</span>
              <p><strong>дней пробного периода</strong><br />Все функции старта уже открыты.</p>
              <button type="button" onClick={() => setPlanDialogOpen(true)}>Выбрать тариф →</button>
            </div>
          )}
          <div className="crm-profile">
            <span>{userInitials}</span>
            <p><strong>{me.user.fullName || me.user.email.split("@")[0]}</strong><small>{plan?.name || "Без тарифа"}</small></p>
            <button type="button" onClick={handleSignOut} disabled={loggingOut} aria-label="Выйти">
              ↗
            </button>
          </div>
        </div>
      </aside>

      <button
        className={"crm-sidebar-backdrop" + (menuOpen ? " is-visible" : "")}
        type="button"
        aria-label="Закрыть меню"
        onClick={() => setMenuOpen(false)}
        tabIndex={menuOpen ? 0 : -1}
      />

      <div className="crm-workspace">
        <header className="crm-topbar">
          <div className="crm-topbar__mobile-brand"><BrandMark compact /></div>
          <button
            className="crm-topbar__menu"
            type="button"
            aria-label="Открыть меню"
            aria-expanded={menuOpen}
            disabled={!hydrated}
            onClick={() => setMenuOpen(true)}
          >
            <AppIcon name="menu" />
          </button>
          <div className="crm-topbar__date">
            <span aria-hidden="true">●</span>
            <p>Сегодня</p>
            <strong>{today}</strong>
          </div>
          <div className="crm-topbar__actions">
            {site?.publishedVersion ? (
              <a href={tenantSiteUrl(site.slug)} target="_blank" rel="noreferrer">
                Открыть сайт ↗
              </a>
            ) : (
              <span>Сайт ещё не опубликован</span>
            )}
            <span className="crm-topbar__avatar">{userInitials}</span>
          </div>
        </header>
        <main className="crm-main" id="crm-content">{children}</main>
      </div>

      <nav className="crm-mobile-nav" aria-label="Быстрая навигация">
        <Link className={pathname === "/app" ? "is-active" : ""} href="/app" onClick={() => setMenuOpen(false)}>
          <AppIcon name="home" />
          <span>Обзор</span>
        </Link>
        <Link className={pathname === "/app/calendar" ? "is-active" : ""} data-tour="mobile-calendar" href={"/app/calendar" as Route} onClick={() => setMenuOpen(false)}>
          <AppIcon name="calendar" /><span>Календарь</span>
        </Link>
        <Link className={pathname === "/app/clients" ? "is-active" : ""} data-tour="mobile-clients" href={"/app/clients" as Route} onClick={() => setMenuOpen(false)}>
          <AppIcon name="clients" /><span>Клиенты</span>
        </Link>
        <button type="button" data-tour="mobile-more" onClick={() => setMenuOpen(true)} disabled={!hydrated}>
          <AppIcon name="menu" />
          <span>Ещё</span>
        </button>
      </nav>
      <PlanDialog
        open={planDialogOpen}
        onOpenChange={setPlanDialogOpen}
        currentPlanId={plan?.id}
      />
      <DashboardTour open={tourOpen} onOpenChange={setTourOpen} />
      <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} phone={me.user.phone || ""} />
    </div>
  );
}
