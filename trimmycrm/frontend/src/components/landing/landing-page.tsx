import Image from "next/image";
import { ArrowUpRight, MoveHorizontal, ShieldCheck } from "lucide-react";

import { InfiniteDragGallery, HeroPhotoLoop, type EditorialPhoto } from "@/components/landing/infinite-gallery";
import { LandingChat } from "@/components/landing/landing-chat";
import { LandingContactSection } from "@/components/landing/landing-contact-section";
import { LandingHeader } from "@/components/landing/landing-header";
import {
  LandingFooterAccountLink,
  LandingPrimaryAction,
  LandingSessionProvider,
} from "@/components/landing/landing-session";
import { PlansSection } from "@/components/landing/plans-section";
import { legalConfig } from "@/components/legal/legal-config";
import { faqs, productFeatures } from "@/content/landing";

import styles from "./editorial-landing.module.css";

const portraits: readonly EditorialPhoto[] = [
  {
    src: "/images/editorial/woman-copper-bob.webp",
    alt: "Женщина с медным графичным бобом",
    label: "Медный боб",
  },
  {
    src: "/images/editorial/man-textured-crop.webp",
    alt: "Мужчина с текстурной короткой стрижкой",
    label: "Текстурный кроп",
  },
  {
    src: "/images/editorial/woman-graphic-pixie.webp",
    alt: "Женщина с графичной стрижкой пикси",
    label: "Графичная пикси",
  },
  {
    src: "/images/editorial/man-layered-curls.webp",
    alt: "Мужчина со слоистой стрижкой на кудрявых волосах",
    label: "Слоистые кудри",
  },
  {
    src: "/images/editorial/salon-cut-session.webp",
    alt: "Мастер выполняет мужскую стрижку в светлом салоне",
    label: "Стрижка в работе",
  },
  {
    src: "/images/editorial/salon-copper-consultation.webp",
    alt: "Колорист обсуждает медный оттенок с клиенткой",
    label: "Консультация по цвету",
  },
];

export function LandingPage() {
  return (
    <LandingSessionProvider>
      <div className={`${styles.root} editorial-landing landing-shell`} id="top">
        <a className="skip-link" href="#main-content">К содержанию</a>
        <LandingHeader />

        <main id="main-content">
          <section className={styles.hero} aria-labelledby="hero-title">
            <div className={styles.heroCopy}>
              <p className={styles.eyebrow}>CRM для hair-индустрии</p>
              <h1 id="hero-title">
                <span>Салон в ритме.</span>
                <span>Рутина уходит.</span>
              </h1>
              <p className={styles.heroLead}>Сайт, онлайн-запись, клиенты и расписание в одном понятном рабочем пространстве.</p>
              <div className={styles.heroActions}>
                <LandingPrimaryAction className={styles.primaryAction} anonymousLabel="Попробовать 14 дней" />
                <a className={styles.secondaryAction} href="#product">Посмотреть возможности <ArrowUpRight aria-hidden="true" /></a>
              </div>
            </div>

            <div className={styles.heroMedia}>
              <HeroPhotoLoop photos={portraits} />
            </div>
          </section>

          <section className={styles.product} id="product" aria-labelledby="product-title">
            <div className={styles.sectionHeading}>
              <p className={styles.eyebrow}>Возможности</p>
              <h2 id="product-title">Один ритм работы вместо набора разрозненных сервисов.</h2>
              <p>С первого визита на сайт до формулы окрашивания в карточке постоянного клиента.</p>
            </div>
            <div className={styles.featureGrid}>
              {productFeatures.map((feature) => (
                <article key={feature.title}>
                  <h3>{feature.title}</h3>
                  <p>{feature.text}</p>
                  <span aria-hidden="true">{feature.number}</span>
                </article>
              ))}
            </div>
          </section>

          <section className={styles.formats} id="examples" aria-labelledby="formats-title">
            <div className={styles.formatIntro}>
              <h2 id="formats-title">Разные салоны. Своя логика у каждого.</h2>
              <p>При регистрации владелец выбирает женский салон, барбершоп или унисекс. TrimmyCRM подстраивает каталог услуг, лексику и стартовые блоки сайта.</p>
              <span><MoveHorizontal aria-hidden="true" /> Галерею можно перетаскивать</span>
            </div>
            <InfiniteDragGallery photos={portraits} />
          </section>

          <section className={styles.tryOn} aria-labelledby="tryon-title">
            <div className={styles.tryOnImage}>
              <Image
                src="/images/editorial/woman-copper-bob.webp"
                alt="Пример визуального подбора медного боба"
                fill
                sizes="(max-width: 780px) 100vw, 46vw"
              />
            </div>
            <div className={styles.tryOnCopy}>
              <ShieldCheck aria-hidden="true" />
              <h2 id="tryon-title">Примерка причёски остаётся на устройстве клиента.</h2>
              <p>Фото обрабатывается локально в браузере. Без загрузки в облако, распознавания лица и стороннего AI API.</p>
              <a className={styles.secondaryAction} href="/try-on">Открыть примерку <ArrowUpRight aria-hidden="true" /></a>
            </div>
          </section>

          <section className={styles.pricing} id="plans" aria-labelledby="plans-title">
            <div className={styles.sectionHeading}>
              <p className={styles.eyebrow}>Тарифы</p>
              <h2 id="plans-title">Начните с малого. Масштабируйтесь в том же кабинете.</h2>
              <p>14 дней бесплатно. Карта для старта не нужна.</p>
            </div>
            <PlansSection />
          </section>

          <section className={styles.faq} id="faq" aria-labelledby="faq-title">
            <div className={styles.faqIntro}>
              <h2 id="faq-title">Прямые ответы на частые вопросы.</h2>
              <p>Если вашего вопроса нет в списке, напишите нам в форме ниже.</p>
            </div>
            <div className={styles.faqList}>
              {faqs.map((item, index) => (
                <details key={item.question} open={index === 0}>
                  <summary>{item.question}</summary>
                  <p>{item.answer}</p>
                </details>
              ))}
            </div>
          </section>

          <LandingContactSection />
        </main>

        <footer className={styles.footer}>
          <strong><span>Trimmy</span>CRM</strong>
          <p>Сайт, запись и управление салоном в одном продукте.</p>
          <nav aria-label="Документы">
            <a href="/privacy">Политика</a>
            <a href="/terms">Условия</a>
            <a href="/consent">Согласие</a>
          </nav>
          <div><LandingFooterAccountLink /><a href={`mailto:${legalConfig.email}`}>{legalConfig.email}</a></div>
          <small>© {new Date().getFullYear()} TrimmyCRM</small>
        </footer>

        <LandingChat />
      </div>
    </LandingSessionProvider>
  );
}
