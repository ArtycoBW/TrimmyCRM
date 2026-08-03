"use client";

import { ArrowUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import styles from "./editorial-footer.module.css";

export function FooterToTop() {
  const markerRef = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const footer = markerRef.current?.closest("footer");
    if (!footer) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: .02 });
    observer.observe(footer);
    return () => observer.disconnect();
  }, []);

  const goToTop = () => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
  };

  return (
    <>
      <span ref={markerRef} className={styles.topMarker} aria-hidden="true" />
      <button
        className={styles.toTop}
        type="button"
        aria-label="Вернуться в начало страницы"
        aria-hidden={!visible}
        tabIndex={visible ? 0 : -1}
        data-visible={visible ? "true" : "false"}
        onClick={goToTop}
      >
        <ArrowUp aria-hidden="true" />
      </button>
    </>
  );
}
