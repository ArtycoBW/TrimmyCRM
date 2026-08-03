"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Image from "next/image";
import { useState, type KeyboardEvent } from "react";

import styles from "./site-builder-sortable.module.css";

type BlockKind = "cover" | "services" | "team" | "works" | "booking" | "contacts";
type SiteBlock = { id: BlockKind; label: string };

const initialBlocks: SiteBlock[] = [
  { id: "cover", label: "Обложка" },
  { id: "services", label: "Услуги" },
  { id: "team", label: "Команда" },
  { id: "works", label: "Работы" },
  { id: "booking", label: "Онлайн-запись" },
  { id: "contacts", label: "Контакты" },
];

const workImages = [
  "/images/editorial/woman-copper-bob.webp",
  "/images/editorial/man-textured-crop.webp",
  "/images/editorial/woman-graphic-pixie.webp",
] as const;

function BlockContent({ kind }: { kind: BlockKind }) {
  if (kind === "cover") {
    return (
      <div className={styles.cover}>
        <Image src="/images/editorial/salon-copper-consultation.webp" alt="Мастер и клиентка в салоне" fill sizes="(max-width: 780px) 90vw, 46vw" />
        <div><span>Студия Форма</span><strong>Цвет и стрижка, которые остаются вашими.</strong><b>Записаться</b></div>
      </div>
    );
  }

  if (kind === "services") {
    return (
      <div className={styles.services}>
        <h3>Услуги</h3>
        <ul>
          <li><span>Стрижка и укладка</span><b>3 200 ₽</b></li>
          <li><span>Сложное окрашивание</span><b>от 6 900 ₽</b></li>
          <li><span>Форма бороды</span><b>1 800 ₽</b></li>
        </ul>
      </div>
    );
  }

  if (kind === "team") {
    return (
      <div className={styles.team}>
        <div><h3>Люди, которым доверяют волосы.</h3><span>Выберите мастера по стилю работ.</span></div>
        <div className={styles.teamFaces}>
          {workImages.slice(0, 2).map((src, index) => (
            <figure key={src}><Image src={src} alt={index === 0 ? "Женский мастер" : "Мужской мастер"} fill sizes="110px" /></figure>
          ))}
        </div>
      </div>
    );
  }

  if (kind === "works") {
    return (
      <div className={styles.works}>
        {workImages.map((src, index) => (
          <figure key={src}><Image src={src} alt={`Работа мастера ${index + 1}`} fill sizes="(max-width: 780px) 28vw, 15vw" /></figure>
        ))}
      </div>
    );
  }

  if (kind === "booking") {
    return (
      <div className={styles.booking}>
        <div><span>Ближайшая запись</span><h3>Выберите удобное время</h3></div>
        <div className={styles.slots}><b>11:30</b><b>14:00</b><b>17:30</b></div>
      </div>
    );
  }

  return (
    <div className={styles.contacts}>
      <strong>Москва, Покровка 18</strong>
      <span>Ежедневно, 10:00-21:00</span>
      <b>Построить маршрут</b>
    </div>
  );
}

function SortableBlock({ block, onKeyboardMove }: { block: SiteBlock; onKeyboardMove: (id: string, offset: number) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.shiftKey && ["ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      onKeyboardMove(block.id, event.key === "ArrowUp" ? -1 : 1);
      return;
    }
    listeners?.onKeyDown?.(event);
  };

  return (
    <article
      ref={setNodeRef}
      className={`${styles.block}${isDragging ? ` ${styles.dragging}` : ""}`}
      data-kind={block.id}
      aria-label={`Переместить секцию ${block.label}`}
      {...attributes}
      {...listeners}
      onKeyDown={handleKeyDown}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <BlockContent kind={block.id} />
    </article>
  );
}

export function SiteBuilderSortable() {
  const [blocks, setBlocks] = useState(initialBlocks);
  const [activeId, setActiveId] = useState<BlockKind | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const activeBlock = blocks.find((block) => block.id === activeId);

  const move = (id: string, offset: number) => {
    setBlocks((current) => {
      const from = current.findIndex((block) => block.id === id);
      const to = Math.max(0, Math.min(current.length - 1, from + offset));
      if (from === to) return current;
      const next = arrayMove(current, from, to);
      setAnnouncement(`${current[from].label}: позиция ${to + 1} из ${current.length}`);
      return next;
    });
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    if (!over || active.id === over.id) return;
    setBlocks((current) => {
      const from = current.findIndex((block) => block.id === active.id);
      const to = current.findIndex((block) => block.id === over.id);
      return arrayMove(current, from, to);
    });
  };

  return (
    <div className={styles.shell}>
      <div className={styles.browserBar}>
        <strong>Форма</strong>
        <nav aria-label="Пример навигации сайта"><span>Услуги</span><span>Команда</span><span>Работы</span></nav>
        <b>Записаться</b>
      </div>
      <DndContext
        id="landing-site-builder"
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={({ active }: DragStartEvent) => setActiveId(active.id as BlockKind)}
        onDragCancel={() => setActiveId(null)}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={blocks.map((block) => block.id)} strategy={verticalListSortingStrategy}>
          <div className={styles.grid}>
            {blocks.map((block) => <SortableBlock block={block} key={block.id} onKeyboardMove={move} />)}
          </div>
        </SortableContext>
        <DragOverlay dropAnimation={{ duration: 520, easing: "cubic-bezier(.22, 1, .36, 1)" }}>
          {activeBlock ? <article className={`${styles.block} ${styles.overlay}`} data-kind={activeBlock.id}><BlockContent kind={activeBlock.id} /></article> : null}
        </DragOverlay>
      </DndContext>
      <p className={styles.srOnly} aria-live="polite">{announcement}</p>
    </div>
  );
}
