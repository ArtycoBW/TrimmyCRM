"use client";

import { useLayoutEffect, useMemo, useState } from "react";

type TourStep = { target: string; title: string; description: string };

const desktopSteps: TourStep[] = [
  { target: "#crm-content", title: "Ваш рабочий кабинет", description: "Здесь собраны главные показатели и все рабочие разделы салона." },
  { target: "[data-tour='calendar']", title: "Календарь", description: "Планируйте визиты, переносите записи и держите день под контролем." },
  { target: "[data-tour='clients']", title: "Клиенты", description: "В карточках хранится история визитов, контакты и профиль волос или бороды." },
  { target: "[data-tour='site']", title: "Сайт салона", description: "Соберите лендинг, добавьте фотографии и включите онлайн-запись без разработчика." },
  { target: "[data-tour='settings']", title: "Настройки и помощь", description: "Здесь меняются данные салона, а «Инструкция» всегда запускает этот тур заново." },
];

const mobileSteps: TourStep[] = [
  desktopSteps[0],
  { target: "[data-tour='mobile-calendar']", title: "Календарь", description: "Быстрый доступ к расписанию — всегда внизу экрана." },
  { target: "[data-tour='mobile-clients']", title: "Клиенты", description: "Открывайте карточки клиентов и историю визитов в один тап." },
  { target: "[data-tour='mobile-more']", title: "Остальные разделы", description: "В меню находятся сайт салона, аналитика, настройки и инструкция." },
];

type Rect = { top: number; left: number; width: number; height: number } | null;

export function DashboardTour({ open, onOpenChange }: { open: boolean; onOpenChange: (value: boolean) => void }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const [rect, setRect] = useState<Rect>(null);
  const steps = useMemo(() => (isMobile ? mobileSteps : desktopSteps), [isMobile]);
  const safeStepIndex = Math.min(stepIndex, steps.length - 1);
  const step = steps[safeStepIndex];

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const compact = window.innerWidth <= 760;
      setIsMobile(compact);
      const activeSteps = compact ? mobileSteps : desktopSteps;
      const active = activeSteps[Math.min(stepIndex, activeSteps.length - 1)];
      const element = document.querySelector(active.target);
      if (!element) return setRect(null);
      const box = element.getBoundingClientRect();
      setRect({ top: box.top, left: box.left, width: box.width, height: box.height });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, stepIndex]);

  if (!open) return null;
  const last = safeStepIndex === steps.length - 1;
  const closeTour = () => {
    setStepIndex(0);
    onOpenChange(false);
  };
  const top = rect ? Math.min(Math.max(rect.top + rect.height + 16, 16), window.innerHeight - 250) : undefined;
  const left = rect ? Math.min(Math.max(rect.left + Math.min(rect.width / 2, 190), 16), window.innerWidth - 400) : undefined;

  return (
    <div className="dashboard-tour" role="dialog" aria-modal="true" aria-labelledby="dashboard-tour-title">
      <button className="dashboard-tour__backdrop" type="button" aria-label="Закрыть тур" onClick={closeTour} />
      {rect && <div className="dashboard-tour__spotlight" style={{ top: rect.top - 7, left: rect.left - 7, width: rect.width + 14, height: rect.height + 14 }} />}
      <section className="dashboard-tour__card" style={rect ? { top, left } : undefined}>
        <button className="dashboard-tour__close" type="button" aria-label="Закрыть тур" onClick={closeTour}>×</button>
        <p className="crm-kicker">Знакомство с TrimmyCRM</p>
        <h2 id="dashboard-tour-title">{step.title}</h2>
        <p>{step.description}</p>
        <footer>
          <span>{safeStepIndex + 1} / {steps.length}</span>
          <div>
            {safeStepIndex > 0 && <button type="button" onClick={() => setStepIndex((value) => value - 1)}>Назад</button>}
            <button className="button button--ink" type="button" onClick={() => last ? closeTour() : setStepIndex((value) => value + 1)}>
              {last ? "Готово" : "Далее"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
