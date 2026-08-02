"use client";

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";

import { salonTypeLabel } from "@/lib/app/salon-profile";
import { tenantSiteUrl } from "@/lib/app/site-url";
import { apiRequest } from "@/lib/api/client";
import type {
  PublicServiceView,
  PublicSiteSnapshot,
  PublicStaffView,
  PublicReviewView,
  SiteBlockView,
} from "@/lib/api/types";

type SalonSiteCanvasProps = {
  snapshot: PublicSiteSnapshot;
  services?: PublicServiceView[];
  staff?: PublicStaffView[];
  reviews?: PublicReviewView[];
  embedded?: boolean;
  editor?: boolean;
  includeDisabled?: boolean;
  renderBlock?: (block: SiteBlockView, content: ReactNode) => ReactNode;
};

type GalleryItem = { id: string; src: string; caption: string };
type FaqItem = { question: string; answer: string };
type BlogItem = { title: string; text: string };

const sectionLabels: Record<string, string> = {
  about: "О салоне",
  services: "Услуги",
  gallery: "Работы",
  staff: "Команда",
  reviews: "Отзывы",
  promotions: "Акции",
  loyalty: "Лояльность",
  hours: "Часы работы",
  contacts: "Контакты",
  faq: "Вопросы",
  blog: "Новости",
  socials: "Соцсети",
  booking: "Запись",
  cta: "Запись",
};

const dayLabels: Record<string, string> = {
  monday: "Пн",
  tuesday: "Вт",
  wednesday: "Ср",
  thursday: "Чт",
  friday: "Пт",
  saturday: "Сб",
  sunday: "Вс",
};

function configText(block: SiteBlockView, key: string, fallback: string) {
  const value = block.config[key];
  if (typeof value !== "string" || !value.trim() || value.trim().toLowerCase() === block.type) {
    return fallback;
  }
  return value.trim();
}

function money(value: string | number) {
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Number(value))} ₽`;
}

function bookingHref(): "/client?booking=1" {
  return "/client?booking=1";
}

function blockGallery(block: SiteBlockView, key = "items"): GalleryItem[] {
  const source = block.config[key];
  if (!Array.isArray(source)) return [];
  return source.filter((item): item is GalleryItem => {
    if (!item || typeof item !== "object") return false;
    const value = item as Record<string, unknown>;
    return typeof value.id === "string" && typeof value.src === "string" && typeof value.caption === "string";
  });
}

const blockFonts: Record<string, string> = {
  display: "var(--display)",
  clean: "var(--body)",
  hand: "var(--hand)",
};

function blockAppearance(block: SiteBlockView) {
  const classes: string[] = [];
  const style: CSSProperties & Record<`--block-${string}`, string> = {};
  const background = block.config.backgroundColor;
  const text = block.config.textColor;
  const accent = block.config.accentColor;
  const font = block.config.fontFamily;
  const titleSize = block.config.titleSize;
  const textSize = block.config.textSize;

  if (typeof background === "string") {
    classes.push("has-block-background");
    style["--block-background"] = background;
  }
  if (typeof text === "string") {
    classes.push("has-block-text-color");
    style["--block-text"] = text;
  }
  if (typeof accent === "string") {
    classes.push("has-block-accent");
    style["--block-accent"] = accent;
  }
  if (typeof font === "string" && blockFonts[font]) {
    classes.push("has-block-font");
    style["--block-font"] = blockFonts[font];
  }
  if (typeof titleSize === "number") {
    classes.push("has-block-title-size");
    style["--block-title-size"] = `${titleSize}px`;
    style["--block-title-preview-size"] = `${Math.max(20, Math.round(titleSize * 0.38))}px`;
  }
  if (typeof textSize === "number") {
    classes.push("has-block-text-size");
    style["--block-text-size"] = `${textSize}px`;
    style["--block-text-preview-size"] = `${Math.max(9, Math.round(textSize * 0.58))}px`;
  }
  return { className: classes.join(" "), style };
}

function blockItems<T extends object>(block: SiteBlockView, keys: Array<keyof T>): T[] {
  if (!Array.isArray(block.config.items)) return [];
  return block.config.items.filter((item): item is T => {
    if (!item || typeof item !== "object") return false;
    const value = item as Record<string, unknown>;
    return keys.every((key) => typeof value[String(key)] === "string");
  });
}

function sectionId(type: string) {
  if (type === "booking") return "booking";
  return `section-${type}`;
}

function SectionLead({ block, fallback }: { block: SiteBlockView; fallback: string }) {
  return <p className="salon-section__lead">{configText(block, "subtitle", fallback)}</p>;
}

function displayTitle(text: string) {
  const words = text.trim().split(/\s+/);
  if (words.length < 2) return text;
  return <>{words.slice(0, -1).join(" ")} <span>{words.at(-1)}</span></>;
}

export function mediaUrl(url: string, snapshot: PublicSiteSnapshot, embedded: boolean) {
  if (!embedded || !url.startsWith("/")) return url;
  if (typeof window === "undefined") {
    const origin = snapshot.customDomain ? `https://${snapshot.customDomain}` : tenantSiteUrl(snapshot.slug);
    return new URL(url, origin).toString();
  }
  const { protocol, hostname, port } = window.location;
  const root = hostname === "localhost" || hostname === "127.0.0.1"
    ? "trimmycrm.localhost"
    : hostname.replace(/^(?:www|admin)\./, "");
  const host = snapshot.customDomain || `${snapshot.slug}.${root}`;
  return `${protocol}//${host}${port ? `:${port}` : ""}${url}`;
}

