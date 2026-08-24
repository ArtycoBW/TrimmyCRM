import { ArrowUpRight, BellRing, CalendarCheck, PanelsTopLeft, UsersRound } from "lucide-react";
import Image from "next/image";

import { EditorialFooter } from "@/components/landing/editorial-footer";
import { PhotoMarquee, type EditorialPhoto } from "@/components/landing/infinite-gallery";
import { LandingChat } from "@/components/landing/landing-chat";
import { LandingContactSection } from "@/components/landing/landing-contact-section";
import { LandingFaq } from "@/components/landing/landing-faq";
import { LandingHeader } from "@/components/landing/landing-header";
import { LandingMotion } from "@/components/landing/landing-motion";
import { LandingSessionProvider } from "@/components/landing/landing-session";
import { PlansSection } from "@/components/landing/plans-section";
import { SalonJourneyScroller } from "@/components/landing/salon-journey-scroller";
import { SalonWorldStory } from "@/components/landing/salon-world-story";
import { SiteBuilderSortable } from "@/components/landing/site-builder-sortable";
import { faqs, productFeatures } from "@/content/landing";

import editorial from "./editorial-landing.module.css";
import styles from "./kinetic-landing.module.css";

const portraits: readonly EditorialPhoto[] = [
  { src: "/images/editorial/v2/copper-bob.webp", alt: "Клиентка с аккуратным медным бобом", label: "Медный боб" },
  { src: "/images/editorial/v2/taper-fade.webp", alt: "Клиент барбершопа с низким фейдом", label: "Низкий фейд" },
  { src: "/images/editorial/v2/icy-bob.webp", alt: "Клиентка с графичным холодным бобом и светлой акцентной прядью", label: "Холодный боб" },
  { src: "/images/editorial/v2/layered-cut.webp", alt: "Клиентка с многослойной стрижкой", label: "Мягкие слои" },
  { src: "/images/editorial/v2/wavy-cut.webp", alt: "Клиент с современной стрижкой на волнистых волосах", label: "Волнистая текстура" },
  { src: "/images/editorial/v2/salon-consultation.webp", alt: "Мастер обсуждает форму стрижки с клиенткой", label: "Консультация" },
];

const featureIcons = [PanelsTopLeft, CalendarCheck, UsersRound, BellRing] as const;

export function LandingPage() {
  return (
    <LandingSessionProvider>
      <div className={`${editorial.root} ${styles.root} editorial-landing landing-shell`} id="top">
        <a className="skip-link" href="#main-content">К содержанию</a>
        <LandingHeader />
        <LandingMotion />

        <main id="main-content">
          <SalonWorldStory />

          <section className={styles.system} id="product" aria-labelledby="system-title">
            <div className={styles.systemHead} data-reveal>
              <h2 id="system-title">Салон без пяти разных сервисов.</h2>
              <p>Расписание, клиенты, напоминания и сайт работают вместе. Команде не приходится переносить данные вручную.</p>
            </div>

            <div className={styles.systemFlow} id="system">
              {productFeatures.map((feature, index) => {
                const FeatureIcon = featureIcons[index];
                return (
                <article key={feature.title} data-reveal data-reveal-delay={(index % 3) + 1}>
                  <span className={styles.featureIcon} aria-hidden="true"><FeatureIcon /></span>
                  <h3>{feature.title}</h3>
                  <p>{feature.text}</p>
                </article>
                );
              })}
            </div>
          </section>

          <section className={styles.builder} id="builder" aria-labelledby="builder-title">
            <div className={styles.builderCopy} data-reveal>
              <p className={styles.sectionKicker}><span /> Сайт внутри CRM</p>
              <h2 id="builder-title">Витрина, которая умеет записывать.</h2>
              <p>Соберите публичную страницу из рабочих блоков. Услуги, мастера, портфолио и свободное время уже связаны с салоном.</p>
              <a href="#plans">Попробовать бесплатно <ArrowUpRight aria-hidden="true" /></a>
            </div>
            <div className={styles.builderCanvas} data-reveal data-reveal-delay="1" data-parallax>
              <SiteBuilderSortable />
            </div>
          </section>

          <SalonJourneyScroller />

          <section className={styles.tryOn} aria-labelledby="tryon-title">
            <figure className={styles.tryOnPhoto} data-reveal data-parallax>
              <Image
                src="/images/editorial/v2/layered-cut.webp"
                  alt="Клиентка с многослойной стрижкой"
                  fill
                  quality={94}
                  sizes="(max-width: 780px) 100vw, 46vw"
              />
            </figure>
            <div className={styles.tryOnCopy} data-reveal data-reveal-delay="1">
              <h2 id="tryon-title">Примерка без загрузки фото.</h2>
              <p>Клиент выбирает причёску прямо в браузере. Фотография не отправляется в CRM и не хранится на сервере.</p>
              <a href="/try-on">Открыть примерку <ArrowUpRight aria-hidden="true" /></a>
            </div>
          </section>

          <section className={styles.formats} id="examples" aria-labelledby="formats-title">
            <div className={styles.formatsHead} data-reveal>
              <h2 id="formats-title">Для разных салонов и разных клиентов.</h2>
              <p>Настройте услуги и сайт под барбершоп, женский салон или универсальную студию.</p>
            </div>
            <div data-reveal data-reveal-delay="1"><PhotoMarquee photos={portraits} /></div>
          </section>

          <section className={styles.pricing} id="plans" aria-labelledby="plans-title">
            <div className={styles.pricingHead} data-reveal>
              <h2 id="plans-title">Выберите тариф под свою команду.</h2>
              <p>Первые 14 дней бесплатны. Карта для старта не нужна.</p>
            </div>
            <div data-reveal data-reveal-delay="1"><PlansSection /></div>
          </section>

          <section className={styles.faq} id="faq" aria-labelledby="faq-title">
            <div className={styles.faqHead} data-reveal>
              <h2 id="faq-title">Ответы перед началом.</h2>
              <p>Перенос базы, запуск сайта, тарифы и защита данных.</p>
            </div>
            <LandingFaq items={faqs} />
          </section>

          <LandingContactSection />
        </main>

        <EditorialFooter />
        <LandingChat />
      </div>
    </LandingSessionProvider>
  );
}
