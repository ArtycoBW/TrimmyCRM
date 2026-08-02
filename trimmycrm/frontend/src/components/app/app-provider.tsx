"use client";

import type { Route } from "next";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { BrandMark } from "@/components/ui/brand-mark";
import { apiRequest, ApiError, logout } from "@/lib/api/client";
import type { MeResponse, SiteView } from "@/lib/api/types";

type AppContextValue = {
  me: MeResponse;
  site: SiteView | null;
  setSite: (site: SiteView) => void;
  signOut: () => Promise<void>;
};

type BootstrapState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; me: MeResponse; site: SiteView | null };

const AppContext = createContext<AppContextValue | null>(null);

function AppLoading({ label = "Собираем рабочий день…" }: { label?: string }) {
  return (
    <main className="crm-gate" aria-busy="true">
      <BrandMark />
      <div className="crm-gate__loader" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <p>{label}</p>
    </main>
  );
}

export function AppProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const initialPath = useRef(pathname);
  const [state, setState] = useState<BootstrapState>({ status: "loading" });

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      try {
        const me = await apiRequest<MeResponse>("/auth/me", { realm: "platform" });
        if (!active) return;

        let site: SiteView | null = null;
        const hasSalonAccess = me.user.role === "owner" || me.user.role === "superadmin";
        if (hasSalonAccess) {
          try {
            site = await apiRequest<SiteView>("/sites/mine", { realm: "platform" });
          } catch (reason) {
            if (!(reason instanceof ApiError && reason.status === 404 && reason.code === "site_not_found")) {
              throw reason;
            }
          }
        }

        if (hasSalonAccess && site === null && initialPath.current !== "/app/onboarding") {
          router.replace("/app/onboarding" as Route);
        } else if (site !== null && initialPath.current === "/app/onboarding") {
          router.replace("/app" as Route);
        }
        if (active) setState({ status: "ready", me, site });
      } catch (reason) {
        if (!active) return;
        if (reason instanceof ApiError && reason.status === 401) {
          router.replace(("/login?next=" + encodeURIComponent(initialPath.current)) as Route);
          return;
        }
        setState({
          status: "error",
          message: reason instanceof Error ? reason.message : "Не удалось открыть кабинет",
        });
      }
    }

    void bootstrap();
    return () => {
      active = false;
    };
  }, [router]);

  const needsOnboarding =
    state.status === "ready" &&
    (state.me.user.role === "owner" || state.me.user.role === "superadmin") &&
    state.site === null;
  const routeMismatch =
    state.status === "ready" &&
    ((needsOnboarding && pathname !== "/app/onboarding") ||
      (!needsOnboarding && pathname === "/app/onboarding"));

  useEffect(() => {
    if (state.status !== "ready") return;
    if (needsOnboarding && pathname !== "/app/onboarding") {
      router.replace("/app/onboarding" as Route);
    } else if (!needsOnboarding && pathname === "/app/onboarding") {
      router.replace("/app" as Route);
    }
  }, [needsOnboarding, pathname, router, state.status]);

  const value = useMemo<AppContextValue | null>(() => {
    if (state.status !== "ready") return null;
    return {
      me: state.me,
      site: state.site,
      setSite: (site) => setState((current) =>
        current.status === "ready" ? { ...current, site } : current
      ),
      signOut: async () => {
        await logout("platform");
        router.replace("/login" as Route);
      },
    };
  }, [router, state]);

  if (state.status === "loading" || routeMismatch) {
    return <AppLoading label={routeMismatch ? "Готовим кабинет…" : undefined} />;
  }

  if (state.status === "error") {
    return (
      <main className="crm-gate crm-gate--error">
        <BrandMark />
        <span className="crm-gate__error-icon" aria-hidden="true">!</span>
        <h1>Кабинет не открылся</h1>
        <p>{state.message}</p>
        <button className="button button--ink" type="button" onClick={() => window.location.reload()}>
          Попробовать снова
        </button>
      </main>
    );
  }

  if (!value) return <AppLoading />;
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp must be used inside AppProvider");
  return value;
}
