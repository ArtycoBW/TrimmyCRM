import { ArrowUpRight } from "lucide-react";
import Image from "next/image";

import { EditorialFooter } from "@/components/landing/editorial-footer";
import { DualPhotoMarquee, type EditorialPhoto } from "@/components/landing/infinite-gallery";
import { InteractiveHead } from "@/components/landing/interactive-head";
import { LandingChat } from "@/components/landing/landing-chat";
import { LandingContactSection } from "@/components/landing/landing-contact-section";
import { LandingHeader } from "@/components/landing/landing-header";
import { LandingMotion } from "@/components/landing/landing-motion";
import {
  LandingPrimaryAction,
  LandingSessionProvider,
} from "@/components/landing/landing-session";
import { PlansSection } from "@/components/landing/plans-section";
import { SiteBuilderSortable } from "@/components/landing/site-builder-sortable";
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
        <LandingMotion />

        <main id="main-content">
          <section className={styles.hero} aria-labelledby="hero-title">
            <div className={styles.heroCopy} data-reveal>
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

            <div className={styles.heroMedia} data-reveal data-reveal-delay="1">
              <InteractiveHead />
            </div>
          </section>

          <section className={styles.product} id="product" aria-labelledby="product-title">
            <div className={styles.sectionHeading} data-reveal>
              <h2 id="product-title">Один ритм работы вместо набора разрозненных сервисов.</h2>
              <p>С первого визита на сайт до формулы окрашивания в карточке постоянного клиента.</p>
            </div>
            <div className={styles.featureGrid} data-parallax>
              {productFeatures.map((feature) => (
                <article key={feature.title} data-reveal data-reveal-delay={feature.number}>
                  <h3>{feature.title}</h3>
                  <p>{feature.text}</p>
                  <span aria-hidden="true">{feature.number}</span>
                </article>
              ))}
            </div>
          </section>

          <section className={styles.formats} id="examples" aria-labelledby="formats-title">
            <div className={styles.formatIntro} data-reveal>
              <h2 id="formats-title">Разные салоны. Своя логика у каждого.</h2>
              <p>Женский салон, барбершоп или смешанная команда получают сайт, который говорит с клиентом на своём языке.</p>
            </div>
            <div data-reveal data-reveal-delay="1" data-parallax><DualPhotoMarquee photos={portraits} /></div>
          </section>

          <section className={styles.builder} aria-labelledby="builder-title">
            <div className={styles.builderIntro} data-reveal>
              <h2 id="builder-title">Сайт выглядит как ваш салон.</h2>
              <p>Портфолио, мастера, услуги и свободные окна складываются в одну цельную страницу.</p>
            </div>
            <div data-reveal data-reveal-delay="1" data-parallax><SiteBuilderSortable /></div>
          </section>

          <section className={styles.tryOn} aria-labelledby="tryon-title">
            <div className={styles.tryOnVisual} data-reveal data-parallax>
              <figure className={styles.tryOnMainPhoto}>
                <Image src="/images/editorial/woman-copper-bob.webp" alt="Женщина с современной медной стрижкой боб" fill sizes="(max-width: 780px) 100vw, 46vw" />
              </figure>
              <figure className={styles.tryOnDetailPhoto} aria-hidden="true">
                <Image src="/images/editorial/man-textured-crop.webp" alt="" fill sizes="(max-width: 780px) 38vw, 18vw" />
              </figure>
            </div>
            <div className={styles.tryOnCopy} data-reveal data-reveal-delay="1">
              <h2 id="tryon-title">Примерьте образ до визита.</h2>
              <p>Клиент загружает фото, выбирает причёску и видит новый образ ещё до записи к мастеру.</p>
              <a className={styles.secondaryAction} href="/try-on">Примерить причёску <ArrowUpRight aria-hidden="true" /></a>
            </div>
          </section>

          <section className={styles.pricing} id="plans" aria-labelledby="plans-title">
            <div className={styles.sectionHeading} data-reveal>
              <h2 id="plans-title">Начните с малого. Масштабируйтесь в том же кабинете.</h2>
              <p>14 дней бесплатно. Карта для старта не нужна.</p>
            </div>
            <div data-reveal data-reveal-delay="1" data-parallax><PlansSection /></div>
          </section>

          <section className={styles.faq} id="faq" aria-labelledby="faq-title">
            <div className={styles.faqIntro} data-reveal>
              <h2 id="faq-title">Прямые ответы на частые вопросы.</h2>
              <p>Если вашего вопроса нет в списке, напишите нам в форме ниже.</p>
            </div>
            <div className={styles.faqList} data-reveal data-reveal-delay="1" data-parallax>
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

        <EditorialFooter />

        <LandingChat />
      </div>
    </LandingSessionProvider>
  );
}
