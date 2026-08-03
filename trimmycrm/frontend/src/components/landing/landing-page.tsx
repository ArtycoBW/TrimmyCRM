import Image from "next/image";

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

const portraits = [
  {
    src: "/images/editorial/woman-copper-bob.webp",
    alt: "Женская стрижка — медный графичный боб",
    caption: "BOB / COPPER",
  },
  {
    src: "/images/editorial/man-textured-crop.webp",
    alt: "Мужская стрижка — текстурный кроп",
    caption: "CROP / TEXTURE",
  },
  {
    src: "/images/editorial/woman-graphic-pixie.webp",
    alt: "Женская стрижка — графичная пикси",
    caption: "PIXIE / EDGE",
  },
  {
    src: "/images/editorial/man-layered-curls.webp",
    alt: "Мужская стрижка — слоистые кудри",
    caption: "CURL / LAYER",
  },
] as const;

export function LandingPage() {
  return (
    <LandingSessionProvider>
      <div className={`${styles.root} editorial-landing landing-shell`} id="top">
        <a className="skip-link" href="#main-content">К содержанию</a>
        <LandingHeader />

        <main id="main-content">
          <section className={`${styles.hero} hero`} aria-labelledby="hero-title">
            <div className={`${styles.heroWordmark} hero__title`} aria-hidden="true">
              <span>TRIMMY</span>
              <span>CRM</span>
            </div>

            <figure className={`${styles.portrait} ${styles.portraitOne}`}>
              <Image src={portraits[0].src} alt={portraits[0].alt} fill priority sizes="(max-width: 700px) 54vw, 30vw" />
              <figcaption>{portraits[0].caption}</figcaption>
            </figure>
            <figure className={`${styles.portrait} ${styles.portraitTwo}`}>
              <Image src={portraits[1].src} alt={portraits[1].alt} fill priority sizes="(max-width: 700px) 42vw, 22vw" />
              <figcaption>{portraits[1].caption}</figcaption>
            </figure>

            <div className={`${styles.heroCopy} hero__content`}>
              <p className={styles.index}>01 — CRM ДЛЯ HAIR-ИНДУСТРИИ</p>
              <h1 id="hero-title">Салон растёт.<br />Рутина — нет.</h1>
              <p>Сайт, онлайн-запись и полный рабочий день команды в одном дерзко простом кабинете.</p>
              <div className={`${styles.heroActions} hero__actions`}>
                <LandingPrimaryAction className={styles.outlineAction} anonymousLabel="Попробовать 14 дней" />
                <a className={styles.textAction} href="#product">Смотреть систему ↓</a>
              </div>
            </div>
          </section>

          <section className={styles.statement} id="product" aria-labelledby="product-title">
            <p className={styles.index}>02 — СИСТЕМА</p>
            <h2 id="product-title">САЙТ.<br />ЗАПИСЬ.<br />CRM.</h2>
            <p className={styles.statementLead}>Не три сервиса. Один ритм работы — от первого визита на сайт до истории формулы в карточке клиента.</p>
            <div className={styles.featureList}>
              {productFeatures.map((feature) => (
                <article key={feature.number}>
                  <span>{feature.number}</span>
                  <h3>{feature.title}</h3>
                  <p>{feature.text}</p>
                </article>
              ))}
            </div>
          </section>

          <section className={styles.people} id="examples" aria-labelledby="people-title">
            <div className={styles.peopleType} aria-hidden="true">HAIR<br />IS<br />IDENTITY</div>
            <p className={styles.index}>03 — ЖЕНСКИЙ САЛОН / БАРБЕРШОП / УНИСЕКС</p>
            <h2 id="people-title">Разная эстетика.<br />Одна точная система.</h2>

            <figure className={`${styles.portrait} ${styles.portraitThree}`}>
              <Image src={portraits[2].src} alt={portraits[2].alt} fill loading="eager" sizes="(max-width: 700px) 58vw, 31vw" />
              <figcaption>{portraits[2].caption}</figcaption>
            </figure>
            <figure className={`${styles.portrait} ${styles.portraitFour}`}>
              <Image src={portraits[3].src} alt={portraits[3].alt} fill loading="eager" sizes="(max-width: 700px) 52vw, 28vw" />
              <figcaption>{portraits[3].caption}</figcaption>
            </figure>

            <p className={styles.peopleNote}>При регистрации вы выбираете формат салона. TrimmyCRM меняет стартовый каталог, лексику и блоки сайта — не ограничивая вас шаблоном.</p>
          </section>

          <section className={styles.workspace} aria-labelledby="workspace-title">
            <header>
              <p className={styles.index}>04 — РАБОЧИЙ ДЕНЬ</p>
              <h2 id="workspace-title">ВСЁ ВИДНО.<br />НИЧЕГО ЛИШНЕГО.</h2>
            </header>
            <div className={styles.workspaceBoard} aria-label="Возможности рабочего кабинета">
              <div className={styles.boardDate}><span>ПН</span><strong>03</strong><small>АВГУСТА</small></div>
              <div className={styles.boardSchedule}>
                <span>10:00</span><strong>Стрижка + укладка</strong><small>АННА / МАРИЯ / 90 МИН</small>
                <span>12:00</span><strong>Кроп + борода</strong><small>МАКСИМ / ИЛЬЯ / 75 МИН</small>
                <span>14:30</span><strong>Окрашивание</strong><small>ВЕРА / СОФИЯ / 180 МИН</small>
              </div>
              <div className={styles.boardFacts}>
                <p><strong>24/7</strong><span>онлайн-запись</span></p>
                <p><strong>1</strong><span>карточка клиента</span></p>
                <p><strong>0</strong><span>потерянных формул</span></p>
              </div>
            </div>
          </section>

          <section className={styles.tryOnPromo} aria-labelledby="tryon-promo-title">
            <div>
              <p className={styles.index}>05 — ЛОКАЛЬНО В БРАУЗЕРЕ</p>
              <h2 id="tryon-promo-title">ПРИМЕРЬ.<br />НЕ ЗАГРУЖАЯ.</h2>
              <p>Клиент выбирает фото и вручную совмещает причёску. Изображение остаётся на его устройстве — без AI API, облака и распознавания лица.</p>
              <a className={styles.outlineAction} href="/try-on">Открыть примерку →</a>
            </div>
            <div className={styles.tryOnCrop} aria-hidden="true">
              <Image src={portraits[0].src} alt="" fill loading="eager" sizes="(max-width: 700px) 100vw, 42vw" />
              <span>YOUR PHOTO<br />STAYS HERE</span>
            </div>
          </section>

          <section className={styles.pricing} id="plans" aria-labelledby="plans-title">
            <div className={styles.sectionIntro}>
              <p className={styles.index}>06 — ТАРИФЫ</p>
              <h2 id="plans-title">Начните с малого.<br />Растите без переезда.</h2>
              <p>14 дней бесплатно. Без карты на старте.</p>
            </div>
            <PlansSection />
          </section>

          <section className={styles.faq} id="faq" aria-labelledby="faq-title">
            <div className={styles.sectionIntro}>
              <p className={styles.index}>07 — БЕЗ МЕЛКОГО ШРИФТА</p>
              <h2 id="faq-title">ВОПРОСЫ.<br />ПРЯМЫЕ ОТВЕТЫ.</h2>
            </div>
            <div className={styles.faqList}>
              {faqs.map((item, index) => (
                <details key={item.question} open={index === 0}>
                  <summary><span>0{index + 1}</span>{item.question}</summary>
                  <p>{item.answer}</p>
                </details>
              ))}
            </div>
          </section>

          <LandingContactSection />
        </main>

        <footer className={styles.footer}>
          <strong>TRIMMYCRM</strong>
          <div><a href="/privacy">Политика</a><a href="/terms">Условия</a><a href="/consent">Согласие</a></div>
          <div><LandingFooterAccountLink /><a href={`mailto:${legalConfig.email}`}>{legalConfig.email}</a></div>
          <small>© {new Date().getFullYear()} / СДЕЛАНО ДЛЯ HAIR-ИНДУСТРИИ</small>
        </footer>

        <LandingChat />
      </div>
    </LandingSessionProvider>
  );
}
