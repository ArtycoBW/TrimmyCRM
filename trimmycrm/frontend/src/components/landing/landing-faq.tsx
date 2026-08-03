"use client";

import { Plus } from "lucide-react";
import { useState } from "react";

import styles from "./editorial-landing.module.css";

type FaqItem = {
  question: string;
  answer: string;
};

type LandingFaqProps = {
  items: readonly FaqItem[];
};

export function LandingFaq({ items }: LandingFaqProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <div className={styles.faqList} data-reveal data-reveal-delay="1" data-parallax>
      {items.map((item, index) => {
        const isOpen = openIndex === index;
        const panelId = `faq-panel-${index}`;

        return (
          <article className={styles.faqItem} data-open={isOpen} key={item.question}>
            <h3>
              <button
                aria-controls={panelId}
                aria-expanded={isOpen}
                className={styles.faqButton}
                onClick={() => setOpenIndex(isOpen ? null : index)}
                type="button"
              >
                <span>{item.question}</span>
                <Plus aria-hidden="true" />
              </button>
            </h3>
            <div className={styles.faqAnswer} id={panelId} aria-hidden={!isOpen}>
              <div><p>{item.answer}</p></div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
