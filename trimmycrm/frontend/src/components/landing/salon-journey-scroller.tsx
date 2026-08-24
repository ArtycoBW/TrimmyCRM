"use client";

import { ArrowDown, ArrowUpRight } from "lucide-react";
import Image from "next/image";
import { type CSSProperties, useEffect, useRef, useState } from "react";

import styles from "./salon-journey-scroller.module.css";

const chapters = [
  {
    number: "01",
    eyebrow: "Онлайн-запись",
    title: "Запись без звонков",
    text: "Клиент выбирает услугу, мастера и свободное время прямо на сайте салона.",
    image: "/images/editorial/journey/booking-owner.webp",
    alt: "Владелица современного салона подтверждает новую запись на смартфоне",
  },
  {
    number: "02",
    eyebrow: "Расписание",
    title: "День без накладок",
    text: "Вся команда видит одно актуальное расписание: от первого окна до закрытия.",
    image: "/images/editorial/journey/team-schedule.webp",
    alt: "Мастер и управляющая сверяют расписание салона на планшете",
  },
  {
    number: "03",
    eyebrow: "Клиенты",
    title: "Помнить каждого",
    text: "История посещений, предпочтения и важные заметки остаются в карточке клиента.",
    image: "/images/editorial/journey/returning-client.webp",
    alt: "Мастер встречает постоянную клиентку с короткой серебристой стрижкой",
  },
  {
    number: "04",
    eyebrow: "Работа мастера",
    title: "Продолжить с нужного места",
    text: "Формулы окрашивания и фотографии процедур доступны мастеру перед новым визитом.",
    image: "/images/editorial/journey/color-formula.webp",
    alt: "Колорист наносит состав постоянной клиентке в современной колор-зоне",
  },
  {
    number: "05",
    eyebrow: "Конструктор",
    title: "Свой сайт за вечер",
    text: "Услуги, команда, портфолио и запись собираются в цельную витрину без разработчика.",
    image: "/images/editorial/journey/site-owner.webp",
    alt: "Владелец барбершопа настраивает сайт салона за ноутбуком",
  },
  {
    number: "06",
    eyebrow: "Возвращаемость",
    title: "Напомнить вовремя",
    text: "Подтверждения и напоминания помогают клиенту не забыть о визите, а креслу не пустовать.",
    image: "/images/editorial/journey/appointment-reminder.webp",
    alt: "Клиентка получает напоминание после визита в светлом городском салоне",
  },
] as const;

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

export function SalonJourneyScroller() {
  const sectionRef = useRef<HTMLElement>(null);
  const frame = useRef<number | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [journeyPosition, setJourneyPosition] = useState(0);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      section.style.setProperty("--journey-progress", "0");
      return;
    }

    const update = () => {
      frame.current = null;
      const rect = section.getBoundingClientRect();
      const travel = Math.max(section.offsetHeight - window.innerHeight, 1);
      const progress = clamp(-rect.top / travel);
      const nextPosition = progress * (chapters.length - 1);
      const nextIndex = Math.min(chapters.length - 1, Math.round(nextPosition));
      section.style.setProperty("--journey-progress", progress.toFixed(4));
      setJourneyPosition((current) => Math.abs(current - nextPosition) < 0.001 ? current : nextPosition);
      setActiveIndex((current) => current === nextIndex ? current : nextIndex);
    };

    const schedule = () => {
      if (frame.current === null) frame.current = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, []);

  const goToChapter = (index: number) => {
    const section = sectionRef.current;
    if (!section) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const sectionTop = window.scrollY + section.getBoundingClientRect().top;
    const travel = Math.max(section.offsetHeight - window.innerHeight, 0);
    const target = sectionTop + (index / Math.max(chapters.length - 1, 1)) * travel;
    window.scrollTo({ top: target, behavior: reducedMotion ? "auto" : "smooth" });
  };

  return (
    <section
      ref={sectionRef}
      id="journey"
      className={styles.journey}
      aria-labelledby="journey-title"
      data-active-chapter={activeIndex + 1}
    >
      <h2 id="journey-title" className={styles.srTitle}>Как TrimmyCRM ведёт клиента от выбора времени до следующего визита</h2>
      <div className={styles.reducedJourney}>
        <header>
          <p>Салон в движении</p>
          <h3>Один рабочий день в TrimmyCRM.</h3>
        </header>
        <div>
          {chapters.map((chapter) => (
            <article key={chapter.number}>
              <figure>
                <Image src={chapter.image} alt={chapter.alt} fill quality={94} sizes="(max-width: 600px) 100vw, 50vw" />
              </figure>
              <span>{chapter.number} / {chapter.eyebrow}</span>
              <h4>{chapter.title}</h4>
              <p>{chapter.text}</p>
            </article>
          ))}
        </div>
      </div>
      <div className={styles.stage}>
        <header className={styles.topline}>
          <p>Один рабочий день в TrimmyCRM</p>
          <span>{String(activeIndex + 1).padStart(2, "0")} / {String(chapters.length).padStart(2, "0")}</span>
        </header>

        <div className={styles.rail} aria-hidden="true">
          <span>TrimmyCRM</span>
          <i />
          <span>Листайте</span>
          <ArrowDown />
        </div>

        <div className={styles.copy}>
          <p className={styles.kicker}>Салон в движении</p>
          <ol className={styles.chapterList}>
            {chapters.map((chapter, index) => {
              const distance = Math.abs(index - activeIndex);
              return (
                <li key={chapter.number} data-active={index === activeIndex ? "true" : "false"} data-near={distance <= 1 ? "true" : "false"}>
                  <button type="button" onClick={() => goToChapter(index)} aria-current={index === activeIndex ? "step" : undefined}>
                    <span>{chapter.number}</span>
                    <b>{chapter.title}</b>
                  </button>
                </li>
              );
            })}
          </ol>
          <div className={styles.activeCopy} aria-live="polite">
            <span>{chapters[activeIndex].eyebrow}</span>
            <h3>{chapters[activeIndex].title}</h3>
            <p>{chapters[activeIndex].text}</p>
            {activeIndex === chapters.length - 1 && (
              <a href="#plans">Попробовать на своём салоне <ArrowUpRight aria-hidden="true" /></a>
            )}
          </div>
        </div>

        <div className={styles.media} aria-label="Сценарий работы салона">
          {chapters.map((chapter, index) => {
            const offset = index - journeyPosition;
            const distance = Math.abs(offset);
            const isActive = index === activeIndex;
            const mediaStyle = {
              "--card-y": `${offset * 18}%`,
              "--card-scale": String(1 - Math.min(distance, 2) * 0.065),
              "--card-opacity": String(isActive ? 1 : Math.max(0, 1 - distance * 1.15)),
              "--card-z": String(isActive ? 30 : 20 - Math.round(distance * 4)),
            } as CSSProperties;
            return (
              <figure
                key={chapter.number}
                className={styles.mediaCard}
                style={mediaStyle}
                data-active={index === activeIndex ? "true" : "false"}
                aria-hidden={index === activeIndex ? undefined : "true"}
              >
                <Image
                  src={chapter.image}
                    alt={index === activeIndex ? chapter.alt : ""}
                    fill
                    quality={94}
                    sizes="(max-width: 780px) 100vw, 52vw"
                  loading={index < 2 ? "eager" : "lazy"}
                />
                <figcaption>
                  <span>{chapter.eyebrow}</span>
                  <b>{chapter.number}</b>
                </figcaption>
              </figure>
            );
          })}
        </div>

        <div className={styles.progress} aria-hidden="true"><i /></div>
      </div>
    </section>
  );
}
