"use client";

import { ArrowDown, ArrowUpRight } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";

import { LandingPrimaryAction } from "@/components/landing/landing-session";
import { createRealisticSalonWorld } from "@/components/landing/three/realistic-salon-world";

import styles from "./salon-world-story.module.css";

type SceneStatus = "loading" | "ready" | "error";

export function SalonWorldStory() {
  const storyRef = useRef<HTMLElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<SceneStatus>("loading");
  const [loadProgress, setLoadProgress] = useState(0);

  useEffect(() => {
    const story = storyRef.current;
    const mount = mountRef.current;
    if (!story || !mount) return;

    let cancelled = false;
    let dispose: () => void = () => undefined;
    document.documentElement.dataset.trimmyScene = "loading";

    void createRealisticSalonWorld({
      story,
      mount,
      reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      onProgress: (progress) => {
        if (!cancelled) setLoadProgress(progress);
      },
      onReady: () => {
        if (cancelled) return;
        setStatus("ready");
        document.documentElement.dataset.trimmyScene = "ready";
        window.dispatchEvent(new Event("trimmycrm:salon-scene-ready"));
      },
      onError: (error) => {
        console.error("[trimmy-salon-world] failed to start", error);
        if (cancelled) return;
        setStatus("error");
        document.documentElement.dataset.trimmyScene = "error";
        window.dispatchEvent(new Event("trimmycrm:salon-scene-ready"));
      },
    }).then((cleanup) => {
      if (cancelled) cleanup();
      else dispose = cleanup;
    });

    return () => {
      cancelled = true;
      dispose();
    };
  }, []);

  return (
    <section className={styles.story} id="salon-story" ref={storyRef} aria-labelledby="salon-story-title">
      <div className={styles.stage}>
        <div className={styles.viewport} ref={mountRef} data-status={status}>
          <div className={styles.loader} aria-hidden={status === "ready"}>
            <span style={{ "--load-progress": loadProgress } as CSSProperties} />
            <p>{status === "error" ? "Показываем статичный салон" : "Загружаем пространство"}</p>
          </div>
          <p className={styles.modelHint} aria-hidden="true"><span /> Наведите на предметы</p>
        </div>
      </div>

      <div className={styles.chapters}>
        <section className={`${styles.chapter} ${styles.heroChapter}`}>
          <div className={`${styles.copy} ${styles.heroCopy}`}>
            <p className={styles.kicker}><span /> CRM для салонов и барбершопов</p>
            <h1 id="salon-story-title">Салон.<br /><em>Включён.</em></h1>
            <p className={styles.lead}>Запись, команда, клиенты и сайт живут в одном пространстве. Пройдите через него.</p>
            <div className={styles.actions}>
              <LandingPrimaryAction className={styles.primaryAction} anonymousLabel="Попробовать бесплатно" />
              <a className={styles.secondaryAction} href="#product">Увидеть систему <ArrowUpRight aria-hidden="true" /></a>
            </div>
          </div>
          <a className={styles.scrollCue} href="#scene-booking"><span>Листайте</span><ArrowDown aria-hidden="true" /></a>
        </section>

        <section className={styles.chapter} id="scene-booking">
          <div className={`${styles.copy} ${styles.copyRight}`}>
            <p className={styles.chapterNumber}>01</p>
            <h2>Клиенты записываются сами.</h2>
            <p>Услуга, мастер и свободное время доступны круглосуточно. Новая запись сразу появляется в календаре.</p>
          </div>
        </section>

        <section className={styles.chapter}>
          <div className={styles.copy}>
            <p className={styles.chapterNumber}>02</p>
            <h2>Вся команда видит один день.</h2>
            <p>Администратор и мастера работают с актуальным расписанием без таблиц и ручных уточнений.</p>
          </div>
        </section>

        <section className={styles.chapter}>
          <div className={`${styles.copy} ${styles.copyRight}`}>
            <p className={styles.chapterNumber}>03</p>
            <h2>Каждый визит остаётся в истории.</h2>
            <p>Пожелания, фотографии и формулы хранятся в карточке клиента и доступны только вашей команде.</p>
          </div>
        </section>

        <section className={`${styles.chapter} ${styles.finalChapter}`}>
          <div className={styles.copy}>
            <p className={styles.chapterNumber}>04</p>
            <h2>Сайт приводит записи прямо в CRM.</h2>
            <p>Меняйте услуги, работы и расписание в одном месте. Клиенты всегда видят актуальную информацию.</p>
            <a className={styles.finalAction} href="#builder">Собрать свой сайт <ArrowUpRight aria-hidden="true" /></a>
          </div>
        </section>
      </div>
    </section>
  );
}
