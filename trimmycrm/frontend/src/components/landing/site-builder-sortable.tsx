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
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Grip, Move } from "lucide-react";
import { useState, type KeyboardEvent } from "react";

import styles from "./site-builder-sortable.module.css";

type SiteBlock = {
  id: string;
  title: string;
  description: string;
  tone: "paper" | "mint" | "vermillion";
  size: "wide" | "regular";
};

const initialBlocks: SiteBlock[] = [
  { id: "cover", title: "Обложка", description: "Название, позиционирование и кнопка записи.", tone: "vermillion", size: "wide" },
  { id: "services", title: "Услуги", description: "Цена, длительность и варианты процедуры.", tone: "paper", size: "regular" },
  { id: "team", title: "Команда", description: "Мастера, специализация и расписание.", tone: "mint", size: "regular" },
  { id: "works", title: "Работы", description: "Стрижки, цвет и форма без шаблонного портфолио.", tone: "paper", size: "wide" },
  { id: "booking", title: "Онлайн-запись", description: "Свободные слоты прямо на сайте салона.", tone: "mint", size: "regular" },
  { id: "contacts", title: "Контакты", description: "Адрес, график, маршрут и способы связи.", tone: "paper", size: "regular" },
];

function SortableBlock({ block, onKeyboardMove }: { block: SiteBlock; onKeyboardMove: (id: string, offset: number) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.shiftKey && ["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      onKeyboardMove(block.id, ["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1);
      return;
    }
    listeners?.onKeyDown?.(event);
  };

  return (
    <button
      ref={setNodeRef}
      className={`${styles.block} ${styles[block.tone]} ${styles[block.size]}${isDragging ? ` ${styles.dragging}` : ""}`}
      type="button"
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      onKeyDown={handleKeyDown}
    >
      <span className={styles.blockTop}>
        <Move aria-hidden="true" />
        <Grip aria-hidden="true" />
      </span>
      <strong>{block.title}</strong>
      <span>{block.description}</span>
    </button>
  );
}

export function SiteBuilderSortable() {
  const [blocks, setBlocks] = useState(initialBlocks);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const activeBlock = blocks.find((block) => block.id === activeId);

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    if (!over || active.id === over.id) return;
    setBlocks((current) => {
      const from = current.findIndex((block) => block.id === active.id);
      const to = current.findIndex((block) => block.id === over.id);
      return arrayMove(current, from, to);
    });
  };

  const moveWithKeyboard = (id: string, offset: number) => {
    setBlocks((current) => {
      const from = current.findIndex((block) => block.id === id);
      const to = Math.max(0, Math.min(current.length - 1, from + offset));
      if (from === to) return current;
      const next = arrayMove(current, from, to);
      setAnnouncement(`${current[from].title}: позиция ${to + 1} из ${current.length}`);
      return next;
    });
  };

  return (
    <div className={styles.shell}>
      <div className={styles.toolbar}>
        <span>Структура главной</span>
        <span>{blocks.length} блоков</span>
      </div>
      <DndContext
        id="landing-site-builder"
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={({ active }: DragStartEvent) => setActiveId(String(active.id))}
        onDragCancel={() => setActiveId(null)}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={blocks.map((block) => block.id)} strategy={rectSortingStrategy}>
          <div className={styles.grid}>
            {blocks.map((block) => <SortableBlock block={block} key={block.id} onKeyboardMove={moveWithKeyboard} />)}
          </div>
        </SortableContext>
        <DragOverlay dropAnimation={{ duration: 260, easing: "cubic-bezier(.16, 1, .3, 1)" }}>
          {activeBlock ? (
            <div className={`${styles.block} ${styles[activeBlock.tone]} ${styles[activeBlock.size]} ${styles.overlay}`}>
              <span className={styles.blockTop}><Move aria-hidden="true" /><Grip aria-hidden="true" /></span>
              <strong>{activeBlock.title}</strong>
              <span>{activeBlock.description}</span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      <p className={styles.hint}>Перетаскивайте мышью. С клавиатуры используйте Shift и стрелки.</p>
      <p className={styles.srOnly} aria-live="polite">{announcement}</p>
    </div>
  );
}