function SiteBlock({
  block,
  snapshot,
  services,
  staff,
  reviews,
  embedded,
}: {
  block: SiteBlockView;
  snapshot: PublicSiteSnapshot;
  services: PublicServiceView[];
  staff: PublicStaffView[];
  reviews: PublicReviewView[];
  embedded: boolean;
}) {
  if (block.type === "hero") {
    const legacyImage = typeof block.config.image === "string" ? block.config.image : null;
    const images = blockGallery(block, "images");
    const heroImages = images.length ? images : legacyImage ? [{ id: "legacy", src: legacyImage, caption: "" }] : [];
    return (
      <section className={`salon-hero${heroImages.length ? " salon-hero--with-image" : ""}`} data-block="hero">
        <div className="salon-hero__copy">
          <p className="salon-site__eyebrow">{salonTypeLabel(snapshot.salonType)} · {snapshot.city || "рядом с вами"}</p>
          <h1>{displayTitle(configText(block, "title", snapshot.name))}</h1>
          <p>{configText(block, "subtitle", snapshot.description || "Стрижки, цвет и детали образа — с вниманием к вашему стилю.")}</p>
          <Link className="salon-site__button" href={bookingHref()}>{configText(block, "cta", "Записаться онлайн")} →</Link>
        </div>
        {heroImages.length > 0 && <div className={`salon-hero__image salon-hero__images salon-hero__images--${heroImages.length}`}>
          {heroImages.map((image, index) => <figure key={image.id || image.src}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={mediaUrl(image.src, snapshot, embedded)} alt={image.caption || `Работа мастера салона, фото ${index + 1}`} />
            {image.caption && <figcaption>{image.caption}</figcaption>}
          </figure>)}
        </div>}
      </section>
    );
  }

  if (block.type === "about") {
    const image = typeof block.config.image === "string" ? block.config.image : null;
    return (
      <section className={`salon-section salon-about${image ? " salon-about--with-image" : ""}`} id={sectionId("about")} data-block="about">
        <p className="salon-site__eyebrow">О нас</p>
        <h2>{displayTitle(configText(block, "title", `Добро пожаловать в ${snapshot.name}`))}</h2>
        <p>{configText(block, "text", snapshot.description || "Добавьте описание салона в настройках — оно появится здесь после сохранения.")}</p>
        {image && <div className="salon-about__image">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={mediaUrl(image, snapshot, embedded)} alt="Интерьер и команда салона" />
        </div>}
      </section>
    );
  }

  if (block.type === "services") {
    return (
      <section className="salon-section" id={sectionId("services")} data-block="services">
        <p className="salon-site__eyebrow">Прайс</p>
        <h2>{displayTitle(configText(block, "title", "Услуги и цены"))}</h2>
        <SectionLead block={block} fallback="Выберите подходящий уход — стоимость и длительность всегда видны заранее." />
        <div className="salon-service-grid">
          {(services.length ? services : [
            { id: "demo-1", name: snapshot.salonType === "barbershop" ? "Стрижка + борода" : "Стрижка и укладка", description: "Услуги салона появятся здесь автоматически", price: 2000, durationMin: 60, bufferBeforeMin: 0, bufferAfterMin: 0 },
            { id: "demo-2", name: snapshot.salonType === "barbershop" ? "Фейд" : "Окрашивание", description: "Цена и длительность берутся из CRM", price: 1500, durationMin: 45, bufferBeforeMin: 0, bufferAfterMin: 0 },
          ]).slice(0, 6).map((service) => (
            <article key={service.id}>
              <span>{service.durationMin} мин</span>
              <h3>{service.name}</h3>
              <p>{service.description || "Работа мастера с учётом ваших пожеланий"}</p>
              <strong>{money(service.price)}</strong>
            </article>
          ))}
        </div>
      </section>
    );
  }

  if (block.type === "staff") {
    return (
      <section className="salon-section" id={sectionId("staff")} data-block="staff">
        <p className="salon-site__eyebrow">Команда</p>
        <h2>{displayTitle(configText(block, "title", "Наши мастера"))}</h2>
        <SectionLead block={block} fallback="Команда, с которой легко обсудить форму, цвет и домашний уход." />
        <div className="salon-staff-grid">
          {(staff.length ? staff : [{ id: "demo", name: "Ваш мастер", specialization: "Специализация из CRM", photoUrl: null, serviceIds: [] }]).slice(0, 6).map((member) => (
            <article key={member.id}>
              <div className="salon-staff__photo" style={member.photoUrl ? { backgroundImage: `url("${mediaUrl(member.photoUrl, snapshot, embedded)}")` } : undefined}>
                {!member.photoUrl && <span>{member.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2)}</span>}
              </div>
              <h3>{member.name}</h3>
              <p>{member.specialization || "Мастер салона"}</p>
            </article>
          ))}
        </div>
      </section>
    );
  }

  if (block.type === "gallery") {
    const items = blockGallery(block);
    const columns = typeof block.config.columns === "number" ? Math.max(2, Math.min(4, block.config.columns)) : 3;
    return (
      <section className="salon-section salon-gallery" id={sectionId("gallery")} data-block="gallery">
        <p className="salon-site__eyebrow">Портфолио</p>
        <h2>{displayTitle(configText(block, "title", "Наши работы"))}</h2>
        <SectionLead block={block} fallback="Посмотрите стрижки, укладки, окрашивания и детали образов." />
        {items.length ? <div className="salon-gallery__grid" style={{ "--gallery-columns": columns } as React.CSSProperties}>
          {items.map((item) => <figure key={item.id}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={mediaUrl(item.src, snapshot, embedded)} alt={item.caption || "Работа мастера салона"} />
            {item.caption && <figcaption>{item.caption}</figcaption>}
          </figure>)}
        </div> : <p className="salon-section__empty">Фотографии работ скоро появятся.</p>}
      </section>
    );
  }

  if (block.type === "reviews") {
    const limit = typeof block.config.limit === "number" ? Math.max(1, Math.min(30, block.config.limit)) : 6;
    return (
      <section className="salon-section salon-reviews" id={sectionId("reviews")} data-block="reviews">
        <p className="salon-site__eyebrow">Говорят клиенты</p>
        <h2>{displayTitle(configText(block, "title", "Отзывы клиентов"))}</h2>
        <SectionLead block={block} fallback="Впечатления клиентов после визита в салон." />
        {reviews.length ? <div className="salon-reviews__grid">
          {reviews.slice(0, limit).map((review) => <article key={review.id}>
            <span aria-label={`${review.rating} из 5`}>{"★".repeat(review.rating)}{"☆".repeat(Math.max(0, 5 - review.rating))}</span>
            <blockquote>«{review.text || "Спасибо мастеру за внимательную работу и отличный результат."}»</blockquote>
            <strong>{review.authorName || "Клиент салона"}</strong>
          </article>)}
        </div> : <p className="salon-section__empty">Здесь появятся отзывы клиентов после завершённых визитов и публикации владельцем салона.</p>}
      </section>
    );
  }

  if (block.type === "booking" || block.type === "cta") {
    return (
      <section className="salon-booking" id={sectionId(block.type)} data-block={block.type}>
        <p className="salon-site__eyebrow">Свободное время онлайн</p>
        <h2>{displayTitle(configText(block, "title", "Запишитесь без звонка"))}</h2>
        <p>{configText(block, block.type === "cta" ? "text" : "subtitle", "Выберите услугу, мастера и удобное время в личном кабинете.")}</p>
        <Link className="salon-site__button salon-site__button--light" href={bookingHref()}>{configText(block, "cta", "Выбрать время")} →</Link>
      </section>
    );
  }

  if (block.type === "hours") {
    const hours = Object.entries(snapshot.workHours || {});
    const displayHours: Array<[string, Array<{ start: string; end: string }>]> = hours.length
      ? hours
      : [["monday", [{ start: "09:00", end: "18:00" }]]];
    return (
      <section className="salon-section" id={sectionId("hours")} data-block="hours">
        <p className="salon-site__eyebrow">Когда мы работаем</p>
        <h2>{displayTitle(configText(block, "title", "Часы работы"))}</h2>
        <SectionLead block={block} fallback="Выберите удобный день для визита." />
        <div className="salon-hours">
          {displayHours.map(([day, intervals]) => (
            <div key={day}><strong>{dayLabels[day] || day}</strong><span>{intervals.length ? intervals.map((item) => `${item.start}–${item.end}`).join(", ") : "Выходной"}</span></div>
          ))}
        </div>
      </section>
    );
  }

  if (block.type === "contacts") {
    return (
      <section className="salon-section salon-contacts" id={sectionId(block.type)} data-block={block.type}>
        <p className="salon-site__eyebrow">Контакты</p>
        <h2>{displayTitle(configText(block, "title", "Найдите нас"))}</h2>
        <SectionLead block={block} fallback="Позвоните нам или постройте маршрут до салона." />
        <div>
          <p><span>Адрес</span><strong>{[snapshot.city, snapshot.street].filter(Boolean).join(", ") || "Укажите адрес в настройках"}</strong></p>
          <p><span>Телефон</span><strong>{snapshot.phone || "Укажите телефон в настройках"}</strong></p>
        </div>
      </section>
    );
  }

  if (block.type === "socials") {
    const links = Object.entries(snapshot.socials || {}).filter((entry): entry is [string, string] => typeof entry[1] === "string" && Boolean(entry[1]));
    return (
      <section className="salon-section salon-socials" id={sectionId("socials")} data-block="socials">
        <p className="salon-site__eyebrow">Остаёмся на связи</p>
        <h2>{displayTitle(configText(block, "title", "Мы в соцсетях"))}</h2>
        <SectionLead block={block} fallback="Больше работ и новостей в наших соцсетях." />
        <div>{links.length ? links.map(([name, href]) => <a href={href} target="_blank" rel="noreferrer" key={name}>{name} <span>↗</span></a>) : <p className="salon-section__empty">Ссылки появятся после заполнения профиля салона.</p>}</div>
      </section>
    );
  }

  if (block.type === "faq") {
    const items = blockItems<FaqItem>(block, ["question", "answer"]);
    return (
      <section className="salon-section salon-faq" id={sectionId("faq")} data-block="faq">
        <p className="salon-site__eyebrow">Без мелкого шрифта</p>
        <h2>{displayTitle(configText(block, "title", "Частые вопросы"))}</h2>
        <SectionLead block={block} fallback="Коротко ответили на то, что обычно спрашивают перед первой записью." />
        <div>{items.length ? items.map((item, index) => <details key={`${item.question}-${index}`} open={index === 0}><summary>{item.question}<span>+</span></summary><p>{item.answer}</p></details>) : <p className="salon-section__empty">Добавьте вопросы и ответы в конструкторе.</p>}</div>
      </section>
    );
  }

  if (block.type === "blog") {
    const items = blockItems<BlogItem>(block, ["title", "text"]);
    return (
      <section className="salon-section salon-blog" id={sectionId("blog")} data-block="blog">
        <p className="salon-site__eyebrow">Полезное от команды</p>
        <h2>{displayTitle(configText(block, "title", "Новости"))}</h2>
        <SectionLead block={block} fallback="Полезные заметки и новости салона." />
        <div>{items.length ? items.map((item, index) => <article key={`${item.title}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span><h3>{item.title}</h3><p>{item.text}</p></article>) : <p className="salon-section__empty">Добавьте первую новость в конструкторе.</p>}</div>
      </section>
    );
  }

  if (block.type === "loyalty" || block.type === "promotions") {
    return (
      <section className="salon-section salon-callout" id={sectionId(block.type)} data-block={block.type}>
        <p className="salon-site__eyebrow">{block.type === "loyalty" ? "Для постоянных клиентов" : "Выгодный визит"}</p>
        <h2>{displayTitle(configText(block, "title", block.type === "loyalty" ? "Программа лояльности" : "Акции"))}</h2>
        <p>{configText(block, block.type === "loyalty" ? "text" : "subtitle", block.type === "loyalty" ? "Возвращайтесь снова и получайте персональные предложения салона." : "Специальные предложения салона.")}</p>
        {block.type === "loyalty" && <Link className="salon-site__button salon-site__button--light" href={bookingHref()}>{configText(block, "cta", "Узнать подробнее")} →</Link>}
      </section>
    );
  }

  const fallback = configText(block, "title", block.type === "gallery" ? "Наши работы" : block.type === "reviews" ? "Отзывы клиентов" : block.type === "promotions" ? "Акции" : "Раздел сайта");
  return (
    <section className="salon-section salon-placeholder" data-block={block.type}>
      <p className="salon-site__eyebrow">{block.type.replaceAll("_", " ")}</p>
      <h2>{fallback}</h2>
      <p>Контент этого раздела синхронизируется с кабинетом салона.</p>
    </section>
  );
}

export function SalonSiteCanvas({ snapshot, services = [], staff = [], reviews = [], embedded = false, editor = false, includeDisabled = false, renderBlock }: SalonSiteCanvasProps) {
  const blocks = useMemo(
    () => [...snapshot.blocks].filter((block) => includeDisabled || block.enabled).sort((left, right) => left.position - right.position),
    [includeDisabled, snapshot.blocks],
  );
  const navigation = blocks.filter((block) => block.type !== "hero" && sectionLabels[block.type]).slice(0, 3);
  const accent = typeof snapshot.theme?.vermillion === "string" ? snapshot.theme.vermillion : "#d15022";
  const tickerFocus = snapshot.salonType === "barbershop" ? "Стрижки и борода" : snapshot.salonType === "women_hair_salon" ? "Стрижки и цвет" : "Стиль для каждого";

  return (
    <div className={`salon-site${embedded ? " salon-site--embedded" : ""}`} style={{ "--salon-accent": accent } as React.CSSProperties}>
      <header className="salon-site__header">
        <a href="#top" className="salon-site__brand">
          {snapshot.logoUrl ? <span className="salon-site__logo" style={{ backgroundImage: `url("${mediaUrl(snapshot.logoUrl, snapshot, embedded)}")` }} /> : <i>{snapshot.name.charAt(0)}</i>}
          <strong>{snapshot.name}</strong>
        </a>
        <nav aria-label="Навигация сайта салона">
          {navigation.map((block) => <a href={`#${sectionId(block.type)}`} key={block.id}>{sectionLabels[block.type]}</a>)}
          <Link href="/client">Мой кабинет</Link>
        </nav>
        <Link className="salon-site__header-cta" href={bookingHref()}>Записаться</Link>
      </header>
      <div className="salon-site__ticker" aria-hidden="true"><div><span>{tickerFocus}</span><i>✦</i><span>Онлайн-запись</span><i>✦</i><span>Портфолио мастеров</span><i>✦</i><span>{snapshot.city || "Рядом с вами"}</span><i>✦</i></div></div>
      <main id="top">
        {blocks.length ? blocks.map((block) => {
          const content = <SiteBlock block={block} snapshot={snapshot} services={services} staff={staff} reviews={reviews} embedded={embedded || editor} />;
          const appearance = blockAppearance(block);
          return <div className={`salon-site__block ${appearance.className}`.trim()} style={appearance.style} key={block.id}>{renderBlock ? renderBlock(block, content) : content}</div>;
        }) : (
          <section className="salon-hero"><p className="salon-site__eyebrow">Сайт готовится</p><h1>{snapshot.name}</h1><p>{snapshot.description || "Скоро здесь появятся услуги и онлайн-запись."}</p></section>
        )}
      </main>
      <footer className="salon-site__footer"><strong>{snapshot.name}</strong><span>{[snapshot.city, snapshot.street].filter(Boolean).join(", ")}</span><small>Онлайн-запись на сайте салона</small></footer>
    </div>
  );
}

export function PublicSalonSite({ previewToken }: { previewToken?: string }) {
  const [snapshot, setSnapshot] = useState<PublicSiteSnapshot | null>(null);
  const [services, setServices] = useState<PublicServiceView[]>([]);
  const [staff, setStaff] = useState<PublicStaffView[]>([]);
  const [reviews, setReviews] = useState<PublicReviewView[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const sitePath = `/public/site${previewToken ? `?previewToken=${encodeURIComponent(previewToken)}` : ""}`;
    Promise.allSettled([
      apiRequest<PublicSiteSnapshot>(sitePath),
      apiRequest<PublicServiceView[]>("/public/services"),
      apiRequest<PublicStaffView[]>("/public/staff"),
      apiRequest<PublicReviewView[]>("/public/reviews"),
    ]).then(([siteResult, serviceResult, staffResult, reviewResult]) => {
      if (!active) return;
      if (siteResult.status === "rejected") {
        setError(siteResult.reason instanceof Error ? siteResult.reason.message : "Сайт пока недоступен");
        return;
      }
      setSnapshot(siteResult.value);
      if (serviceResult.status === "fulfilled") setServices(serviceResult.value);
      if (staffResult.status === "fulfilled") setStaff(staffResult.value);
      if (reviewResult.status === "fulfilled") setReviews(reviewResult.value);
    });
    return () => { active = false; };
  }, [previewToken]);

  if (error) return <main className="salon-site-state"><span>404</span><h1>Сайт пока недоступен</h1><p>{error}</p></main>;
  if (!snapshot) return <main className="salon-site-state" aria-busy="true"><i /><p>Открываем сайт салона…</p></main>;
  return <SalonSiteCanvas snapshot={snapshot} services={services} staff={staff} reviews={reviews} />;
}
