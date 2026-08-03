"use client";

import { useEffect } from "react";

export function LandingMotion() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".editorial-landing");
    if (!root) return;
    const elements = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    for (const element of elements) {
      const bounds = element.getBoundingClientRect();
      element.dataset.revealState = reducedMotion || (bounds.top < window.innerHeight * 1.03 && bounds.bottom > 0)
        ? "visible"
        : "hidden";
    }
    root.dataset.motionReady = "true";
    if (reducedMotion) return;

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const element = entry.target as HTMLElement;
        if (entry.isIntersecting) {
          element.dataset.revealState = "visible";
          continue;
        }
        element.dataset.revealOrigin = entry.boundingClientRect.top < (entry.rootBounds?.top ?? 0) ? "above" : "below";
        element.dataset.revealState = "hidden";
      }
    }, { rootMargin: "6% 0px 6%", threshold: .08 });

    for (const element of elements) observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return null;
}
