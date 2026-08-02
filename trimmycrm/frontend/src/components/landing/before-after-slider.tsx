"use client";

import Image from "next/image";
import { useState, type CSSProperties } from "react";

export function BeforeAfterSlider() {
  const [position, setPosition] = useState(52);
  const style = { "--comparison-position": `${position}%` } as CSSProperties;

  return (
    <div className="before-after" style={style}>
      <div className="before-after__frame">
        <Image
          className="before-after__image before-after__image--before"
          src="/images/landing/before-consultation.svg"
          alt="Образ до выбора новой формы"
          fill
          priority
          sizes="(max-width: 800px) 92vw, 680px"
        />
        <div className="before-after__after" aria-hidden="true">
          <Image
            className="before-after__image before-after__image--after"
            src="/images/landing/after-style.svg"
            alt=""
            fill
            priority
            sizes="(max-width: 800px) 92vw, 680px"
          />
        </div>
        <span className="before-after__label before-after__label--before">До</span>
        <span className="before-after__label before-after__label--after">После</span>
        <span className="before-after__divider" aria-hidden="true"><i>↔</i></span>
        <input
          aria-label="Сравнить образ до и после работы мастера"
          type="range"
          min="4"
          max="96"
          value={position}
          onChange={(event) => setPosition(Number(event.target.value))}
        />
      </div>
      <p>Передвиньте разделитель и сравните результат</p>
    </div>
  );
}
