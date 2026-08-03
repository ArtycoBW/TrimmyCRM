"use client";

import Image from "next/image";
import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from "react";

import styles from "./infinite-gallery.module.css";

export type EditorialPhoto = {
  src: string;
  alt: string;
  label: string;
};

export function HeroPhotoLoop({ photos }: { photos: readonly EditorialPhoto[] }) {
  return (
    <div className={styles.heroViewport} aria-label="Работы мужских и женских мастеров">
      <div className={styles.heroTrack}>
        {[0, 1].map((group) => (
          <div className={styles.heroGroup} key={group} aria-hidden={group === 1}>
            {photos.map((photo, index) => (
              <figure className={styles.heroFrame} key={`${group}-${photo.src}`}>
                <Image
                  src={photo.src}
                  alt={group === 0 ? photo.alt : ""}
                  fill
                  priority={group === 0 && index < 2}
                  sizes="(max-width: 780px) 58vw, 25vw"
                />
              </figure>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function InfiniteDragGallery({ photos }: { photos: readonly EditorialPhoto[] }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const pausedRef = useRef(false);
  const pointerStartRef = useRef({ x: 0, scrollLeft: 0 });

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let animationFrame = 0;
    let previousTime = performance.now();

    const loopWidth = () => viewport.scrollWidth / 3;
    const normalize = () => {
      const width = loopWidth();
      if (!width) return;
      if (viewport.scrollLeft < width * .45) viewport.scrollLeft += width;
      if (viewport.scrollLeft > width * 1.55) viewport.scrollLeft -= width;
    };

    viewport.scrollLeft = loopWidth();
    const tick = (time: number) => {
      const delta = Math.min(time - previousTime, 48);
      previousTime = time;
      if (!reduceMotion.matches && !draggingRef.current && !pausedRef.current) {
        viewport.scrollLeft += delta * .026;
        normalize();
      }
      animationFrame = requestAnimationFrame(tick);
    };
    animationFrame = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(animationFrame);
  }, []);

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    if (!viewport || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    viewport.scrollBy({ left: event.key === "ArrowLeft" ? -260 : 260, behavior: "smooth" });
  };

  return (
    <div
      ref={viewportRef}
      className={styles.dragViewport}
      role="region"
      aria-label="Бесконечная галерея форматов салона. Перетаскивайте по горизонтали"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onPointerDown={(event) => {
        draggingRef.current = true;
        pointerStartRef.current = { x: event.clientX, scrollLeft: event.currentTarget.scrollLeft };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!draggingRef.current) return;
        event.currentTarget.scrollLeft = pointerStartRef.current.scrollLeft - (event.clientX - pointerStartRef.current.x);
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onMouseEnter={() => { pausedRef.current = true; }}
      onMouseLeave={() => { pausedRef.current = false; draggingRef.current = false; }}
      onFocus={() => { pausedRef.current = true; }}
      onBlur={() => { pausedRef.current = false; }}
    >
      <div className={styles.dragTrack}>
        {[0, 1, 2].map((group) => (
          <div className={styles.dragCanvas} key={group} aria-hidden={group !== 1}>
            {photos.map((photo) => (
              <figure className={styles.dragFrame} key={`${group}-${photo.src}`}>
                <div className={styles.dragImage}>
                  <Image
                    src={photo.src}
                    alt={group === 1 ? photo.alt : ""}
                    fill
                    sizes="(max-width: 780px) 54vw, 24vw"
                  />
                </div>
                <figcaption>{photo.label}</figcaption>
              </figure>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
