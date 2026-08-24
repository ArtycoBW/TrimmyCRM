"use client";

import { ArrowUpRight } from "lucide-react";
import { useEffect, useRef } from "react";

import { FooterToTop } from "@/components/landing/footer-to-top";
import { LandingFooterAccountLink, LandingPrimaryAction } from "@/components/landing/landing-session";
import { legalConfig } from "@/components/legal/legal-config";

import styles from "./editorial-footer.module.css";

const marqueeItems = ["Онлайн-запись", "Расписание команды", "Карточки клиентов", "Сайт салона", "Напоминания"] as const;

export function EditorialFooter() {
  const footerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const footer = footerRef.current;
    if (!footer) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      footer.style.setProperty("--footer-clip", "0%");
      footer.style.setProperty("--footer-shift", "0px");
      return;
    }

    let frame: number | null = null;
    const update = () => {
      frame = null;
      const rect = footer.getBoundingClientRect();
      const progress = Math.min(1, Math.max(0, (window.innerHeight - rect.top) / Math.max(window.innerHeight * .9, 1)));
      footer.style.setProperty("--footer-clip", `${((1 - progress) * 9).toFixed(3)}%`);
      footer.style.setProperty("--footer-shift", `${((1 - progress) * 56).toFixed(2)}px`);
      footer.style.setProperty("--footer-progress", progress.toFixed(4));
      footer.style.setProperty("--footer-word-y", `${((1 - progress) * 24).toFixed(2)}px`);
      footer.style.setProperty("--footer-glow-opacity", String(.72 + progress * .28));
    };
    const schedule = () => {
      if (frame === null) frame = requestAnimationFrame(update);
    };
    const pointerMove = (event: PointerEvent) => {
      const rect = footer.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / Math.max(rect.width, 1)) - .5;
      const y = ((event.clientY - rect.top) / Math.max(rect.height, 1)) - .5;
      footer.style.setProperty("--footer-glow-x", `${(x * 22).toFixed(2)}px`);
      footer.style.setProperty("--footer-glow-y", `${(y * 14).toFixed(2)}px`);
      footer.style.setProperty("--footer-word-x", `${(x * -12).toFixed(2)}px`);
    };

    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    footer.addEventListener("pointermove", pointerMove, { passive: true });
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      footer.removeEventListener("pointermove", pointerMove);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <footer ref={footerRef} className={styles.footer}>
      <div className={styles.curtain}>
        <div className={styles.grid} aria-hidden="true" />
        <div className={styles.glow} aria-hidden="true" />

        <div className={styles.marquee} aria-hidden="true">
          <div>
            {[0, 1].map((group) => (
              <span key={group}>
                {marqueeItems.map((item) => <b key={`${group}-${item}`}>{item}<i>✦</i></b>)}
              </span>
            ))}
          </div>
        </div>

        <div className={styles.sideNote} data-side="left"><span>Сайт</span><span>Запись</span><span>Команда</span></div>
        <div className={styles.sideNote} data-side="right"><span>Клиенты</span><span>История</span><span>Возврат</span></div>

        <div className={styles.cta}>
          <p className={styles.eyebrow}><span /> Следующий шаг</p>
          <h2>Салон работает.<br />Вы управляете.</h2>
          <p className={styles.lead}>Запустите TrimmyCRM на 14 дней и соберите запись, команду, клиентов и сайт в одном месте.</p>
          <div className={styles.actions}>
            <LandingPrimaryAction className={styles.primaryAction} anonymousLabel="Начать бесплатно" />
            <span className={styles.accountAction}><LandingFooterAccountLink /></span>
          </div>
        </div>

        <div className={styles.giantWord} aria-hidden="true">TRIMMY</div>

        <div className={styles.bottom}>
          <small>© {new Date().getFullYear()} TrimmyCRM</small>
          <nav aria-label="Документы и поддержка">
            <a href="/privacy">Политика</a>
            <a href="/terms">Условия</a>
            <a href="/consent">Согласие</a>
            <a href={`mailto:${legalConfig.email}`}>Поддержка <ArrowUpRight aria-hidden="true" /></a>
          </nav>
          <p>Сделано для тех, кто работает руками и сердцем.</p>
        </div>
      </div>
      <FooterToTop />
    </footer>
  );
}
