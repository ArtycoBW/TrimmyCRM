"use client";

import { useCallback, useEffect, useState, type AnimationEvent } from "react";

import { BrandMark } from "@/components/ui/brand-mark";

const INTRO_STORAGE_KEY = "trimmycrm:first-visit-intro:v2";

const loaderCards = [
  { number: "01", label: "Интерьер", title: "Готовим зал", detail: "Интерьер и рабочие зоны", tone: "paper" },
  { number: "02", label: "Свет", title: "Настраиваем свет", detail: "Материалы и отражения", tone: "ice" },
  { number: "03", label: "Сцена", title: "Расставляем кресла", detail: "Модели и интерактив", tone: "mint" },
  { number: "04", label: "Готово", title: "Открываем салон", detail: "TrimmyCRM к работе готов", tone: "paper" },
] as const;

export const firstVisitPreloaderScript = `
  (() => {
    const key = ${JSON.stringify(INTRO_STORAGE_KEY)};
    try {
      const isLanding = window.location.pathname === "/";
      const seen = window.sessionStorage.getItem(key);
      document.documentElement.dataset.trimmyIntro = isLanding && !seen ? "show" : "seen";
      if (isLanding && !seen) {
        if ("scrollRestoration" in history) history.scrollRestoration = "manual";
        window.scrollTo(0, 0);
        window.sessionStorage.setItem(key, "1");
      }
    } catch {
      document.documentElement.dataset.trimmyIntro = window.location.pathname === "/" ? "show" : "seen";
    }
  })();
`;

export function FirstVisitPreloader() {
  const [mounted, setMounted] = useState(true);
  const [phase, setPhase] = useState<"loading" | "exiting">("loading");
  const [activeCard, setActiveCard] = useState(0);

  const finish = useCallback(() => {
    document.documentElement.dataset.trimmyIntro = "seen";
    setMounted(false);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (root.dataset.trimmyIntro !== "show") {
      const removeHiddenIntro = window.setTimeout(() => setMounted(false), 0);
      return () => window.clearTimeout(removeHiddenIntro);
    }

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (window.location.pathname === "/") {
      const previousScrollBehavior = root.style.scrollBehavior;
      root.style.scrollBehavior = "auto";
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      requestAnimationFrame(() => {
        window.scrollTo({ top: 0, left: 0, behavior: "auto" });
        root.style.scrollBehavior = previousScrollBehavior;
      });
    }
    const startedAt = performance.now();
    const minimumDuration = reducedMotion ? 240 : 900;
    let exitTimer = 0;

    const requestExit = () => {
      const delay = Math.max(0, minimumDuration - (performance.now() - startedAt));
      window.clearTimeout(exitTimer);
      exitTimer = window.setTimeout(() => setPhase("exiting"), delay);
    };

    const isLanding = window.location.pathname === "/";
    const sceneAlreadyReady = root.dataset.trimmyScene === "ready" || root.dataset.trimmyScene === "error";
    if (!isLanding || sceneAlreadyReady) requestExit();

    const handleSceneReady = () => requestExit();
    if (isLanding && !sceneAlreadyReady) window.addEventListener("trimmycrm:salon-scene-ready", handleSceneReady, { once: true });

    const safetyFallback = window.setTimeout(requestExit, isLanding ? 30_000 : 1_200);
    return () => {
      window.removeEventListener("trimmycrm:salon-scene-ready", handleSceneReady);
      window.clearTimeout(exitTimer);
      window.clearTimeout(safetyFallback);
    };
  }, [finish]);

  useEffect(() => {
    if (phase !== "exiting") return;
    const fallback = window.setTimeout(finish, 1_100);
    return () => window.clearTimeout(fallback);
  }, [finish, phase]);

  useEffect(() => {
    if (phase !== "loading" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const cycle = window.setInterval(() => {
      setActiveCard((current) => (current + 1) % loaderCards.length);
    }, 1_050);
    return () => window.clearInterval(cycle);
  }, [phase]);

  function handleAnimationEnd(event: AnimationEvent<HTMLDivElement>) {
    if (phase === "exiting" && event.target === event.currentTarget) finish();
  }

  if (!mounted) return null;

  return (
    <div
      className="first-visit-preloader"
      data-testid="first-visit-preloader"
      role="status"
      aria-live="polite"
      aria-label="Загружаем TrimmyCRM"
      data-phase={phase}
      onAnimationEnd={handleAnimationEnd}
    >
      <div className="first-visit-preloader__frame">
        <header className="first-visit-preloader__header" aria-hidden="true">
          <BrandMark compact />
          <span>Салон загружается</span>
          <small>{String(activeCard + 1).padStart(2, "0")} / {String(loaderCards.length).padStart(2, "0")}</small>
        </header>

        <div className="first-visit-preloader__deck" aria-hidden="true">
          {loaderCards.map((card, index) => {
            const depth = (index - activeCard + loaderCards.length) % loaderCards.length;
            return (
              <article key={card.number} data-depth={depth} data-tone={card.tone}>
                <div>
                  <span>{card.label}</span>
                  <b>{card.number}</b>
                </div>
                <strong>{card.title}</strong>
                <div className="first-visit-preloader__card-meta">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/brand/trimmy-symbol.png" alt="" />
                  <small>{card.detail}</small>
                </div>
              </article>
            );
          })}
        </div>

        <div className="first-visit-preloader__status">
          <span aria-hidden="true"><i /><i /><i /></span>
          <p>Готовим ваш салон</p>
          <small>{loaderCards[activeCard].title}</small>
        </div>
      </div>
    </div>
  );
}
