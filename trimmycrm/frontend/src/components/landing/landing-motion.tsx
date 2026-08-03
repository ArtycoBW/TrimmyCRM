"use client";

import { useEffect } from "react";

export function LandingMotion() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".editorial-landing");
    if (!root) return;
    const elements = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    for (const element of elements) {
      if (reducedMotion || element.getBoundingClientRect().top < window.innerHeight * .92) {
        element.dataset.revealState = "visible";
      }
    }
    root.dataset.motionReady = "true";
    if (reducedMotion) return;

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        (entry.target as HTMLElement).dataset.revealState = "visible";
        observer.unobserve(entry.target);
      }
    }, { rootMargin: "0px 0px -8%", threshold: .12 });

    for (const element of elements) {
      if (element.dataset.revealState !== "visible") observer.observe(element);
    }
    return () => observer.disconnect();
  }, []);

  return null;
}
