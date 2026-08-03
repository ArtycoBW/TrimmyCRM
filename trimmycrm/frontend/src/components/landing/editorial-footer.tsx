import { ArrowUp, ArrowUpRight } from "lucide-react";
import Image from "next/image";

import { LandingFooterAccountLink, LandingPrimaryAction } from "@/components/landing/landing-session";
import { legalConfig } from "@/components/legal/legal-config";

import styles from "./editorial-footer.module.css";

const footerImages = [
  {
    src: "/images/editorial/salon-cut-session.webp",
    alt: "Рабочая стрижка в современном барбершопе",
    caption: "Рабочий день",
  },
  {
    src: "/images/editorial/woman-copper-bob.webp",
    alt: "Женщина с медным бобом",
    caption: "Женский салон",
  },
  {
    src: "/images/editorial/man-textured-crop.webp",
    alt: "Мужчина с текстурным кропом",
    caption: "Барбершоп",
  },
] as const;

export function EditorialFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.cta} data-reveal>
        <div>
          <h2>Соберите сайт. Откройте запись. Ведите салон.</h2>
        </div>
        <div className={styles.ctaAside}>
          <p>14 дней бесплатно. Карта на старте не нужна.</p>
          <LandingPrimaryAction className={styles.footerAction} anonymousLabel="Попробовать TrimmyCRM" />
        </div>
      </div>

      <div className={styles.gallery} data-reveal data-reveal-delay="1">
        {footerImages.map((image, index) => (
          <figure key={image.src} data-size={index === 0 ? "wide" : "portrait"}>
            <div>
              <Image src={image.src} alt={image.alt} fill sizes={index === 0 ? "(max-width: 780px) 100vw, 50vw" : "(max-width: 780px) 50vw, 24vw"} />
            </div>
            <figcaption>{image.caption}</figcaption>
          </figure>
        ))}
      </div>

      <div className={styles.wordmark} aria-hidden="true"><span>Trimmy</span>CRM</div>

      <div className={styles.bottom}>
        <div className={styles.brand}>
          <strong><span>Trimmy</span>CRM</strong>
          <p>Сайт, запись и управление салоном в одном продукте.</p>
        </div>
        <nav aria-label="Документы и поддержка">
          <a href="/privacy">Политика</a>
          <a href="/terms">Условия</a>
          <a href="/consent">Согласие</a>
          <a href={`mailto:${legalConfig.email}`}>Поддержка <ArrowUpRight aria-hidden="true" /></a>
        </nav>
        <div className={styles.account}>
          <LandingFooterAccountLink />
          <a href="#top">Наверх <ArrowUp aria-hidden="true" /></a>
        </div>
        <small>© {new Date().getFullYear()} TrimmyCRM</small>
      </div>
    </footer>
  );
}
