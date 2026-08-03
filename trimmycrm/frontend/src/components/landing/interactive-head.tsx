"use client";

import { Rotate3D } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from "react";

import styles from "./interactive-head.module.css";

const FRAME_COUNT = 8;

function frameTransform(frame: number) {
  const column = frame % 4;
  const row = Math.floor(frame / 4);
  return `translate3d(${-column * 25}%, ${-row * 50}%, 0)`;
}

export function InteractiveHead() {
  const spriteRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef(0);
  const startXRef = useRef(0);
  const startFrameRef = useRef(0);
  const draggingRef = useRef(false);

  const renderFrame = (frame: number) => {
    const normalized = (frame + FRAME_COUNT) % FRAME_COUNT;
    frameRef.current = normalized;
    spriteRef.current?.style.setProperty("--head-transform", frameTransform(normalized));
  };

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => {
      if (!draggingRef.current) renderFrame(frameRef.current + 1);
    }, 1800);
    return () => window.clearInterval(timer);
  }, []);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    draggingRef.current = true;
    startXRef.current = event.clientX;
    startFrameRef.current = frameRef.current;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.dataset.dragging = "true";
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const step = Math.round((event.clientX - startXRef.current) / 42);
    renderFrame(startFrameRef.current - step);
  };

  const handlePointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    delete event.currentTarget.dataset.dragging;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    renderFrame(frameRef.current + (event.key === "ArrowLeft" ? -1 : 1));
  };

  return (
    <div className={styles.stage} data-parallax>
      <div
        className={styles.viewport}
        role="img"
        tabIndex={0}
        aria-label="Фотореалистичная причёска. Потяните в сторону или используйте стрелки, чтобы повернуть голову"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onKeyDown={handleKeyDown}
      >
        <div className={styles.sprite} ref={spriteRef}>
          <Image
            src="/images/editorial/head-turntable.webp"
            alt=""
            fill
            priority
            sizes="(max-width: 780px) 92vw, 56vw"
          />
        </div>
      </div>
      <span className={styles.control} aria-hidden="true"><Rotate3D /></span>
      <div className={styles.plane} aria-hidden="true" />
    </div>
  );
}
