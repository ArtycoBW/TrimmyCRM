import Image from "next/image";

import { BeforeAfterSlider } from "@/components/landing/before-after-slider";
import { LandingHeader } from "@/components/landing/landing-header";
import { LandingChat } from "@/components/landing/landing-chat";
import { LandingContactSection } from "@/components/landing/landing-contact-section";
import { LandingFooterAccountLink, LandingPrimaryAction, LandingSessionProvider } from "@/components/landing/landing-session";
import { PlansSection } from "@/components/landing/plans-section";
import { ProductMockup } from "@/components/landing/product-mockup";
import { legalConfig } from "@/components/legal/legal-config";
import { BrandMark } from "@/components/ui/brand-mark";
import { Icon, type IconName } from "@/components/ui/icons";
import {
  examples,
  faqs,
  outcomes,
  productFeatures,
  workflow,
} from "@/content/landing";

export function LandingPage() {
  return (
    <LandingSessionProvider><div className="landing-shell" id="top">
      <a className="skip-link" href="#main-content">К содержанию</a>
      <LandingHeader />

      <main id="main-content">
        <section className="hero section" aria-labelledby="hero-title">
          <div className="hero__paper-noise" aria-hidden="true" />

          <figure className="polaroid hero__photo hero__photo--left">
            <Image
              src="/images/landing/studio-cut.svg"
              alt="Абстрактный образ студии волос"
              width={780}
              height={980}
              priority
              sizes="(max-width: 720px) 34vw, 220px"
            />
            <figcaption>форма и характер</figcaption>
          </figure>

          <figure className="polaroid hero__photo hero__photo--right">
            <Image
              src="/images/landing/barber-grid.svg"
              alt="Абстрактный образ барбершопа"
              width={780}
              height={980}
              priority
              sizes="(max-width: 720px) 34vw, 220px"
            />
            <figcaption>точность в деталях</figcaption>
          </figure>

          <div className="hero__content page-container">
            <p className="eyebrow hero__eyebrow">
              <span className="eyebrow__dot" /> Сайт + запись + CRM для hair-салона
            </p>
            <h1 className="hero__title" id="hero-title">
              <span>Салон растёт.</span>
              <span>Расписание <em>сходится.</em></span>
            </h1>
            <p className="hero__lead">
              Соберите сайт, откройте онлайн-запись и ведите клиентов в одной понятной системе — без таблиц, потерянных сообщений и лишней рутины.
            </p>
            <div className="hero__actions">
              <LandingPrimaryAction className="button button--lime button--large" anonymousLabel="Попробовать 14 дней" />
              <a className="text-link" href="#product">
                Посмотреть, как работает <Icon name="arrow" />
              </a>
            </div>
            <p className="hero__fineprint">Без карты · запуск за вечер · данные хранятся в РФ</p>
          </div>

          <div className="hero__sticker hero__sticker--one" aria-hidden="true">для тех, кто любит порядок</div>
          <div className="hero__scribble" aria-hidden="true">
            <svg viewBox="0 0 130 50"><path d="M4 33c31-22 70-22 119-9M103 10l20 14-13 20" /></svg>
          </div>
        </section>

        <div className="ticker" aria-label="Ключевые возможности">
          <div className="ticker__track">
            {[0, 1].map((copy) => (
              <div className="ticker__set" aria-hidden={copy === 1} key={copy}>
                <span>САЙТ САЛОНА</span><i>✦</i>
                <span>ОНЛАЙН-ЗАПИСЬ</span><i>✦</i>
                <span>КЛИЕНТЫ И ИСТОРИЯ</span><i>✦</i>
                <span>РАСПИСАНИЕ КОМАНДЫ</span><i>✦</i>
              </div>
            ))}
          </div>
        </div>

        <section className="product section" id="product" aria-labelledby="product-title">
          <div className="page-container">
            <div className="section-heading section-heading--split">
              <div>
                <p className="eyebrow">Всё на своих местах</p>
                <h2 id="product-title">Один кабинет.<br /><span>Меньше суеты.</span></h2>
              </div>
              <p className="section-heading__lead">
                TrimmyCRM связывает витрину салона и ежедневную работу команды. Клиент видит свободное время, а вы — полную картину дня.
              </p>
            </div>

            <div className="feature-grid">
              {productFeatures.map((feature) => (
                <article className={`feature-card feature-card--${feature.tone}`} key={feature.title}>
                  <div className="feature-card__top">
                    <span className="feature-card__icon"><Icon name={feature.icon as IconName} /></span>
                    <span className="feature-card__number">{feature.number}</span>
                  </div>
                  <h3>{feature.title}</h3>
                  <p>{feature.text}</p>
                </article>
              ))}
            </div>

            <ProductMockup />
          </div>
        </section>

        <section className="workflow section" aria-labelledby="workflow-title">
          <div className="page-container workflow__layout">
            <div className="workflow__intro">
              <p className="eyebrow">От идеи до первой записи</p>
              <h2 id="workflow-title">Запуск в три<br />понятных шага<span>.</span></h2>
              <div className="workflow__photo polaroid">
                <Image
                  src="/images/landing/color-studio.svg"
                  alt="Абстрактный образ студии окрашивания"
                  width={900}
                  height={700}
                  sizes="(max-width: 800px) 80vw, 430px"
                />
                <figcaption>а дальше — только расти</figcaption>
              </div>
            </div>
            <ol className="workflow__steps">
              {workflow.map((item) => (
                <li key={item.step}>
                  <span className="workflow__number">{item.step}</span>
                  <div>
                    <h3>{item.title}</h3>
                    <p>{item.text}</p>
                  </div>
                </li>
              ))}
              <li className="workflow__result">
                <span aria-hidden="true">✓</span>
                <p><strong>Готово:</strong> сайт принимает записи, а CRM собирает их в календарь.</p>
              </li>
            </ol>
          </div>
        </section>

        <section className="transformation section" aria-labelledby="transformation-title">
          <div className="page-container transformation__layout">
            <div className="transformation__copy">
              <p className="eyebrow">Результат видно сразу</p>
              <h2 id="transformation-title">До —<br />идея.<br /><span>После — форма.</span></h2>
              <p>Покажите стрижки, окрашивания и работы с бородой так, чтобы результат говорил сам за себя ещё до первой записи.</p>
              <div className="transformation__tags" aria-label="Направления салона"><span>стрижки</span><span>цвет</span><span>борода</span></div>
            </div>
            <BeforeAfterSlider />
          </div>
        </section>

        <section className="examples section" id="examples" aria-labelledby="examples-title">
          <div className="page-container">
            <div className="section-heading section-heading--center">
              <p className="eyebrow">Шаблон один — характер разный</p>
              <h2 id="examples-title">Сайт, похожий<br />на <span>ваш салон.</span></h2>
              <p>Меняйте фотографии, цвет, тексты и набор блоков. Ни один «конструкторный» привкус не обязателен.</p>
            </div>
            <div className="examples-grid">
              {examples.map((example, index) => (
                <article
                  className="site-concept"
                  key={example.title}
                  style={{ "--card-rotate": example.rotate, "--card-accent": example.color } as React.CSSProperties}
                >
                  <div className="site-concept__browser">
                    <div className="site-concept__chrome">
                      <span className="window-dots"><i /><i /><i /></span>
                      <span>{example.title.toLowerCase().replaceAll(" ", "-")}.trimmycrm.ru</span>
                    </div>
                    <div className="site-concept__image">
                      <Image
                        src={example.image}
                        alt={`Концепт сайта hair-салона «${example.title}»`}
                        fill
                        sizes="(max-width: 780px) 88vw, 380px"
                      />
                      <span className="site-concept__pill">ЗАПИСАТЬСЯ →</span>
                    </div>
                    <div className="site-concept__caption">
                      <span>0{index + 1}</span>
                      <div><strong>{example.title}</strong><small>{example.city}</small></div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
            <p className="examples__note">Нужен полностью индивидуальный дизайн? Сделаем вручную и подключим к той же CRM.</p>
          </div>
        </section>

        <section className="outcomes section" aria-labelledby="outcomes-title">
          <div className="page-container">
            <div className="section-heading section-heading--split section-heading--outcomes">
              <div>
                <p className="eyebrow">Что меняется в работе</p>
                <h2 id="outcomes-title">Спокойнее вам.<br /><span>Удобнее клиенту.</span></h2>
              </div>
              <p className="section-heading__lead">Не обещаем магию. Убираем повторяющиеся действия и даём команде единый источник правды.</p>
            </div>
            <div className="outcomes-grid">
              {outcomes.map((item, index) => (
                <article className="outcome-card" key={item.label}>
                  <span className="outcome-card__marker">{item.marker}</span>
                  <blockquote>«{item.quote}»</blockquote>
                  <div className="outcome-card__footer">
                    <span className={`outcome-card__avatar outcome-card__avatar--${index + 1}`} aria-hidden="true">{index + 1}</span>
                    <strong>{item.label}</strong>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="pricing section" id="plans" aria-labelledby="plans-title">
          <div className="page-container">
            <div className="section-heading section-heading--center pricing__heading">
              <p className="eyebrow">Честные тарифы</p>
              <h2 id="plans-title">Начните с малого.<br /><span>Растите без переезда.</span></h2>
              <p>14 дней бесплатно на старте. Тариф можно сменить, данные никуда не исчезнут.</p>
            </div>
            <PlansSection />
            <div className="custom-landing-card">
              <div className="custom-landing-card__stamp" aria-hidden="true">made<br />for you</div>
              <div>
                <p className="eyebrow">Особенный случай</p>
                <h3>Индивидуальный лендинг</h3>
                <p>Уникальная визуальная концепция от нашей команды, подключённая к вашему контенту и онлайн-записи.</p>
              </div>
              <div className="custom-landing-card__price">
                <strong>20 000 ₽</strong>
                <span>единоразово</span>
              </div>
              <LandingPrimaryAction className="button button--outline" anonymousLabel="Обсудить проект" anonymousHref="/register?intent=custom-landing" />
            </div>
          </div>
        </section>

        <section className="faq section" id="faq" aria-labelledby="faq-title">
          <div className="page-container faq__layout">
            <div className="faq__intro">
              <p className="eyebrow">Без мелкого шрифта</p>
              <h2 id="faq-title">Частые<br /><span>вопросы.</span></h2>
              <p>Не нашли ответ? Напишите нам — разберём ваш сценарий без презентации на сорок слайдов.</p>
              <a className="text-link" href={`mailto:${legalConfig.email}`}>{legalConfig.email} <Icon name="arrow" /></a>
            </div>
            <div className="faq__items">
              {faqs.map((item, index) => (
                <details key={item.question} open={index === 0}>
                  <summary><span>{item.question}</span><i aria-hidden="true" /></summary>
                  <p>{item.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <LandingContactSection />

        <section className="final-cta section" aria-labelledby="final-cta-title">
          <div className="page-container final-cta__inner">
            <p className="eyebrow">Можно начинать</p>
            <h2 id="final-cta-title">Пусть салон<br />работает <span>легче.</span></h2>
            <p>Сайт, онлайн-запись и CRM уже знакомы друг с другом. Осталось познакомить их с вашим салоном.</p>
            <div className="final-cta__actions">
              <LandingPrimaryAction className="button button--ink button--large" anonymousLabel="Попробовать бесплатно" />
              <span>14 дней · без карты</span>
            </div>
            <div className="final-cta__doodle" aria-hidden="true">woof!</div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="page-container site-footer__top">
          <BrandMark inverse />
          <p>Цифровой порядок для салонов,<br />которые заботятся о деталях.</p>
          <div className="site-footer__links">
            <a href="#product">Возможности</a>
            <a href="#plans">Тарифы</a>
            <LandingFooterAccountLink />
            <a href={`mailto:${legalConfig.email}`}>Связаться</a>
          </div>
        </div>
        <div className="page-container site-footer__bottom">
          <span>© 2026 TrimmyCRM</span>
          <div><a href="/privacy">Политика обработки данных</a><a href="/terms">Условия сервиса</a></div>
          <span>Сделано с вниманием к деталям</span>
        </div>
      </footer>
      <LandingChat />
    </div></LandingSessionProvider>
  );
}
